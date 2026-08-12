import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseDirectory } from "./release-candidate.mjs";

const fail = (message) => { throw new Error(message); };
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const piCommand = process.env.PI_BIN ?? "pi";

const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
	const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	if (options.input !== undefined) child.stdin.end(options.input);
	else child.stdin.end();
	const timeout = setTimeout(() => {
		child.kill("SIGTERM");
		setTimeout(() => child.kill("SIGKILL"), 500).unref();
	}, options.timeoutMs ?? 30_000);
	child.once("error", (error) => { clearTimeout(timeout); reject(error); });
	child.once("close", (code, signal) => {
		clearTimeout(timeout);
		resolvePromise({ code, signal, stdout, stderr });
	});
});

const isolatedEnv = (root, configRoot, sessionsRoot) => {
	const keep = ["PATH", "TMPDIR", "LANG", "LC_ALL", "TERM"];
	return {
		...Object.fromEntries(keep.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])),
		HOME: root,
		PI_CODING_AGENT_DIR: join(root, "agent"),
		PI_CODING_AGENT_SESSION_DIR: sessionsRoot,
		PI_MULTI_ORCH_CONFIG_ROOT: configRoot,
		PI_OFFLINE: "1",
	};
};

const hashTree = async (root) => {
	const entries = [];
	const walk = async (prefix = "") => {
		for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
			const path = join(prefix, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile()) {
				const bytes = await readFile(join(root, path));
				entries.push({ path: path.split("\\").join("/"), sha256: createHash("sha256").update(bytes).digest("hex") });
			}
		}
	};
	await walk();
	return entries.sort((left, right) => left.path.localeCompare(right.path));
};

const scrub = (value) => value.replace(/(?:\/private)?\/(?:tmp|var\/folders)\/[^\s\n]+/gu, "<temp-path>");
const safeResult = (result) => ({
	code: result.code,
	signal: result.signal,
	stdout: scrub(result.stdout.slice(-2_000)),
	stderr: scrub(result.stderr.slice(-2_000)),
});

const rpcControlCenter = async (env, cwd) => new Promise((resolvePromise, reject) => {
	const child = spawn(piCommand, ["--offline", "--no-session", "--no-context-files", "--mode", "rpc"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
	let buffer = "";
	let stdout = "";
	let stderr = "";
	let commandNames = [];
	let sections;
	let dashboard = false;
let diagnostics = false;
let untrusted = false;
	let settled = false;
	const finish = (error, result) => {
		if (settled) return;
		settled = true;
		clearTimeout(timeout);
		if (error) reject(error);
		else resolvePromise({ ...result, stdout: stdout.slice(-4_000), stderr: stderr.slice(-2_000) });
	};
	const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
	const timeout = setTimeout(() => {
		child.kill("SIGTERM");
		setTimeout(() => child.kill("SIGKILL"), 500).unref();
		finish(new Error("Pi RPC startup timed out"));
	}, 45_000);
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		buffer += chunk;
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
			if (!line.startsWith("{")) continue;
			let event;
			try { event = JSON.parse(line); } catch { continue; }
			if (event.type === "response" && event.command === "get_commands") {
				commandNames = (event.data?.commands ?? []).flatMap((entry) => typeof entry?.name === "string" ? [entry.name] : []);
				send({ type: "prompt", id: "m11-r2-orchestrator", message: "/orchestrator" });
				continue;
			}
			if (event.type === "extension_ui_request" && event.method === "select") {
				const title = typeof event.title === "string" ? event.title : "";
				const options = Array.isArray(event.options) ? event.options.filter((value) => typeof value === "string") : [];
				if (title === "Pi Multi-Orchestrator") {
					sections = options;
					send({ type: "extension_ui_response", id: event.id, value: "Diagnostics" });
				} else if (title === "Diagnostics") {
					diagnostics = true;
					send({ type: "extension_ui_response", id: event.id, value: "Security & Trust" });
				} else if (title === "Security & Trust") {
					send({ type: "extension_ui_response", id: event.id, value: "Back" });
				} else {
					send({ type: "extension_ui_response", id: event.id, value: "Back" });
				}
				continue;
			}
			if (event.type === "extension_ui_request" && event.method === "notify") {
				const message = typeof event.message === "string" ? event.message : "";
				if (message.includes("Pi Multi-Orchestrator — Home")) dashboard = true;
				if (message.includes("Diagnostics")) diagnostics = true;
				if (/state: UNTRUSTED/u.test(message)) untrusted = true;
					if (dashboard && sections && untrusted) {
					child.stdin.end();
				}
			}
		}
	});
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.once("error", (error) => finish(error));
	child.once("close", (code, signal) => finish(undefined, { code, signal, commandNames, sections, dashboard, diagnostics, untrusted }));
	send({ type: "get_commands", id: "m11-r2-commands" });
});

const parseArgs = (argv) => {
	let releaseDir;
	let output;
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--release-dir") releaseDir = argv[++index];
		else if (argv[index] === "--output") output = argv[++index];
		else if (argv[index] === "--help") return { help: true };
		else fail(`unknown argument: ${argv[index]}`);
	}
	if (!releaseDir) fail("usage: node scripts/verify-pi-release.mjs --release-dir DIR [--output FILE]");
	return { releaseDir: resolve(releaseDir), output: output ? resolve(output) : join(resolve(releaseDir), "pi-install-evidence.json"), help: false };
};

