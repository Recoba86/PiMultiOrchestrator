import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

import { ConfigStore, createDefaultConfig, type StableId } from "../src/core/config/index.js";
import { HealthStore } from "../src/core/health/index.js";
import { classifyFailure } from "../src/core/routing/index.js";
import {
	FakeNineRouter,
	makeCatalogModels,
	type FakeModel,
} from "./support/fake-ninerouter.js";
import {
	CatalogCacheStore,
	type CatalogCacheV1,
	type RemoteCatalogEntry,
} from "../src/core/ninerouter/index.js";
import { createMissionStore } from "../src/core/mission/index.js";
import { ContextBroker, missionStoreContextRepository } from "../src/core/context/index.js";
import { AnalyticsQueryService, SQLiteAnalyticsStore } from "../src/core/analytics/index.js";
import { TrustStore } from "../src/core/security/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// `npm test` compiles src/** into dist-test/** and runs this file from there.
// Keep the entrypoint tied to that same build so the P tests cannot silently
// skip merely because the production dist/ directory has not been built yet.
const builtEntry = resolve(
	repoRoot,
	process.env.PI_M2_EXTENSION_ENTRY ?? "dist-test/src/host/pi-extension.js",
);
const piCommand = process.env.PI_BIN ?? "pi";
const integrationSkip = !existsSync(builtEntry)
	? `compiled Pi extension is absent at ${builtEntry}; run npm test (or set PI_M2_EXTENSION_ENTRY)`
	: process.env.PI_M2_SKIP_PI === "1"
		? "PI_M2_SKIP_PI=1"
		: false;

const selectedRemoteIds = makeCatalogModels(5).map((model) => model.id);
const sourceModels = makeCatalogModels();
// Config schema StableId values must begin with a letter.  The gateway's
// stable config identity is therefore distinct from Pi's provider namespace
// (`9router`), which remains the externally visible provider ID.
const configGatewayId = "ninerouter" as StableId;

interface StableRouteModule {
	stableRouteId?: (gatewayId: string, remoteModelId: string) => string;
	deriveRouteId?: (gatewayId: string, remoteModelId: string) => string;
	routeIdForRemote?: (gatewayId: string, remoteModelId: string) => string;
}

interface PiRunResult {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly stdout: string;
	readonly stderr: string;
}

const stripAnsi = (value: string): string => value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");

const safePiDiagnostic = (result: PiRunResult, token: string): string =>
	JSON.stringify({
		code: result.code,
		signal: result.signal,
		stdout: result.stdout.replaceAll(token, "<redacted>").slice(-4_000),
		stderr: result.stderr.replaceAll(token, "<redacted>").slice(-4_000),
	});

async function stableRouteId(remoteModelId: string): Promise<StableId> {
	const moduleRoot = resolve(dirname(builtEntry), "..");
	const moduleUrl = pathToFileURL(resolve(moduleRoot, "core/ninerouter/index.js")).href;
	const module = (await import(moduleUrl)) as StableRouteModule;
	const fn = module.stableRouteId ?? module.deriveRouteId ?? module.routeIdForRemote;
	if (!fn) throw new Error("M2 integration requires an exported stableRouteId helper");
	const value = fn(configGatewayId, remoteModelId);
	if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) {
		throw new Error(`stableRouteId returned an invalid config ID for ${remoteModelId}`);
	}
	return value as StableId;
}

function cacheEntry(model: FakeModel): RemoteCatalogEntry {
	return {
		remoteId: model.id,
		displayName: model.name ?? model.id,
		owner: model.owned_by ?? "fake-9router",
		resourceClass: "unknown",
		capabilities: ["chat"],
		input: ["text"],
		contextWindow: model.context_window ?? 128_000,
		maxTokens: model.max_tokens ?? 4_096,
		capability: "chat",
		provenance: {
			remoteId: "remote",
			displayName: model.name ? "remote" : "conservative-default",
			owner: model.owned_by ? "remote" : "conservative-default",
			resourceClass: "conservative-default",
			capabilities: "conservative-default",
			input: "conservative-default",
			contextWindow: model.context_window ? "remote" : "conservative-default",
			maxTokens: model.max_tokens ? "remote" : "conservative-default",
			capability: "configured",
		},
	};
}

async function seedConfig(root: string, baseUrl: string, models: readonly FakeModel[], options: { readonly analyticsEnabled?: boolean; readonly fallbackEnabled?: boolean } = {}): Promise<void> {
	const config = createDefaultConfig();
	config.analytics.enabled = options.analyticsEnabled === true;
	config.routing.fallback.enabled = options.fallbackEnabled === true;
	const gatewayId = configGatewayId;
	const routeIds: StableId[] = [];
	config.gateways[gatewayId] = {
		id: gatewayId,
		kind: "9router",
		baseUrl,
		enabled: true,
		timeoutMs: 2_000,
		credentialRef: { store: "env", key: "NINEROUTER_TEST_KEY" },
	};
	for (const model of models) {
		const routeId = await stableRouteId(model.id);
		routeIds.push(routeId);
		config.routes[routeId] = {
			id: routeId,
			displayName: model.name ?? model.id,
			enabled: selectedRemoteIds.includes(model.id),
			gatewayId,
			remoteModelId: model.id,
			resource: { class: "unknown" },
			tags: [],
			capabilities: ["chat"],
			metadata: { sourceLabel: "fake-9router" },
		};
	}
	config.pools.investigation.entries = routeIds.slice(0, 2).map((routeId) => ({ routeId, enabled: true }));
	config.pools.implementation.entries = routeIds.slice(0, 4).map((routeId) => ({ routeId, enabled: true }));
	config.pools.verification.entries = routeIds.slice(1, 3).map((routeId) => ({ routeId, enabled: true }));
	await new ConfigStore({ root }).initialize(config);
	const now = new Date().toISOString();
	const cache: CatalogCacheV1 = {
		cacheVersion: 1,
		gatewayId,
		baseUrl,
		generation: 1,
		fetchedAt: now,
		lastSuccessAt: now,
		entries: models.map(cacheEntry),
	};
	await new CatalogCacheStore(root).save(cache);
}

async function seedRecommendation(root: string, proposedRouteId: StableId, baselineRouteId: StableId): Promise<void> {
	const store = new SQLiteAnalyticsStore({ root, enabled: true });
	store.saveRecommendation({
		recommendationId: "rec-fixture",
		poolId: "verification",
		proposedRouteId,
		baselineRouteId,
		sampleSize: 10,
		score: 0.9,
		formulaVersion: "quality-v1",
		evidence: ["9/10 successful runs on proposed route"],
		limitations: ["fixture only"],
		proposedDiff: { baselineOrder: [baselineRouteId, proposedRouteId] },
		status: "proposed",
	});
	store.close();
}

function isolatedEnv(server: FakeNineRouter, agentRoot: string, orchestratorRoot: string, sessionsRoot: string): NodeJS.ProcessEnv {
	const inherited = Object.fromEntries(
		["PATH", "TMPDIR", "LANG", "LC_ALL", "TERM"]
			.map((key) => [key, process.env[key]])
			.filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
	return {
		...inherited,
		// Keep Pi's fallback home paths inside the fixture even if a test runner
		// has real provider credentials or a live ~/.pi directory.
		HOME: agentRoot,
		PI_CODING_AGENT_DIR: agentRoot,
		PI_CODING_AGENT_SESSION_DIR: sessionsRoot,
		PI_MULTI_ORCH_CONFIG_ROOT: orchestratorRoot,
		NINEROUTER_TEST_KEY: server.token,
		PI_OFFLINE: "1",
	};
}

function runPi(args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs = 20_000): Promise<PiRunResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(piCommand, args, { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] });
		// Print/list modes read optional prompt content from stdin.  Closing the
		// pipe is the protocol EOF that lets Pi finish instead of waiting for
		// more piped input indefinitely.
		child.stdin.end();
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 500).unref();
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", (error) => {
			clearTimeout(timeout);
			if (!settled) {
				settled = true;
				reject(error);
			}
		});
		child.once("close", (code, signal) => {
			clearTimeout(timeout);
			if (settled) return;
			settled = true;
			resolvePromise({ code, signal, stdout, stderr });
		});
	});
}

