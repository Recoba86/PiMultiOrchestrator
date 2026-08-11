import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ProviderConfig,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

import {
	createPiHost,
	type ModelManagerEntry,
	type PiManagerContract,
	NINEROUTER_PROVIDER_ID,
} from "../src/host/pi-extension.js";
import { NINEROUTER_GATEWAY_ID, type ProviderProjection } from "../src/core/ninerouter/index.js";
import type { StableId } from "../src/core/config/types.js";

function projection(models: readonly ProviderModelConfig[] = [model("remote-a")]): ProviderProjection {
	return {
		providerId: NINEROUTER_PROVIDER_ID,
		gatewayId: NINEROUTER_GATEWAY_ID,
		baseUrl: "http://127.0.0.1:3000/v1",
		apiKeyReference: "$NINEROUTER_API_KEY",
		authHeader: true,
		api: "openai-completions",
		models: models.map((value) => ({
			routeId: `route-${value.id}` as StableId,
			id: value.id,
			name: value.name,
			reasoning: value.reasoning,
			input: value.input,
			cost: value.cost,
			contextWindow: value.contextWindow,
			maxTokens: value.maxTokens,
		})),
		stale: false,
		warnings: [],
	};
}

function model(id: string): ProviderModelConfig {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4_096,
	};
}

function managerFixture(initial: ProviderProjection): PiManagerContract & {
	projection: ProviderProjection | undefined;
	entries: ModelManagerEntry[];
	setEnabledCalls: Array<{ id: string; enabled: boolean; activeRemoteModelId?: string }>;
} {
	const setEnabledCalls: Array<{ id: string; enabled: boolean; activeRemoteModelId?: string }> = [];
	const fixture = {
		projection: initial,
		entries: [{ remoteModelId: "remote-a", displayName: "Remote A", routeId: "route-a", sourceLabel: "fixture", capability: "chat", enabled: true }],
		setEnabledCalls,
		async list(): Promise<readonly ModelManagerEntry[]> {
			return fixture.entries;
		},
		async loadStatus(): Promise<unknown> {
			return { state: "ready", catalogCount: fixture.entries.length, enabledCount: fixture.entries.filter((entry) => entry.enabled).length };
		},
		async refresh(): Promise<void> {},
		async configure(): Promise<void> {},
		async setEnabled(id: string, enabled: boolean, options?: { activeRemoteModelId?: string }): Promise<void> {
			fixture.setEnabledCalls.push({ id, enabled, ...(options?.activeRemoteModelId ? { activeRemoteModelId: options.activeRemoteModelId } : {}) });
		},
		async providerProjection(): Promise<ProviderProjection | undefined> {
			return fixture.projection;
		},
	} satisfies PiManagerContract & {
		projection: ProviderProjection | undefined;
		entries: ModelManagerEntry[];
		setEnabledCalls: Array<{ id: string; enabled: boolean; activeRemoteModelId?: string }>;
	};
	return fixture;
}

interface PiFixture {
	readonly pi: ExtensionAPI;
	readonly providers: Map<string, ProviderConfig>;
	readonly commands: Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
	readonly unregisters: string[];
}

function piFixture(): PiFixture {
	const providers = new Map<string, ProviderConfig>();
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
	const unregisters: string[] = [];
	const pi = {
		registerProvider(name: string, config: ProviderConfig): void {
			providers.set(name, config);
		},
		unregisterProvider(name: string): void {
			unregisters.push(name);
			providers.delete(name);
		},
		registerCommand(name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }): void {
			commands.set(name, options);
		},
	} as unknown as ExtensionAPI;
	return { pi, providers, commands, unregisters };
}

describe("Pi 9Router host adapter", () => {
	it("[U][fixture-pi-0.84.1] registers only enabled projection models and skips identical reconciliation", async () => {
		const fixture = managerFixture(projection());
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });

		assert.deepEqual(await host.reconcile(), { changed: true, registered: true, modelCount: 1 });
		assert.equal(pi.providers.size, 1);
		assert.deepEqual(pi.providers.get(NINEROUTER_PROVIDER_ID)?.models?.map((entry) => entry.id), ["remote-a"]);
		assert.deepEqual(await host.reconcile(), { changed: false, registered: true, modelCount: 1 });
		assert.deepEqual(pi.unregisters, []);
		fixture.projection = projection([model("remote-b"), model("remote-c")]);
		assert.deepEqual(await host.reconcile(), { changed: true, registered: true, modelCount: 2 });
		assert.deepEqual(pi.providers.get(NINEROUTER_PROVIDER_ID)?.models?.map((entry) => entry.id), ["remote-b", "remote-c"]);
		assert.deepEqual(pi.unregisters, []);
	});

	it("[U][fixture-pi-0.84.1] unregisters the provider when the projection becomes unavailable", async () => {
		const fixture = managerFixture(projection());
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });
		await host.reconcile();
		fixture.projection = undefined;

		assert.deepEqual(await host.reconcile(), { changed: true, registered: false, modelCount: 0 });
		assert.equal(pi.providers.size, 0);
		assert.deepEqual(pi.unregisters, [NINEROUTER_PROVIDER_ID]);
	});

	it("[U][fixture-pi-0.84.1] clears a provider retained by Pi when a reloaded host starts empty", async () => {
		const fixture = managerFixture(projection());
		fixture.projection = undefined;
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });

		assert.deepEqual(await host.reconcile(), { changed: true, registered: false, modelCount: 0 });
		assert.deepEqual(await host.reconcile(), { changed: false, registered: false, modelCount: 0 });
		assert.deepEqual(pi.unregisters, [NINEROUTER_PROVIDER_ID]);
	});

	it("[U][fixture-pi-0.84.1] unregisters the owned provider on host disposal", async () => {
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()) });
		await host.reconcile();
		host.dispose();
		assert.equal(pi.providers.size, 0);
		assert.deepEqual(pi.unregisters, [NINEROUTER_PROVIDER_ID]);
	});

	it("[U][fixture-pi-0.84.1] registers all required native commands and blocks disabling the active route", async () => {
		const fixture = managerFixture(projection());
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });
		host.registerCommands();
		assert.deepEqual([...pi.commands.keys()], ["orchestrator", "9router-models", "9router-refresh", "9router-status"]);

		const notifications: string[] = [];
		let prompts = 0;
		const selections: Array<string | undefined> = [
			"[x] remote-a — Remote A (route-a)",
			"Inspect",
			"[x] remote-a — Remote A (route-a)",
			"Disable",
			undefined,
		];
		const ctx = {
			mode: "tui",
			isIdle: () => true,
			model: { provider: NINEROUTER_PROVIDER_ID, id: "remote-a" },
			ui: {
				select: async () => selections.shift(),
				confirm: async () => {
					prompts += 1;
					return true;
				},
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext;
		await pi.commands.get("9router-models")!.handler("", ctx);
		assert.equal(prompts, 0);
		assert.deepEqual(fixture.setEnabledCalls, []);
		assert.match(notifications[0] ?? "", /remote: remote-a/);
		assert.ok(notifications.some((message) => /active 9Router model/.test(message)));
	});

	it("[U][fixture-pi-0.84.1] refuses provider mutations while Pi is busy", async () => {
		const fixture = managerFixture(projection());
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });
		host.registerCommands();
		const notifications: string[] = [];
		await pi.commands.get("9router-refresh")!.handler("", {
			isIdle: () => false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[0] ?? "", /current Pi turn/);
	});
});
