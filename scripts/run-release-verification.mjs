import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	bindReleaseEvidence,
	trustedNpm,
	trustedPi,
	trustedNode,
	trustedToolEnvironment,
	verifyReleaseDirectory,
} from "./release-candidate.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fail = (message) => { throw new Error(message); };

const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
	if (!isAbsolute(command)) {
		reject(new Error(`release verification requires an absolute executable: ${command}`));
		return;
	}
	const child = spawn(command, args, { cwd: options.cwd ?? root, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.once("error", reject);
	child.once("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const scrub = (value) => value
	.replaceAll(root, "<repo>")
	.replace(/(?:\/Users|\/private|\/home|\/tmp|\/var\/folders)\/[^\s"'`]+/gu, "<path>")
	.replace(/[A-Z]:[\\/]Users[\\/][^\s"'`]+/gu, "<path>");

const parseTapSummary = (output) => {
	const pattern = /(?:^|\n)# tests (?<total>\d+)\n# suites (?<suites>\d+)\n# pass (?<passed>\d+)\n# fail (?<failed>\d+)\n# cancelled (?<cancelled>\d+)\n# skipped (?<skipped>\d+)\n# todo (?<todo>\d+)\n# duration_ms (?<duration>[0-9]+(?:\.[0-9]+)?)(?:\n|$)/gu;
	const matches = [...output.matchAll(pattern)];
	if (matches.length !== 1) fail(`expected exactly one complete TAP summary, found ${matches.length}`);
	const match = matches[0];
	const values = Object.fromEntries(Object.entries(match.groups ?? {}).map(([key, value]) => [key, Number(value)]));
	const accounted = values.passed + values.failed + values.cancelled + values.skipped + values.todo;
	if (values.total !== accounted || values.failed !== 0 || values.cancelled !== 0) fail("TAP summary totals are inconsistent or contain failed/cancelled tests");
	return {
		total: values.total,
		passed: values.passed,
		failed: values.failed,
		cancelled: values.cancelled,
		skipped: values.skipped,
		todo: values.todo,
	};
};

const parsePackEvidence = (output) => {
	let parsed;
	try { parsed = JSON.parse(output.trim()); } catch { fail("npm pack dry-run did not return JSON evidence"); }
	if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0]?.filename !== "string" || !Array.isArray(parsed[0]?.files)) fail("npm pack dry-run evidence is not one strict package record");
	const files = parsed[0].files.map((file) => file?.path);
	if (files.some((path) => typeof path !== "string" || path.startsWith("/") || path.split("/").includes(".."))) fail("npm pack dry-run returned an unsafe path");
	return { filename: parsed[0].filename, fileCount: files.length, files };
};

const parseArgs = (argv) => {
	let output;
	let bundle;
	let force = false;
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--output") output = argv[++index];
		else if (argv[index] === "--bundle") bundle = argv[++index];
		else if (argv[index] === "--force") force = true;
		else if (argv[index] === "--help") return { help: true };
		else fail(`unknown argument: ${argv[index]}`);
	}
	if (!output) fail("usage: node scripts/run-release-verification.mjs --output DIR --bundle DIR [--force]");
	return { output: resolve(output), bundle: resolve(bundle ?? `${output}-review`), force, help: false };
};

const main = async () => {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) return;
	const node = await trustedNode();
	const npm = await trustedNpm();
	const pi = await trustedPi();
	const packCache = await mkdtemp(`${tmpdir()}/pi-m11-r4-npm-cache-`);
	const env = await trustedToolEnvironment(packCache);
	try {
		const check = await run(node.realpath, [npm.cli.realpath, "run", "check"], { env });
		const pack = await run(node.realpath, [npm.cli.realpath, "pack", "--dry-run", "--ignore-scripts", "--json"], { env });
		const tests = check.code === 0 ? parseTapSummary(check.stdout) : null;
		const packEvidence = pack.code === 0 ? parsePackEvidence(pack.stdout) : null;
		if (check.code !== 0 || pack.code !== 0 || !tests || !packEvidence) fail("trusted check or pack dry-run failed; no PASS evidence was produced");
		const evidence = {
			schemaVersion: 2,
			status: "PASS",
			runner: {
				node: { kind: "process.execPath", file: basename(node.realpath), sha256: node.sha256, version: process.version },
				npm: { kind: "node-cli", file: "npm-cli.js", sha256: npm.cli.sha256 },
			},
			commands: {
				check: "npm run check",
				packDryRun: "npm pack --dry-run --ignore-scripts --json",
			},
			check: {
				code: check.code,
				signal: check.signal,
				tests,
				stdoutSha256: sha256(check.stdout),
				stderrSha256: sha256(check.stderr),
				stdoutTail: scrub(check.stdout.slice(-4_000)),
				stderrTail: scrub(check.stderr.slice(-2_000)),
			},
			pack: {
				code: pack.code,
				signal: pack.signal,
				evidence: packEvidence,
				stdoutSha256: sha256(pack.stdout),
				stderrSha256: sha256(pack.stderr),
				stdoutTail: scrub(pack.stdout.slice(-2_000)),
				stderrTail: scrub(pack.stderr.slice(-2_000)),
			},
		};
		const release = await run(node.realpath, [resolve(root, "scripts", "release-candidate.mjs"), "--output", args.output, ...(args.force ? ["--force"] : [])], { env });
		if (release.code !== 0) fail(scrub(release.stderr) || "release-candidate failed");
		await mkdir(args.output, { recursive: true });
		const manifest = JSON.parse(await readFile(resolve(args.output, "release-manifest.json"), "utf8"));
		if (manifest.dirty !== false || manifest.trackedClean !== true || !/^[0-9a-f]{40}$/u.test(manifest.gitCommit) || !/^[0-9a-f]{40}$/u.test(manifest.gitTree) || !/^[0-9a-f]{64}$/u.test(manifest.sourceDigest) || !/^[0-9a-f]{64}$/u.test(manifest.buildDigest)) fail("release manifest lacks clean source/build provenance");
		if (JSON.stringify(manifest.piIdentity) !== JSON.stringify(pi.identity)) fail("release manifest Pi identity differs from the trusted local Pi package");
		const releaseBinding = {
			gitCommit: manifest.gitCommit,
			gitTree: manifest.gitTree,
			sourceDigest: manifest.sourceDigest,
			buildDigest: manifest.buildDigest,
			artifact: manifest.artifact,
			piIdentity: manifest.piIdentity,
		};
		await writeFile(resolve(args.output, "test-evidence.json"), `${JSON.stringify({ ...evidence, release: releaseBinding }, null, 2)}\n`, "utf8");
		const piEnv = { ...env, PI_BIN: pi.path };
		const piVersion = await run(pi.path, ["--version"], { env: piEnv });
		if (piVersion.code !== 0 || piVersion.stdout.trim() !== pi.identity.version) fail("trusted Pi identity/version probe failed");
		const piResult = await run(node.realpath, [resolve(root, "scripts", "verify-pi-release.mjs"), "--release-dir", args.output], { env: piEnv });
		if (piResult.code !== 0) fail(scrub(piResult.stderr) || "Pi release verification failed");
		const piEvidencePath = resolve(args.output, "pi-install-evidence.json");
		const piEvidence = JSON.parse(await readFile(piEvidencePath, "utf8"));
		if (piEvidence.status !== "PASS" || piEvidence.artifact !== manifest.artifact.file || piEvidence.sha256 !== manifest.artifact.sha256 || piEvidence.piVersion !== pi.identity.version) fail("Pi evidence is not bound to the trusted Pi or release artifact");
		await writeFile(piEvidencePath, `${JSON.stringify({ ...piEvidence, piIdentity: pi.identity, runner: { kind: "project-local-pi", file: "node_modules/@earendil-works/pi-coding-agent/dist/cli.js", sha256: pi.identity.cliSha256 } }, null, 2)}\n`, "utf8");
		await bindReleaseEvidence(args.output);
		await verifyReleaseDirectory(args.output);
		const bundle = await run(node.realpath, [resolve(root, "scripts", "create-review-bundle.mjs"), "--release-dir", args.output, "--output", args.bundle, "--force"], { env });
		if (bundle.code !== 0) fail(scrub(bundle.stderr) || "review bundle creation failed");
		console.log(JSON.stringify({ output: relative(process.cwd(), args.output), bundle: relative(process.cwd(), args.bundle), tests: evidence.check.tests, status: "PASS" }, null, 2));
	} finally {
		await rm(packCache, { recursive: true, force: true });
	}
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
