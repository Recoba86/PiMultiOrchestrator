import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT = resolve(REPO_ROOT, "..", "pi-multi-orchestrator-release");
const EXPECTED_FILES = ["dist/**/*.js", "dist/**/*.d.ts", "README.md"];
const OPTIONAL_FILES = ["docs/OPERATOR_GUIDE.md"];
const ENTRYPOINT = "dist/host/pi-extension.js";
export const DIRECTORY_SOURCE = "directory-source";

const fail = (message) => {
	throw new Error(message);
};

const isPathInside = (parent, candidate) => {
	const child = relative(parent, candidate);
	return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
};

const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
	const child = spawn(command, args, {
		cwd: options.cwd,
		env: options.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.on("error", reject);
	child.on("close", (code) => {
		if (code === 0) {
			resolvePromise({ stdout, stderr });
			return;
		}
		reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown"}: ${stderr.trim()}`));
	});
});

const sha256 = async (path) => {
	const digest = createHash("sha256");
	digest.update(await readFile(path));
	return digest.digest("hex");
};

const commandOutput = async (command, args, options = {}) => (await run(command, args, options)).stdout.trim();

const walkFiles = async (root, prefix = "") => {
	const entries = await readdir(join(root, prefix), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(prefix, entry.name);
		if (entry.isDirectory()) files.push(...await walkFiles(root, path));
		else if (entry.isFile()) files.push(path.split("\\").join("/"));
	}
	return files;
};

const sortUnique = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right));

const readChecksum = async (checksumPath, artifactName) => {
	const value = (await readFile(checksumPath, "utf8")).trim();
	const match = /^(?<hash>[a-f0-9]{64})  (?<name>[^\n]+)$/u.exec(value);
	if (!match || match.groups.name !== artifactName) fail(`invalid checksum file for ${artifactName}`);
	return match.groups.hash;
};

export const verifyArtifactChecksum = async (artifactPath, checksumPath = `${artifactPath}.sha256`) => {
	const artifactName = artifactPath.split(/[\\/]/u).pop();
	if (!artifactName) fail("artifact path has no filename");
	const expected = await readChecksum(checksumPath, artifactName);
	const actual = await sha256(artifactPath);
	if (actual !== expected) fail(`artifact checksum mismatch for ${artifactName}`);
	return actual;
};

