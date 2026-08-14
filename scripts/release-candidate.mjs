import { createHash } from "node:crypto";
import { access, constants, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT = resolve(REPO_ROOT, "..", "pi-multi-orchestrator-release");
const EXPECTED_FILES = ["dist/**/*.js", "dist/**/*.d.ts", "README.md"];
const OPTIONAL_FILES = ["docs/OPERATOR_GUIDE.md"];
const ENTRYPOINT = "dist/host/pi-extension.js";
const EXPECTED_RELEASE_VERSION = "0.1.0-rc.12";
const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const PI_PACKAGE_ROOT = join(REPO_ROOT, "node_modules", "@earendil-works", "pi-coding-agent");
const PI_CLI = join(PI_PACKAGE_ROOT, "dist", "cli.js");
const PI_BIN = join(REPO_ROOT, "node_modules", ".bin", "pi");
export const DIRECTORY_SOURCE = "directory-source";

const fail = (message) => {
	throw new Error(message);
};

const isPathInside = (parent, candidate) => {
	const child = relative(parent, candidate);
	return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
};


const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
	if (!isAbsolute(command)) {
		reject(new Error(`release tooling requires an absolute executable: ${command}`));
		return;
	}
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

const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");

const sha256 = async (path) => {
	const details = await lstat(path);
	if (details.isSymbolicLink() || !details.isFile()) fail(`cannot hash a non-regular file: ${basename(path)}`);
	const digest = createHash("sha256");
	digest.update(await readFile(path));
	return digest.digest("hex");
};

const canonicalize = (value) => {
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
};

export const digestJson = (value) => hashBytes(Buffer.from(canonicalize(value), "utf8"));

const commandOutput = async (command, args, options = {}) => (await run(command, args, options)).stdout.trim();

const fileInfo = async (candidate, label, executable = false) => {
	if (!isAbsolute(candidate)) fail(`${label} must be an absolute path`);
	const actual = await realpath(candidate).catch(() => fail(`${label} does not exist: ${label}`));
	const details = await stat(actual).catch(() => fail(`${label} is not a file`));
	if (!details.isFile()) fail(`${label} is not a file`);
	if (executable) await access(actual, constants.X_OK).catch(() => fail(`${label} is not executable`));
	return { path: candidate, realpath: actual, sha256: await sha256(actual) };
};

const systemCandidates = {
	git: ["/usr/bin/git", "/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"],
	tar: ["/usr/bin/tar", "/bin/tar", "/usr/local/bin/tar", "/opt/homebrew/bin/tar"],
};

export const trustedSystemExecutable = async (name) => {
	for (const candidate of systemCandidates[name] ?? []) {
		try { return await fileInfo(candidate, `${name} executable`, true); } catch { /* try the next fixed system location */ }
	}
	fail(`no trusted ${name} executable is available`);
};

export const trustedNode = async () => fileInfo(process.execPath, "process.execPath", true);

export const trustedNpm = async () => {
	const node = await trustedNode();
	const nodeBin = dirname(node.realpath);
	const candidates = [
		resolve(nodeBin, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
		resolve(nodeBin, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
	];
	for (const candidate of candidates) {
		try {
			const cli = await fileInfo(candidate, "npm CLI");
			return { node, cli };
		} catch { /* only accept npm bundled with the trusted Node runtime */ }
	}
	fail("could not locate npm CLI next to process.execPath");
};

export const trustedTypeScript = async (projectRoot = REPO_ROOT) => {
	const packageRoot = join(projectRoot, "node_modules", "typescript");
	const manifestPath = join(packageRoot, "package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (manifest.name !== "typescript" || manifest.version !== "5.9.3") fail("validated TypeScript dependency must be typescript@5.9.3");
	const packageJson = await fileInfo(manifestPath, "TypeScript package manifest");
	const cli = await fileInfo(join(packageRoot, "lib", "tsc.js"), "TypeScript CLI");
	return { package: "typescript", version: manifest.version, packageJsonSha256: packageJson.sha256, cliSha256: cli.sha256 };
};

export const trustedPi = async () => {
	const packageManifestPath = join(PI_PACKAGE_ROOT, "package.json");
	const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
	if (packageManifest.name !== PI_PACKAGE || packageManifest.version !== "0.84.1") fail("validated Pi dependency must be @earendil-works/pi-coding-agent@0.84.1");
	const packageJson = await fileInfo(packageManifestPath, "Pi package manifest");
	const cli = await fileInfo(PI_CLI, "Pi CLI", true);
	const bin = await fileInfo(PI_BIN, "project-local Pi launcher");
	if (bin.realpath !== cli.realpath) fail("project-local Pi launcher does not resolve to the validated Pi CLI");
	return {
		path: bin.path,
		identity: {
			package: PI_PACKAGE,
			version: packageManifest.version,
			packageJsonSha256: packageJson.sha256,
			cli: "dist/cli.js",
			cliSha256: cli.sha256,
		},
	};
};

const safeEnvironment = (nodePath, cacheDir, projectRoot = REPO_ROOT) => {
	const nodeDir = dirname(nodePath);
	return {
		PATH: [join(projectRoot, "node_modules", ".bin"), nodeDir, "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"].join(delimiter),
		HOME: cacheDir ?? tmpdir(),
		TMPDIR: process.env.TMPDIR ?? tmpdir(),
		LANG: "C",
		LC_ALL: "C",
		NO_COLOR: "1",
		PI_OFFLINE: "1",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		...(cacheDir ? {
			npm_config_cache: cacheDir,
			npm_config_userconfig: join(cacheDir, "empty-npmrc"),
			npm_config_global: "false",
			npm_config_audit: "false",
			npm_config_fund: "false",
			npm_config_update_notifier: "false",
		} : {}),
	};
};

export const trustedToolEnvironment = async (cacheDir, projectRoot = REPO_ROOT) => safeEnvironment((await trustedNode()).realpath, cacheDir, projectRoot);

const pathCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export const inspectTree = async (root, prefix = "") => {
	const entries = await readdir(join(root, prefix), { withFileTypes: true });
	const files = [];
	const directories = [];
	const symlinks = [];
	const special = [];
	for (const entry of entries) {
		const path = join(prefix, entry.name).split("\\").join("/");
		if (entry.isSymbolicLink()) symlinks.push(path);
		else if (entry.isDirectory()) {
			directories.push(path);
			const nested = await inspectTree(root, path);
			files.push(...nested.files);
			directories.push(...nested.directories);
			symlinks.push(...nested.symlinks);
			special.push(...nested.special);
		} else if (entry.isFile()) files.push(path);
		else special.push(path);
	}
	return {
		files: files.sort(pathCompare),
		directories: directories.sort(pathCompare),
		symlinks: symlinks.sort(pathCompare),
		special: special.sort(pathCompare),
	};
};

const walkFiles = async (root) => {
	const details = await lstat(root);
	if (details.isSymbolicLink() || !details.isDirectory()) fail("tree root must be a real directory");
	const tree = await inspectTree(root);
	if (tree.symlinks.length > 0) fail(`tree contains symlinks: ${tree.symlinks.join(", ")}`);
	if (tree.special.length > 0) fail(`tree contains non-regular entries: ${tree.special.join(", ")}`);
	return tree.files;
};

const sortUnique = (values) => [...new Set(values)].sort(pathCompare);

const readChecksum = async (checksumPath, artifactName) => {
	const value = (await readFile(checksumPath, "utf8")).trim();
	const match = /^(?<hash>[a-f0-9]{64})  (?<name>[^\n]+)$/u.exec(value);
	if (!match || match.groups.name !== artifactName) fail(`invalid checksum file for ${artifactName}`);
	return match.groups.hash;
};

export const verifyArtifactChecksum = async (artifactPath, checksumPath = `${artifactPath}.sha256`) => {
	for (const [path, label] of [[artifactPath, "artifact"], [checksumPath, "checksum"]]) {
		const details = await lstat(path);
		if (details.isSymbolicLink() || !details.isFile()) fail(`${label} must be a regular file`);
	}
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
	{ name: "basic-auth", pattern: /\b(?:authorization|proxy-authorization)\b\s*[:=]\s*["']?\s*basic\s+[A-Za-z0-9+/]{8,}={0,2}/iu },
	{ name: "credential-assignment", pattern: /["']?(?:api[_-]?key|access[_-]?key|authorization|password|passwd|secret|token|private[_-]?key|client[_-]?secret|credential|auth)["']?\s*[:=]\s*["'][^"'\r\n]{16,}["']/iu },
	{ name: "credential-assignment-unquoted", pattern: /\b(?:api[_-]?key|access[_-]?key|authorization|password|passwd|secret|token|private[_-]?key|client[_-]?secret|credential|auth)\b\s*[:=]\s*[A-Za-z0-9+\/_~=-]{16,}\b/iu },
	{ name: "credential-url", pattern: /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@/iu },
];
const privacyRuleNames = [...privacyTextPatterns.map((item) => item.name), "local-absolute-path", "runtime-state-filename", "sqlite-signature", "nul-byte", "symlink", "non-regular-file"];
const localPathPattern = /(?:^|[="'`\s:([{,])(?:\/(?:Users|private|home|var\/folders)\/|[A-Z]:[\\/]+Users[\\/]+)/u;
const runtimeDatabaseName = /(?:^|\/)(?:[^/]+\.(?:sqlite(?:[-.][^/]*)?|sqlite3|db(?:[-.][^/]*)?|log)|(?:state|history|sessions?)(?:\/|$))/iu;

export const scanPrivacy = async (root) => {
	const report = {
		schemaVersion: 3,
		filesScanned: 0,
		binaryHandling: "NUL-containing files are reported and not interpreted as text",
		symlinkHandling: "symlinks are reported and never followed",
		rules: privacyRuleNames,
		symlinks: [],
		issues: [],
	};
	const addIssue = (path, kind) => report.issues.push({ path: path || ".", kind });
	const rootStat = await lstat(root);
	if (rootStat.isSymbolicLink()) {
		report.symlinks.push(".");
		addIssue(".", "symlink");
	} else if (!rootStat.isDirectory()) addIssue(".", "root-not-directory");
	else {
		const tree = await inspectTree(root);
		report.symlinks.push(...tree.symlinks);
		for (const path of tree.symlinks) addIssue(path, "symlink");
		for (const path of tree.special) addIssue(path, "non-regular-file");
		for (const path of tree.files) {
			report.filesScanned += 1;
			if (runtimeDatabaseName.test(path)) addIssue(path, "runtime-state-filename");
			const content = await readFile(join(root, path));
			if (content.includes(Buffer.from("SQLite format 3\0"))) addIssue(path, "sqlite-signature");
			if (content.includes(0)) {
				addIssue(path, "nul-byte");
				continue;
			}
			const text = content.toString("utf8");
			if (localPathPattern.test(text)) addIssue(path, "local-absolute-path");
			for (const pattern of privacyTextPatterns) if (pattern.pattern.test(text)) addIssue(path, pattern.name);
		}
	}
	report.symlinks.sort(pathCompare);
	report.issues.sort((left, right) => pathCompare(left.path, right.path) || pathCompare(left.kind, right.kind));
	return { ...report, clean: report.issues.length === 0 };
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
	if (manifest.version !== EXPECTED_RELEASE_VERSION) fail(`expected release-candidate version ${EXPECTED_RELEASE_VERSION}, got ${manifest.version}`);
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
	const actualFiles = (await walkFiles(packageRoot)).sort(pathCompare);
	const expectedFiles = files.map((file) => file.path).sort(pathCompare);
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
	const privacyReport = await scanPrivacy(packageRoot);
	if (!privacyReport.clean) fail(`privacy scan failed: ${privacyReport.issues.map((issue) => `${issue.path}: ${issue.kind}`).join(", ")}`);
	const node = await trustedNode();
	await run(node.realpath, ["--check", join(packageRoot, ENTRYPOINT)], { env: safeEnvironment(node.realpath) });
	const hostPeerRoot = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent");
	await mkdir(dirname(hostPeerRoot), { recursive: true });
	try {
		await cp(join(REPO_ROOT, "node_modules", "@earendil-works", "pi-coding-agent"), hostPeerRoot, { recursive: true });
	} catch (error) {
		fail(`validated Pi peer is unavailable: ${error instanceof Error ? error.message : String(error)}`);
	}
	const entryUrl = pathToFileURL(join(packageRoot, ENTRYPOINT)).href;
	await run(node.realpath, ["--input-type=module", "-e", `const module = await import(${JSON.stringify(entryUrl)}); if (typeof module.default !== "function") throw new Error("compiled Pi entrypoint has no default extension function");`], { cwd: packageRoot, env: safeEnvironment(node.realpath) });
	const unpackedManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	if (JSON.stringify(unpackedManifest) !== JSON.stringify(packageManifest)) fail("unpacked package.json differs from the source manifest");
	return {
		allowlist: true,
		entrypoint: true,
		manifest: true,
		sourceIndependent: true,
		privacySafe: privacyReport.clean,
		syntax: true,
		sourceIndependentImport: true,
	};
};

const archiveEntries = async (artifactPath) => {
	const artifact = await lstat(artifactPath);
	if (artifact.isSymbolicLink() || !artifact.isFile()) fail("release artifact must be a regular file");
	const tar = await trustedSystemExecutable("tar");
	const env = safeEnvironment((await trustedNode()).realpath);
	const listing = await commandOutput(tar.realpath, ["-tzf", artifactPath], { env });
	const verbose = await commandOutput(tar.realpath, ["-tvzf", artifactPath], { env });
	for (const line of verbose.split(/\r?\n/u).filter(Boolean)) if (!line.startsWith("-") && !line.startsWith("d")) fail("release artifact contains a symlink or non-regular archive entry");
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

export const captureSourceIdentity = async (repoRoot = REPO_ROOT) => {
	const git = await trustedSystemExecutable("git");
	const node = await trustedNode();
	const env = safeEnvironment(node.realpath, undefined, repoRoot);
	const commit = await commandOutput(git.realpath, ["rev-parse", "HEAD"], { cwd: repoRoot, env });
	const tree = await commandOutput(git.realpath, ["rev-parse", "HEAD^{tree}"], { cwd: repoRoot, env });
	const commitTimestamp = await commandOutput(git.realpath, ["show", "-s", "--format=%cI", commit], { cwd: repoRoot, env });
	if (!/^[0-9a-f]{40}$/u.test(commit) || !/^[0-9a-f]{40}$/u.test(tree)) fail("Git source identity is not a full commit/tree SHA");
	const status = await commandOutput(git.realpath, ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repoRoot, env });
	const trackedChanges = status.split(/\r?\n/u).filter((line) => line && !line.startsWith("?? "));
	if (trackedChanges.length > 0) fail(`source checkout has tracked changes; commit the release inputs first (${trackedChanges.length} change${trackedChanges.length === 1 ? "" : "s"})`);
	const tracked = await run(git.realpath, ["ls-tree", "-r", "-z", "--full-tree", commit], { cwd: repoRoot, env });
	const entries = tracked.stdout.split("\0").filter(Boolean);
	for (const entry of entries) {
		const match = /^(?<mode>\d+) (?<type>\S+) [0-9a-f]+\t/u.exec(entry);
		if (!match || match.groups?.type !== "blob" || !["100644", "100755"].includes(match.groups.mode)) fail("release source contains a symlink, submodule, or unsupported Git entry");
	}
	return {
		gitCommit: commit,
		gitTree: tree,
		gitCommitTimestamp: commitTimestamp,
		trackedClean: true,
		sourceDigest: hashBytes(Buffer.from(tracked.stdout, "utf8")),
		sourceDigestAlgorithm: "sha256(git ls-tree -r -z --full-tree <commit>)",
		trackedFileCount: entries.length,
		untrackedCount: status.split(/\r?\n/u).filter((line) => line.startsWith("?? ")).length,
		untrackedIncluded: false,
	};
};

export const createGitSourceStage = async ({ repoRoot = REPO_ROOT } = {}) => {
	const sourceIdentity = await captureSourceIdentity(repoRoot);
	const git = await trustedSystemExecutable("git");
	const node = await trustedNode();
	const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-multi-orchestrator-git-source-"));
	const sourceRoot = join(temporaryRoot, "source");
	try {
		const env = safeEnvironment(node.realpath, undefined, repoRoot);
		await run(git.realpath, ["clone", "--no-hardlinks", "--no-checkout", "--no-tags", repoRoot, sourceRoot], { env });
		await run(git.realpath, ["-c", "advice.detachedHead=false", "checkout", "--detach", "--force", sourceIdentity.gitCommit], { cwd: sourceRoot, env });
		const stagedIdentity = await captureSourceIdentity(sourceRoot);
		if (stagedIdentity.gitCommit !== sourceIdentity.gitCommit || stagedIdentity.gitTree !== sourceIdentity.gitTree || stagedIdentity.sourceDigest !== sourceIdentity.sourceDigest || stagedIdentity.untrackedCount !== 0) fail("detached Git source does not match the release commit");
		const dependencyRoot = await realpath(join(repoRoot, "node_modules")).catch(() => fail("release dependencies are unavailable"));
		await symlink(dependencyRoot, join(sourceRoot, "node_modules"), "dir");
		return { temporaryRoot, sourceRoot: await realpath(sourceRoot), sourceIdentity };
	} catch (error) {
		await rm(temporaryRoot, { recursive: true, force: true });
		throw error;
	}
};

export const captureTestDefinition = async (sourceRoot) => {
	const packageBytes = await readFile(join(sourceRoot, "package.json"));
	const lockBytes = await readFile(join(sourceRoot, "package-lock.json"));
	const manifest = JSON.parse(packageBytes.toString("utf8"));
	if (typeof manifest.scripts?.check !== "string" || manifest.scripts.check.length === 0) fail("package has no check script");
	const definition = {
		command: "npm run check",
		packageJsonSha256: hashBytes(packageBytes),
		packageLockSha256: hashBytes(lockBytes),
		scripts: manifest.scripts,
	};
	return { ...definition, digest: digestJson(definition) };
};

const assertSourceIdentity = (manifest) => {
	if (!/^[0-9a-f]{40}$/u.test(manifest.gitCommit) || !/^[0-9a-f]{40}$/u.test(manifest.gitTree)) fail("release manifest has an invalid Git identity");
	if (manifest.dirty !== false || manifest.trackedClean !== true) fail("release manifest does not prove a clean tracked source state");
	if (!/^[0-9a-f]{64}$/u.test(manifest.sourceDigest)) fail("release manifest has no deterministic source digest");
	if (manifest.sourceDigestAlgorithm !== "sha256(git ls-tree -r -z --full-tree <commit>)" || !Number.isSafeInteger(manifest.trackedFileCount) || manifest.trackedFileCount <= 0 || manifest.untrackedIncluded !== false || manifest.buildSource !== "detached-git-commit") fail("release manifest does not bind an exact Git-derived source tree");
	const definition = manifest.testDefinition;
	if (!definition || definition.command !== "npm run check" || typeof definition.packageJsonSha256 !== "string" || typeof definition.packageLockSha256 !== "string" || !definition.scripts || definition.digest !== digestJson({ command: definition.command, packageJsonSha256: definition.packageJsonSha256, packageLockSha256: definition.packageLockSha256, scripts: definition.scripts })) fail("release manifest test definition is invalid");
};

const buildDigestFor = (manifest) => digestJson({
	sourceDigest: manifest.sourceDigest,
	gitTree: manifest.gitTree,
	testDefinition: manifest.testDefinition,
	nodeVersion: manifest.nodeVersion,
	piIdentity: manifest.piIdentity,
	package: manifest.package,
	files: manifest.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })),
});

const validateEvidenceRecord = (record, name) => {
	if (!record || record.file !== name || !/^[0-9a-f]{64}$/u.test(record.sha256)) fail(`release evidence binding is invalid for ${name}`);
};

export const releaseBindingFor = (manifest) => ({
	gitCommit: manifest.gitCommit,
	gitTree: manifest.gitTree,
	sourceDigest: manifest.sourceDigest,
	buildDigest: manifest.buildDigest,
	testDefinition: manifest.testDefinition,
	artifact: manifest.artifact,
	piIdentity: manifest.piIdentity,
});

export const validateTestEvidence = (evidence, manifest) => {
	if (evidence?.schemaVersion !== 3 || evidence.status !== "PASS" || evidence.authority !== "execution-time-independent-rerun") fail("test evidence is not execution-time release proof");
	if (JSON.stringify(evidence.release) !== JSON.stringify(releaseBindingFor(manifest))) fail("test evidence is not bound to the copied release");
	const expectedSource = { gitCommit: manifest.gitCommit, gitTree: manifest.gitTree, sourceDigest: manifest.sourceDigest, testDefinition: manifest.testDefinition };
	if (JSON.stringify(evidence.source) !== JSON.stringify(expectedSource)) fail("test evidence source or script definition differs from the release source");
	if (evidence.commands?.check !== "npm run check" || evidence.commands?.packDryRun !== "npm pack --dry-run --ignore-scripts --json") fail("test evidence commands are not strict release commands");
	const tests = evidence.check?.tests;
	const values = tests && [tests.total, tests.passed, tests.failed, tests.cancelled, tests.skipped, tests.todo];
	if (!values || values.some((value) => !Number.isSafeInteger(value) || value < 0) || evidence.check.code !== 0 || evidence.check.signal !== null || tests.total <= 0 || tests.passed <= 0 || tests.failed !== 0 || tests.cancelled !== 0 || tests.total !== tests.passed + tests.failed + tests.cancelled + tests.skipped + tests.todo) fail("test evidence TAP totals are not a non-empty passing complete summary");
	for (const digest of [evidence.check?.stdoutSha256, evidence.check?.stderrSha256, evidence.pack?.stdoutSha256, evidence.pack?.stderrSha256]) if (!/^[0-9a-f]{64}$/u.test(digest ?? "")) fail("test evidence is missing output digests");
	if (evidence.pack?.code !== 0 || evidence.pack?.signal !== null || !evidence.pack?.evidence?.filename || !Number.isSafeInteger(evidence.pack.evidence.fileCount) || evidence.pack.evidence.fileCount <= 0) fail("pack evidence is incomplete");
	return tests;
};

const verifyEvidenceBinding = async (root, manifest, verification) => {
	if (!manifest.evidence) {
		if (verification.evidence !== undefined) fail("verification contains evidence without a manifest binding");
		return null;
	}
	if (manifest.evidence.schemaVersion !== 2 || !manifest.evidence.test || !manifest.evidence.pi || !manifest.evidence.safety || !manifest.evidence.integrity) fail("release evidence binding is incomplete");
	validateEvidenceRecord(manifest.evidence.test, "test-evidence.json");
	validateEvidenceRecord(manifest.evidence.pi, "pi-install-evidence.json");
	validateEvidenceRecord(manifest.evidence.safety, "worker-safety-evidence.json");
	validateEvidenceRecord(manifest.evidence.integrity, "release-integrity-evidence.json");
	if (JSON.stringify(verification.evidence) !== JSON.stringify(manifest.evidence)) fail("verification evidence binding differs from release manifest");
	for (const record of [manifest.evidence.test, manifest.evidence.pi, manifest.evidence.safety, manifest.evidence.integrity]) {
		const digest = await sha256(join(root, record.file));
		if (digest !== record.sha256) fail(`release evidence checksum mismatch for ${record.file}`);
	}
	validateTestEvidence(JSON.parse(await readFile(join(root, "test-evidence.json"), "utf8")), manifest);
	const integrity = JSON.parse(await readFile(join(root, "release-integrity-evidence.json"), "utf8"));
	if (integrity.schemaVersion !== 1 || integrity.status !== "PASS" || integrity.total !== 20 || integrity.passed !== 20 || integrity.failed !== 0 || !Array.isArray(integrity.attacks) || integrity.attacks.length !== 20 || integrity.attacks.some((attack) => attack.status !== "PASS")) fail("release integrity attack evidence is incomplete");
	return manifest.evidence;
};

export async function verifyReleaseDirectory(directory) {
	const root = resolve(directory);
	const rootDetails = await lstat(root);
	if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) fail("release directory must be a real directory");
	for (const name of ["release-manifest.json", "verification.json", "artifact-files.txt", "privacy-report.json"]) {
		const details = await lstat(join(root, name));
		if (details.isSymbolicLink() || !details.isFile()) fail(`release metadata must be a regular file: ${name}`);
	}
	const manifest = JSON.parse(await readFile(join(root, "release-manifest.json"), "utf8"));
	const verification = JSON.parse(await readFile(join(root, "verification.json"), "utf8"));
	assertSourceIdentity(manifest);
	if (manifest.schemaVersion !== 3 || manifest.releaseStatus !== "candidate") fail("release manifest schema/status is not the hardened candidate format");
	if (!manifest.piIdentity || manifest.piIdentity.package !== PI_PACKAGE || manifest.piIdentity.version !== "0.84.1" || !/^[0-9a-f]{64}$/u.test(manifest.piIdentity.packageJsonSha256) || !/^[0-9a-f]{64}$/u.test(manifest.piIdentity.cliSha256)) fail("release manifest has no bound Pi identity");
	const artifactName = manifest.artifact?.file;
	if (typeof artifactName !== "string" || artifactName !== artifactName.split(/[\\/]/u).pop() || !artifactName.endsWith(".tgz")) fail("release manifest has an invalid artifact filename");
	const artifactPath = join(root, artifactName);
	const artifactHash = await verifyArtifactChecksum(artifactPath, join(root, `${artifactName}.sha256`));
	if (manifest.artifact.sha256 !== artifactHash || verification.sha256 !== artifactHash) fail("release metadata checksum does not match artifact");
	if (manifest.artifact.size !== (await stat(artifactPath)).size) fail("release metadata artifact size does not match artifact");
	const records = manifest.files;
	if (!Array.isArray(records) || records.length === 0 || manifest.fileCount !== records.length) fail("release manifest file records are invalid");
	for (const record of records) {
		if (!record || typeof record.path !== "string" || record.path.startsWith("/") || record.path.split("/").includes("..") || !/^[0-9a-f]{64}$/u.test(record.sha256) || !Number.isSafeInteger(record.size) || record.size < 0) fail("release manifest has an unsafe file record");
	}
	const listed = (await readFile(join(root, "artifact-files.txt"), "utf8")).trim().split(/\r?\n/u).filter(Boolean);
	const expectedPaths = records.map((record) => record.path).sort(pathCompare);
	if (JSON.stringify(listed) !== JSON.stringify(expectedPaths)) fail("artifact file list differs from release manifest");
	if (verification.schemaVersion !== 3 || verification.verified !== true || JSON.stringify(verification.checks) !== JSON.stringify(manifest.checks)) fail("verification evidence is not deterministic or complete");
	if (verification.gitCommit !== manifest.gitCommit || verification.gitTree !== manifest.gitTree || verification.dirty !== manifest.dirty || verification.sourceDigest !== manifest.sourceDigest || verification.buildDigest !== manifest.buildDigest || JSON.stringify(verification.testDefinition) !== JSON.stringify(manifest.testDefinition) || JSON.stringify(verification.piIdentity) !== JSON.stringify(manifest.piIdentity)) fail("verification evidence is not bound to the release source/build identity");
	if (manifest.buildDigest !== buildDigestFor(manifest)) fail("release build digest does not match its source, Pi, or artifact records");
	await verifyEvidenceBinding(root, manifest, verification);
	const privacyReport = JSON.parse(await readFile(join(root, "privacy-report.json"), "utf8"));
	if (privacyReport.schemaVersion !== 1 || !privacyReport.artifact || !privacyReport.directorySource) fail("detailed privacy report is missing");
	if (manifest.directorySource !== DIRECTORY_SOURCE) fail("release manifest is missing the supported directory source");
	const directorySourcePath = join(root, DIRECTORY_SOURCE);
	const directoryPrivacy = await scanPrivacy(directorySourcePath);
	if (!directoryPrivacy.clean) fail(`directory source privacy scan failed: ${directoryPrivacy.issues.map((issue) => `${issue.path}: ${issue.kind}`).join(", ")}`);
	if (digestJson(privacyReport.directorySource) !== digestJson(directoryPrivacy)) fail("directory privacy report does not match the scanned directory source");
	const directoryFiles = (await walkFiles(directorySourcePath)).sort(pathCompare);
	if (JSON.stringify(directoryFiles) !== JSON.stringify(expectedPaths)) fail("directory source files differ from release manifest");
	if (await sha256(join(directorySourcePath, "package.json")) !== manifest.testDefinition.packageJsonSha256) fail("release test definition is not bound to the packaged package.json");
	for (const record of records) {
		const path = join(directorySourcePath, record.path);
		const digest = await sha256(path);
		if (digest !== record.sha256 || (await stat(path)).size !== record.size) fail(`directory source record mismatch for ${record.path}`);
	}
	const archiveList = await archiveEntries(artifactPath);
	const archivePaths = archiveList.filter((entry) => entry !== "package").map((entry) => entry.slice("package/".length)).sort(pathCompare);
	if (JSON.stringify(archivePaths) !== JSON.stringify(expectedPaths)) fail("artifact archive files differ from release manifest");
	const staging = await mkdtemp(join(tmpdir(), "pi-multi-orchestrator-release-verify-"));
	try {
		const tar = await trustedSystemExecutable("tar");
		await run(tar.realpath, ["-xzf", artifactPath, "-C", staging], { env: safeEnvironment((await trustedNode()).realpath) });
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
		await rm(join(packageRoot, "node_modules"), { recursive: true, force: true });
		const artifactPrivacy = await scanPrivacy(packageRoot);
		if (!artifactPrivacy.clean || digestJson(privacyReport.artifact) !== digestJson(artifactPrivacy)) fail("artifact privacy report does not match the scanned artifact");
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	return { verified: true, artifact: artifactName, sha256: artifactHash, directorySource: DIRECTORY_SOURCE, checks: manifest.checks };
}

export async function bindReleaseEvidence(directory) {
	const root = resolve(directory);
	const manifestPath = join(root, "release-manifest.json");
	const verificationPath = join(root, "verification.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const verification = JSON.parse(await readFile(verificationPath, "utf8"));
	await verifyReleaseDirectory(root);
	const records = {};
	for (const name of ["test-evidence.json", "pi-install-evidence.json", "worker-safety-evidence.json", "release-integrity-evidence.json"]) {
		const details = await lstat(join(root, name));
		if (details.isSymbolicLink() || !details.isFile()) fail(`release evidence must be a regular file: ${name}`);
		const key = name === "test-evidence.json" ? "test" : name === "pi-install-evidence.json" ? "pi" : name === "worker-safety-evidence.json" ? "safety" : "integrity";
		records[key] = { file: name, sha256: await sha256(join(root, name)) };
	}
	const evidence = { schemaVersion: 2, test: records.test, pi: records.pi, safety: records.safety, integrity: records.integrity };
	const nextManifest = { ...manifest, evidence };
	const nextVerification = { ...verification, evidence };
	await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
	await writeFile(verificationPath, `${JSON.stringify(nextVerification, null, 2)}\n`, "utf8");
	await verifyReleaseDirectory(root);
	return evidence;
}

export async function buildReleaseCandidate({ output, force = false } = {}) {
	const target = resolve(output ?? DEFAULT_OUTPUT);
	if (isPathInside(REPO_ROOT, target)) fail("release output must be outside the source checkout");
	const pi = await trustedPi();
	const npm = await trustedNpm();
	const targetEntries = await readdir(target).catch((error) => {
		if (error?.code === "ENOENT") return [];
		throw error;
	});
	if (targetEntries.length > 0 && !force) fail(`release output is not empty: ${target}; use --force to overwrite it`);
	if (targetEntries.length > 0 && force) await rm(target, { recursive: true, force: true });
	await mkdir(target, { recursive: true });

	const sourceStage = await createGitSourceStage();
	const { sourceIdentity, sourceRoot } = sourceStage;
	let staging;
	try {
		const sourceManifest = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
		assertManifest(sourceManifest);
		const testDefinition = await captureTestDefinition(sourceRoot);
		staging = await mkdtemp(join(tmpdir(), "pi-multi-orchestrator-release-"));
		const npmCache = join(staging, "npm-cache");
		const env = safeEnvironment(npm.node.realpath, npmCache, sourceRoot);
		await run(npm.node.realpath, [npm.cli.realpath, "run", "build"], {
			cwd: sourceRoot,
			env,
		});
		const packed = await run(npm.node.realpath, [npm.cli.realpath, "pack", "--json", "--ignore-scripts", "--pack-destination", staging], {
			cwd: sourceRoot,
			env,
		});
		const packInfo = JSON.parse(packed.stdout.trim());
		const info = Array.isArray(packInfo) ? packInfo[0] : packInfo;
		if (!info?.filename || !Array.isArray(info.files)) fail("npm pack did not return a package file list");
		const sourceArtifact = join(staging, info.filename);
		const packageRoot = join(staging, "unpacked", "package");
		await mkdir(packageRoot, { recursive: true });
		const tar = await trustedSystemExecutable("tar");
		await run(tar.realpath, ["-xzf", sourceArtifact, "-C", join(staging, "unpacked")], { env });
		const directorySourcePath = join(target, DIRECTORY_SOURCE);
		await cp(packageRoot, directorySourcePath, { recursive: true });
		const checks = {
			...(await verifyUnpacked({ packageRoot, packageManifest: sourceManifest, files: info.files })),
			freshBuild: true,
			directorySource: true,
			sourceMaps: true,
		};
		await rm(join(packageRoot, "node_modules"), { recursive: true, force: true });
		const artifactPath = join(target, info.filename);
		await copyFile(sourceArtifact, artifactPath);
		const privacyReport = {
			schemaVersion: 1,
			artifact: await scanPrivacy(packageRoot),
			directorySource: await scanPrivacy(directorySourcePath),
		};
		await writeFile(join(target, "privacy-report.json"), `${JSON.stringify(privacyReport, null, 2)}\n`, "utf8");
		const artifactHash = await sha256(artifactPath);
		const artifactSize = (await stat(artifactPath)).size;
		const fileRecords = [];
		for (const file of [...info.files].sort((left, right) => pathCompare(left.path, right.path))) {
			const path = join(packageRoot, file.path);
			fileRecords.push({ path: file.path, size: (await stat(path)).size, sha256: await sha256(path) });
		}
		const finalSourceIdentity = await captureSourceIdentity();
		if (finalSourceIdentity.gitCommit !== sourceIdentity.gitCommit || finalSourceIdentity.gitTree !== sourceIdentity.gitTree || finalSourceIdentity.sourceDigest !== sourceIdentity.sourceDigest || !finalSourceIdentity.trackedClean) fail("source identity changed during release build");
		const filesName = "artifact-files.txt";
		const checksumName = `${info.filename}.sha256`;
		const manifestName = "release-manifest.json";
		const verificationName = "verification.json";
		const buildTimestamp = process.env.SOURCE_DATE_EPOCH
			? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
			: new Date(sourceIdentity.gitCommitTimestamp).toISOString();
		const testResult = "not-run-by-release-script";
		await writeFile(join(target, filesName), `${fileRecords.map((file) => file.path).join("\n")}\n`, "utf8");
		await writeFile(join(target, checksumName), `${artifactHash}  ${info.filename}\n`, "utf8");
		const manifest = {
			schemaVersion: 3,
			releaseStatus: "candidate",
			gitCommit: sourceIdentity.gitCommit,
			gitTree: sourceIdentity.gitTree,
			gitCommitTimestamp: sourceIdentity.gitCommitTimestamp,
			dirty: false,
			trackedClean: true,
			untrackedCount: finalSourceIdentity.untrackedCount,
			untrackedIncluded: false,
			sourceDigest: sourceIdentity.sourceDigest,
			sourceDigestAlgorithm: sourceIdentity.sourceDigestAlgorithm,
			trackedFileCount: sourceIdentity.trackedFileCount,
			buildSource: "detached-git-commit",
			testDefinition,
			buildTimestamp,
			nodeVersion: process.version,
			piVersion: "0.84.1",
			piIdentity: pi.identity,
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
		manifest.buildDigest = buildDigestFor(manifest);
		await writeFile(join(target, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		const verification = {
			schemaVersion: 3,
			verified: Object.values(checks).every(Boolean),
			artifact: info.filename,
			sha256: artifactHash,
			gitCommit: sourceIdentity.gitCommit,
			gitTree: sourceIdentity.gitTree,
			dirty: false,
			trackedClean: true,
			sourceDigest: sourceIdentity.sourceDigest,
			buildDigest: manifest.buildDigest,
			testDefinition,
			piIdentity: pi.identity,
			checks,
		};
		await writeFile(join(target, verificationName), `${JSON.stringify(verification, null, 2)}\n`, "utf8");
		await verifyReleaseDirectory(target);
		return { output: target, artifact: artifactPath, directorySource: directorySourcePath, version: sourceManifest.version, sha256: artifactHash, checks };
	} finally {
		if (staging) await rm(staging, { recursive: true, force: true });
		await rm(sourceStage.temporaryRoot, { recursive: true, force: true });
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
