import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

import { ConfigStore, createDefaultConfig, type StableId } from "../src/core/config/index.js";
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

async function seedConfig(root: string, baseUrl: string, models: readonly FakeModel[]): Promise<void> {
	const config = createDefaultConfig();
	const gatewayId = configGatewayId;
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

async function withFixture<T>(run: (server: FakeNineRouter, root: string) => Promise<T>): Promise<T> {
	const server = new FakeNineRouter({ models: sourceModels });
	const root = await mkdtemp(join(tmpdir(), "pi-m2-integration-"));
	const agentRoot = join(root, "agent");
	const sessionsRoot = join(root, "sessions");
	const orchestratorRoot = join(root, "orchestrator");
	await mkdir(agentRoot, { recursive: true, mode: 0o700 });
	await mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
	try {
		await server.start();
		await seedConfig(orchestratorRoot, server.baseUrl, sourceModels);
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

test("[P][fixture-v1] Pi RPC exposes all M2 commands without live configuration", { skip: integrationSkip }, async () => {
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
								event.type === "response" &&
								event.command === "prompt" &&
								event.id === "status"
							) {
								// RPC has no explicit client shutdown request. Ending stdin
								// after the command response asks Pi to run its graceful
								// shutdown path and keeps this acceptance test bounded.
								child.stdin.end();
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
			for (const name of ["orchestrator", "9router-models", "9router-refresh", "9router-status"]) assert.ok(commands.includes(name), `${name}: ${safePiDiagnostic(result, server.token)}`);
			assert.equal(result.stdout.includes(server.token), false);
			assert.equal(result.stderr.includes(server.token), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