const privacyTextPatterns = [
	{ name: "private-key", pattern: /-----BEGIN(?: [^-]+)? PRIVATE KEY-----/iu },
	{ name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u },
	{ name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u },
	{ name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/u },
	{ name: "openai-style-token", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/u },
	{ name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u },
	{ name: "bearer-token", pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}\b/iu },
	{ name: "credential-assignment", pattern: /\b(?:api[_-]?key|authorization|password|secret|token|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9+/._~=-]{16,}["']/iu },
	{ name: "credential-assignment-unquoted", pattern: /\b(?:API[_-]?KEY|AUTHORIZATION|PASSWORD|SECRET|TOKEN|PRIVATE[_-]?KEY)\s*=\s*[A-Za-z0-9+\/_~=-]{16,}\b/u },
	{ name: "credential-url", pattern: /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@/iu },
];
const localPathPattern = /(?:^|["'`\s(])(?:\/(?:Users|private|home|tmp|var\/folders)\/|[A-Z]:[\\/]Users[\\/])/u;
const runtimeDatabaseName = /(?:^|\/)(?:[^/]+\.(?:sqlite(?:[-.][^/]*)?|sqlite3|db(?:[-.][^/]*)?|log)|(?:state|history|sessions?)(?:\/|$))/iu;

export const scanPrivacy = async (root) => {
	const issues = [];
	const files = await walkFiles(root);
	for (const path of files) {
		if (runtimeDatabaseName.test(path)) issues.push(`${path}: runtime-state filename`);
		const content = await readFile(join(root, path));
		if (content.includes(Buffer.from("SQLite format 3\0"))) issues.push(`${path}: SQLite database signature`);
		if (content.includes(0)) continue;
		const text = content.toString("utf8");
		if (localPathPattern.test(text)) issues.push(`${path}: local absolute path`);
		for (const pattern of privacyTextPatterns) {
			if (pattern.pattern.test(text)) issues.push(`${path}: ${pattern.name}`);
		}
	}
	return sortUnique(issues);
};

const parseArgs = (argv) => {
	let output = process.env.PI_RELEASE_OUTPUT ? resolve(process.env.PI_RELEASE_OUTPUT) : DEFAULT_OUTPUT;
	let force = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--output" || arg === "-o") {
			const value = argv[index + 1];
			if (!value) fail("--output requires a directory");
			output = resolve(value);
			index += 1;
		} else if (arg === "--force") {
			force = true;
		} else if (arg === "--help" || arg === "-h") {
			return { help: true, output, force };
		} else {
			fail(`unknown argument: ${arg}`);
		}
	}
	return { output, force, help: false };
};

const packagePathAllowed = (path) => path === "README.md"
	|| OPTIONAL_FILES.includes(path)
	|| /^dist\/(?:.*\/)?[^/]+\.js$/u.test(path)
	|| /^dist\/(?:.*\/)?[^/]+\.d\.ts$/u.test(path);

const assertManifest = (manifest) => {
	if (manifest.private === true) fail("release candidate package must not be private");
	if (manifest.version !== "0.1.0-rc.1") fail(`expected release-candidate version 0.1.0-rc.1, got ${manifest.version}`);
	if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("pi-package")) fail("package is missing the pi-package keyword");
	if (!Array.isArray(manifest.files) || !EXPECTED_FILES.every((file) => manifest.files.includes(file))) fail("package files allowlist is missing a required entry");
	if (manifest.files.some((file) => !EXPECTED_FILES.includes(file) && !OPTIONAL_FILES.includes(file))) fail("package files allowlist contains an unexpected entry");
	if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) fail("runtime dependencies are not allowed in the release candidate");
	if (manifest.engines?.node !== ">=22.19.0") fail("Node engine must remain >=22.19.0");
	if (manifest.peerDependencies?.["@earendil-works/pi-coding-agent"] !== ">=0.84.1 <0.85.0") fail("Pi peer dependency range is not the validated 0.84.x range");
	if (JSON.stringify(manifest.pi?.extensions) !== JSON.stringify([`./${ENTRYPOINT}`])) fail("Pi manifest must expose the compiled extension entrypoint only");
	if (manifest.exports?.["./pi"]?.import !== `./${ENTRYPOINT}`) fail("./pi export must point at the compiled extension entrypoint");
};

