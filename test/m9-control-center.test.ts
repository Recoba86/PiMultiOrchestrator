import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ProviderConfig,
} from "@earendil-works/pi-coding-agent";

import {
	createPiHost,
	type PiManagerContract,
	type PoolManagerContract,
	type RecommendationAnalystContract,
	NINEROUTER_PROVIDER_ID,
} from "../src/host/pi-extension.js";
import { NINEROUTER_GATEWAY_ID, type ProviderProjection } from "../src/core/ninerouter/index.js";
import { POOL_IDS, type PoolId } from "../src/core/pools/index.js";
import type { StableId } from "../src/core/config/types.js";

const CONTROL_CENTER_SECTIONS = [
	"Models & 9Router",
	"Investigation Pool",
	"Implementation Pool",
	"Verification Pool",
	"Boss / Orchestrator Profiles",
	"Routing & Fallback",
	"Health & Quotas",
	"Budget / Quality Profiles",
	"Context & Mission Settings",
	"Statistics & Analytics",
	"Diagnostics",
	"Backup / Restore",
] as const;

type SelectCall = { readonly title: string; readonly options: readonly string[] };

function projection(): ProviderProjection {
	return {
		providerId: NINEROUTER_PROVIDER_ID,
		gatewayId: NINEROUTER_GATEWAY_ID,
		baseUrl: "http://127.0.0.1:3000/v1",
		apiKeyReference: "$NINEROUTER_API_KEY",
		authHeader: true,
		api: "openai-completions",
		models: [{
			routeId: "route-a" as StableId,
			id: "remote-a",
			name: "Remote A",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 4_096,
		}],
		stale: false,
		warnings: [],
	};
}

function managerFixture(overrides: Partial<{
		state: string;
		listError: Error;
		projection: ProviderProjection | undefined;
	}> = {}): PiManagerContract {
		return {
			list: async () => [{ remoteModelId: "remote-a", displayName: "Remote A", routeId: "route-a", enabled: true, available: true }],
			loadStatus: async () => ({ state: overrides.state ?? "LIVE", catalogCount: 1, enabledCount: 1 }),
			refresh: async () => {
				if (overrides.listError) throw overrides.listError;
			},
			configure: async () => {},
			setEnabled: async () => {},
			providerProjection: async () => overrides.projection === undefined && "projection" in overrides ? undefined : overrides.projection ?? projection(),
		};
}

type PoolEntry = {
	routeId: StableId;
	displayName: string;
	remoteModelId: string;
	globalEnabled: boolean;
	poolEnabled: boolean;
	state: "active" | "missing" | "unknown" | "provider-unavailable";
	catalogState: "fresh" | "stale";
	resourceClass: "subscription";
	index?: number;
};

function poolFixture(entries: readonly PoolEntry[] = []): PoolManagerContract & { readonly mutationCalls: number } {
	let mutationCalls = 0;
	const views = () => POOL_IDS.map((poolId) => ({
		poolId,
		id: poolId,
		label: poolId[0]!.toUpperCase() + poolId.slice(1),
		entries: poolId === "implementation" ? entries.map((entry, index) => ({ ...entry, index })) : [],
	}));
	const mutate = async () => { mutationCalls += 1; };
	const fixture = {
		getAvailableCandidatesToAdd: async () => [],
		addRoute: mutate,
		removeRoute: mutate,
		moveRouteUp: mutate,
		moveRouteDown: mutate,
		moveRoute: mutate,
		setPoolEntryEnabled: mutate,
		listPools: async () => views(),
		getPool: async (poolId: PoolId) => views().find((view) => view.poolId === poolId)!,
		get mutationCalls() { return mutationCalls; },
	} satisfies PoolManagerContract & { readonly mutationCalls: number };
	return fixture;
}

interface PiFixture {
	readonly pi: ExtensionAPI;
	readonly commands: Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
}

