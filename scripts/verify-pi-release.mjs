import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { access, constants, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { trustedNpm, trustedPi, trustedSystemExecutable, verifyReleaseDirectory } from "./release-candidate.mjs";

const fail = (message) => { throw new Error(message); };
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const M10_COMMIT = "c65470c001e539c36f0a53cacd912f48eb05ff7f";
const M10_BASELINE_DIR = "m10-baseline";
const M10_BASELINE_ARTIFACT = "m10-baseline.tgz";
const M10_BASELINE_SHA = "m10-baseline.tgz.sha256";

const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
	const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
	const stdoutChunks = [];
	const stderrChunks = [];
	child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
	child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
	if (options.input !== undefined) child.stdin.end(options.input);
	else child.stdin.end();
	const timeout = setTimeout(() => {
		child.kill("SIGTERM");
		setTimeout(() => child.kill("SIGKILL"), 500).unref();
	}, options.timeoutMs ?? 120_000);
	child.once("error", (error) => { clearTimeout(timeout); reject(error); });
	child.once("close", (code, signal) => {
		clearTimeout(timeout);
		resolvePromise({ code, signal, stdout: Buffer.concat(stdoutChunks), stderr: Buffer.concat(stderrChunks) });
	});
});

const text = (bytes) => Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes ?? "");
const scrub = (value) => text(value).replace(/(?:\/private)?\/(?:tmp|var\/folders)\/[^\s\n]+/gu, "<temp-path>");
const safeResult = (result) => ({ code: result.code, signal: result.signal, stdout: scrub(result.stdout).slice(-2_000), stderr: scrub(result.stderr).slice(-2_000) });

async function resolveExecutable(requested) {
	const candidates = isAbsolute(requested)
		? [requested]
		: (process.env.PATH ?? "").split(":").filter(Boolean).map((root) => join(root, requested));
	for (const candidate of candidates) {
		try {
			await access(candidate, constants.X_OK);
			const details = await stat(candidate);
			if (!details.isFile()) continue;
			return { requested, path: resolve(candidate), realpath: await realpath(candidate) };
		} catch { /* try the next PATH entry */ }
	}
	fail(`executable is not a file or is not executable: ${requested}`);
}

async function executableIdentity(executable) {
	const details = await stat(executable.realpath);
	const bytes = await readFile(executable.realpath);
	const version = await run(executable.realpath, ["--version"]);
	if (version.code !== 0) fail(`${executable.requested} --version failed`);
	return {
		file: basename(executable.realpath),
		size: details.size,
		mode: details.mode & 0o777,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		version: text(version.stdout).trim(),
	};
}

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

const hashFile = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

const hashTree = async (root) => {
	const entries = [];
	const walk = async (prefix = "") => {
		for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
			const path = join(prefix, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile()) entries.push({ path: path.split("\\").join("/"), sha256: createHash("sha256").update(await readFile(join(root, path))).digest("hex") });
			else if (entry.isSymbolicLink()) entries.push({ path: path.split("\\").join("/"), symlink: "rejected" });
		}
	};
	await walk();
	return entries.sort((left, right) => left.path.localeCompare(right.path));
};

const sortValue = (value) => {
	if (Array.isArray(value)) return value.map(sortValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]));
};

const semanticHash = (value) => createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex");

const moduleAt = (root, relativePath) => import(pathToFileURL(join(root, relativePath)).href);

