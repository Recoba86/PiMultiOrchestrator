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
const ENTRYPOINT = "dist/host/pi-extension.js";

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

const packagePathAllowed = (path) => path === "README.md" || /^dist\/(?:.*\/)?[^/]+\.js$/.test(path) || /^dist\/(?:.*\/)?[^/]+\.d\.ts$/.test(path);

const assertManifest = (manifest) => {
	if (manifest.private === true) fail("release candidate package must not be private");
	if (manifest.version !== "0.1.0-rc.1") fail(`expected release-candidate version 0.1.0-rc.1, got ${manifest.version}`);
	if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("pi-package")) fail("package is missing the pi-package keyword");
	if (JSON.stringify(manifest.files) !== JSON.stringify(EXPECTED_FILES)) fail("package files allowlist changed unexpectedly");
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
	const sourceLeak = /(?:^|["'`])(?:\.\.\/)+src\/|(?:^|["'`])\/Users\/|(?:^|["'`])\/private\//u;
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
		if (sourceLeak.test(content)) fail(`source path leaked into ${path}`);
	}
	await run(process.execPath, ["--check", join(packageRoot, ENTRYPOINT)]);
	const hostPeerRoot = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent");
	await mkdir(dirname(hostPeerRoot), { recursive: true });
	await cp(join(REPO_ROOT, "node_modules", "@earendil-works", "pi-coding-agent"), hostPeerRoot, { recursive: true });
	const entryUrl = pathToFileURL(join(packageRoot, ENTRYPOINT)).href;
	await run(process.execPath, ["--input-type=module", "-e", `const module = await import(${JSON.stringify(entryUrl)}); if (typeof module.default !== "function") throw new Error("compiled Pi entrypoint has no default extension function");`], { cwd: packageRoot });
	const unpackedManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	if (JSON.stringify(unpackedManifest) !== JSON.stringify(packageManifest)) fail("unpacked package.json differs from the source manifest");
	return {
		allowlist: true,
		entrypoint: true,
		manifest: true,
		sourceIndependent: true,
		privacySafe: true,
		syntax: true,
		sourceIndependentImport: true,
	};
};

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
		const checks = await verifyUnpacked({ packageRoot, packageManifest: sourceManifest, files: info.files });
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
		const testResult = process.env.PI_RELEASE_TEST_RESULT ?? "not-run-by-release-script";
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
		return { output: target, artifact: artifactPath, version: sourceManifest.version, sha256: artifactHash, checks };
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
	console.log(JSON.stringify({ ...result, artifact: relative(process.cwd(), result.artifact) }, null, 2));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
