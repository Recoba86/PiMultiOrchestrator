import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	bindReleaseEvidence,
	captureSourceIdentity,
	captureTestDefinition,
	createGitSourceStage,
	releaseBindingFor,
	scrubEvidenceText,
	trustedNpm,
	trustedPi,
	trustedNode,
	trustedToolEnvironment,
	trustedTypeScript,
	verifyReleaseDirectory,
} from "./release-candidate.mjs";
import { verifyReviewBundle } from "./create-review-bundle.mjs";

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
const scrub = (value) => scrubEvidenceText(value);

export const parseTapSummary = (output) => {
	const pattern = /(?:^|\n)# tests (?<total>\d+)\n# suites (?<suites>\d+)\n# pass (?<passed>\d+)\n# fail (?<failed>\d+)\n# cancelled (?<cancelled>\d+)\n# skipped (?<skipped>\d+)\n# todo (?<todo>\d+)\n# duration_ms (?<duration>[0-9]+(?:\.[0-9]+)?)(?:\n|$)/gu;
	const matches = [...output.matchAll(pattern)];
	if (matches.length !== 1) fail(`expected exactly one complete TAP summary, found ${matches.length}`);
	const values = Object.fromEntries(Object.entries(matches[0].groups ?? {}).map(([key, value]) => [key, Number(value)]));
	for (const key of ["total", "suites", "passed", "failed", "cancelled", "skipped", "todo"]) if (!Number.isSafeInteger(values[key]) || values[key] < 0) fail("TAP summary contains an invalid count");
	const accounted = values.passed + values.failed + values.cancelled + values.skipped + values.todo;
	if (values.total <= 0 || values.passed <= 0 || values.total !== accounted || values.failed !== 0 || values.cancelled !== 0 || values.skipped !== 0 || values.todo !== 0) fail("TAP summary totals are empty, inconsistent, or contain failed/cancelled/skipped/todo tests");
	return {
		total: values.total,
		suites: values.suites,
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
	if (files.length === 0 || files.some((path) => typeof path !== "string" || path.startsWith("/") || path.split("/").includes(".."))) fail("npm pack dry-run returned an unsafe or empty path list");
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
	const packCache = await mkdtemp(`${tmpdir()}/pi-m11-r8-npm-cache-`);
	const sourceStage = await createGitSourceStage();
	const { sourceRoot, sourceIdentity } = sourceStage;
	const env = await trustedToolEnvironment(packCache, sourceRoot);
	try {
		const testDefinition = await captureTestDefinition(sourceRoot);
		const typeScript = await trustedTypeScript(sourceRoot);
		const check = await run(node.realpath, [npm.cli.realpath, "run", "check"], { cwd: sourceRoot, env });
		const pack = await run(node.realpath, [npm.cli.realpath, "pack", "--dry-run", "--ignore-scripts", "--json"], { cwd: sourceRoot, env });
		const tests = check.code === 0 ? parseTapSummary(check.stdout) : null;
		const packEvidence = pack.code === 0 ? parsePackEvidence(pack.stdout) : null;
		if (check.code !== 0 || check.signal !== null || pack.code !== 0 || pack.signal !== null || !tests || !packEvidence) fail(scrub(check.stderr || pack.stderr || check.stdout.slice(-4_000) || pack.stdout.slice(-2_000)) || "trusted check or pack dry-run failed; no PASS evidence was produced");
		const finalTestSource = await captureSourceIdentity(sourceRoot);
		if (finalTestSource.gitCommit !== sourceIdentity.gitCommit || finalTestSource.gitTree !== sourceIdentity.gitTree || finalTestSource.sourceDigest !== sourceIdentity.sourceDigest || !finalTestSource.trackedClean) fail("test source changed during the independent rerun");

		const release = await run(node.realpath, [resolve(sourceRoot, "scripts", "release-candidate.mjs"), "--output", args.output, ...(args.force ? ["--force"] : [])], { cwd: sourceRoot, env });
		if (release.code !== 0) fail(scrub(release.stderr) || "release-candidate failed");
		const manifest = JSON.parse(await readFile(resolve(args.output, "release-manifest.json"), "utf8"));
		if (manifest.gitCommit !== sourceIdentity.gitCommit || manifest.gitTree !== sourceIdentity.gitTree || manifest.sourceDigest !== sourceIdentity.sourceDigest || JSON.stringify(manifest.testDefinition) !== JSON.stringify(testDefinition) || manifest.buildSource !== "detached-git-commit") fail("release manifest differs from the independently tested Git source");
		if (JSON.stringify(manifest.piIdentity) !== JSON.stringify(pi.identity)) fail("release manifest Pi identity differs from the trusted local Pi package");
		const manifestFiles = manifest.files.map((file) => file.path).sort();
		if (packEvidence.filename !== manifest.artifact.file || JSON.stringify([...packEvidence.files].sort()) !== JSON.stringify(manifestFiles)) fail("independent pack dry-run differs from the release artifact file set");
		const releaseBinding = releaseBindingFor(manifest);
		const evidence = {
			schemaVersion: 3,
			status: "PASS",
			authority: "execution-time-independent-rerun",
			bundleAuthority: "audit-only; authenticate the bundle with its separately supplied root SHA-256",
			source: {
				gitCommit: manifest.gitCommit,
				gitTree: manifest.gitTree,
				sourceDigest: manifest.sourceDigest,
				testDefinition,
			},
			runner: {
				node: { kind: "process.execPath", file: basename(node.realpath), sha256: node.sha256, version: process.version },
				npm: { kind: "node-cli", file: "npm-cli.js", sha256: npm.cli.sha256 },
				typeScript: { package: typeScript.package, version: typeScript.version, packageJsonSha256: typeScript.packageJsonSha256, cliSha256: typeScript.cliSha256, launcherSha256: typeScript.launcherSha256 },
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
			release: releaseBinding,
		};
		await writeFile(resolve(args.output, "test-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

		const piEnv = { ...env, PI_BIN: pi.path };
		const piVersion = await run(pi.path, ["--version"], { cwd: sourceRoot, env: piEnv });
		if (piVersion.code !== 0 || piVersion.stdout.trim() !== pi.identity.version) fail("trusted Pi identity/version probe failed");
		const safety = await run(node.realpath, ["--test", "--test-name-pattern", "M11-R6", resolve(sourceRoot, "dist-test/test/pi-integration.test.js")], { cwd: sourceRoot, env: piEnv });
		const safetyTests = safety.code === 0 ? parseTapSummary(safety.stdout) : null;
		if (safety.code !== 0 || safety.signal !== null || !safetyTests || safetyTests.total !== 1 || safetyTests.passed !== 1) fail(scrub(safety.stderr) || "custom-tool safety regression failed");
		await writeFile(resolve(args.output, "worker-safety-evidence.json"), `${JSON.stringify({
			schemaVersion: 1,
			status: "PASS",
			actualPi: pi.identity.version,
			liveCalls: 0,
			paidInference: 0,
			command: "node --test --test-name-pattern M11-R6 dist-test/test/pi-integration.test.js",
			result: {
				tests: safetyTests,
				stdoutSha256: sha256(safety.stdout),
				stderrSha256: sha256(safety.stderr),
				stdoutTail: scrub(safety.stdout.slice(-4_000)),
				stderrTail: scrub(safety.stderr.slice(-2_000)),
			},
			customToolBoundary: {
				tool: "submit_evil",
				projectTrust: "UNTRUSTED",
				oldBehavior: "caller-supplied executable handler could mutate a fixture; reproduced by External Review #3",
				regressionAttempted: true,
				advertisedToChild: false,
				handlerExecuted: false,
				filesystemMutation: false,
				newBehavior: "unknown model-visible tool is not registered and cannot execute",
			},
			protocolBoundary: {
				classification: "protocol_submit",
				implementation: "M5-owned capture-only tool",
				callerExecuteCallback: false,
				ambientInheritance: false,
			},
			effectiveTools: {
				investigation: ["read", "grep", "find", "ls", "submit_agent_result"],
				implementation: ["read", "grep", "find", "ls", "bash", "edit", "write", "submit_agent_result"],
				verification: ["read", "grep", "find", "ls", "submit_verification_result"],
				analyst: ["read", "grep", "find", "ls", "submit_recommendation_analysis"],
				unknown: "FAIL_CLOSED",
			},
		}, null, 2)}\n`, "utf8");

		const piResult = await run(node.realpath, [resolve(sourceRoot, "scripts", "verify-pi-release.mjs"), "--release-dir", args.output], { cwd: sourceRoot, env: piEnv });
		if (piResult.code !== 0) fail(scrub(piResult.stderr) || "Pi release verification failed");
		const piEvidencePath = resolve(args.output, "pi-install-evidence.json");
		const piEvidence = JSON.parse(await readFile(piEvidencePath, "utf8"));
		if (piEvidence.status !== "PASS" || piEvidence.artifact !== manifest.artifact.file || piEvidence.sha256 !== manifest.artifact.sha256 || piEvidence.piVersion !== pi.identity.version) fail("Pi evidence is not bound to the trusted Pi or release artifact");
		await writeFile(piEvidencePath, `${JSON.stringify({ ...piEvidence, piIdentity: pi.identity, runner: { kind: "project-local-pi", file: "node_modules/@earendil-works/pi-coding-agent/dist/cli.js", sha256: pi.identity.cliSha256 } }, null, 2)}\n`, "utf8");

		const attacks = await run(node.realpath, [resolve(sourceRoot, "scripts", "release-integrity-attacks.mjs"), "--release-dir", args.output], { cwd: sourceRoot, env: piEnv });
		if (attacks.code !== 0) fail(scrub(attacks.stderr) || "release integrity attack harness failed");
		const attackEvidence = JSON.parse(await readFile(resolve(args.output, "release-integrity-evidence.json"), "utf8"));
		if (attackEvidence.status !== "PASS" || attackEvidence.total !== 20 || attackEvidence.passed !== 20) fail("release integrity attack evidence is incomplete");

		await bindReleaseEvidence(args.output);
		await verifyReleaseDirectory(args.output);
		const bundle = await run(node.realpath, [resolve(sourceRoot, "scripts", "create-review-bundle.mjs"), "--release-dir", args.output, "--output", args.bundle, "--force"], { cwd: sourceRoot, env });
		if (bundle.code !== 0) fail(scrub(bundle.stderr) || "review bundle creation failed");
		const bundleResult = JSON.parse(bundle.stdout.trim());
		if (!/^[0-9a-f]{64}$/u.test(bundleResult.rootSha256 ?? "")) fail("review bundle did not report an external root SHA-256");
		await verifyReviewBundle(args.bundle, bundleResult.rootSha256);
		console.log(JSON.stringify({
			output: relative(process.cwd(), args.output),
			bundle: relative(process.cwd(), args.bundle),
			artifactSha256: manifest.artifact.sha256,
			bundleRootSha256: bundleResult.rootSha256,
			tests: evidence.check.tests,
			integrityAttacks: { passed: attackEvidence.passed, total: attackEvidence.total },
			status: "PASS",
		}, null, 2));
	} finally {
		await rm(packCache, { recursive: true, force: true });
		await rm(sourceStage.temporaryRoot, { recursive: true, force: true });
	}
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