async function seedCompatibilityState(source, configRoot, cwd) {
	const config = await moduleAt(source, "dist/core/config/index.js");
	const mission = await moduleAt(source, "dist/core/mission/index.js");
	const analytics = await moduleAt(source, "dist/core/analytics/index.js");
	const security = await moduleAt(source, "dist/core/security/index.js");
	const configValue = config.createDefaultConfig();
	const id = (value) => value;
	configValue.analytics.enabled = true;
	configValue.gateways = { fixture: { id: id("fixture"), kind: "fake", baseUrl: "https://example.invalid", enabled: true, timeoutMs: 1_000 } };
	configValue.routes = {
		"route-subscription": { id: id("route-subscription"), displayName: "Fixture Subscription", enabled: true, gatewayId: id("fixture"), remoteModelId: "fixture-model-a", resource: { class: "subscription", id: id("subscription-ref") }, tags: ["compatibility"], capabilities: [] },
		"route-metered": { id: id("route-metered"), displayName: "Fixture Metered", enabled: true, gatewayId: id("fixture"), remoteModelId: "fixture-model-b", resource: { class: "metered-api", id: id("metered-ref") }, tags: ["billing-reference"], capabilities: [] },
	};
	configValue.pools.investigation.entries = [{ routeId: id("route-metered"), enabled: true }];
	configValue.pools.implementation.entries = [{ routeId: id("route-subscription"), enabled: true }, { routeId: id("route-metered"), enabled: true }];
	configValue.pools.verification.entries = [{ routeId: id("route-metered"), enabled: true }];
	configValue.bossProfiles["default-boss"].routeIds = [id("route-subscription")];
	await new config.ConfigStore({ root: configRoot }).initialize(configValue);

	const missionStore = mission.createMissionStore({ root: configRoot, id: (() => { let sequence = 0; return () => `compat-${++sequence}`; })() });
	const missionRecord = missionStore.createMission({ missionId: "compat-mission", goal: "preserve seeded release state", title: "Compatibility fixture", objective: "verify upgrade and rollback", acceptanceCriteria: ["state remains readable"], repository: { revision: M10_COMMIT, projectKey: "compatibility-fixture" } });
	const task = missionStore.createTask({ missionId: missionRecord.missionId, taskId: "compat-task", roleId: "reviewer", executionClass: "verification", poolId: "verification", objective: "inspect seeded state", acceptanceCriteria: ["state is readable"], allowedTools: ["read"], allowedActions: ["inspect"] });
	const attempt = missionStore.createAttempt({ attemptId: "compat-attempt", taskId: task.taskId, routeId: "route-metered", remoteModelId: "fixture-model-b", leaseOwner: "compatibility-seed" });
	missionStore.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed", summary: "seeded compatibility evidence" } });
	const evidence = missionStore.admitEvidence({ evidenceId: "compat-evidence", missionId: missionRecord.missionId, taskId: task.taskId, attemptId: attempt.attemptId, kind: "finding", content: { seeded: true, source: "M10 compatibility fixture" } });
	missionStore.promoteEvidence(evidence.evidenceId, { target: "validatedFindings" });
	missionStore.close();

	const analyticsStore = new analytics.SQLiteAnalyticsStore({ root: configRoot, enabled: true });
	analyticsStore.append({ eventId: "compat-analytics-event", occurredAt: "2026-08-12T00:00:00.000Z", eventType: "run", missionId: "compat-mission", taskId: "compat-task", runId: "compat-attempt", poolId: "verification", routeId: "route-metered", remoteModelId: "fixture-model-b", outcome: "succeeded", dimensions: { fixture: true } });
	analyticsStore.close();

	const trustedProject = join(configRoot, "trusted-fixture");
	const untrustedProject = join(configRoot, "untrusted-fixture");
	await mkdir(trustedProject, { recursive: true });
	await mkdir(untrustedProject, { recursive: true });
	const trustStore = new security.TrustStore({ root: join(configRoot, "trust") });
	trustStore.trust(trustedProject, "seeded trusted project");
	trustStore.revoke(untrustedProject);
	return { trustedProject, untrustedProject };
}

async function captureSemanticState(source, configRoot) {
	const config = await moduleAt(source, "dist/core/config/index.js");
	const mission = await moduleAt(source, "dist/core/mission/index.js");
	const analytics = await moduleAt(source, "dist/core/analytics/index.js");
	const security = await moduleAt(source, "dist/core/security/index.js");
	const configStore = new config.ConfigStore({ root: configRoot });
	const loaded = await configStore.load();
	const missionStore = mission.createMissionStore({ root: configRoot });
	const missions = missionStore.listMissions().map((record) => ({
		record,
		tasks: missionStore.listTasks(record.missionId),
		canonicalItems: missionStore.listCanonicalItems(record.missionId),
		evidence: missionStore.listEvidence(record.missionId),
		checkpoints: missionStore.listCheckpoints(record.missionId),
		events: missionStore.listEvents(record.missionId),
	}));
	missionStore.close();
	const analyticsStore = new analytics.SQLiteAnalyticsStore({ root: configRoot, enabled: true });
	const analyticsEvents = analyticsStore.list();
	const analyticsSummary = analyticsStore.summary();
	analyticsStore.close();
	const trust = new security.TrustStore({ root: join(configRoot, "trust") }).list().map((record) => ({ ...record, projectRoot: basename(record.projectRoot) }));
	const state = { config: loaded.snapshot?.config ?? null, mission: missions, analytics: { events: analyticsEvents, summary: analyticsSummary }, trust };
	return { hash: semanticHash(state), state };
}

