import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fail = (message) => { throw new Error(message); };
const scrub = (value) => value.replace(/(?:\/private)?\/(?:tmp|var\/folders)\/[^\s\n]+/gu, "<temp-path>");

const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
	const child = spawn(command, args, { cwd: root, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.once("error", reject);
	child.once("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
});

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
	const check = await run("npm", ["run", "check"]);
	const packCache = await mkdtemp(`${tmpdir()}/pi-m11-r2-npm-cache-`);
	const pack = await run("npm", ["pack", "--dry-run", "--ignore-scripts"], { env: { ...process.env, npm_config_cache: packCache } });
	await rm(packCache, { recursive: true, force: true });
	const tests = [...check.stdout.matchAll(/# tests (\d+)\s+# suites \d+\s+# pass (\d+)\s+# fail (\d+)/gu)].at(-1);
	const evidence = {
		schemaVersion: 1,
		status: check.code === 0 && pack.code === 0 ? "PASS" : "FAIL",
		gitCommit: (await run("git", ["rev-parse", "HEAD"])).stdout.trim(),
		commands: {
			check: "npm run check",
			packDryRun: "npm pack --dry-run --ignore-scripts",
		},
		check: { code: check.code, signal: check.signal, tests: tests ? { total: Number(tests[1]), passed: Number(tests[2]), failed: Number(tests[3]) } : null, stdoutTail: scrub(check.stdout.slice(-4_000)), stderrTail: scrub(check.stderr.slice(-2_000)) },
		pack: { code: pack.code, signal: pack.signal, stdoutTail: scrub(pack.stdout.slice(-2_000)), stderrTail: scrub(pack.stderr.slice(-2_000)) },
	};
	if (evidence.status !== "PASS" || !evidence.check.tests) fail("npm check or npm pack --dry-run failed, or test totals were not captured; see test-evidence.json");
	const release = await run(process.execPath, ["scripts/release-candidate.mjs", "--output", args.output, ...(args.force ? ["--force"] : [])]);
	if (release.code !== 0) fail(release.stderr || "release-candidate failed");
	await mkdir(args.output, { recursive: true });
	await writeFile(`${args.output}/test-evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
	const pi = await run(process.execPath, ["scripts/verify-pi-release.mjs", "--release-dir", args.output]);
	if (pi.code !== 0) fail(pi.stderr || "Pi release verification failed");
	const bundle = await run(process.execPath, ["scripts/create-review-bundle.mjs", "--release-dir", args.output, "--output", args.bundle, "--force"]);
	if (bundle.code !== 0) fail(bundle.stderr || "review bundle creation failed");
	console.log(JSON.stringify({ output: args.output, bundle: args.bundle, tests: evidence.check.tests, status: "PASS" }, null, 2));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