function piFixture(): PiFixture {
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
	const pi = {
		registerProvider: (_name: string, _config: ProviderConfig) => {},
		unregisterProvider: (_name: string) => {},
		registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => commands.set(name, options),
		registerTool: () => {},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;
	return { pi, commands };
}

function context(options: {
	readonly mode?: "tui" | "rpc";
	readonly hasUI?: boolean;
	readonly idle?: boolean;
	readonly select?: (title: string, choices: readonly string[]) => Promise<string | undefined>;
	readonly notify?: (message: string, type?: "info" | "warning" | "error") => void;
	readonly model?: ExtensionCommandContext["model"];
} = {}): ExtensionCommandContext {
	return {
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		isIdle: () => options.idle ?? true,
		model: options.model,
		ui: {
			select: options.select ?? (async () => undefined),
			confirm: async () => false,
			input: async () => undefined,
			notify: options.notify ?? (() => {}),
		},
	} as unknown as ExtensionCommandContext;
}

async function openCenter(
	host: ReturnType<typeof createPiHost>,
	pi: PiFixture,
	selection: string | undefined,
	options: { readonly mode?: "tui" | "rpc"; readonly titles?: SelectCall[]; readonly notifications?: string[]; readonly rootSelections?: readonly (string | undefined)[] } = {},
): Promise<void> {
	const calls = options.titles ?? [];
	const notifications = options.notifications ?? [];
	const rootSelections = [...(options.rootSelections ?? [selection])];
	const contextOptions = {
		select: async (title: string, choices: readonly string[]) => {
			calls.push({ title, options: [...choices] });
			if (title === "Pi Multi-Orchestrator") return rootSelections.shift();
			// Existing and M9 nested screens all expose Back. Returning it is the
			// deterministic keyboard escape path and prevents a test from hanging.
			return choices.includes("Back") ? "Back" : undefined;
		},
		notify: (message: string) => { notifications.push(message); },
		...(options.mode ? { mode: options.mode } : {}),
	};
	await pi.commands.get("orchestrator")!.handler("", context(contextOptions));
}

describe("M9 Control Center contract", () => {
	it("[U][fixture-pi-0.84.1] exposes exactly twelve sections in the required order", async () => {
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(), poolManager: poolFixture() });
		host.registerCommands();
		const calls: SelectCall[] = [];
		const notifications: string[] = [];
		await openCenter(host, pi, undefined, { titles: calls, notifications });
		assert.equal(calls[0]?.title, "Pi Multi-Orchestrator");
		assert.deepEqual(calls[0]?.options, [...CONTROL_CENTER_SECTIONS]);
		assert.equal(calls[0]?.options.filter((option) => CONTROL_CENTER_SECTIONS.includes(option as never)).length, CONTROL_CENTER_SECTIONS.length);
		assert.match(notifications[0] ?? "", /^Pi Multi-Orchestrator — Home\n/);
		assert.match(notifications[0] ?? "", /dashboard:/u);
		for (const section of CONTROL_CENTER_SECTIONS) assert.ok(section.length < 64 && !section.includes("\n"));
	});

	it("[U][fixture-pi-0.84.1] is RPC-testable and every section has a view or truthful deferred notification", async () => {
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(), poolManager: poolFixture() });
		host.registerCommands();
		for (const section of CONTROL_CENTER_SECTIONS) {
			const calls: SelectCall[] = [];
			const notifications: string[] = [];
			await openCenter(host, pi, section, { mode: "rpc", titles: calls, notifications });
			assert.deepEqual(calls[0]?.options, [...CONTROL_CENTER_SECTIONS], section);
			assert.ok(notifications.every((message) => !/undefined|null/u.test(message)), section);
			if (section === "Boss / Orchestrator Profiles") {
				assert.ok(notifications.some((message) => /Boss runtime not implemented yet|planned/iu.test(message)), section);
				continue;
			}
			if (["Budget / Quality Profiles", "Diagnostics", "Backup / Restore"].includes(section)) {
				assert.ok(notifications.some((message) => message.includes(section)), section);
				continue;
			}
			if (section === "Models & 9Router") assert.ok(calls.some((call) => /9Router Models/u.test(call.title)), section);
			else if (section.endsWith("Pool")) assert.ok(calls.some((call) => call.title === section), section);
			else if (section === "Context & Mission Settings") assert.ok(calls.some((call) => call.title === section), section);
			else if (section === "Routing & Fallback") assert.ok(notifications.some((message) => /routing|pool|unavailable/iu.test(message)), section);
			else if (section === "Health & Quotas") assert.ok(notifications.some((message) => /health|unavailable|no routes/iu.test(message)), section);
			else if (section === "Statistics & Analytics") assert.ok(notifications.some((message) => /analytics|disabled|unavailable/iu.test(message)), section);
		}
	});

	it("[U][fixture-pi-0.84.1] supports Back/escape navigation without applying or analyzing anything", async () => {
		const pi = piFixture();
		const pools = poolFixture([{ routeId: "route-a" as StableId, displayName: "Route A", remoteModelId: "remote-a", globalEnabled: true, poolEnabled: true, state: "active", catalogState: "fresh", resourceClass: "subscription" }]);
		const notifications: string[] = [];
		const host = createPiHost(pi.pi, { manager: managerFixture(), poolManager: pools });
		host.registerCommands();
		const calls: SelectCall[] = [];
		await openCenter(host, pi, "Implementation Pool", { titles: calls, notifications });
		await openCenter(host, pi, undefined, { titles: calls, notifications });
		assert.equal(pools.mutationCalls, 0);
		assert.equal(calls.filter((call) => call.title === "Pi Multi-Orchestrator").length, 3);
		assert.ok(calls.some((call) => call.options.includes("Back")));
	});

	it("[U][fixture-pi-0.84.1] returns one logical level for repeated nested Back and still exits at the root", async () => {
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(), poolManager: poolFixture() });
		host.registerCommands();
		const calls: SelectCall[] = [];
		await openCenter(host, pi, undefined, {
			titles: calls,
			rootSelections: ["Investigation Pool", "Implementation Pool", "Verification Pool", undefined],
		});
		const rootCalls = calls.filter((call) => call.title === "Pi Multi-Orchestrator");
		assert.equal(rootCalls.length, 4);
		assert.equal(calls.filter((call) => call.title.endsWith("Pool")).length, 3);
		assert.ok(calls.every((call) => call.options.length > 0));
	});

	it("[U][fixture-pi-0.84.1] projects empty, stale, error, and busy states textually", async () => {
		const emptyPi = piFixture();
		const emptyNotifications: string[] = [];
		const emptyHost = createPiHost(emptyPi.pi, { manager: managerFixture({ projection: undefined }), poolManager: poolFixture() });
		emptyHost.registerCommands();
		await emptyPi.commands.get("pool-status")!.handler("implementation", context({ mode: "rpc", notify: (message) => { emptyNotifications.push(message); } }));
		assert.match(emptyNotifications.join("\n"), /no routes assigned|empty/iu);

		const stalePi = piFixture();
		const staleNotifications: string[] = [];
		const staleHost = createPiHost(stalePi.pi, {
			manager: managerFixture({ state: "CACHED/STALE" }),
			poolManager: poolFixture([{ routeId: "route-a" as StableId, displayName: "Route A", remoteModelId: "remote-a", globalEnabled: true, poolEnabled: true, state: "active", catalogState: "stale", resourceClass: "subscription" }]),
		});
		staleHost.registerCommands();
		await stalePi.commands.get("pool-status")!.handler("implementation", context({ mode: "rpc", notify: (message) => { staleNotifications.push(message); } }));
		assert.match(staleNotifications.join("\n"), /stale/iu);

		const errorPi = piFixture();
		const errorNotifications: string[] = [];
		const errorHost = createPiHost(errorPi.pi, { manager: managerFixture({ listError: new Error("fixture failure") }), poolManager: poolFixture() });
		errorHost.registerCommands();
		await errorPi.commands.get("9router-refresh")!.handler("", context({ mode: "rpc", notify: (message) => { errorNotifications.push(message); } }));
		assert.match(errorNotifications.join("\n"), /error|failed|unavailable/iu);

		const busyPi = piFixture();
		const busyNotifications: string[] = [];
		const busyHost = createPiHost(busyPi.pi, { manager: managerFixture(), poolManager: poolFixture() });
		busyHost.registerCommands();
		await busyPi.commands.get("9router-refresh")!.handler("", context({ mode: "tui", idle: false, notify: (message) => { busyNotifications.push(message); } }));
		assert.match(busyNotifications.join("\n"), /busy|current Pi turn|wait/iu);
	});

	it("[U][fixture-pi-0.84.1] keeps direct commands available and never auto-Apply/AI", async () => {
		const pi = piFixture();
		const pools = poolFixture();
		const notifications: string[] = [];
		let analystCalls = 0;
		const analyst: RecommendationAnalystContract = {
			getSettings: async () => ({ mode: "deterministic" }),
			getStatus: async () => ({ state: "idle" }),
			listVerificationRoutes: async () => [],
			analyze: async () => { analystCalls += 1; return { state: "completed" }; },
		};
		const host = createPiHost(pi.pi, { manager: managerFixture(), poolManager: pools, recommendationAnalyst: analyst });
		host.registerCommands();
		for (const command of ["orchestrator", "9router-models", "9router-refresh", "9router-status", "pool-models", "pool-status", "routing-status", "route-health", "routing-settings", "subagent-run", "missions", "mission-packet", "quality-status", "verify-task", "analytics", "recommendation-analyst", "recommendations"]) assert.ok(pi.commands.has(command), command);
		await openCenter(host, pi, "Statistics & Analytics", { notifications });
		assert.equal(pools.mutationCalls, 0);
		assert.equal(analystCalls, 0);
		assert.ok(!notifications.some((message) => /analyzing|analysis started|applied recommendation/iu.test(message)));
	});
});