const verifyUnpacked = async ({ packageRoot, packageManifest, files }) => {
	const actualFiles = (await walkFiles(packageRoot)).sort();
	const expectedFiles = files.map((file) => file.path).sort();
	if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) fail("unpacked files differ from npm pack file list");
	if (!actualFiles.includes("package.json")) fail("unpacked artifact is missing package.json");
	const packageFiles = actualFiles.filter((path) => path !== "package.json");
	const disallowed = packageFiles.filter((path) => !packagePathAllowed(path));
	if (disallowed.length > 0) fail(`artifact allowlist violation: ${disallowed.join(", ")}`);
	if (!actualFiles.includes(ENTRYPOINT)) fail(`compiled Pi entrypoint missing: ${ENTRYPOINT}`);
	const sourceLeak = /(?:^|["'`])(?:\.\.\/)+src\/|(?:^|["'`])\/(?:Users|private|home|tmp|var\/folders)\/|(?:^|["'`])[A-Z]:[\\/]Users[\\/]/u;
	const sourceMapLinks = [];
	for (const path of actualFiles.filter((entry) => /\.(?:js|d\.ts)$/u.test(entry))) {
		const content = await readFile(join(packageRoot, path), "utf8");
		if (path.endsWith(".js")) {
			for (const specifier of content.matchAll(/(?:from\s+|import\s*\()\s*["'](\.{1,2}\/[^"']+)["']/gu)) {
				const target = specifier[1].endsWith(".js") ? specifier[1] : specifier[1] + ".js";
				const resolved = resolve(dirname(join(packageRoot, path)), target);
				if (!isPathInside(packageRoot, resolved)) fail("relative import escapes package");
				try {
					await stat(resolved);
				} catch {
					fail("relative import is missing from unpacked artifact");
				}
			}
		}
		if (path.endsWith(".js")) {
			for (const match of content.matchAll(/(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL=([^\s*]+)\s*(?:\*\/)?/gu)) {
				const target = resolve(dirname(join(packageRoot, path)), match[1]);
				if (!isPathInside(packageRoot, target)) fail(`source map reference escapes package from ${path}`);
				try { await stat(target); } catch { sourceMapLinks.push(`${path} -> ${match[1]}`); }
			}
		}
		if (sourceLeak.test(content)) fail(`source path leaked into ${path}`);
	}
	if (sourceMapLinks.length > 0) fail(`dangling source map reference: ${sourceMapLinks.join(", ")}`);
	const privacyIssues = await scanPrivacy(packageRoot);
	if (privacyIssues.length > 0) fail(`privacy scan failed: ${privacyIssues.join(", ")}`);
	await run(process.execPath, ["--check", join(packageRoot, ENTRYPOINT)]);
	const hostPeerRoot = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent");
	await mkdir(dirname(hostPeerRoot), { recursive: true });
	try {
		await cp(join(REPO_ROOT, "node_modules", "@earendil-works", "pi-coding-agent"), hostPeerRoot, { recursive: true });
	} catch (error) {
		fail(`validated Pi peer is unavailable: ${error instanceof Error ? error.message : String(error)}`);
	}
	const entryUrl = pathToFileURL(join(packageRoot, ENTRYPOINT)).href;
	await run(process.execPath, ["--input-type=module", "-e", `const module = await import(${JSON.stringify(entryUrl)}); if (typeof module.default !== "function") throw new Error("compiled Pi entrypoint has no default extension function");`], { cwd: packageRoot });
	const unpackedManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	if (JSON.stringify(unpackedManifest) !== JSON.stringify(packageManifest)) fail("unpacked package.json differs from the source manifest");
	return {
		allowlist: true,
		entrypoint: true,
		manifest: true,
		sourceIndependent: true,
		privacySafe: privacyIssues.length === 0,
		syntax: true,
		sourceIndependentImport: true,
	};
};

const archiveEntries = async (artifactPath) => {
	const listing = await commandOutput("tar", ["-tzf", artifactPath]);
	const entries = listing.split(/\r?\n/u).map((entry) => entry.replace(/\/$/u, "")).filter(Boolean);
	for (const entry of entries) {
		if (entry.startsWith("/") || entry.split("/").includes("..") || !entry.startsWith("package/")) {
			fail(`unsafe archive entry: ${entry}`);
		}
	}
	return entries;
};

const assertSameFiles = async (leftRoot, rightRoot, paths) => {
	for (const path of paths) {
		const left = await readFile(join(leftRoot, path));
		const right = await readFile(join(rightRoot, path));
		if (!left.equals(right)) fail(`directory source differs from artifact for ${path}`);
	}
};

export async function verifyReleaseDirectory(directory) {
	const root = resolve(directory);
	const manifest = JSON.parse(await readFile(join(root, "release-manifest.json"), "utf8"));
	const verification = JSON.parse(await readFile(join(root, "verification.json"), "utf8"));
	const artifactName = manifest.artifact?.file;
	if (typeof artifactName !== "string" || artifactName !== artifactName.split(/[\\/]/u).pop() || !artifactName.endsWith(".tgz")) fail("release manifest has an invalid artifact filename");
	const artifactPath = join(root, artifactName);
	const artifactHash = await verifyArtifactChecksum(artifactPath, join(root, `${artifactName}.sha256`));
	if (manifest.artifact.sha256 !== artifactHash || verification.sha256 !== artifactHash) fail("release metadata checksum does not match artifact");
	if (manifest.artifact.size !== (await stat(artifactPath)).size) fail("release metadata artifact size does not match artifact");
	const records = manifest.files;
	if (!Array.isArray(records) || records.length === 0 || manifest.fileCount !== records.length) fail("release manifest file records are invalid");
	const listed = (await readFile(join(root, "artifact-files.txt"), "utf8")).trim().split(/\r?\n/u).filter(Boolean);
	const expectedPaths = records.map((record) => record.path).sort((left, right) => left.localeCompare(right));
	if (JSON.stringify(listed) !== JSON.stringify(expectedPaths)) fail("artifact file list differs from release manifest");
	if (verification.verified !== true || JSON.stringify(verification.checks) !== JSON.stringify(manifest.checks)) fail("verification evidence is not deterministic or complete");
	if (manifest.directorySource !== DIRECTORY_SOURCE) fail("release manifest is missing the supported directory source");
	const directorySourcePath = join(root, DIRECTORY_SOURCE);
	const directoryFiles = (await walkFiles(directorySourcePath)).sort((left, right) => left.localeCompare(right));
	if (JSON.stringify(directoryFiles) !== JSON.stringify(expectedPaths)) fail("directory source files differ from release manifest");
	for (const record of records) {
		const path = join(directorySourcePath, record.path);
		const digest = await sha256(path);
		if (digest !== record.sha256 || (await stat(path)).size !== record.size) fail(`directory source record mismatch for ${record.path}`);
	}
	const archiveList = await archiveEntries(artifactPath);
	const archivePaths = archiveList.filter((entry) => entry !== "package").map((entry) => entry.slice("package/".length)).sort((left, right) => left.localeCompare(right));
	if (JSON.stringify(archivePaths) !== JSON.stringify(expectedPaths)) fail("artifact archive files differ from release manifest");
	const staging = await mkdtemp(join(tmpdir(), "pi-multi-orchestrator-release-verify-"));
	try {
		await run("tar", ["-xzf", artifactPath, "-C", staging]);
		const packageRoot = join(staging, "package");
		await assertSameFiles(packageRoot, directorySourcePath, expectedPaths);
		const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
		const selectedManifest = {
			name: manifest.package?.name,
			version: manifest.package?.version,
			engines: manifest.package?.engines,
			peerDependencies: manifest.package?.peerDependencies,
			pi: manifest.package?.pi,
			files: manifest.package?.files,
		};
		const selectedPackage = {
			name: packageManifest.name,
			version: packageManifest.version,
			engines: packageManifest.engines,
			peerDependencies: packageManifest.peerDependencies,
			pi: packageManifest.pi,
			files: packageManifest.files,
		};
		if (JSON.stringify(selectedPackage) !== JSON.stringify(selectedManifest)) fail("artifact package.json differs from release manifest");
		await verifyUnpacked({ packageRoot, packageManifest, files: records });
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	return { verified: true, artifact: artifactName, sha256: artifactHash, directorySource: DIRECTORY_SOURCE, checks: manifest.checks };
}

export async function buildReleaseCandidate({ output, force = false } = {}) {
	const target = resolve(output ?? DEFAULT_OUTPUT);
	if (isPathInside(REPO_ROOT, target)) fail("release output must be outside the source checkout");
	const targetEntries = await readdir(target).catch((error) => {
		if (error?.code === "ENOENT") return [];
		throw error;
	});
	if (targetEntries.length > 0 && !force) fail(`release output is not empty: ${target}; use --force to overwrite it`);
	if (targetEntries.length > 0 && force) await rm(target, { recursive: true, force: true });
	await mkdir(target, { recursive: true });

	const sourceManifest = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8"));
	assertManifest(sourceManifest);
	const staging = await mkdtemp(join(tmpdir(), "pi-multi-orchestrator-release-"));
	try {
		const npmCache = join(staging, "npm-cache");
		await rm(join(REPO_ROOT, "dist"), { recursive: true, force: true });
		await run("npm", ["run", "build"], {
			cwd: REPO_ROOT,
			env: { ...process.env, npm_config_cache: npmCache },
		});
		const packed = await run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", staging], {
			cwd: REPO_ROOT,
			env: { ...process.env, npm_config_cache: npmCache },
		});
		const packInfo = JSON.parse(packed.stdout.trim());
		const info = Array.isArray(packInfo) ? packInfo[0] : packInfo;
		if (!info?.filename || !Array.isArray(info.files)) fail("npm pack did not return a package file list");
		const sourceArtifact = join(staging, info.filename);
		const packageRoot = join(staging, "unpacked", "package");
		await mkdir(packageRoot, { recursive: true });
		await run("tar", ["-xzf", sourceArtifact, "-C", join(staging, "unpacked")]);
		const directorySourcePath = join(target, DIRECTORY_SOURCE);
		await cp(packageRoot, directorySourcePath, { recursive: true });
		const checks = {
			...(await verifyUnpacked({ packageRoot, packageManifest: sourceManifest, files: info.files })),
			freshBuild: true,
			directorySource: true,
			sourceMaps: true,
		};
		const artifactPath = join(target, info.filename);
		await copyFile(sourceArtifact, artifactPath);
		const artifactHash = await sha256(artifactPath);
		const artifactSize = (await stat(artifactPath)).size;
		const fileRecords = [];
		for (const file of [...info.files].sort((left, right) => left.path.localeCompare(right.path))) {
			const path = join(packageRoot, file.path);
			fileRecords.push({ path: file.path, size: file.size, sha256: await sha256(path) });
		}
		const filesName = "artifact-files.txt";
		const checksumName = `${info.filename}.sha256`;
		const manifestName = "release-manifest.json";
		const verificationName = "verification.json";
		const gitCommit = await commandOutput("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
		const gitStatus = await commandOutput("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO_ROOT });
		const buildTimestamp = process.env.SOURCE_DATE_EPOCH
			? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
			: new Date().toISOString();
		const testResult = "not-run-by-release-script";
		await writeFile(join(target, filesName), `${fileRecords.map((file) => file.path).join("\n")}\n`, "utf8");
		await writeFile(join(target, checksumName), `${artifactHash}  ${info.filename}\n`, "utf8");
		const manifest = {
			schemaVersion: 1,
			releaseStatus: "candidate",
			gitCommit,
			dirty: gitStatus.length > 0,
			buildTimestamp,
			nodeVersion: process.version,
			piVersion: "0.84.1",
			testResult,
			configSchema: 2,
			missionSchema: 2,
			analyticsSchema: 1,
			liveCalls: 0,
			fileCount: fileRecords.length,
			package: {
				name: sourceManifest.name,
				version: sourceManifest.version,
				engines: sourceManifest.engines,
				peerDependencies: sourceManifest.peerDependencies,
				pi: sourceManifest.pi,
				files: sourceManifest.files,
			},
			artifact: { file: info.filename, size: artifactSize, sha256: artifactHash },
			directorySource: DIRECTORY_SOURCE,
			files: fileRecords,
			checks,
		};
		await writeFile(join(target, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		const verification = {
			schemaVersion: 1,
			verified: Object.values(checks).every(Boolean),
			artifact: info.filename,
			sha256: artifactHash,
			gitCommit,
			dirty: gitStatus.length > 0,
			checks,
		};
		await writeFile(join(target, verificationName), `${JSON.stringify(verification, null, 2)}\n`, "utf8");
		await verifyReleaseDirectory(target);
		return { output: target, artifact: artifactPath, directorySource: directorySourcePath, version: sourceManifest.version, sha256: artifactHash, checks };
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

const main = async () => {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log("Usage: npm run release:candidate -- [--output DIR] [--force]");
		return;
	}
	const result = await buildReleaseCandidate(options);
	console.log(JSON.stringify({
		...result,
		artifact: relative(process.cwd(), result.artifact),
		directorySource: relative(process.cwd(), result.directorySource),
	}, null, 2));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
