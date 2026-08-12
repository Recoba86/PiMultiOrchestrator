import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	type PoolManagerContract,
	NINEROUTER_PROVIDER_ID,
} from "../src/host/pi-extension.js";
import { ConfigStore, createDefaultConfig } from "../src/core/config/index.js";
import { HealthStore } from "../src/core/health/index.js";
import { classifyFailure } from "../src/core/routing/index.js";
import { NINEROUTER_GATEWAY_ID, type ProviderProjection } from "../src/core/ninerouter/index.js";
import type { StableId } from "../src/core/config/types.js";
import { POOL_IDS, type PoolEntryView, type PoolId } from "../src/core/pools/index.js";
import type { SubagentExecutor, SubagentRunResult } from "../src/core/workers/index.js";
import type { MissionRecord, MissionStoreAdapter } from "../src/core/mission/types.js";
import type { QualityPersistence, TaskQualityStatus, VerificationRunRecord } from "../src/core/quality/types.js";
import { summarize, type AnalyticsEventV1, type AnalyticsRecommendation, type AnalyticsStoreAdapter } from "../src/core/analytics/index.js";

function projection(models: readonly ProviderModelConfig[] = [model("remote-a")]): ProviderProjection {
	return {
		providerId: NINEROUTER_PROVIDER_ID,
		gatewayId: NINEROUTER_GATEWAY_ID,
		baseUrl: "http://127.0.0.1:3000/v1",
		apiKeyReference: "$NINEROUTER_API_KEY",
		authHeader: true,
		api: "openai-completions",
		models: models.map((value) => ({
			routeId: value.id.replace(/^remote-/u, "route-") as StableId,
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

function poolManagerFixture(): PoolManagerContract & {
	entries: Array<{ routeId: StableId; displayName: string; remoteModelId: string; globalEnabled: boolean; poolEnabled: boolean; state: "active"; catalogState: "fresh"; resourceClass: "subscription"; gatewayId?: StableId; resourceId?: StableId; sourceLabel?: string; provenance?: NonNullable<PoolEntryView["provenance"]> }>;
	moveDownCalls: number;
} {
	type Entry = { routeId: StableId; displayName: string; remoteModelId: string; globalEnabled: boolean; poolEnabled: boolean; state: "active"; catalogState: "fresh"; resourceClass: "subscription"; gatewayId?: StableId; resourceId?: StableId; sourceLabel?: string; provenance?: NonNullable<PoolEntryView["provenance"]> };
	type View = { poolId: PoolId; id: PoolId; label: string; entries: Array<Entry & { index: number }> };
	const entries: Entry[] = [
		{ routeId: "route-a" as StableId, displayName: "Route A", remoteModelId: "remote-a", globalEnabled: true, poolEnabled: true, state: "active", catalogState: "fresh", resourceClass: "subscription", gatewayId: NINEROUTER_GATEWAY_ID, resourceId: "resource-a" as StableId, sourceLabel: "fixture-source", provenance: { remoteId: "remote", displayName: "remote", resourceClass: "remote", capabilities: "remote", input: "remote", capability: "remote" } },
		{ routeId: "route-b" as StableId, displayName: "Route B", remoteModelId: "remote-b", globalEnabled: true, poolEnabled: true, state: "active", catalogState: "fresh", resourceClass: "subscription" },
	];
	let moveDownCalls = 0;
	const listPools = (): readonly View[] => POOL_IDS.map((poolId) => ({
		poolId,
		id: poolId,
		label: poolId[0]!.toUpperCase() + poolId.slice(1),
		entries: poolId === "implementation" ? entries.map((entry, index) => ({ ...entry, index })) : [],
	}));
	const fixture: PoolManagerContract & { entries: Entry[]; moveDownCalls: number } = {
		entries,
		moveDownCalls: 0,
		getAvailableCandidatesToAdd: async () => [],
		addRoute: async () => {},
		removeRoute: async () => {},
		moveRouteUp: async () => {},
		moveRouteDown: async (_poolId: string, routeId: string) => {
			moveDownCalls += 1;
			const index = entries.findIndex((entry) => entry.routeId === routeId);
			if (index >= 0 && index + 1 < entries.length) {
				const [entry] = entries.splice(index, 1);
				if (entry) entries.splice(index + 1, 0, entry);
			}
		},
		moveRoute: async () => {},
		setPoolEntryEnabled: async () => {},
		listPools: async () => listPools(),
		getPool: async (poolId: PoolId) => listPools().find((pool) => pool.poolId === poolId)!,
	};
	Object.defineProperty(fixture, "moveDownCalls", { get: () => moveDownCalls, enumerable: true });
	return fixture;
}

interface PiFixture {
	readonly pi: ExtensionAPI;
	readonly providers: Map<string, ProviderConfig>;
	readonly commands: Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
	readonly unregisters: string[];
	readonly registerCalls: string[];
	readonly tools: Map<string, unknown>;
	readonly entries: Array<{ customType: string; data: unknown }>;
}

function piFixture(): PiFixture {
	const providers = new Map<string, ProviderConfig>();
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
	const unregisters: string[] = [];
	const registerCalls: string[] = [];
	const tools = new Map<string, unknown>();
	const entries: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		registerProvider(name: string, config: ProviderConfig): void {
			registerCalls.push(name);
			providers.set(name, config);
		},
		unregisterProvider(name: string): void {
			unregisters.push(name);
			providers.delete(name);
		},
		registerCommand(name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }): void {
			commands.set(name, options);
		},
		registerTool(tool: { name: string }): void {
			tools.set(tool.name, tool);
		},
		appendEntry(customType: string, data: unknown): void {
			entries.push({ customType, data });
		},
	} as unknown as ExtensionAPI;
	return { pi, providers, commands, unregisters, registerCalls, tools, entries };
}

function missionFixture(): { store: MissionStoreAdapter; mission: MissionRecord; transitions: Array<{ id: string; status: string }> } {
	const mission: MissionRecord = {
		missionId: "mission-1" as MissionRecord["missionId"],
		revision: 1,
		status: "planned",
		goal: "Fixture mission",
		title: "Fixture mission",
		objective: "Fixture mission",
		constraints: [],
		acceptanceCriteria: ["tests pass"],
		repository: { cwd: "/tmp/fixture" },
		plan: undefined,
		approvedDecisions: [],
		validatedFindings: [],
		completedWork: [],
		currentChangeState: undefined,
		testReviewEvidence: [],
		unresolvedIssues: [],
		nextSteps: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
	const transitions: Array<{ id: string; status: string }> = [];
	const store = {
		getMission: (id: string) => id === mission.missionId ? mission : undefined,
		listMissions: () => [mission],
		listTasks: () => [],
		transitionMission: (id: string, status: MissionRecord["status"]) => {
			transitions.push({ id, status });
			return { ...mission, status, revision: mission.revision + 1, updatedAt: "2026-01-01T00:00:01.000Z" };
		},
	} as unknown as MissionStoreAdapter;
	return { store, mission, transitions };
}

function qualityFixture(): {
	readonly store: QualityPersistence;
	readonly status: TaskQualityStatus;
	readonly runs: VerificationRunRecord[];
	readonly confirmations: number[];
} {
	const status: TaskQualityStatus = { missionId: "mission-1" as never, taskId: "task-1" as never, status: "unverified", qualityRound: 0, updatedAt: "2026-01-01T00:00:00.000Z" };
	const runs: VerificationRunRecord[] = [];
	const confirmations: number[] = [];
	const store = {
		getTaskQualityStatus: (taskId: string) => taskId === "task-1" ? status : undefined,
		setTaskQualityStatus: (input: TaskQualityStatus) => { Object.assign(status, input); return status; },
		createVerificationRun: (input: Parameters<QualityPersistence["createVerificationRun"]>[0]) => {
			const run = { verificationId: `verification-${runs.length + 1}`, missionId: input.missionId as never, taskId: input.taskId as never, targetRunId: input.targetRunId, ...(input.targetPacketId ? { targetPacketId: input.targetPacketId } : {}), round: input.round ?? 0, status: "running" as const, startedAt: "2026-01-01T00:00:01.000Z", potentialMutationObserved: input.potentialMutationObserved === true };
			runs.push(run);
			return run;
		},
		getVerificationRun: (id: string) => runs.find((run) => run.verificationId === id),
		updateVerificationRun: (id: string, patch: Partial<VerificationRunRecord>) => {
			const run = runs.find((item) => item.verificationId === id)!;
			Object.assign(run, patch);
			return run;
		},
		recordQualityDecision: () => { throw new Error("not used by host fixture"); },
		createQualityEscalation: () => { throw new Error("not used by host fixture"); },
		listVerificationRuns: () => runs,
		listQualityDecisions: () => [],
		listQualityEscalations: () => [],
	} as unknown as QualityPersistence;
	return { store, status, runs, confirmations };
}

function analyticsFixture(): AnalyticsStoreAdapter {
	const events: AnalyticsEventV1[] = [
		{ eventId: "run-1", occurredAt: "2026-08-10T00:00:00.000Z", eventType: "run", runId: "run-1", missionId: "mission-1", roleId: "investigator", poolId: "implementation", routeId: "route-a", remoteModelId: "remote-a", outcome: "success", durationMs: 125, tokenUsage: { inputTokens: 12, outputTokens: 8, cacheReadTokens: 3, totalTokens: 23, provenance: "observed" } },
		{ eventId: "attempt-1", occurredAt: "2026-08-10T00:00:01.000Z", eventType: "attempt", runId: "run-1", poolId: "implementation", routeId: "route-a", outcome: "success", durationMs: 125, tokenUsage: { inputTokens: 12, outputTokens: 8, cacheReadTokens: 3, totalTokens: 23, provenance: "observed" } },
		{ eventId: "fallback-1", occurredAt: "2026-08-10T00:00:02.000Z", eventType: "fallback", poolId: "implementation", fallbackFromRouteId: "route-a", fallbackToRouteId: "route-b", failureClass: "rate_limited", outcome: "fallback" },
		{ eventId: "quality-1", occurredAt: "2026-08-10T00:00:03.000Z", eventType: "quality", missionId: "mission-1", poolId: "implementation", routeId: "route-a", qualityOutcome: "pass", firstPass: true, repairRound: 0 },
	];
	const recommendations: AnalyticsRecommendation[] = [{ recommendationId: "rec-fixture", poolId: "implementation", proposedRouteId: "route-a", baselineRouteId: "route-b", sampleSize: 10, score: 0.9, formulaVersion: "quality-v1", evidence: ["9/10 successful runs"], limitations: ["fixture only"], proposedDiff: { baselineOrder: ["route-b", "route-a"] }, status: "proposed" }];
	const list = (range?: { readonly from?: string; readonly to?: string }): readonly AnalyticsEventV1[] => events.filter((event) => (!range?.from || event.occurredAt >= range.from) && (!range?.to || event.occurredAt <= range.to));
	return {
		enabled: true,
		append: (event) => { events.push(event); return true; },
		list,
		summary: (range) => summarize(list(range), range),
		saveRecommendation: (recommendation) => { recommendations.push(recommendation); },
		listRecommendations: () => recommendations,
		updateRecommendationStatus: () => true,
	};
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
		assert.deepEqual([...pi.commands.keys()], ["orchestrator", "9router-models", "9router-refresh", "9router-status", "pool-models", "pool-status", "routing-status", "route-health", "routing-settings", "subagent-run", "missions", "mission-packet", "quality-status", "verify-task", "analytics", "recommendations"]);

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

	it("[U][fixture-pi-0.84.1] exposes quality status and confirmation-gated task verification", async () => {
		const quality = qualityFixture();
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), qualityStore: quality.store });
		host.registerCommands();
		assert.ok(pi.commands.has("quality-status"));
		assert.ok(pi.commands.has("verify-task"));
		const notifications: string[] = [];
		await pi.commands.get("quality-status")!.handler("mission-1 task-1", {
			mode: "rpc",
			hasUI: false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[0] ?? "", /quality status: unverified \(round 0\)/);
		let confirmed = false;
		await pi.commands.get("verify-task")!.handler("mission-1 task-1 run-1", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				confirm: async () => confirmed,
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.equal(quality.runs.length, 0);
		confirmed = true;
		await pi.commands.get("verify-task")!.handler("mission-1 task-1 run-1", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				confirm: async () => confirmed,
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.equal(quality.runs.length, 1);
		assert.equal(quality.status.status, "verification_running");
		assert.ok(notifications.some((message) => /Verification started/.test(message)));
	});

	it("[U][fixture-pi-0.84.1] registers parent-only delegate tool and returns bounded child result", async () => {
		const pi = piFixture();
		const result: SubagentRunResult = {
			protocolVersion: 1,
			runId: "run-1",
			roleId: "debugger",
			poolId: "investigation",
			terminalStatus: "completed",
			attempts: [],
			potentialMutationObserved: false,
			fallbackCount: 0,
			summary: "child complete",
		};
		const executor = { run: async () => result } as unknown as SubagentExecutor;
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), subagentExecutor: executor });
		host.registerCommands();
		assert.ok(pi.tools.has("delegate_agent"));
		assert.ok(pi.commands.has("subagent-run"));
	});

	it("[U][fixture-pi-0.84.1] exposes canonical missions and stores only a pointer/status entry", async () => {
		const fixture = missionFixture();
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: fixture.store });
		host.registerCommands();
		assert.ok(pi.commands.has("missions"));
		const notifications: string[] = [];
		await pi.commands.get("missions")!.handler("", {
			mode: "rpc",
			hasUI: false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[0] ?? "", /mission: mission-1/);

		await pi.commands.get("missions")!.handler("mission-1", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async () => "Start mission",
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.deepEqual(fixture.transitions, [{ id: "mission-1", status: "running" }]);
		assert.deepEqual(pi.entries, [{ customType: "pi-multi-orchestrator:mission", data: { missionId: "mission-1", status: "running", revision: 2 } }]);
	});

	it("[U][fixture-pi-0.84.1] opens Context & Mission Settings from the control center", async () => {
		const fixture = missionFixture();
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: fixture.store });
		host.registerCommands();
		const titles: string[] = [];
		const selections = ["Context & Mission Settings", "Back"];
		await pi.commands.get("orchestrator")!.handler("", {
			mode: "tui",
			hasUI: true,
			ui: {
				select: async (title: string) => {
					titles.push(title);
					return selections.shift();
				},
				notify: () => {},
			},
		} as unknown as ExtensionCommandContext);
		assert.deepEqual(titles, ["Pi Multi-Orchestrator", "Context & Mission Settings"]);
	});

	it("[U][fixture-pi-0.84.1] opens all three pool sections from orchestrator", async () => {
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), poolManager: poolManagerFixture() });
		host.registerCommands();
		const titles: string[] = [];
		const selections = [
			"Investigation Pool", "Back",
			"Implementation Pool", "Back",
			"Verification Pool", "Back",
		];
		const ctx = {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async (title: string) => {
					titles.push(title);
					return selections.shift();
				},
				notify: () => {},
			},
		} as unknown as ExtensionCommandContext;
		for (let index = 0; index < 3; index += 1) await pi.commands.get("orchestrator")!.handler("", ctx);
		assert.ok(titles.includes("Investigation Pool"));
		assert.ok(titles.includes("Implementation Pool"));
		assert.ok(titles.includes("Verification Pool"));
	});

	it("[U][fixture-pi-0.84.1] refuses provider mutations while Pi is busy", async () => {
		const fixture = managerFixture(projection());
		const pools = poolManagerFixture();
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture, poolManager: pools });
		host.registerCommands();
		const notifications: string[] = [];
		await pi.commands.get("9router-refresh")!.handler("", {
			isIdle: () => false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		const selections = ["1. Route A — remote-a [ACTIVE] (route-a)", "Move Down", "Back"];
		await pi.commands.get("pool-models")!.handler("implementation", {
			mode: "tui",
			hasUI: true,
			isIdle: () => false,
			ui: {
				select: async () => selections.shift(),
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[0] ?? "", /current Pi turn/);
		assert.equal(pools.moveDownCalls, 0);
	});

	it("[U][fixture-pi-0.84.1] edits one pool through the generic editor without provider reconciliation", async () => {
		const fixture = managerFixture(projection());
		const pools = poolManagerFixture();
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture, poolManager: pools });
		await host.reconcile();
		host.registerCommands();
		const notifications: string[] = [];
		const selections: Array<string | undefined> = [
			"1. Route A — remote-a [ACTIVE] (route-a)",
			"Move Down",
			"Back",
		];
		const ctx = {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async () => selections.shift(),
				confirm: async () => true,
				input: async () => undefined,
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext;
		await pi.commands.get("pool-models")!.handler("implementation", ctx);
		assert.equal(pools.moveDownCalls, 1);
		assert.deepEqual(pools.entries.map((entry) => entry.routeId), ["route-b", "route-a"]);
		assert.equal(pi.registerCalls.length, 1);
		assert.ok(notifications.some((message) => /Move route-a down saved/.test(message)));
	});

	it("[U][fixture-pi-0.84.1] inspects safe pool, catalog, and Pi availability metadata", async () => {
		const baseProjection = projection();
		const projected: ProviderProjection = {
			...baseProjection,
			models: baseProjection.models.map((entry) => ({ ...entry, routeId: "route-a" as StableId })),
		};
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projected), poolManager: poolManagerFixture() });
		host.registerCommands();
		const notifications: string[] = [];
		const selections: Array<string | undefined> = [
			"1. Route A — remote-a [ACTIVE] (route-a)",
			"Inspect",
			"Back",
		];
		await pi.commands.get("pool-models")!.handler("implementation", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			modelRegistry: { getAvailable: () => [{ provider: NINEROUTER_PROVIDER_ID, id: "remote-a" }] },
			ui: {
				select: async () => selections.shift(),
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[0] ?? "", /gateway: ninerouter/);
		assert.match(notifications[0] ?? "", /source: fixture-source/);
		assert.match(notifications[0] ?? "", /resource: subscription\/resource-a/);
		assert.match(notifications[0] ?? "", /catalog: fresh/);
		assert.match(notifications[0] ?? "", /projected in Pi: true/);
		assert.match(notifications[0] ?? "", /available in Pi: true/);
		assert.match(notifications[0] ?? "", /metadata provenance: remote/);
	});

	it("[U][fixture-pi-0.84.1] exposes pool status without TUI prompts", async () => {
		const pools = poolManagerFixture();
		pools.entries[0]!.poolEnabled = false;
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), poolManager: pools });
		host.registerCommands();
		const notifications: string[] = [];
		await pi.commands.get("pool-status")!.handler("", {
			mode: "rpc",
			hasUI: false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[0] ?? "", /Investigation Pool/);
		assert.match(notifications[0] ?? "", /Implementation Pool/);
		assert.match(notifications[0] ?? "", /2 routes/);
		assert.match(notifications[0] ?? "", /pool-disabled/);
		assert.match(notifications[0] ?? "", /No routes assigned\./);
	});

	it("[U][fixture-pi-0.84.1] drills analytics sections through native menus and ranges", async () => {
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), analyticsStore: analyticsFixture() });
		host.registerCommands();
		const notifications: string[] = [];
		await pi.commands.get("analytics")!.handler("all Pools", {
			mode: "rpc",
			hasUI: false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[0] ?? "", /Statistics & Analytics — Pools/);
		assert.match(notifications[0] ?? "", /implementation: runs=1/);
		await pi.commands.get("analytics")!.handler("custom 2026-08-09T00:00:00.000Z 2026-08-11T00:00:00.000Z Cost", {
			mode: "rpc",
			hasUI: false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[1] ?? "", /Statistics & Analytics — Cost/);
		assert.match(notifications[1] ?? "", /unknown cost events=/);
		await pi.commands.get("analytics")!.handler("all Recommendations", {
			mode: "rpc",
			hasUI: false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[2] ?? "", /rec-fixture: pool=implementation route=route-a/);
		await pi.commands.get("recommendations")!.handler("details rec-fixture", {
			mode: "rpc",
			hasUI: false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[3] ?? "", /rec-fixture/);
		const titles: string[] = [];
		const selections = ["Last 7 days", "Routes"];
		await pi.commands.get("analytics")!.handler("", {
			mode: "tui",
			hasUI: true,
			ui: {
				select: async (title: string) => { titles.push(title); return selections.shift(); },
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.deepEqual(titles, ["Analytics time window", "Statistics & Analytics"]);
		assert.match(notifications[4] ?? "", /Routes\/models/);
		assert.match(notifications[4] ?? "", /model provenance: route-a=remote-a/);
	});

	it("[I][fixture-v1] previews routing and resets persisted health without touching config", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-host-routing-"));
		try {
			const configStore = new ConfigStore({ root });
			await configStore.initialize(createDefaultConfig());
			const healthStore = new HealthStore({ root });
			await healthStore.recordFailure("route-a" as StableId, classifyFailure({ status: 429 }), { policy: { rateLimitCooldownMs: 60_000 } });
			const pi = piFixture();
			const host = createPiHost(pi.pi, {
				manager: managerFixture(projection([model("remote-a"), model("remote-b")])),
				poolManager: poolManagerFixture(),
				configStore,
				healthStore,
			});
			host.registerCommands();
			const notifications: string[] = [];
			await pi.commands.get("routing-status")!.handler("implementation", {
				mode: "rpc",
				hasUI: false,
				ui: { notify: (message: string) => notifications.push(message) },
			} as unknown as ExtensionCommandContext);
			assert.match(notifications[0] ?? "", /Current first eligible: Route B/);
			assert.match(notifications[0] ?? "", /Rate-limit cooldown/);
			const before = await configStore.load();
			let healthSelection = 0;
			await pi.commands.get("route-health")!.handler("route-a", {
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				ui: {
					select: async (title: string, options: readonly string[]) => {
						healthSelection += 1;
						if (healthSelection === 1) return options.find((option) => option.includes("route-a"));
						if (healthSelection === 2) return "Reset health";
						return undefined;
					},
					confirm: async () => true,
					notify: (message: string) => notifications.push(message),
				},
			} as unknown as ExtensionCommandContext);
			assert.equal((await healthStore.get("route-a" as StableId))?.circuit, "healthy");
			assert.equal((await configStore.load()).snapshot?.generation, before.snapshot?.generation);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