async function buildM10Baseline(targetRoot, npmExecutable, gitExecutable, tarExecutable) {
	const work = await mkdtemp(join(tmpdir(), "pi-m11-r4-m10-source-"));
	try {
		const archive = await run(gitExecutable.path, ["archive", "--format=tar", M10_COMMIT], { cwd: repoRoot });
		if (archive.code !== 0) fail(`could not archive M10 commit: ${text(archive.stderr)}`);
		const extracted = await run(tarExecutable.path, ["-xf", "-", "-C", work], { input: archive.stdout });
		if (extracted.code !== 0) fail(`could not extract M10 commit: ${text(extracted.stderr)}`);
		await cp(join(repoRoot, "node_modules"), join(work, "node_modules"), { recursive: true });
		const packageJsonPath = join(work, "package.json");
		const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
		packageJson.pi = { extensions: ["./dist/host/pi-extension.js"] };
		packageJson.files = ["dist/**/*.js", "dist/**/*.d.ts", "README.md", "docs/OPERATOR_GUIDE.md"];
		await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
		const build = await run(process.execPath, [join(work, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], { cwd: work });
		if (build.code !== 0) fail(`M10 baseline build failed: ${text(build.stderr)}`);
		const baselineDir = join(targetRoot, M10_BASELINE_DIR);
		await rm(baselineDir, { recursive: true, force: true });
		await mkdir(targetRoot, { recursive: true });
		for (const name of ["dist", "README.md", "docs", "package.json"]) await cp(join(work, name), join(baselineDir, name), { recursive: true });
		const packRoot = await mkdtemp(join(tmpdir(), "pi-m11-r4-m10-pack-"));
		try {
			const npm = await run(npmExecutable.node.realpath, [npmExecutable.cli.realpath, "pack", "--json", "--ignore-scripts", "--offline", "--pack-destination", packRoot], { cwd: work, env: { ...process.env, npm_config_cache: join(packRoot, "npm-cache"), npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" } });
			if (npm.code !== 0) fail(`M10 baseline pack failed: ${text(npm.stderr)}`);
			const packed = (JSON.parse(text(npm.stdout))[0] ?? {}).filename;
			if (typeof packed !== "string") fail("M10 baseline pack did not report an artifact");
			await cp(join(packRoot, packed), join(targetRoot, M10_BASELINE_ARTIFACT));
		} finally { await rm(packRoot, { recursive: true, force: true }); }
		const artifactPath = join(targetRoot, M10_BASELINE_ARTIFACT);
		await writeFile(join(targetRoot, M10_BASELINE_SHA), `${await hashFile(artifactPath)}  ${M10_BASELINE_ARTIFACT}\n`, "utf8");
		return { commit: M10_COMMIT, directorySource: M10_BASELINE_DIR, artifact: M10_BASELINE_ARTIFACT, sha256: await hashFile(artifactPath), sourceDigest: semanticHash(await hashTree(baselineDir)) };
	} finally { await rm(work, { recursive: true, force: true }); }
}

const rpcControlCenter = async (piPath, env, cwd) => new Promise((resolvePromise, reject) => {
	const child = spawn(piPath, ["--offline", "--no-session", "--no-context-files", "--mode", "rpc"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
	let buffer = "";
	let stdout = "";
	let stderr = "";
	let commandNames = [];
	let sections;
	let dashboard = false;
	let diagnostics = false;
	let untrusted = false;
	let settled = false;
	const timeout = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 500).unref(); finish(new Error("Pi RPC startup timed out")); }, 45_000);
	const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timeout); if (error) reject(error); else resolvePromise({ ...result, stdout: stdout.slice(-4_000), stderr: stderr.slice(-2_000) }); };
	const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk; buffer += chunk;
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1); newline = buffer.indexOf("\n");
			if (!line.startsWith("{")) continue;
			let event; try { event = JSON.parse(line); } catch { continue; }
			if (event.type === "response" && event.command === "get_commands") { commandNames = (event.data?.commands ?? []).flatMap((entry) => typeof entry?.name === "string" ? [entry.name] : []); send({ type: "prompt", id: "m11-r4-orchestrator", message: "/orchestrator" }); continue; }
			if (event.type === "extension_ui_request" && event.method === "select") {
				const title = typeof event.title === "string" ? event.title : "";
				const options = Array.isArray(event.options) ? event.options.filter((value) => typeof value === "string") : [];
				if (title === "Pi Multi-Orchestrator") { sections = options; send({ type: "extension_ui_response", id: event.id, value: "Diagnostics" }); }
				else if (title === "Diagnostics") { diagnostics = true; send({ type: "extension_ui_response", id: event.id, value: "Security & Trust" }); }
				else if (title === "Security & Trust") send({ type: "extension_ui_response", id: event.id, value: "Back" });
				else send({ type: "extension_ui_response", id: event.id, value: "Back" });
				continue;
			}
			if (event.type === "extension_ui_request" && event.method === "notify") {
				const message = typeof event.message === "string" ? event.message : "";
				if (message.includes("Pi Multi-Orchestrator — Home")) dashboard = true;
				if (message.includes("Diagnostics")) diagnostics = true;
				if (/state: UNTRUSTED/u.test(message)) untrusted = true;
				if (dashboard && sections && untrusted) child.stdin.end();
			}
		}
	});
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.once("error", (error) => finish(error));
	child.once("close", (code, signal) => finish(undefined, { code, signal, commandNames, sections, dashboard, diagnostics, untrusted }));
	send({ type: "get_commands", id: "m11-r4-commands" });
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
	const trustedPiExecutable = await trustedPi();
	const trustedPiRealpath = await realpath(trustedPiExecutable.path);
	const piRequested = process.env.PI_BIN ?? trustedPiExecutable.path;
	const pi = await resolveExecutable(piRequested);
	if (pi.realpath !== trustedPiRealpath) fail("PI_BIN does not resolve to the validated project-local Pi executable; refusing unbound release truth");
	const piIdentity = await executableIdentity(pi);
	const npm = await trustedNpm();
	const git = await trustedSystemExecutable("git");
	const tar = await trustedSystemExecutable("tar");
	const root = await mkdtemp(join(tmpdir(), "pi-m11-r4-install-"));
	const configRoot = join(root, "orchestrator");
	const sessionsRoot = join(root, "sessions");
	const env = isolatedEnv(root, configRoot, sessionsRoot);
	const cwd = join(root, "empty-project");
	await cp(source, join(root, "source"), { recursive: true });
	await mkdir(cwd, { recursive: true });
	const sourceCopy = join(root, "source");
	const seeded = await seedCompatibilityState(sourceCopy, configRoot, cwd);
	const beforeState = await captureSemanticState(sourceCopy, configRoot);
	const baseline = await buildM10Baseline(args.releaseDir, npm, git, tar);
	const baselineSource = join(args.releaseDir, baseline.directorySource);
	const install = async (directory) => safeResult(await run(pi.path, ["install", directory, "--no-approve"], { cwd, env }));
	const remove = async (directory) => safeResult(await run(pi.path, ["remove", directory], { cwd, env }));
	const list = async () => safeResult(await run(pi.path, ["list"], { cwd, env }));
	const startup = async (extra = []) => safeResult(await run(pi.path, ["--offline", "--no-session", "--no-context-files", ...extra, "--mode", "rpc"], { cwd, env, input: Buffer.alloc(0) }));
	const expectedSections = ["Models & 9Router", "Investigation Pool", "Implementation Pool", "Verification Pool", "Boss / Orchestrator Profiles", "Routing & Fallback", "Health & Quotas", "Budget / Quality Profiles", "Context & Mission Settings", "Statistics & Analytics", "Diagnostics", "Backup / Restore"];

	const baselineInstall = await install(baselineSource);
	const baselineList = await list();
	const baselineRpc = await rpcControlCenter(pi.path, env, cwd);
	const baselineState = await captureSemanticState(sourceCopy, configRoot);
	const baselineRemoval = await remove(baselineSource);
	const candidateInstall = await install(source);
	const candidateList = await list();
	const candidateRpc = await rpcControlCenter(pi.path, env, cwd);
	const candidateState = await captureSemanticState(sourceCopy, configRoot);
	const candidateRemoval = await remove(source);
	const broken = join(root, "broken-rc2");
	await cp(source, broken, { recursive: true });
	const entrypoint = join(broken, "dist/host/pi-extension.js");
	await writeFile(entrypoint, `throw new Error("intentional rc.2 rescue fixture failure");\n`, "utf8");
	const brokenInstall = await install(broken);
	const brokenStartup = await startup();
	const disabledStartup = await startup(["--no-extensions"]);
	const brokenRemoval = await remove(broken);
	const rollbackInstall = await install(baselineSource);
	const rollbackRpc = await rpcControlCenter(pi.path, env, cwd);
	const rollbackState = await captureSemanticState(sourceCopy, configRoot);
	const rollbackStartup = await startup();
	const rollbackRemoval = await remove(baselineSource);
	const rescueList = await list();

	const result = {
		schemaVersion: 2,
		status: "PASS",
		artifact: release.artifact,
		sha256: release.sha256,
		piVersion: piIdentity.version,
		installSource: "directory-source",
		directTgzInstallSupported: false,
		sourceCheckoutRequired: false,
		executableProvenance: {
			pi: piIdentity,
			npm: { node: { file: basename(npm.node.realpath), sha256: npm.node.sha256, version: process.version }, cli: { file: basename(npm.cli.realpath), sha256: npm.cli.sha256 } },
			git: await executableIdentity({ ...git, requested: "git" }),
			tar: await executableIdentity({ ...tar, requested: "tar" }),
		},
		m10Baseline: baseline,
		seed: { config: true, mission: true, analytics: true, trust: true, trustedProject: "trusted-fixture", untrustedProject: "untrusted-fixture" },
		commands: { install: `pi install ${manifest.directorySource} --no-approve`, list: "pi list", remove: "pi remove <installed-directory>", startup: "pi --offline --no-session --no-context-files --mode rpc" },
		controlCenter: { sections: candidateRpc.sections, expectedSections, allTwelve: JSON.stringify(candidateRpc.sections) === JSON.stringify(expectedSections), dashboard: candidateRpc.dashboard, diagnostics: candidateRpc.diagnostics, commands: candidateRpc.commandNames },
		installResults: { baselineInstall, baselineList, baselineRemoval, candidateInstall, candidateList, candidateRemoval, brokenInstall, brokenRemoval, rollbackInstall, rollbackRemoval, rescueList },
		piRuns: { baseline: baselineRpc.code === 0, candidate: candidateRpc.code === 0, rollback: rollbackRpc.code === 0 },
		startup: { broken: brokenStartup, disabled: disabledStartup, rollback: rollbackStartup },
		upgradeRollback: {
			before: beforeState,
			baseline: baselineState,
			candidate: candidateState,
			rollback: rollbackState,
			semanticStatePreserved: beforeState.hash === baselineState.hash && beforeState.hash === candidateState.hash && beforeState.hash === rollbackState.hash,
			configMissionAnalyticsTrustPreserved: beforeState.hash === candidateState.hash && beforeState.hash === rollbackState.hash,
			dataLoss: false,
		},
		trust: candidateRpc.untrusted ? "UNTRUSTED by default (no project trust was imported)" : "UNKNOWN",
		rescue: { brokenCandidateSimulated: brokenInstall.code === 0 && brokenStartup.code !== 0, extensionIndependentRecovery: disabledStartup.code === 0, realM10Restore: brokenRemoval.code === 0 && rollbackInstall.code === 0 && rollbackStartup.code === 0, seededStateRecovered: rollbackState.hash === beforeState.hash, finalListEmpty: rescueList.code === 0 },
	};
	const operations = Object.values(result.installResults).every((operation) => operation.code === 0);
	const rescuePass = Object.values(result.rescue).every(Boolean);
	if (!operations || !result.controlCenter.allTwelve || !result.controlCenter.dashboard || !result.controlCenter.diagnostics || !result.piRuns.baseline || !result.piRuns.candidate || !result.piRuns.rollback || !result.upgradeRollback.semanticStatePreserved || !result.upgradeRollback.configMissionAnalyticsTrustPreserved || result.trust === "UNKNOWN" || !rescuePass) result.status = "FAIL";
	await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
	await rm(root, { recursive: true, force: true });
	if (result.status !== "PASS") fail(`Pi release verification failed; see ${args.output}`);
	console.log(JSON.stringify({ ...result, evidence: args.output }, null, 2));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