function parseJsonLines(value: string): Record<string, unknown>[] {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("{"))
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as Record<string, unknown>];
			} catch {
				return [];
			}
		});
}

type RpcEventHandler = (event: Record<string, unknown>, send: (value: Record<string, unknown>) => void, close: () => void) => void;

function runRpcSession(cwd: string, env: NodeJS.ProcessEnv, handle: RpcEventHandler, timeoutMs = 45_000): Promise<PiRunResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(piCommand, ["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--mode", "rpc"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let buffer = "";
		let settled = false;
		const deadline = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 500).unref(); }, timeoutMs);
		const send = (value: Record<string, unknown>): void => { if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(value)}\n`); };
		const close = (): void => { if (!child.stdin.destroyed) child.stdin.end(); };
		const fail = (error: unknown): void => { if (settled) return; settled = true; clearTimeout(deadline); child.kill("SIGTERM"); reject(error); };
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
			buffer += chunk.toString();
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).replace(/\r$/u, "");
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (!line.trim().startsWith("{")) continue;
				try { handle(JSON.parse(line) as Record<string, unknown>, send, close); } catch (error) { fail(error); return; }
			}
		});
		child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
		child.once("error", fail);
		child.once("close", (code, signal) => { if (settled) return; settled = true; clearTimeout(deadline); resolvePromise({ code, signal, stdout, stderr }); });
		send({ type: "get_commands", id: "commands" });
	});
}

async function withFixture<T>(run: (server: FakeNineRouter, root: string) => Promise<T>, options: { readonly toolCallFlow?: boolean; readonly customToolBypassFlow?: boolean; readonly customToolMarker?: string; readonly qualityLoopFlow?: boolean; readonly analystFlow?: "support" | "oppose" | "insufficient_evidence" | "infra-failure"; readonly analystSecret?: string; readonly analyticsEnabled?: boolean; readonly fallbackEnabled?: boolean; readonly failModels?: readonly string[] } = {}): Promise<T> {
	const server = new FakeNineRouter({ models: sourceModels, ...options });
	const root = await mkdtemp(join(tmpdir(), "pi-m2-integration-"));
	const agentRoot = join(root, "agent");
	const sessionsRoot = join(root, "sessions");
	const orchestratorRoot = join(root, "orchestrator");
	await mkdir(agentRoot, { recursive: true, mode: 0o700 });
	await mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
	try {
		await server.start();
		await seedConfig(orchestratorRoot, server.baseUrl, sourceModels, options);
		return await run(server, orchestratorRoot);
	} finally {
		await server.close();
		await rm(root, { recursive: true, force: true });
	}
}

test("[I][fixture-v1] fake 9Router catalog and SSE contract are bounded and auth-protected", async () => {
	const server = new FakeNineRouter({ models: sourceModels });
	try {
		await server.start();
		const response = await fetch(`${server.baseUrl}/models`, {
			headers: { authorization: `Bearer ${server.token}` },
		});
		assert.equal(response.status, 200);
		const payload = (await response.json()) as { data?: FakeModel[] };
		assert.equal(payload.data?.length, 36);
		assert.equal(payload.data?.[0]?.id, "fake/model-01");

		const unauthorized = await fetch(`${server.baseUrl}/models`);
		assert.equal(unauthorized.status, 401);
		const completion = await fetch(`${server.baseUrl}/chat/completions`, {
			method: "POST",
			headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
			body: JSON.stringify({
				model: "fake/model-01",
				messages: [{ role: "user", content: "fixture" }],
				stream: true,
				stream_options: { include_usage: true },
			}),
		});
		assert.equal(completion.status, 200);
		const streamBody = await completion.text();
		assert.match(streamBody, /PI_FAKE_9ROUTER_OK/);
		assert.match(streamBody, /data: \[DONE\]/);
		assert.deepEqual(server.chatRequests.at(-1), {
			method: "POST",
			path: "/v1/chat/completions",
			authAccepted: true,
			model: "fake/model-01",
			stream: true,
			includeUsage: true,
			messageCount: 1,
		});
	} finally {
		await server.close();
	}
});

test("[I][fixture-v1][M8.5] fake Verification route returns bounded analyst verdicts without transcript metadata", async () => {
	for (const verdict of ["support", "oppose", "insufficient_evidence"] as const) {
		const secret = `analyst-secret-${verdict}`;
		const server = new FakeNineRouter({ toolCallFlow: true, analystFlow: verdict, analystSecret: secret });
		try {
			await server.start();
			const request = (messages: readonly Record<string, unknown>[]) => fetch(`${server.baseUrl}/chat/completions`, {
				method: "POST",
				headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
				body: JSON.stringify({
					model: "fake/model-01",
					messages,
					stream: true,
					stream_options: { include_usage: true },
					tools: [{ type: "function", function: { name: "submit_recommendation_analysis", parameters: { type: "object" } } }],
				}),
			});
			const first = await request([{ role: "user", content: "Analyze the bounded recommendation." }]);
			assert.equal(first.status, 200);
			const body = await first.text();
			const argumentLine = body.split(/\r?\n/u).find((line) => line.includes('"arguments":"'));
			assert.ok(argumentLine, body);
			const encoded = argumentLine?.match(/"arguments":"((?:\\.|[^"\\])*)"/u)?.[1];
			assert.ok(encoded, body);
			const analystResult = JSON.parse(JSON.parse(`"${encoded}"`)) as Record<string, unknown>;
			assert.equal(analystResult.verdict, verdict);
			assert.equal(typeof analystResult.explanation, "string");
			assert.ok(Array.isArray(analystResult.reasoningFactors));
			assert.ok(Array.isArray(analystResult.caveats));
			assert.equal(body.includes(secret), false);
			assert.equal(body.includes("transcript"), false);
			assert.equal(server.analystRequests.length, 1);
			assert.equal(JSON.stringify(server.analystRequests).includes(secret), false);
			assert.equal(JSON.stringify(server.analystRequests).includes("transcript"), false);
		} finally {
			await server.close();
		}
	}
});

test("[I][fixture-v1][M8.5] analyst infrastructure failure leaves deterministic recommendation proposed", async () => {
	const server = new FakeNineRouter({ toolCallFlow: true, analystFlow: "infra-failure" });
	const root = await mkdtemp(join(tmpdir(), "pi-m85-analyst-failure-"));
	try {
		await server.start();
		await seedRecommendation(root, "route-proposed" as StableId, "route-baseline" as StableId);
		const response = await fetch(`${server.baseUrl}/chat/completions`, {
			method: "POST",
			headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
			body: JSON.stringify({
				model: "fake/model-01",
				messages: [{ role: "user", content: "Analyze recommendation" }],
				stream: true,
				tools: [{ type: "function", function: { name: "submit_recommendation_analysis", parameters: { type: "object" } } }],
			}),
		});
		assert.equal(response.status, 503);
		const store = new SQLiteAnalyticsStore({ root, enabled: true });
		assert.equal(store.listRecommendations()[0]?.status, "proposed");
		assert.equal(store.listAnalystAnalyses?.().length ?? 0, 0);
		store.close();
	} finally {
		await server.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("[P][fixture-v1] Pi 0.84.1 lists exactly the five enabled fake routes", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const root = await mkdtemp(join(tmpdir(), "pi-m2-run-"));
		try {
			const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
			const result = await runPi(
				["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--list-models"],
				env,
			);
			assert.equal(result.code, 0, safePiDiagnostic(result, server.token));
			assert.equal(result.signal, null);
			assert.equal(server.chatRequests.length, 0);
			const lines = stripAnsi(result.stdout).split(/\r?\n/);
			const modelRows = lines.filter((line) => /^\s*9router\s+\S+/.test(line));
			const ids = modelRows.map((line) => line.trim().split(/\s+/)[1]);
			assert.deepEqual(ids.sort(), [...selectedRemoteIds].sort());
			assert.equal(ids.length, 5);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

test("[P][fixture-v1] Pi commands register and fake completion returns deterministic text", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const root = await mkdtemp(join(tmpdir(), "pi-m2-run-"));
		try {
			const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
			const completion = await runPi(
				[
					"--offline",
					"--no-extensions",
					"-e",
					builtEntry,
					"--no-context-files",
					"--no-session",
					"--no-tools",
					"--mode",
					"json",
					"--provider",
					"9router",
					"--model",
					selectedRemoteIds[0]!,
					"--print",
					"m2 fake completion",
				],
				env,
			);
			assert.equal(
				completion.code,
				0,
				safePiDiagnostic(completion, server.token),
			);
			assert.equal(completion.signal, null);
			const events = parseJsonLines(completion.stdout);
			const messageEnd = events.find(
				(event) =>
					event.type === "message_end" &&
					typeof event.message === "object" &&
					event.message !== null &&
					(event.message as { role?: unknown }).role === "assistant",
			);
			assert.ok(messageEnd, completion.stdout);
			const message = messageEnd.message as { content?: unknown } | undefined;
			const text = Array.isArray(message?.content)
				? message.content
						.filter((part): part is { type: string; text: string } => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text")
						.map((part) => part.text)
						.join("")
				: "";
			assert.equal(text, "PI_FAKE_9ROUTER_OK");
			assert.equal(server.chatRequests.length, 1);
			assert.equal(server.chatRequests[0]?.path, "/v1/chat/completions");
			assert.equal(server.chatRequests[0]?.model, selectedRemoteIds[0]);
			assert.equal(server.chatRequests[0]?.stream, true);
			assert.equal(server.chatRequests[0]?.includeUsage, true);
			assert.equal(server.modelsRequests.every((request) => request.authAccepted), true);
			assert.equal(completion.stdout.includes(server.token), false);
			assert.equal(completion.stderr.includes(server.token), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

test("[P][fixture-v1] Pi parent delegates to an isolated child with exact model and bounded result tool", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const root = await mkdtemp(join(tmpdir(), "pi-m5-run-"));
		try {
			const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
			const result = await runPi(
				[
					"--offline", "--no-extensions", "-e", builtEntry, "--no-context-files", "--no-session", "--mode", "json",
					"--provider", "9router", "--model", selectedRemoteIds[0]!, "--print", "delegate once",
				],
				env,
				30_000,
			);
			assert.equal(result.code, 0, safePiDiagnostic(result, server.token));
			assert.equal(result.signal, null);
			const parent = server.chatRequests.find((request) => request.toolNames?.includes("delegate_agent"));
			assert.ok(parent, result.stdout);
			assert.equal(parent.model, selectedRemoteIds[0]);
			const child = server.chatRequests.find((request) => request.toolNames?.includes("submit_agent_result"));
			assert.ok(child, result.stdout);
			assert.equal(child.model, selectedRemoteIds[0]);
			assert.deepEqual([...child.toolNames ?? []].sort(), ["find", "grep", "ls", "read", "submit_agent_result"]);
			assert.equal(child.toolNames?.includes("delegate_agent"), false);
			assert.equal(child.toolNames?.includes("read"), true);
			assert.equal(child.toolNames?.includes("edit"), false);
			assert.equal(child.toolNames?.includes("write"), false);
			assert.ok(server.chatRequests.some((request) => request.toolNames?.includes("submit_agent_result")));
			assert.equal(result.stdout.includes(server.token), false);
			assert.equal(result.stderr.includes(server.token), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, { toolCallFlow: true });
});

test("[P][fixture-v1][M11-R6] Pi 0.84.1 does not execute an unclassified custom result tool", { skip: integrationSkip }, async () => {
	const markerRoot = await mkdtemp(join(tmpdir(), "pi-m11-r6-submit-evil-"));
	const marker = join(markerRoot, "MUTATED");
	try {
		await withFixture(async (server, orchestratorRoot) => {
			const root = await mkdtemp(join(tmpdir(), "pi-m11-r6-run-"));
			try {
				const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
				const result = await runPi(
					[
						"--offline", "--no-extensions", "-e", builtEntry, "--no-context-files", "--no-session", "--mode", "json",
						"--provider", "9router", "--model", selectedRemoteIds[0]!, "--print", "delegate once",
					],
					env,
					30_000,
				);
				assert.equal(result.code, 0, safePiDiagnostic(result, server.token));
				assert.equal(server.customToolAttempted, true);
				const child = server.chatRequests.find((request) => request.toolNames?.includes("submit_agent_result"));
				assert.ok(child, result.stdout);
				assert.equal(child.toolNames?.includes("submit_evil"), false);
				assert.equal(server.chatRequests.some((request) => request.toolNames?.includes("submit_evil")), false);
				assert.equal(existsSync(marker), false);
				assert.equal(result.stdout.includes(server.token), false);
				assert.equal(result.stderr.includes(server.token), false);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}, { toolCallFlow: true, customToolBypassFlow: true, customToolMarker: marker });
	} finally {
		await rm(markerRoot, { recursive: true, force: true });
	}
});

test("[P][fixture-v1] Pi M6 mission task persists packet, proposed evidence, acceptance, and reopen", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const seeded = createMissionStore({ root: orchestratorRoot });
		seeded.createMission({ missionId: "mission-m6", goal: "Read one bounded fixture file", repository: { cwd: repoRoot } });
		seeded.createTask({ missionId: "mission-m6", taskId: "task-m6", roleId: "debugger", executionClass: "investigation", poolId: "investigation", objective: "Read package metadata", acceptanceCriteria: ["submit one result"] , status: "ready" });
		seeded.close();

		const root = await mkdtemp(join(tmpdir(), "pi-m6-run-"));
		try {
			const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
			const child = spawn(
				piCommand,
				["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--mode", "rpc"],
				{ cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] },
			);
			let stdout = "";
			let stderr = "";
			let buffer = "";
			let taskFinished = false;
			const send = (value: Record<string, unknown>): void => { child.stdin.write(`${JSON.stringify(value)}\n`); };
			const result = await new Promise<PiRunResult>((resolvePromise, reject) => {
				let settled = false;
				const deadline = setTimeout(() => {
					child.kill("SIGTERM");
					setTimeout(() => child.kill("SIGKILL"), 500).unref();
				}, 30_000);
				child.stdout.on("data", (chunk: Buffer) => {
					const text = chunk.toString();
					stdout += text;
					buffer += text;
					let newline = buffer.indexOf("\n");
					while (newline >= 0) {
						const line = buffer.slice(0, newline).replace(/\r$/u, "");
						buffer = buffer.slice(newline + 1);
						newline = buffer.indexOf("\n");
						let event: Record<string, unknown>;
						try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
						if (event.type === "response" && event.command === "get_commands") {
							send({ type: "prompt", message: "/missions mission-m6", id: "mission-m6" });
							continue;
						}
						if (event.type === "extension_ui_request") {
							const id = typeof event.id === "string" ? event.id : undefined;
							const method = event.method;
							const title = typeof event.title === "string" ? event.title : "";
							const options = Array.isArray(event.options) ? event.options.filter((value): value is string => typeof value === "string") : [];
							if (id && method === "select" && title.startsWith("mission: mission-m6")) send({ type: "extension_ui_response", id, value: "Tasks" });
							else if (id && method === "select" && title.startsWith("Tasks for mission-m6")) send({ type: "extension_ui_response", id, value: options.find((value) => value.startsWith("task-m6 ")) ?? "Back" });
							else if (id && method === "select" && title.startsWith("task: task-m6")) send({ type: "extension_ui_response", id, value: "Run task" });
							else if (method === "notify" && typeof event.message === "string" && event.message.includes("Task task-m6 finished")) {
								taskFinished = true;
								child.stdin.end();
							}
						}
					}
				});
				child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
				child.once("error", (error) => { clearTimeout(deadline); if (!settled) { settled = true; reject(error); } });
				child.once("close", (code, signal) => { clearTimeout(deadline); if (!settled) { settled = true; resolvePromise({ code, signal, stdout, stderr }); } });
				send({ type: "get_commands", id: "commands" });
			});
			assert.equal(result.code, 0, safePiDiagnostic(result, server.token));
			assert.equal(taskFinished, true, result.stdout);
			assert.equal(result.stdout.includes(server.token), false);
			assert.equal(result.stderr.includes(server.token), false);
			const childRequests = server.chatRequests.filter((request) => request.toolNames?.includes("submit_agent_result"));
			assert.ok(childRequests.length >= 1, result.stdout);
			assert.equal(childRequests.some((request) => request.model === selectedRemoteIds[0]), true);
			assert.equal(childRequests.at(-1)?.model, selectedRemoteIds[1]);
			assert.equal(childRequests.every((request) => request.toolNames?.includes("delegate_agent") === false), true);

			const reopened = createMissionStore({ root: orchestratorRoot });
			const task = reopened.getTask("task-m6");
			const proposed = reopened.listEvidence("mission-m6", "proposed");
			assert.equal(task?.status, "execution_completed");
			assert.equal(task?.packetRevision, 1);
			assert.equal(proposed.length, 1);
			assert.ok(reopened.listCheckpoints("mission-m6").some((checkpoint) => checkpoint.kind === "task-ended"));
			const accepted = reopened.promoteEvidence(proposed[0]!.evidenceId, { actor: "user" });
			assert.equal(accepted.status, "accepted");
			const broker = new ContextBroker(missionStoreContextRepository(reopened));
			const packet = broker.buildPacket({ missionId: "mission-m6", taskId: "task-m6", sourceMissionRevision: reopened.getMission("mission-m6")!.revision });
			assert.equal(packet.approvedFindings.length, 1);
			assert.equal(packet.approvedFindings[0]?.sourceEvidenceId, accepted.evidenceId);
			reopened.close();
			const analyticsStore = new SQLiteAnalyticsStore({ root: orchestratorRoot, enabled: true });
			const analytics = new AnalyticsQueryService(analyticsStore);
			const summary = analytics.overview();
			assert.ok(summary.attempts >= 1, JSON.stringify(summary));
			assert.ok((summary.tokens.total ?? 0) > 0, JSON.stringify(summary));
			assert.ok(summary.fallbacks >= 1, JSON.stringify(summary));
			assert.equal(summary.byMission?.["mission-m6"]?.runs, summary.attempts);
			analyticsStore.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, { toolCallFlow: true, analyticsEnabled: true, fallbackEnabled: true, failModels: [selectedRemoteIds[0]!] });
});

test("[P][fixture-v1] Pi M7 quality loop persists reject, repair, and re-verification lineage", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const seeded = createMissionStore({ root: orchestratorRoot });
		const implementationRoute = await stableRouteId(sourceModels[0]!.id);
		seeded.createMission({ missionId: "mission-m7", goal: "Run one bounded quality loop", repository: { cwd: repoRoot } });
		seeded.createTask({ missionId: "mission-m7", taskId: "task-m7", roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "Repair the bounded fixture task", acceptanceCriteria: ["reviewer approves"], status: "ready" });
		const attempt = seeded.createAttempt({ taskId: "task-m7", attemptId: "attempt-m7", routeId: implementationRoute, remoteModelId: sourceModels[0]!.id });
		seeded.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed", summary: "seed implementation", evidence: [], filesChanged: [], tests: [], risks: [], questions: [] } });
		seeded.close();

		const root = await mkdtemp(join(tmpdir(), "pi-m7-quality-run-"));
		try {
			const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
			const child = spawn(
				piCommand,
				["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--mode", "rpc"],
				{ cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] },
			);
			let stdout = "";
			let stderr = "";
			let buffer = "";
			let loopFinished = false;
			const result = await new Promise<PiRunResult>((resolvePromise, reject) => {
				let settled = false;
				const deadline = setTimeout(() => {
					child.kill("SIGTERM");
					setTimeout(() => child.kill("SIGKILL"), 500).unref();
				}, 45_000);
				const send = (value: Record<string, unknown>): void => { child.stdin.write(`${JSON.stringify(value)}\n`); };
				child.stdout.on("data", (chunk: Buffer) => {
					buffer += chunk.toString();
					stdout += chunk.toString();
					let newline = buffer.indexOf("\n");
					while (newline >= 0) {
						const line = buffer.slice(0, newline).replace(/\r$/u, "");
						buffer = buffer.slice(newline + 1);
						newline = buffer.indexOf("\n");
						let event: Record<string, unknown>;
						try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
						if (event.type === "response" && event.command === "get_commands") {
							send({ type: "prompt", message: "/missions mission-m7", id: "mission-m7" });
							continue;
						}
						if (event.type !== "extension_ui_request") continue;
						const id = typeof event.id === "string" ? event.id : undefined;
						const method = event.method;
						const title = typeof event.title === "string" ? event.title : "";
						const options = Array.isArray(event.options) ? event.options.filter((value): value is string => typeof value === "string") : [];
						if (!id) continue;
						if (method === "select" && title.startsWith("mission: mission-m7")) send({ type: "extension_ui_response", id, value: "Tasks" });
						else if (method === "select" && title.startsWith("Tasks for mission-m7")) send({ type: "extension_ui_response", id, value: options.find((value) => value.startsWith("task-m7 ")) ?? "Back" });
						else if (method === "select" && title.startsWith("task: task-m7")) send({ type: "extension_ui_response", id, value: "Run quality loop" });
						else if (method === "confirm" && title === "Run bounded quality loop?") send({ type: "extension_ui_response", id, confirmed: true });
						else if (method === "notify" && typeof event.message === "string" && event.message.includes("Quality loop passed")) {
							loopFinished = true;
							child.stdin.end();
						}
					}
				});
				child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
				child.once("error", (error) => { clearTimeout(deadline); if (!settled) { settled = true; reject(error); } });
				child.once("close", (code, signal) => { clearTimeout(deadline); if (settled) return; settled = true; resolvePromise({ code, signal, stdout, stderr }); });
				send({ type: "get_commands", id: "commands" });
			});
			assert.equal(result.code, 0, safePiDiagnostic(result, server.token));
			assert.equal(loopFinished, true, result.stdout);
			assert.equal(result.stdout.includes(server.token), false);
			assert.equal(result.stderr.includes(server.token), false);
			const reviewerRequests = server.chatRequests.filter((request) => request.toolNames?.includes("submit_verification_result"));
			const repairRequests = server.chatRequests.filter((request) => request.toolNames?.includes("submit_agent_result"));
			assert.equal(reviewerRequests.length, 4, result.stdout);
			assert.equal(repairRequests.length, 2, result.stdout);
			assert.equal(reviewerRequests.every((request) => request.toolNames?.includes("delegate_agent") !== true), true);
			assert.equal(reviewerRequests.every((request) => request.toolNames?.includes("bash") !== true), true);

			const reopened = createMissionStore({ root: orchestratorRoot });
			const status = reopened.getTaskQualityStatus("task-m7");
			assert.equal(status?.status, "passed");
			assert.equal(status?.qualityRound, 1);
			assert.equal(reopened.listVerificationRuns("mission-m7", "task-m7").length, 2);
			assert.equal(reopened.listQualityDecisions("mission-m7", "task-m7").map((decision) => decision.verdict).join(","), "reject,pass");
			assert.equal(reopened.listQualityEscalations("mission-m7", "task-m7").length, 1);
			assert.equal(reopened.getTask("task-m7")?.status, "execution_completed");
			reopened.close();
			const analyticsStore = new SQLiteAnalyticsStore({ root: orchestratorRoot, enabled: true });
			const summary = new AnalyticsQueryService(analyticsStore).overview();
			assert.equal(summary.qualityRejects, 1, JSON.stringify(summary));
			assert.equal(summary.qualityPasses, 1, JSON.stringify(summary));
			assert.ok(summary.byMission?.["mission-m7"], JSON.stringify(summary));
			analyticsStore.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, { toolCallFlow: true, qualityLoopFlow: true, analyticsEnabled: true });
});

test("[P][M12 final][fixture-pi-0.84.1] Smart-routed Mission reaches Task Run and M7 PASS", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const root = await mkdtemp(join(tmpdir(), "pi-m12-final-smart-m7-"));
		const fixtureRoot = join(root, "fixture");
		const agentRoot = join(root, "agent");
		const sessionsRoot = join(root, "sessions");
		await mkdir(fixtureRoot, { recursive: true, mode: 0o700 });
		await mkdir(agentRoot, { recursive: true, mode: 0o700 });
		await mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
		await writeFile(join(fixtureRoot, "package.json"), JSON.stringify({ name: "m12-final-fixture", version: "1.0.0", private: true }, null, 2));
		new TrustStore({ root: join(orchestratorRoot, "trust") }).trust(fixtureRoot, "M12 final disposable fixture");
		const env = isolatedEnv(server, agentRoot, orchestratorRoot, sessionsRoot);
		const goal = "Audit the bounded fixture, fix findings, add tests, and verify independently";
		let missionId: string | undefined;
		let smartMissionChoice = false;
		let taskFinished = false;
		let phase = "commands";
		const first = await runRpcSession(fixtureRoot, env, (event, send, close) => {
			if (phase === "commands" && event.type === "response" && event.command === "get_commands") {
				phase = "smart";
				send({ type: "prompt", message: goal, id: "smart-entry" });
				return;
			}
			if (phase === "smart" && event.type === "extension_ui_request" && event.method === "select" && event.title === "Orchestrator recommended") {
				smartMissionChoice = true;
				phase = "smart-created";
				send({ type: "extension_ui_response", id: String(event.id), value: "Run as Mission" });
				return;
			}
			if (phase === "smart-created" && event.type === "response" && event.command === "prompt" && event.id === "smart-entry") {
				const store = createMissionStore({ root: orchestratorRoot });
				const mission = store.listMissions().find((item) => item.goal === goal);
				assert.ok(mission, "Smart Routing did not create the canonical Mission");
				missionId = mission.missionId;
				store.createTask({ missionId: mission.missionId, taskId: "task-smart-m7", roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "Read the bounded package fixture", acceptanceCriteria: ["reviewer approves"], status: "ready" });
				store.close();
				phase = "mission-menu";
				send({ type: "prompt", message: `/missions ${mission.missionId}`, id: "mission-menu" });
				return;
			}
			if (event.type !== "extension_ui_request") return;
			const id = String(event.id);
			const title = typeof event.title === "string" ? event.title : "";
			const method = event.method;
			const options = Array.isArray(event.options) ? event.options.filter((value): value is string => typeof value === "string") : [];
			if (method === "select" && missionId !== undefined && title.startsWith(`mission: ${missionId}`)) send({ type: "extension_ui_response", id, value: "Tasks" });
			else if (method === "select" && missionId !== undefined && title.startsWith(`Tasks for ${missionId}`)) send({ type: "extension_ui_response", id, value: options.find((value) => value.startsWith("task-smart-m7 ")) ?? "Back" });
			else if (method === "select" && title.startsWith("task: task-smart-m7")) send({ type: "extension_ui_response", id, value: "Run task" });
			else if (method === "confirm" && title === "Run implementation task?") send({ type: "extension_ui_response", id, confirmed: true });
			else if (method === "notify" && typeof event.message === "string" && event.message.includes("Task task-smart-m7 finished")) {
				taskFinished = true;
				close();
			}
		}, 60_000);
		try {
			assert.equal(first.code, 0, safePiDiagnostic(first, server.token));
			assert.equal(first.signal, null);
			assert.equal(smartMissionChoice, true, first.stdout);
			assert.equal(taskFinished, true, first.stdout);
			assert.equal(first.stdout.includes(server.token), false);
			assert.equal(first.stderr.includes(server.token), false);
			assert.ok(missionId);

			const afterRun = createMissionStore({ root: orchestratorRoot });
			assert.equal(afterRun.getMission(missionId!)?.goal, goal);
			assert.equal(afterRun.getTask("task-smart-m7")?.status, "execution_completed");
			afterRun.close();

			phase = "commands";
			let qualityFinished = false;
			const quality = await runRpcSession(fixtureRoot, env, (event, send, close) => {
				if (phase === "commands" && event.type === "response" && event.command === "get_commands") {
					phase = "quality-menu";
					send({ type: "prompt", message: `/missions ${missionId!}`, id: "quality-menu" });
					return;
				}
				if (event.type !== "extension_ui_request") return;
				const id = String(event.id);
				const title = typeof event.title === "string" ? event.title : "";
				const method = event.method;
				const options = Array.isArray(event.options) ? event.options.filter((value): value is string => typeof value === "string") : [];
				if (method === "select" && title.startsWith(`mission: ${missionId!}`)) send({ type: "extension_ui_response", id, value: "Tasks" });
				else if (method === "select" && title.startsWith(`Tasks for ${missionId!}`)) send({ type: "extension_ui_response", id, value: options.find((value) => value.startsWith("task-smart-m7 ")) ?? "Back" });
				else if (method === "select" && title.startsWith("task: task-smart-m7")) send({ type: "extension_ui_response", id, value: "Run quality loop" });
				else if (method === "confirm" && title === "Run bounded quality loop?") send({ type: "extension_ui_response", id, confirmed: true });
				else if (method === "notify" && typeof event.message === "string" && event.message.includes("Quality loop passed")) {
					qualityFinished = true;
					close();
				}
			}, 60_000);
			assert.equal(quality.code, 0, safePiDiagnostic(quality, server.token));
			assert.equal(quality.signal, null);
			assert.equal(qualityFinished, true, quality.stdout);
			assert.equal(quality.stdout.includes(server.token), false);
			assert.equal(quality.stderr.includes(server.token), false);

			const reopened = createMissionStore({ root: orchestratorRoot });
			assert.equal(reopened.getTaskQualityStatus("task-smart-m7")?.status, "passed");
			assert.equal(reopened.getTaskQualityStatus("task-smart-m7")?.qualityRound, 1);
			assert.equal(reopened.listVerificationRuns(missionId!, "task-smart-m7").length, 2);
			assert.equal(reopened.listQualityDecisions(missionId!, "task-smart-m7").map((decision) => decision.verdict).join(","), "reject,pass");
			assert.equal(reopened.listQualityEscalations(missionId!, "task-smart-m7").length, 1);
			reopened.close();
			const reviewerRequests = server.chatRequests.filter((request) => request.toolNames?.includes("submit_verification_result"));
			const repairRequests = server.chatRequests.filter((request) => request.toolNames?.includes("submit_agent_result"));
			assert.equal(reviewerRequests.length, 4);
			assert.equal(repairRequests.length, 4, "two implementation calls plus two bounded quality-loop repair calls");
			assert.equal(reviewerRequests.every((request) => request.toolNames?.includes("delegate_agent") !== true), true);
			assert.equal(reviewerRequests.every((request) => request.toolNames?.includes("bash") !== true), true);
			const analyticsStore = new SQLiteAnalyticsStore({ root: orchestratorRoot, enabled: true });
			const summary = new AnalyticsQueryService(analyticsStore).overview();
			assert.ok((summary.routing?.decisions ?? 0) >= 1, JSON.stringify(summary));
			assert.ok((summary.routing?.suggestions ?? 0) >= 1, JSON.stringify(summary));
			assert.equal(summary.qualityRejects, 1);
			assert.equal(summary.qualityPasses, 1);
			analyticsStore.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, { toolCallFlow: true, qualityLoopFlow: true, analyticsEnabled: true });
});

test("[P][fixture-v1][M8.5] Pi manual Recommendation Analyst uses Verification Pool and never auto-applies", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const routeIds = await Promise.all(sourceModels.slice(0, 3).map((model) => stableRouteId(model.id)));
		await seedRecommendation(orchestratorRoot, routeIds[2]!, routeIds[1]!);
		const before = (await new ConfigStore({ root: orchestratorRoot }).load()).snapshot?.config.pools.verification.entries.map((entry) => entry.routeId);
		const secret = "m85-pi-analyst-secret";
		const root = await mkdtemp(join(tmpdir(), "pi-m85-analyst-run-"));
		try {
			const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
			const child = spawn(piCommand, ["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--mode", "rpc"], { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			let buffer = "";
			let commandList: string[] = [];
			let requested = false;
			let finished = false;
			let modeSelected = false;
			const send = (value: Record<string, unknown>): void => { child.stdin.write(`${JSON.stringify(value)}\n`); };
			const result = await new Promise<PiRunResult>((resolvePromise, reject) => {
				let settled = false;
				const deadline = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 500).unref(); }, 45_000);
				child.stdout.on("data", (chunk: Buffer) => {
					const text = chunk.toString(); stdout += text; buffer += text;
					let newline = buffer.indexOf("\n");
					while (newline >= 0) {
						const line = buffer.slice(0, newline).replace(/\r$/u, ""); buffer = buffer.slice(newline + 1); newline = buffer.indexOf("\n");
						let event: Record<string, unknown>; try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
						if (event.type === "response" && event.command === "get_commands") {
							const data = event.data as { commands?: Array<{ name?: unknown }> } | undefined;
							commandList = (data?.commands ?? []).flatMap((entry) => typeof entry.name === "string" ? [entry.name] : []);
							assert.ok(commandList.includes("recommendation-analyst"), commandList.join(","));
							if (!requested) { requested = true; send({ type: "prompt", message: "/recommendation-analyst", id: "m85-analyst" }); }
							continue;
						}
						if (event.type === "response" && event.command === "prompt" && event.id === "m85-analyst" && !finished && !stdout.includes("extension_ui_request")) continue;
						if (event.type !== "extension_ui_request") continue;
						const id = typeof event.id === "string" ? event.id : undefined;
						const method = event.method;
						const title = typeof event.title === "string" ? event.title : "";
						const options = Array.isArray(event.options) ? event.options.filter((value): value is string => typeof value === "string") : [];
						if (!id) continue;
						if (method === "confirm") {
							send({ type: "extension_ui_response", id, confirmed: /analy[sz]e|recommendation/iu.test(title) });
							continue;
						}
						if (method === "select") {
							const mode = options.find((value) => /ai[- ]assisted/iu.test(value)) ?? options.find((value) => /deterministic/iu.test(value));
							const route = options.find((value) => value.includes(sourceModels[1]!.id)) ?? options.find((value) => value.includes(routeIds[1]!));
							const action = options.find((value) => /analy[sz]e now|re-analy[sz]e|run analy/iu.test(value));
							const selected = /mode/iu.test(title) ? mode : /route|verification/iu.test(title) ? route : (!modeSelected && options.some((value) => /^Mode:/u.test(value)) ? (modeSelected = true, options.find((value) => /^Mode:/u.test(value))) : action ?? options.find((value) => value !== "Back"));
							if (selected) send({ type: "extension_ui_response", id, value: selected });
							else send({ type: "extension_ui_response", id, value: "Back" });
							continue;
						}
						if (method === "notify" && typeof event.message === "string") {
							const message = event.message;
							if (/(?:state=completed|verdict\s*=|support|oppose|insufficient[_ ]evidence|analysis (?:completed|failed))/iu.test(message) && !/unavailable|disabled/iu.test(message)) { finished = true; child.stdin.end(); }
						}
					}
				});
				child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
				child.once("error", (error) => { clearTimeout(deadline); if (!settled) { settled = true; reject(error); } });
				child.once("close", (code, signal) => { clearTimeout(deadline); if (settled) return; settled = true; resolvePromise({ code, signal, stdout, stderr }); });
				send({ type: "get_commands", id: "commands" });
			});
			assert.equal(result.code, 0, safePiDiagnostic(result, server.token));
			assert.equal(finished, true, result.stdout);
			assert.equal(result.stdout.includes(server.token) || result.stderr.includes(server.token), false);
			assert.ok(server.analystRequests.length >= 1, result.stdout);
			assert.equal(server.analystRequests.every((request) => request.model === sourceModels[1]!.id), true);
			assert.equal(server.analystRequests.every((request) => request.toolNames?.includes("delegate_agent") !== true), true);
			const after = (await new ConfigStore({ root: orchestratorRoot }).load()).snapshot?.config.pools.verification.entries.map((entry) => entry.routeId);
			assert.deepEqual(after, before, "analyst must not auto-apply recommendation");
			const analytics = new SQLiteAnalyticsStore({ root: orchestratorRoot, enabled: true });
			assert.equal(analytics.listAnalystAnalyses?.().at(-1)?.verdict, "support");
			analytics.close();
			const stored = await readFile(join(orchestratorRoot, "analytics.sqlite"));
			assert.equal(stored.includes(Buffer.from(secret)), false, "analyst transcript/secret must not be persisted");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, { toolCallFlow: true, analystFlow: "support", analystSecret: "m85-pi-analyst-secret", analyticsEnabled: true });
});

test("[P][fixture-v1] Pi RPC exposes M2-M6 commands without live configuration", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const root = await mkdtemp(join(tmpdir(), "pi-m2-rpc-"));
		try {
			const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
			const child = spawn(
				piCommand,
				["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--mode", "rpc"],
				{ cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] },
			);
			let stdout = "";
			let stderr = "";
			const lines: Record<string, unknown>[] = [];
			const result = await new Promise<PiRunResult>((resolvePromise, reject) => {
				let settled = false;
				let statusSent = false;
				let routingSent = false;
				let inputClosed = false;
				let inputBuffer = "";
				const deadline = setTimeout(() => {
					child.kill("SIGTERM");
					setTimeout(() => child.kill("SIGKILL"), 500).unref();
				}, 10_000);
				const consume = (chunk: Buffer): void => {
					inputBuffer += chunk.toString();
					stdout += chunk.toString();
					let newlineIndex = inputBuffer.indexOf("\n");
					while (newlineIndex >= 0) {
						const line = inputBuffer.slice(0, newlineIndex).replace(/\r$/u, "");
						inputBuffer = inputBuffer.slice(newlineIndex + 1);
						newlineIndex = inputBuffer.indexOf("\n");
						try {
							const event = JSON.parse(line) as Record<string, unknown>;
							lines.push(event);
							if (
								!statusSent &&
								event.type === "response" &&
								event.command === "get_commands"
							) {
								statusSent = true;
								child.stdin.write(`${JSON.stringify({ type: "prompt", message: "/9router-status", id: "status" })}\n`);
							} else if (
								statusSent &&
								!routingSent &&
								event.type === "response" &&
								event.command === "prompt" &&
								event.id === "status"
							) {
								routingSent = true;
								child.stdin.write(`${JSON.stringify({ type: "prompt", message: "/routing-status implementation", id: "routing" })}\n`);
							} else if (
								routingSent &&
								event.type === "response" &&
								event.command === "prompt" &&
								event.id === "routing"
							) {
								// RPC has no explicit client shutdown request. Ending stdin
								// after the command response asks Pi to run its graceful
								// shutdown path and keeps this acceptance test bounded.
									if (!inputClosed) {
										inputClosed = true;
										child.stdin.end();
									}
							}
						} catch {
							// Startup diagnostics are not JSON protocol events.
						}
					}
				};
				child.stdout.on("data", consume);
				child.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString();
				});
				child.once("error", (error) => {
					clearTimeout(deadline);
					if (!settled) {
						settled = true;
						reject(error);
					}
				});
				child.once("close", (code, signal) => {
					clearTimeout(deadline);
					if (settled) return;
					settled = true;
					resolvePromise({ code, signal, stdout, stderr });
				});
				child.stdin.write(`${JSON.stringify({ type: "get_commands", id: "commands" })}\n`);
			});
			assert.equal(result.code, 0, safePiDiagnostic(result, server.token));
			const commandResponse = lines.find((event) => event.command === "get_commands");
			const commands = ((commandResponse?.data as { commands?: { name?: string }[] } | undefined)?.commands ?? []).map((command) => command.name);
			for (const name of ["orchestrator", "9router-models", "9router-refresh", "9router-status", "pool-models", "pool-status", "routing-status", "route-health", "routing-settings", "missions", "mission-packet"]) assert.ok(commands.includes(name), `${name}: ${safePiDiagnostic(result, server.token)}`);
			assert.equal(result.stdout.includes(server.token), false);
			assert.equal(result.stderr.includes(server.token), false);
			assert.ok(lines.some((event) => event.type === "extension_ui_request" && event.method === "notify" && typeof event.message === "string" && event.message.includes("Implementation Pool")), result.stdout);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

test("[P][M12.3][fixture-pi-0.84.1] isolated Pi RPC dogfood covers explicit memory, cross-language auto-routing, disable, and restart", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const root = await mkdtemp(join(tmpdir(), "pi-m12-3-memory-rpc-"));
		const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
		const args = ["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--mode", "rpc"];
		const runSession = (handle: (event: Record<string, unknown>, send: (value: Record<string, unknown>) => void, close: () => void) => void): Promise<PiRunResult> => new Promise((resolvePromise, reject) => {
			const child = spawn(piCommand, args, { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			let buffer = "";
			let settled = false;
			const deadline = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 500).unref(); }, 30_000);
			const send = (value: Record<string, unknown>): void => { if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(value)}\n`); };
			const close = (): void => { if (!child.stdin.destroyed) child.stdin.end(); };
			const failSession = (error: unknown): void => { if (settled) return; settled = true; clearTimeout(deadline); child.kill("SIGTERM"); reject(error); };
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
				buffer += chunk.toString();
				let newline = buffer.indexOf("\n");
				while (newline >= 0) {
					const line = buffer.slice(0, newline).replace(/\r$/u, "");
					buffer = buffer.slice(newline + 1);
					newline = buffer.indexOf("\n");
					if (!line.trim().startsWith("{")) continue;
					try { handle(JSON.parse(line) as Record<string, unknown>, send, close); } catch (error) { failSession(error); return; }
				}
			});
			child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
			child.once("error", failSession);
			child.once("close", (code, signal) => {
				if (settled) return;
				settled = true;
				clearTimeout(deadline);
				resolvePromise({ code, signal, stdout, stderr });
			});
			send({ type: "get_commands", id: "commands" });
		});
		try {
			let phase = "commands";
			const first = "Audit the repository, fix findings, add tests, and verify independently";
			const similar = "این ریپو را بررسی کن، مشکلاتش را درست کن، تست بزن و مستقل verify کن";
			const risky = "Investigate the production payment bug, fix it, add rollback tests, and verify independently";
			const firstSession = await runSession((event, send, close) => {
				if (phase === "commands" && event.type === "response" && event.command === "get_commands") {
					phase = "first";
					send({ type: "prompt", message: first, id: "first" });
				} else if (phase === "first" && event.type === "extension_ui_request" && event.method === "select" && event.title === "Orchestrator recommended") {
					phase = "explicit-selected";
					send({ type: "extension_ui_response", id: String(event.id), value: "Always orchestrate similar tasks" });
				} else if (phase === "explicit-selected" && event.type === "response" && event.command === "prompt" && event.id === "first") {
					phase = "cross-language";
					send({ type: "prompt", message: similar, id: "similar" });
				} else if (phase === "cross-language" && event.type === "response" && event.command === "prompt" && event.id === "similar") {
					phase = "center";
					send({ type: "prompt", message: "/orchestrator", id: "center" });
				} else if (phase === "center" && event.type === "extension_ui_request" && event.method === "select" && event.title === "Pi Multi-Orchestrator") {
					phase = "routing-settings";
					send({ type: "extension_ui_response", id: String(event.id), value: "Routing & Fallback" });
				} else if (phase === "routing-settings" && event.type === "extension_ui_request" && event.method === "select" && event.title === "Routing & Fallback") {
					const options = Array.isArray(event.options) ? event.options.map(String) : [];
					assert.ok(options.some((option) => option.startsWith("Routing Memory (ON)")), options.join("\n"));
					assert.ok(options.some((option) => option.startsWith("Learn from routing choices (ON)")), options.join("\n"));
					phase = "learned-behaviors";
					send({ type: "extension_ui_response", id: String(event.id), value: "Learned Behaviors" });
				} else if (phase === "learned-behaviors" && event.type === "extension_ui_request" && event.method === "select" && event.title === "Learned Behaviors") {
					const options = Array.isArray(event.options) ? event.options.map(String) : [];
					const rule = options.find((option) => !option.startsWith("Forget ") && !option.startsWith("Reset ") && option !== "Back");
					assert.ok(rule, options.join("\n"));
					phase = "rule-detail";
					send({ type: "extension_ui_response", id: String(event.id), value: rule! });
				} else if (phase === "rule-detail" && event.type === "extension_ui_request" && event.method === "select" && event.title === "Routing rule") {
					phase = "close-center";
					send({ type: "extension_ui_response", id: String(event.id), value: "Disable" });
				} else if (phase === "close-center" && event.type === "extension_ui_request" && event.method === "select" && event.title === "Pi Multi-Orchestrator") {
					phase = "escalation";
					send({ type: "extension_ui_response", id: String(event.id), value: null });
				} else if (phase === "escalation" && event.type === "response" && event.command === "prompt" && event.id === "center") {
					phase = "risk-choice";
					send({ type: "prompt", message: risky, id: "risky" });
				} else if (phase === "risk-choice" && event.type === "extension_ui_request" && event.method === "select" && event.title === "Orchestrator recommended") {
					phase = "finish";
					send({ type: "extension_ui_response", id: String(event.id), value: "Run Normally" });
				} else if (phase === "finish" && event.type === "response" && event.command === "prompt" && event.id === "risky") {
					close();
				}
			});
			assert.equal(firstSession.code, 0, safePiDiagnostic(firstSession, server.token));
			assert.equal(firstSession.signal, null);
			const missions = createMissionStore({ root: orchestratorRoot });
			assert.equal(missions.listMissions().length, 2, "Always plus cross-language AUTO_MISSION create exactly two Missions");
			missions.close();
			const memoryPath = join(orchestratorRoot, "routing-memory.json");
			const memoryText = await readFile(memoryPath, "utf8");
			assert.equal(memoryText.includes(first), false);
			assert.equal(memoryText.includes(similar), false);
			assert.match(memoryText, /"enabled": false/u);
			assert.equal(server.chatRequests.length, 0, "offline routing dogfood does not need provider inference");
			if (process.env.M12_3_DOGFOOD_EVIDENCE === "1") {
				const missionIds = [...firstSession.stdout.matchAll(/"missionId":"([^"]+)"/gu)].map((match) => match[1]).filter((value): value is string => value !== undefined);
				const stored = JSON.parse(memoryText) as { readonly rules?: readonly { readonly id?: string; readonly source?: string }[] };
				console.log("M12_3_DOGFOOD_EVIDENCE", JSON.stringify({ firstMissionId: missionIds[0], followupMissionId: missionIds[1], explicitRuleId: stored.rules?.find((rule) => rule.source === "explicit")?.id }));
			}

			phase = "commands";
			const restart = await runSession((event, send, close) => {
				if (phase === "commands" && event.type === "response" && event.command === "get_commands") {
					phase = "missions";
					send({ type: "prompt", message: "/missions", id: "restart-missions" });
				} else if (phase === "missions" && event.type === "extension_ui_request" && event.method === "select" && event.title === "Missions") {
					phase = "done";
					send({ type: "extension_ui_response", id: String(event.id), value: "Back" });
				} else if (phase === "done" && event.type === "response" && event.command === "prompt" && event.id === "restart-missions") close();
			});
			assert.equal(restart.code, 0, safePiDiagnostic(restart, server.token));
			assert.equal(restart.signal, null);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

test("[P][fixture-v1] Pi RPC route-health reset clears persisted cooldown without provider calls", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const root = await mkdtemp(join(tmpdir(), "pi-m4-health-rpc-"));
		try {
			const routeId = await stableRouteId(sourceModels[0]!.id);
			const health = new HealthStore({ root: orchestratorRoot });
			await health.recordFailure(routeId, classifyFailure({ status: 429 }), { retryAfterMs: 600_000 });
			const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
			const child = spawn(
				piCommand,
				["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--mode", "rpc"],
				{ cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] },
			);
			let stdout = "";
			let stderr = "";
			let buffer = "";
			let resetSeen = false;
			let resetRequested = false;
			let notifyMessage = "";
			const result = await new Promise<PiRunResult>((resolvePromise, reject) => {
				let settled = false;
				const deadline = setTimeout(() => {
					child.kill("SIGTERM");
					setTimeout(() => child.kill("SIGKILL"), 500).unref();
				}, 12_000);
				const send = (value: Record<string, unknown>): void => {
					child.stdin.write(`${JSON.stringify(value)}\n`);
				};
				child.stdout.on("data", (chunk: Buffer) => {
					const text = chunk.toString();
					stdout += text;
					buffer += text;
					let newline = buffer.indexOf("\n");
					while (newline >= 0) {
						const line = buffer.slice(0, newline).replace(/\r$/u, "");
						buffer = buffer.slice(newline + 1);
						newline = buffer.indexOf("\n");
						let event: Record<string, unknown>;
						try {
							event = JSON.parse(line) as Record<string, unknown>;
						} catch {
							continue;
						}
						if (event.type === "response" && event.command === "get_commands") {
							send({ type: "prompt", message: `/route-health ${routeId}`, id: "route-health" });
						} else if (event.type === "response" && event.command === "prompt" && event.id === "route-health") {
							child.stdin.end();
						} else if (event.type === "extension_ui_request") {
							const id = typeof event.id === "string" ? event.id : undefined;
							const method = event.method;
							const title = typeof event.title === "string" ? event.title : "";
							const options = Array.isArray(event.options) ? event.options.filter((value): value is string => typeof value === "string") : [];
							if (id && method === "select" && title === "Route Health") {
								if (resetRequested) {
									send({ type: "extension_ui_response", id, value: "Back" });
									continue;
								}
								const selected = options.find((option) => option.startsWith("fake/model-01"));
								assert.ok(selected, options.join("\n"));
								send({ type: "extension_ui_response", id, value: selected });
							} else if (id && method === "select" && title.startsWith("route:")) {
								send({ type: "extension_ui_response", id, value: "Reset health" });
			} else if (id && method === "confirm") {
				resetRequested = true;
				resetSeen = true;
				send({ type: "extension_ui_response", id, confirmed: true });
							} else if (method === "notify" && typeof event.message === "string" && event.message.includes("Health reset")) {
								resetSeen = true;
								child.stdin.end();
							} else if (method === "notify" && typeof event.message === "string") {
								notifyMessage = event.message;
							}
						}
					}
				});
				child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
				child.once("error", (error) => {
					clearTimeout(deadline);
					if (!settled) { settled = true; reject(error); }
				});
				child.once("close", (code, signal) => {
					clearTimeout(deadline);
					if (settled) return;
					settled = true;
					resolvePromise({ code, signal, stdout, stderr });
				});
				send({ type: "get_commands", id: "commands" });
			});
			assert.equal(result.code, 0, safePiDiagnostic(result, server.token));
			assert.equal(resetSeen, true, result.stdout);
			assert.equal((await health.get(routeId))?.circuit, "healthy", `${JSON.stringify(await health.get(routeId))} notify=${notifyMessage}`);
			assert.equal(server.chatRequests.length, 0);
			assert.equal(result.stdout.includes(server.token), false);
			assert.equal(result.stderr.includes(server.token), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

test("[P][fixture-v1] Pi RPC pool editor persists order and leaves the M2 provider unchanged", { skip: integrationSkip }, async () => {
	await withFixture(async (server, orchestratorRoot) => {
		const root = await mkdtemp(join(tmpdir(), "pi-m3-rpc-"));
		try {
			const env = isolatedEnv(server, join(root, "agent"), orchestratorRoot, join(root, "sessions"));
			const child = spawn(
				piCommand,
				["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--mode", "rpc"],
				{ cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] },
			);
			let stdout = "";
			let stderr = "";
			let buffer = "";
			let phase = "commands";
			let statusSeen = false;
			const send = (value: Record<string, unknown>): void => {
				child.stdin.write(`${JSON.stringify(value)}\n`);
			};
			const result = await new Promise<PiRunResult>((resolvePromise, reject) => {
				let settled = false;
				const deadline = setTimeout(() => {
					child.kill("SIGTERM");
					setTimeout(() => child.kill("SIGKILL"), 500).unref();
				}, 15_000);
				child.stdout.on("data", (chunk: Buffer) => {
					const text = chunk.toString();
					stdout += text;
					buffer += text;
					let newline = buffer.indexOf("\n");
					while (newline >= 0) {
						const line = buffer.slice(0, newline).replace(/\r$/u, "");
						buffer = buffer.slice(newline + 1);
						newline = buffer.indexOf("\n");
						let event: Record<string, unknown>;
						try {
							event = JSON.parse(line) as Record<string, unknown>;
						} catch {
							continue;
						}
						if (phase === "commands" && event.type === "response" && event.command === "get_commands") {
							phase = "open-editor";
							send({ type: "prompt", message: "/pool-models implementation", id: "pool-edit" });
							continue;
						}
						if (event.type !== "extension_ui_request") continue;
						const id = typeof event.id === "string" ? event.id : undefined;
						const method = event.method;
						const title = typeof event.title === "string" ? event.title : "";
						const options = Array.isArray(event.options) ? event.options.filter((value): value is string => typeof value === "string") : [];
						if (method === "select" && id && title === "Implementation Pool" && phase === "open-editor") {
							phase = "add-candidate";
							send({ type: "extension_ui_response", id, value: "Add Route" });
						} else if (method === "select" && id && title === "Add route to Implementation Pool" && phase === "add-candidate") {
							const value = options.find((option) => option.includes("fake/model-05"));
							assert.ok(value, options.join("\n"));
							phase = "select-added";
							send({ type: "extension_ui_response", id, value });
						} else if (method === "select" && id && title === "Implementation Pool" && phase === "select-added") {
							const value = options.find((option) => option.includes("fake/model-05"));
							assert.ok(value, options.join("\n"));
							phase = "move-action";
							send({ type: "extension_ui_response", id, value });
						} else if (method === "select" && id && title.startsWith("Route ") && phase === "move-action") {
							phase = "move-position";
							send({ type: "extension_ui_response", id, value: "Move to position" });
						} else if (method === "input" && id && title === "Target position (1-based)" && phase === "move-position") {
							phase = "close-editor";
							send({ type: "extension_ui_response", id, value: "2" });
						} else if (method === "select" && id && title === "Implementation Pool" && phase === "close-editor") {
							phase = "status";
							send({ type: "extension_ui_response", id, value: "Back" });
							setTimeout(() => send({ type: "prompt", message: "/pool-status implementation", id: "pool-status" }), 25);
						} else if (method === "notify" && phase === "status" && typeof event.message === "string" && event.message.includes("Implementation Pool")) {
							statusSeen = true;
							child.stdin.end();
						}
					}
				});
				child.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString();
				});
				child.once("error", (error) => {
					clearTimeout(deadline);
					if (!settled) {
						settled = true;
						reject(error);
					}
				});
				child.once("close", (code, signal) => {
					clearTimeout(deadline);
					if (settled) return;
					settled = true;
					resolvePromise({ code, signal, stdout, stderr });
				});
				send({ type: "get_commands", id: "commands" });
			});

			assert.equal(result.code, 0, safePiDiagnostic(result, server.token));
			assert.equal(statusSeen, true, safePiDiagnostic(result, server.token));
			const routeIds = await Promise.all(sourceModels.slice(0, 5).map((model) => stableRouteId(model.id)));
			const store = new ConfigStore({ root: orchestratorRoot });
			const loaded = await store.load();
			assert.deepEqual(
				loaded.snapshot?.config.pools.implementation.entries.map((entry) => entry.routeId),
				[routeIds[0], routeIds[4], routeIds[1], routeIds[2], routeIds[3]],
			);
			assert.ok((await store.listHistory()).entries.length >= 2);

			const listResult = await runPi(
				["--offline", "--no-extensions", "-e", builtEntry, "--no-session", "--no-context-files", "--list-models"],
				env,
			);
			assert.equal(listResult.code, 0, safePiDiagnostic(listResult, server.token));
			const providerIds = stripAnsi(listResult.stdout)
				.split(/\r?\n/)
				.filter((line) => /^\s*9router\s+\S+/.test(line))
				.map((line) => line.trim().split(/\s+/)[1]);
			assert.deepEqual(providerIds.sort(), [...selectedRemoteIds].sort());
			assert.equal(result.stdout.includes(server.token) || result.stderr.includes(server.token), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