const main = async () => {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) return;
	const release = await verifyReleaseDirectory(args.releaseDir);
	const manifest = JSON.parse(await readFile(join(args.releaseDir, "release-manifest.json"), "utf8"));
	const source = join(args.releaseDir, manifest.directorySource);
	const root = await mkdtemp(join(tmpdir(), "pi-m11-r2-install-"));
	const configRoot = join(root, "orchestrator");
	const sessionsRoot = join(root, "sessions");
	const env = isolatedEnv(root, configRoot, sessionsRoot);
	const cwd = join(root, "empty-project");
	await cp(source, join(root, "source"), { recursive: true });
	await mkdir(cwd, { recursive: true });
	const baseline = join(root, "m10-compatibility-baseline");
	await cp(source, baseline, { recursive: true });
	const baselineManifest = JSON.parse(await readFile(join(baseline, "package.json"), "utf8"));
	baselineManifest.version = "0.0.0-development";
	await writeFile(join(baseline, "package.json"), `${JSON.stringify(baselineManifest, null, 2)}\n`, "utf8");
	const install = async (directory) => safeResult(await run(piCommand, ["install", directory, "--no-approve"], { cwd, env }));
	const remove = async (directory) => safeResult(await run(piCommand, ["remove", directory], { cwd, env }));
	const list = async () => safeResult(await run(piCommand, ["list"], { cwd, env }));
	const baselineInstall = await install(baseline);
	const baselineList = await list();
	const baselineRpc = await rpcControlCenter(env, cwd);
	const baselineHashes = await hashTree(configRoot);
	const candidateRemoval = await remove(baseline);
	const candidateInstall = await install(source);
	const candidateList = await list();
	const candidateRpc = await rpcControlCenter(env, cwd);
	const candidateHashes = await hashTree(configRoot);
	const candidateRemovalAfter = await remove(source);
	const rollbackInstall = await install(baseline);
	const rollbackRpc = await rpcControlCenter(env, cwd);
	const rollbackHashes = await hashTree(configRoot);
	const rescueRemoval = await remove(baseline);
	const rescueList = await list();
	const expectedSections = [
		"Models & 9Router", "Investigation Pool", "Implementation Pool", "Verification Pool",
		"Boss / Orchestrator Profiles", "Routing & Fallback", "Health & Quotas", "Budget / Quality Profiles",
		"Context & Mission Settings", "Statistics & Analytics", "Diagnostics", "Backup / Restore",
	];
	const result = {
		schemaVersion: 1,
		status: "PASS",
		artifact: release.artifact,
		sha256: release.sha256,
		piVersion: (await run(piCommand, ["--version"], { cwd, env })).stdout.trim(),
		installSource: "directory-source",
		directTgzInstallSupported: false,
		sourceCheckoutRequired: false,
		commands: {
			install: `pi install ${manifest.directorySource} --no-approve`,
			list: "pi list",
			remove: "pi remove <installed-directory>",
			startup: "pi --offline --no-session --no-context-files --mode rpc",
		},
		controlCenter: {
			sections: candidateRpc.sections,
			expectedSections,
			allTwelve: JSON.stringify(candidateRpc.sections) === JSON.stringify(expectedSections),
			dashboard: candidateRpc.dashboard,
			diagnostics: candidateRpc.diagnostics,
			commands: candidateRpc.commandNames,
		},
		installResults: { baselineInstall, baselineList, candidateInstall, candidateList, candidateRemovalAfter, rollbackInstall, rescueRemoval, rescueList },
		upgradeRollback: {
			baseline: baselineHashes,
			candidate: candidateHashes,
			rollback: rollbackHashes,
			configMissionAnalyticsTrustPreserved: JSON.stringify(baselineHashes) === JSON.stringify(candidateHashes) && JSON.stringify(baselineHashes) === JSON.stringify(rollbackHashes),
			baselineVersion: "0.0.0-development",
			candidateVersion: manifest.package.version,
			rollbackVersion: "0.0.0-development",
		},
		trust: candidateRpc.untrusted ? "UNTRUSTED by default (no project trust was imported)" : "UNKNOWN",
		rescue: rescueRemoval.code === 0 && rescueList.code === 0,
		piRuns: { baseline: baselineRpc.code === 0, candidate: candidateRpc.code === 0, rollback: rollbackRpc.code === 0 },
	};
	const packageOpsPass = [baselineInstall, baselineList, candidateInstall, candidateList, candidateRemovalAfter, rollbackInstall, rescueRemoval, rescueList].every((operation) => operation.code === 0);
	result.packageOperationsPass = packageOpsPass;
	if (!packageOpsPass || !result.controlCenter.allTwelve || !result.controlCenter.dashboard || !result.controlCenter.diagnostics || !result.rescue || !result.upgradeRollback.configMissionAnalyticsTrustPreserved || !candidateRpc.untrusted || !result.piRuns.baseline || !result.piRuns.candidate || !result.piRuns.rollback) result.status = "FAIL";
	await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
	await rm(root, { recursive: true, force: true });
	if (result.status !== "PASS") fail(`Pi release verification failed; see ${args.output}`);
	console.log(JSON.stringify({ ...result, evidence: args.output }, null, 2));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
