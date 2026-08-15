import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	ProviderConfig,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

import {
	createPiHost,
	parseOrchestratorInvocation,
	type ModelManagerEntry,
	type PiManagerContract,
	type PoolManagerContract,
	type RecommendationAnalystContract,
	type RecommendationAnalystStatus,
	NINEROUTER_PROVIDER_ID,
} from "../src/host/pi-extension.js";
import { ConfigStore, createDefaultConfig } from "../src/core/config/index.js";
import { MAX_ROUTING_INPUT_LENGTH } from "../src/core/smart-routing/index.js";
import { HealthStore } from "../src/core/health/index.js";
import { classifyFailure } from "../src/core/routing/index.js";
import { NINEROUTER_GATEWAY_ID, type ProviderProjection } from "../src/core/ninerouter/index.js";
import type { StableId } from "../src/core/config/types.js";
import { POOL_IDS, type PoolEntryView, type PoolId, type PoolRouteCandidate } from "../src/core/pools/index.js";
import type { SubagentExecutionRequest, SubagentExecutor, SubagentRunResult } from "../src/core/workers/index.js";
import { createMissionStore } from "../src/core/mission/index.js";
import type { MissionRecord, MissionStoreAdapter } from "../src/core/mission/types.js";
import type { QualityPersistence, TaskQualityStatus, VerificationRunRecord } from "../src/core/quality/types.js";
import { summarize, type AnalyticsEventV1, type AnalyticsRecommendation, type AnalyticsStoreAdapter } from "../src/core/analytics/index.js";
import { TrustStore } from "../src/core/security/index.js";
import { SmartRoutingSettingsStore } from "../src/core/smart-routing/index.js";
import { RoutingMemoryStore } from "../src/core/routing-memory/index.js";

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
		entries: [{ remoteModelId: "remote-a", displayName: "Remote A", routeId: "route-a", sourceLabel: "fixture", capability: "chat", enabled: true } as ModelManagerEntry],
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
			const index = fixture.entries.findIndex((candidate) => candidate.remoteModelId === id);
			if (index >= 0) fixture.entries[index] = { ...fixture.entries[index]!, enabled };
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

function emptyPoolCandidateFixture(): PoolManagerContract & { readonly added: Array<{ poolId: PoolId; routeId: StableId }> } {
	const candidate = {
		routeId: "r9-ninerouter-ag-foo-1234567890abcdef" as StableId,
		displayName: "ag/foo",
		remoteModelId: "ag/foo",
		globalEnabled: true,
		poolEnabled: false,
		state: "active",
		catalogState: "fresh",
		resourceClass: "subscription",
	} satisfies PoolRouteCandidate;
	const added: Array<{ poolId: PoolId; routeId: StableId }> = [];
	const empty = (poolId: PoolId) => ({ id: poolId, poolId, label: poolId[0]!.toUpperCase() + poolId.slice(1), entries: [] as readonly PoolEntryView[] });
	return {
		added,
		listPools: async () => POOL_IDS.map(empty),
		getPool: async (poolId) => empty(poolId),
		getAvailableCandidatesToAdd: async () => [candidate],
		addRoute: async (poolId, routeId) => { added.push({ poolId, routeId }); },
		removeRoute: async () => {},
		moveRouteUp: async () => {},
		moveRouteDown: async () => {},
		moveRoute: async () => {},
		setPoolEntryEnabled: async () => {},
	};
}

interface PiFixture {
	readonly pi: ExtensionAPI;
	readonly providers: Map<string, ProviderConfig>;
	readonly commands: Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
	readonly unregisters: string[];
	readonly registerCalls: string[];
	readonly tools: Map<string, unknown>;
	readonly entries: Array<{ customType: string; data: unknown }>;
	readonly sentUserMessages: Array<{ content: string; options?: { readonly deliverAs?: "steer" | "followUp" } }>;
	readonly inputHandlers: Array<(event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult>>;
}

function piFixture(): PiFixture {
	const providers = new Map<string, ProviderConfig>();
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
	const unregisters: string[] = [];
	const registerCalls: string[] = [];
	const tools = new Map<string, unknown>();
	const entries: Array<{ customType: string; data: unknown }> = [];
	const sentUserMessages: Array<{ content: string; options?: { readonly deliverAs?: "steer" | "followUp" } }> = [];
	const inputHandlers: Array<(event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult>> = [];
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
		sendUserMessage(content: string, options?: { readonly deliverAs?: "steer" | "followUp" }): void {
			sentUserMessages.push({ content, ...(options === undefined ? {} : { options }) });
		},
		on(event: string, handler: (event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult>): void {
			if (event === "input") inputHandlers.push(handler);
		},
	} as unknown as ExtensionAPI;
	return { pi, providers, commands, unregisters, registerCalls, tools, entries, sentUserMessages, inputHandlers };
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
		finalizeQualityFailure: (input: { verificationId: string; status: "blocked" | "review_required"; failureSummary: string }) => {
			const run = runs.find((item) => item.verificationId === input.verificationId)!;
			Object.assign(run, { status: input.status === "review_required" ? "interrupted" : "blocked", failureSummary: input.failureSummary });
			Object.assign(status, { status: input.status, latestVerificationId: run.verificationId, updatedAt: run.completedAt ?? run.startedAt });
			return { run, status };
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

function recommendationAnalystFixture(): RecommendationAnalystContract & {
	readonly calls: Array<{ mode: string; routeId: string }>;
} {
	const calls: Array<{ mode: string; routeId: string }> = [];
	let status: RecommendationAnalystStatus = { state: "idle" };
	const routes = [
		{ routeId: "route-a" as StableId, displayName: "Route A", remoteModelId: "remote-a", enabled: true, available: true },
		{ routeId: "route-b" as StableId, displayName: "Route B", remoteModelId: "remote-b", enabled: true, available: true },
	] as const;
	return {
		calls,
		getSettings: async () => ({ mode: "deterministic" as const, routeId: "route-a" as StableId }),
		getStatus: async () => status,
		listVerificationRoutes: async () => routes,
		analyze: async (request) => {
			calls.push(request);
			status = { state: "completed", mode: request.mode, routeId: request.routeId, lastAnalysisAt: "2026-08-12T00:00:00.000Z", recommendationCount: 1 };
			return status;
		},
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

	it("[U][fixture-pi-0.84.1] does not unregister an unowned provider when a reloaded host starts empty", async () => {
		const fixture = managerFixture(projection());
		fixture.projection = undefined;
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });

		assert.deepEqual(await host.reconcile(), { changed: false, registered: false, modelCount: 0 });
		assert.deepEqual(await host.reconcile(), { changed: false, registered: false, modelCount: 0 });
		assert.deepEqual(pi.unregisters, []);
	});

	it("[U][fixture-pi-0.84.1] preserves an existing 27-model user provider across reconcile, reload, and disposal", async () => {
		const existingProvider = { models: Array.from({ length: 27 }, (_, index) => ({ id: `user-${index}` })) };
		const fixture = managerFixture(projection([model("pmo-only-a"), model("pmo-only-b")]));
		const pi = piFixture();
		const providerRegistry = { getProvider: (providerId: string) => providerId === NINEROUTER_PROVIDER_ID ? existingProvider : undefined };
		const host = createPiHost(pi.pi, { manager: fixture, providerRegistry });

		assert.deepEqual(await host.reconcile(), { changed: false, registered: false, modelCount: 2 });
		fixture.projection = undefined;
		assert.deepEqual(await host.reconcile(), { changed: false, registered: false, modelCount: 0 });
		host.dispose();
		const reloaded = createPiHost(pi.pi, { manager: fixture, providerRegistry });
		assert.deepEqual(await reloaded.reconcile(), { changed: false, registered: false, modelCount: 0 });
		reloaded.dispose();
		assert.equal(existingProvider.models.length, 27);
		assert.deepEqual(pi.registerCalls, []);
		assert.deepEqual(pi.unregisters, []);
	});

	it("[RC19][U][fixture-pi-0.84.1] adopts every exact external Pi model while leaving provider ownership untouched", async () => {
		const externalModels = Array.from({ length: 27 }, (_, index) => ({ id: `external-${index}`, name: `External ${index}`, reasoning: index % 2 === 0, input: ["text"] }));
		const fixture = managerFixture(projection([model("pmo-only-a")]));
		fixture.adoptPiProviderCatalog = async (catalog) => {
			fixture.entries = catalog.models.map((entry) => ({ remoteModelId: entry.id, displayName: entry.name ?? entry.id, sourceLabel: "Pi 9Router", enabled: false, available: true }));
		};
		const pi = piFixture();
		const host = createPiHost(pi.pi, {
			manager: fixture,
			providerRegistry: { getProvider: () => ({ getModels: () => externalModels }) },
		});

		assert.deepEqual(await host.reconcile(), { changed: false, registered: false, modelCount: 1 });
		assert.deepEqual(fixture.entries.map((entry) => entry.remoteModelId), externalModels.map((entry) => entry.id));
		assert.deepEqual(pi.registerCalls, []);
		assert.deepEqual(pi.unregisters, []);
	});

	it("[RC19][U/TUI/RPC][fixture-pi-0.84.1] offers secure setup only when no provider exists", async () => {
		const fixture = managerFixture(projection());
		fixture.entries = [];
		const order: string[] = [];
		let observedSecret = "";
		fixture.testConnection = async (_baseUrl, secret) => {
			order.push("test");
			observedSecret = secret;
			return [];
		};
		fixture.configure = async (_baseUrl, credentialRef) => {
			order.push("configure");
			assert.deepEqual(credentialRef, { store: "pi-auth", key: NINEROUTER_PROVIDER_ID });
		};
		fixture.refresh = async () => { order.push("refresh"); };
		const pi = piFixture();
		const notifications: string[] = [];
		const host = createPiHost(pi.pi, {
			manager: fixture,
			providerRegistry: { getProvider: () => undefined },
			credentialSetup: {
				setApiKey: async (_providerId, _baseUrl, secret) => {
					order.push("save");
					observedSecret = secret;
				},
			},
		});
		host.registerCommands();
		const secret = "rc19-test-key";
		await pi.commands.get("9router-models")!.handler("", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async (title: string, choices: readonly string[]) => {
					assert.equal(title, "Models & 9Router");
					assert.deepEqual(choices, ["Set Up 9Router", "Use Advanced env reference", "Refresh Models", "Back"]);
					return "Set Up 9Router";
				},
				input: async (title: string) => {
					assert.equal(title, "9Router base URL");
					return "http://127.0.0.1:3000";
				},
				confirm: async (title: string) => {
					assert.equal(title, "Test & Save 9Router connection?");
					return true;
				},
				custom: async (factory: unknown) => {
					let result: string | undefined;
					const component = (factory as (tui: unknown, theme: unknown, keybindings: unknown, done: (value: string | undefined) => void) => unknown)(undefined, undefined, undefined, (value) => { result = value; }) as { handleInput(data: string): void; render(width: number): string[] };
					component.handleInput(secret);
					assert.doesNotMatch(component.render(120).join("\n"), new RegExp(secret));
					component.handleInput("\r");
					return result;
				},
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.deepEqual(order, ["test", "save", "configure", "refresh"]);
		assert.equal(observedSecret, secret);
		assert.ok(notifications.some((message) => /Connected to 9Router/.test(message)));
		assert.ok(notifications.every((message) => !message.includes(secret)));

		const rpcFixture = managerFixture(projection());
		rpcFixture.entries = [];
		const rpcPi = piFixture();
		const rpcHost = createPiHost(rpcPi.pi, { manager: rpcFixture, providerRegistry: { getProvider: () => undefined } });
		rpcHost.registerCommands();
		const rpcNotifications: string[] = [];
		await rpcPi.commands.get("9router-models")!.handler("", {
			mode: "rpc",
			hasUI: true,
			ui: { select: async () => "Set Up 9Router", notify: (message: string) => rpcNotifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.ok(rpcNotifications.some((message) => /requires TUI mode/.test(message)));
	});

	it("[U][fixture-pi-0.84.1] unregisters the owned provider on host disposal", async () => {
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()) });
		await host.reconcile();
		host.dispose();
		host.dispose();
		assert.equal(pi.providers.size, 0);
		assert.deepEqual(pi.unregisters, [NINEROUTER_PROVIDER_ID]);
	});

	it("[U][fixture-pi-0.84.1] registers all required native commands and blocks disabling the active route", async () => {
		const fixture = managerFixture(projection());
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });
		host.registerCommands();
		assert.deepEqual([...pi.commands.keys()], ["orchestrator", "9router-models", "9router-refresh", "9router-status", "pool-models", "pool-status", "routing-status", "route-health", "routing-settings", "subagent-run", "missions", "mission-packet", "quality-status", "verify-task", "analytics", "recommendation-analyst", "recommendations"]);

		const notifications: string[] = [];
		let prompts = 0;
		const selections: Array<string | undefined> = [
			"[x] remote-a",
			"Inspect",
			"[x] remote-a",
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

	it("[RC20][U/TUI][fixture-pi-0.84.1] exposes Refresh Models and redraws changed catalog rows", async () => {
		const fixture = managerFixture(projection());
		const pi = piFixture();
		fixture.refresh = async () => {
			fixture.entries.push({ remoteModelId: "remote-new", displayName: "Remote New", sourceLabel: "fixture", enabled: false, available: true });
		};
		const host = createPiHost(pi.pi, { manager: fixture });
		host.registerCommands();
		const notifications: string[] = [];
		let first = true;
		await pi.commands.get("9router-models")!.handler("", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async (_title: string, choices: readonly string[]) => {
					if (first) {
						first = false;
						assert.ok(choices.includes("Refresh Models"));
						return "Refresh Models";
					}
					assert.ok(choices.some((choice) => choice.includes("remote-new")));
					return "Back";
				},
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.ok(notifications.some((message) => /\+1 added/u.test(message)));
		assert.equal(fixture.entries.find((entry) => entry.remoteModelId === "remote-new")?.enabled, false);
	});

	it("[RC24][U/TUI][fixture-pi-0.84.1] shows enablement checkboxes while preserving canonical duplicate labels and inspection privacy", async () => {
		const richRow = {
			entry: {
				remoteId: "remote-rich",
				displayName: "Rich",
				owner: "Pi 9Router",
				resourceClass: "subscription",
				capabilities: ["chat"],
				input: ["text", "image"],
				reasoning: true,
				thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
				vision: true,
				contextWindow: 200_000,
				maxTokens: 16_000,
				capability: "chat",
				provenance: { remoteId: "remote", displayName: "remote", resourceClass: "remote", capabilities: "remote", input: "remote", reasoning: "remote", thinkingLevelMap: "remote", vision: "remote", contextWindow: "remote", maxTokens: "remote", capability: "remote" },
			},
			remoteModelId: "remote-rich",
			displayName: "Rich",
			routeId: "internal-route-id",
			enabled: true,
			available: true,
			sourceLabel: "Pi 9Router",
			status: "present",
		} as unknown as ModelManagerEntry;
		const duplicateRichRow = {
			remoteModelId: "remote-rich",
			displayName: "Rich",
			routeId: "second-internal-route-id",
			enabled: false,
			available: true,
			sourceLabel: "Pi 9Router",
			status: "present",
		} as unknown as ModelManagerEntry;
		const fixture = managerFixture(projection());
		fixture.entries = [
			richRow,
			duplicateRichRow,
			{ remoteModelId: "remote-false", displayName: "False", reasoning: false, enabled: false, available: true },
			{ remoteModelId: "remote-unknown", displayName: "Unknown", enabled: false, available: true },
		];
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });
		host.registerCommands();
		const notifications: string[] = [];
		let modelMenuCalls = 0;
		await pi.commands.get("9router-models")!.handler("", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async (title: string, choices: readonly string[]) => {
					if (title === "9Router Models — select a model") {
						modelMenuCalls += 1;
						assert.equal(choices[0], "Refresh Models");
						assert.equal(choices[1], "────────────");
						assert.deepEqual(choices.slice(2, -1), ["[x] remote-rich #1", "[ ] remote-rich #2", "[ ] remote-false", "[ ] remote-unknown"]);
						assert.ok(choices.slice(2, -1).every((choice) => !/ACTIVE|Thinking|r9-ninerouter/iu.test(choice)));
						const rich = choices.find((choice) => choice === "[x] remote-rich #1")!;
						assert.doesNotMatch(rich, /internal-route-id/u);
						return modelMenuCalls === 1 ? rich : "Back";
					}
					return "Inspect";
				},
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.ok(notifications.some((message) => /remote: remote-rich/u.test(message)));
		assert.ok(notifications.some((message) => /reasoning: supported/u.test(message) && /thinking levels: low, medium, high, xhigh, max/u.test(message) && /vision: true/u.test(message) && /context: 200000/u.test(message) && /max output: 16000/u.test(message) && /local route: internal-route-id/u.test(message)));
	});

	it("[RC24][U/TUI][fixture-pi-0.84.1] opens model actions and redraws enablement immediately and after refresh", async () => {
		const fixture = managerFixture(projection());
		fixture.entries = [
			{ remoteModelId: "ag/gemini-3.7-flash-high", displayName: "ag/gemini-3.7-flash-high", routeId: "route-gemini", enabled: false, available: true },
			{ remoteModelId: "ag/claude-opus-4-6-thinking", displayName: "ag/claude-opus-4-6-thinking", routeId: "route-claude", enabled: true, available: true },
			{ remoteModelId: "cu/composer-2.5", displayName: "cu/composer-2.5", routeId: "route-composer", enabled: false, available: true },
			{ remoteModelId: "cx/gpt-5.6-luna", displayName: "cx/gpt-5.6-luna", routeId: "route-luna", enabled: true, available: true },
		];
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });
		host.registerCommands();
		let menuCalls = 0;
		let confirmations = 0;
		await pi.commands.get("9router-models")!.handler("", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async (title: string, choices: readonly string[]) => {
					if (title === "9Router Models — select a model") {
						menuCalls += 1;
						if (menuCalls === 2) assert.equal(fixture.entries.find((entry) => entry.remoteModelId === "cu/composer-2.5")?.enabled, true);
						assert.equal(choices[0], "Refresh Models");
						assert.equal(choices[1], "────────────");
						assert.deepEqual(choices.slice(2, -1), [
							"[ ] ag/gemini-3.7-flash-high",
							"[x] ag/claude-opus-4-6-thinking",
							menuCalls === 2 ? "[x] cu/composer-2.5" : "[ ] cu/composer-2.5",
							"[x] cx/gpt-5.6-luna",
						]);
						assert.ok(
							choices.slice(2, -1).every(
								(choice) =>
									!["route-gemini", "route-claude", "route-composer", "route-luna"].some((routeId) =>
										choice.includes(routeId),
									) && !/(?:^|\s)(?:ACTIVE|Thinking)(?:\s|$)/u.test(choice),
							),
						);
						if (menuCalls === 1) assert.equal(pi.registerCalls.length, 0, "displaying rows must not reconcile the Pi provider");
						if (menuCalls === 1) return "[ ] cu/composer-2.5";
						if (menuCalls === 2) return "[x] cu/composer-2.5";
						if (menuCalls === 3) {
							assert.equal(fixture.entries.find((entry) => entry.remoteModelId === "cu/composer-2.5")?.enabled, false);
							return "Refresh Models";
						}
						assert.equal(menuCalls, 4);
						return "Back";
					}
					assert.equal(title, "9Router model: cu/composer-2.5");
					const action = confirmations === 0 ? "Enable" : "Disable";
					assert.deepEqual(choices, ["Inspect", action, "Back"]);
					return action;
				},
				confirm: async (title: string) => {
					confirmations += 1;
					assert.equal(title, confirmations === 1 ? "Enable 9Router model?" : "Disable 9Router model?");
					return true;
				},
				notify: () => {},
			},
		} as unknown as ExtensionCommandContext);
		assert.equal(menuCalls, 4);
		assert.equal(confirmations, 2);
		assert.deepEqual(fixture.setEnabledCalls.map(({ id, enabled }) => ({ id, enabled })), [
			{ id: "cu/composer-2.5", enabled: true },
			{ id: "cu/composer-2.5", enabled: false },
		]);
	});

	it("[RC24][U/RPC][fixture-pi-0.84.1] renders authoritative enablement without toggling or provider mutation", async () => {
		const fixture = managerFixture(projection());
		fixture.entries = [
			{ remoteModelId: "rpc-disabled", displayName: "rpc-disabled", routeId: "rpc-route-disabled", enabled: false, available: true },
			{ remoteModelId: "rpc-enabled", displayName: "rpc-enabled", routeId: "rpc-route-enabled", enabled: true, available: true },
		];
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });
		host.registerCommands();
		await pi.commands.get("9router-models")!.handler("", {
			mode: "rpc",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async (title: string, choices: readonly string[]) => {
					assert.equal(title, "9Router Models — select a model");
					assert.deepEqual(choices.slice(2, -1), ["[ ] rpc-disabled", "[x] rpc-enabled"]);
					return "Back";
				},
				notify: () => {},
			},
		} as unknown as ExtensionCommandContext);
		assert.deepEqual(fixture.setEnabledCalls, []);
		assert.deepEqual(pi.registerCalls, []);
	});

	it("[RC21][U/TUI][fixture-pi-0.84.1] refreshes a static Pi provider upstream without mutating it and reports LKG failure", async () => {
		const fixture = managerFixture(projection());
		const externalProvider = { baseUrl: "http://127.0.0.1:4300/v1", models: [{ id: "remote-a" }] };
		let refreshCalls = 0;
		let authCalls = 0;
		fixture.refreshExternalProviderCatalog = async (_baseUrl, auth) => {
			authCalls += 1;
			assert.equal(auth.apiKey, "fixture-secret");
			refreshCalls += 1;
			if (refreshCalls > 1) throw new Error("upstream failure");
			fixture.entries.push({ remoteModelId: "remote-new", displayName: "Remote New", sourceLabel: "fixture", enabled: false, available: true });
			return { addedRemoteIds: ["remote-new"], removedRemoteIds: [], changedRemoteIds: [] };
		};
		const pi = piFixture();
		const host = createPiHost(pi.pi, {
			manager: fixture,
			providerRegistry: {
				getProvider: () => externalProvider,
				getProviderAuth: async () => ({ auth: { apiKey: "fixture-secret" } }),
			},
		});
		host.registerCommands();
		const notifications: string[] = [];
		let menuCalls = 0;
		await pi.commands.get("9router-models")!.handler("", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async (title: string, choices: readonly string[]) => {
					if (title !== "9Router Models — select a model") return "Back";
					menuCalls += 1;
					if (menuCalls === 1) {
						assert.equal(choices[0], "Refresh Models");
						return "Refresh Models";
					}
					assert.ok(choices.some((choice) => choice.includes("remote-new")));
					return menuCalls === 2 ? "Refresh Models" : "Back";
				},
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.equal(authCalls, 2);
		assert.equal(externalProvider.models.length, 1);
		assert.ok(notifications.filter((message) => /Refreshing 9Router models/u.test(message)).length === 2);
		assert.ok(notifications.some((message) => /\+1 added/u.test(message) && /last refreshed/u.test(message)));
		assert.ok(notifications.some((message) => /last-known-good catalog/u.test(message)));
		assert.ok(notifications.every((message) => !message.includes("fixture-secret")));
	});

	it("[RC21][U/TUI][fixture-pi-0.84.1] reports an explicit no-change refresh", async () => {
		const fixture = managerFixture(projection());
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: fixture });
		host.registerCommands();
		const notifications: string[] = [];
		let first = true;
		await pi.commands.get("9router-models")!.handler("", {
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async (_title: string, choices: readonly string[]) => {
					if (first) {
						first = false;
						assert.equal(choices[0], "Refresh Models");
						return "Refresh Models";
					}
					return "Back";
				},
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.ok(notifications.some((message) => /no model changes/u.test(message)));
	});

	it("[U][fixture-pi-0.84.1][M10] exposes Security & Trust without adding a control-center section", async () => {
		const project = await mkdtemp(join(tmpdir(), "pi-m10-host-project-"));
		const state = await mkdtemp(join(tmpdir(), "pi-m10-host-state-"));
		const trustStore = new TrustStore({ root: state });
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), trustStore });
		host.registerCommands();
		const notifications: string[] = [];
		const selections: string[] = ["Diagnostics", "Security & Trust", "Trust Project"];
		await pi.commands.get("orchestrator")!.handler("", {
			mode: "tui", hasUI: true, cwd: project,
			ui: { select: async () => selections.shift(), confirm: async () => true, notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.match(notifications[0] ?? "", /latest accepted milestone: M10/u);
		assert.match(notifications[0] ?? "", /RC28 .*implemented-but-not-accepted/u);
		assert.doesNotMatch(notifications[0] ?? "", /M8\.5|M9 control center implementation pending Planner acceptance/u);
		assert.ok(notifications.some((message) => /UNTRUSTED/.test(message)));
		assert.equal(trustStore.isTrusted(project), true);
		assert.equal([...pi.commands.keys()].filter((name) => name === "orchestrator").length, 1);
	});

	it("[U][fixture-pi-0.84.1] runs the manual Recommendation Analyst against a Verification Pool route", async () => {
		const analyst = recommendationAnalystFixture();
		const pools = poolManagerFixture();
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), poolManager: pools, recommendationAnalyst: analyst });
		host.registerCommands();
		const notifications: string[] = [];
		await pi.commands.get("recommendation-analyst")!.handler("analyze", {
			mode: "rpc",
			hasUI: false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext);
		assert.deepEqual(analyst.calls, [{ mode: "deterministic", routeId: "route-a" }]);
		assert.match(notifications[0] ?? "", /manual-only/);
		assert.match(notifications[0] ?? "", /verification-route=remote-a/u);
		const titles: string[] = [];
		await pi.commands.get("recommendation-analyst")!.handler("", {
			mode: "tui",
			hasUI: true,
			ui: {
				select: (() => {
					let modeChanged = false;
					let routeChanged = false;
					let analyzed = false;
					return async (title: string, options: readonly string[]) => {
						titles.push(title);
						if (title === "Recommendation Analyst") {
							if (!modeChanged) return (modeChanged = true, options.find((option) => option.startsWith("Mode:")));
							if (!routeChanged) return (routeChanged = true, options.find((option) => option.startsWith("Verification route:")));
							if (!analyzed) return (analyzed = true, "Analyze Now");
							return "Back";
						}
						if (title === "Recommendation Analyst mode") return "AI-assisted";
						if (title === "Verification Pool route") {
							assert.deepEqual(options.slice(0, -1), ["remote-a", "remote-b"]);
							assert.equal(options.some((option) => /route-[ab]|r9-ninerouter/iu.test(option)), false);
							return "remote-b";
						}
						return "Back";
					};
				})(),
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.deepEqual(analyst.calls, [{ mode: "deterministic", routeId: "route-a" }, { mode: "ai-assisted", routeId: "route-b" }]);
		assert.equal(pools.moveDownCalls, 0);
		assert.deepEqual(titles.slice(0, 3), ["Recommendation Analyst", "Recommendation Analyst mode", "Recommendation Analyst"]);
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
		assert.ok(notifications.some((message) => /Canonical Mission verification \(M7\) started/.test(message)));
	});

	it("[U][fixture-pi-0.84.1] direct task verification prefers a different reviewer route", async () => {
		const quality = qualityFixture();
		const requests: SubagentExecutionRequest[] = [];
		const missionStore = {
			getTask: (taskId: string) => taskId === "task-1" ? { taskId: "task-1", missionId: "mission-1", acceptanceCriteria: [], lastRunId: "run-1" } : undefined,
			getAttempt: (attemptId: string) => attemptId === "run-1" ? { routeId: "route-implementation" as StableId } : undefined,
		} as unknown as MissionStoreAdapter;
		const qualityExecutor = {
			run: async (request: SubagentExecutionRequest): Promise<SubagentRunResult> => {
				requests.push(request);
				return { protocolVersion: 1, runId: "review-run", roleId: "quality-reviewer", poolId: "verification", terminalStatus: "infrastructure_stopped", attempts: [], potentialMutationObserved: false, fallbackCount: 0, summary: "blocked fixture" };
			},
		} as unknown as SubagentExecutor;
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore, qualityStore: quality.store, qualityExecutor });
		host.registerCommands();
		await pi.commands.get("verify-task")!.handler("mission-1 task-1 run-1", { mode: "tui", hasUI: true, isIdle: () => true, ui: { confirm: async () => true, notify: () => {} } } as unknown as ExtensionCommandContext);
		assert.deepEqual(requests[0]?.diversity, { mode: "prefer", avoidRouteIds: ["route-implementation"] });
		assert.match(requests[0]?.task ?? "", /at most bounded ls\/read calls; do not use grep or find/u);
		assert.match(requests[0]?.task ?? "", /inspection tool errors, stop inspecting and submit a blocked result/u);
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

	it("[U][fixture-pi-0.84.1] creates one canonical mission from @orchestrator and keeps ordinary input unchanged", async () => {
		assert.deepEqual(parseOrchestratorInvocation("  @orchestrator  build a safe plan  "), { goal: "build a safe plan" });
		assert.deepEqual(parseOrchestratorInvocation("@orchestrator بررسی مسیر"), { goal: "بررسی مسیر" });
		assert.deepEqual(parseOrchestratorInvocation("@orchestrator"), { goal: "" });
		assert.equal(parseOrchestratorInvocation("What does @orchestrator mean?"), undefined);
		assert.equal(parseOrchestratorInvocation("\"@orchestrator goal\""), undefined);
		assert.equal(parseOrchestratorInvocation("```@orchestrator goal```"), undefined);
		assert.equal(parseOrchestratorInvocation(`@orchestrator ${"x".repeat(MAX_ROUTING_INPUT_LENGTH)}`), undefined);
		const root = await mkdtemp(join(tmpdir(), "pi-m12-entry-"));
		let entryId = 0;
		const store = createMissionStore({ root, id: () => `entry-${++entryId}` });
		try {
			const pi = piFixture();
			const host = createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: store });
			host.registerCommands();
			const notifications: string[] = [];
			const ctx = {
				cwd: "/private/tmp/pi-m12-entry-dogfood",
				isIdle: () => true,
				ui: { notify: (message: string) => notifications.push(message) },
			} as unknown as ExtensionContext;
			const handleInput = pi.inputHandlers[0];
			assert.ok(handleInput);

			assert.deepEqual(await handleInput({ type: "input", text: " @ORCHESTRATOR بررسی mixed مسیر", source: "interactive" }, ctx), { action: "handled" });
			const mission = store.listMissions()[0];
			assert.ok(mission);
			assert.equal(mission.goal, "بررسی mixed مسیر");
			assert.equal(mission.status, "draft");
			assert.equal(mission.repository.cwd, ctx.cwd);
			assert.equal(store.listMissions().length, 1);
			assert.deepEqual(pi.entries, [{ customType: "pi-multi-orchestrator:mission", data: { missionId: mission.missionId, status: "draft", revision: 1 } }]);
			assert.match(notifications[0] ?? "", /Mission created[\s\S]*Goal: بررسی mixed مسیر[\s\S]*Status: draft[\s\S]*Boss execution starting automatically/u);
			assert.doesNotMatch(notifications[0] ?? "", /add a Task/iu);
			assert.equal(mission.acceptanceCriteria.length > 0, true);

			assert.deepEqual(await handleInput({ type: "input", text: "What does @orchestrator mean?", source: "interactive" }, ctx), { action: "continue" });
			assert.deepEqual(await handleInput({ type: "input", text: "@orchestrator   ", source: "interactive" }, ctx), { action: "handled" });
			assert.match(notifications.at(-1) ?? "", /Add a goal after @orchestrator\./u);
			assert.deepEqual(await handleInput({ type: "input", text: "@orchestrator ignored extension input", source: "extension" }, ctx), { action: "continue" });
			assert.equal(store.listMissions().length, 1);

			const selections = ["Context & Mission Settings", "Create mission", "Back", "Back"];
			const inputs = ["Menu-created mission", "tests pass; review complete"];
			await pi.commands.get("orchestrator")!.handler("", {
				cwd: ctx.cwd,
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				ui: {
					select: async () => selections.shift(),
					input: async () => inputs.shift(),
					notify: (message: string) => notifications.push(message),
				},
			} as unknown as ExtensionCommandContext);
			const menuMission = store.listMissions()[1];
			assert.ok(menuMission, JSON.stringify({ selections, inputs, notifications, missions: store.listMissions().map((item) => item.goal) }));
			assert.equal(menuMission.goal, "Menu-created mission");
			assert.equal(menuMission.status, "draft");
			assert.deepEqual(menuMission.repository, { cwd: ctx.cwd });
			assert.deepEqual(menuMission.acceptanceCriteria, ["tests pass", "review complete"]);
			const menuNotice = notifications.find((message) => message.includes("Menu-created mission"));
			assert.match(menuNotice ?? "", /Next: open \/missions .* to add a Task/u);
		} finally {
			store.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[U][fixture-pi-0.84.1] keeps Smart Routing choices one-shot and preserves explicit mission entry", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-m12-smart-host-"));
		const missionRoot = join(root, "missions");
		const routingRoot = join(root, "routing");
		const store = createMissionStore({ root: missionRoot, id: () => "host-" + Date.now() + "-" + Math.random().toString(16).slice(2) });
		const smartRoutingStore = new SmartRoutingSettingsStore({ root: routingRoot });
		try {
			const pi = piFixture();
			const host = createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: store, smartRoutingStore });
			host.registerCommands();
			const notifications: string[] = [];
			const selections: Array<string | undefined> = ["Run as Mission", "Run Normally", undefined];
			const editorTexts: string[] = [];
			const ctx = {
				cwd: "/private/tmp/pi-m12-smart-host",
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				ui: {
					select: async () => selections.shift(),
					setEditorText: (value: string) => { editorTexts.push(value); },
					notify: (message: string) => { notifications.push(message); },
				},
			} as unknown as ExtensionContext;
			const handleInput = pi.inputHandlers[0];
			assert.ok(handleInput);
			const complexPrompt = "Fix the bug in src/auth.ts and add tests, then verify independently";

			assert.deepEqual(await handleInput({ type: "input", text: complexPrompt, source: "interactive" }, ctx), { action: "handled" });
			assert.equal(store.listMissions().length, 1);
			assert.equal(store.listMissions()[0]?.goal, complexPrompt);

			assert.deepEqual(await handleInput({ type: "input", text: complexPrompt, source: "interactive" }, ctx), { action: "continue" });
			assert.equal(store.listMissions().length, 1);

			assert.deepEqual(await handleInput({ type: "input", text: complexPrompt, source: "interactive" }, ctx), { action: "handled" });
			assert.deepEqual(editorTexts, [complexPrompt]);
			assert.ok(notifications.some((message) => /preserved|حفظ/u.test(message)));

			const busyCtx = { ...ctx, isIdle: () => false } as unknown as ExtensionContext;
			assert.deepEqual(await handleInput({ type: "input", text: "@orchestrator explicit busy goal", source: "interactive" }, busyCtx), { action: "handled" });
			assert.equal(store.listMissions().length, 2);
			assert.ok(store.listMissions().some((mission) => mission.goal === "explicit busy goal"));
		} finally {
			store.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[U][fixture-pi-0.84.1] does not commit a cancelled Smart Routing recommendation", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-m12-smart-cancel-"));
		const store = createMissionStore({ root: join(root, "missions") });
		try {
			const pi = piFixture();
			createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: store, smartRoutingStore: new SmartRoutingSettingsStore({ root: join(root, "routing") }) });
			const controller = new AbortController();
			controller.abort();
			let selections = 0;
			const handleInput = pi.inputHandlers[0];
			assert.ok(handleInput);
			const result = await handleInput({ type: "input", text: "Fix the bug in src/auth.ts and add tests, then verify independently", source: "interactive" }, {
				cwd: root,
				mode: "tui",
				hasUI: true,
				signal: controller.signal,
				isIdle: () => true,
				ui: { select: async () => { selections += 1; return "Run as Mission"; }, notify: () => {} },
			} as unknown as ExtensionContext);
			assert.deepEqual(result, { action: "continue" });
			assert.equal(store.listMissions().length, 0);
			assert.equal(selections, 0);

			const explicitStore = createMissionStore({ root: join(root, "explicit-missions") });
			try {
				const explicitPi = piFixture();
				createPiHost(explicitPi.pi, { manager: managerFixture(projection()), missionStore: explicitStore });
				const explicitResult = await explicitPi.inputHandlers[0]!({ type: "input", text: "@orchestrator explicit cancelled goal", source: "interactive" }, {
					cwd: root,
					mode: "tui",
					hasUI: true,
					signal: controller.signal,
					isIdle: () => true,
					ui: { notify: () => {} },
				} as unknown as ExtensionContext);
				assert.deepEqual(explicitResult, { action: "continue" });
				assert.equal(explicitStore.listMissions().length, 0);
			} finally {
				explicitStore.close();
			}
		} finally {
			store.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[U][fixture-pi-0.84.1] fences asynchronous routing-memory writes after cancellation", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-m12-smart-cancel-race-"));
		const store = createMissionStore({ root: join(root, "missions") });
		const memory = new RoutingMemoryStore({ root: join(root, "memory"), id: (() => { let id = 0; return () => `cancel-rule-${++id}`; })() });
		let observeStarted!: () => void;
		const observeStartedPromise = new Promise<void>((resolve) => { observeStarted = resolve; });
		let releaseObserve!: () => void;
		const observeGate = new Promise<void>((resolve) => { releaseObserve = resolve; });
		const originalObserve = memory.observeChoice.bind(memory);
		memory.observeChoice = (async (...args: Parameters<RoutingMemoryStore["observeChoice"]>) => {
			observeStarted();
			await observeGate;
			const mutation = await originalObserve(args[0], args[1]);
			await memory.addExplicitMissionRule("Always orchestrate concurrent routing updates", { id: "concurrent-routing-update" });
			return mutation;
		}) as RoutingMemoryStore["observeChoice"];
		const analytics = analyticsFixture();
		const notifications: string[] = [];
		const controller = new AbortController();
		try {
			const pi = piFixture();
			createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: store, smartRoutingStore: new SmartRoutingSettingsStore({ root: join(root, "routing") }), routingMemoryStore: memory, analyticsStore: analytics });
			const handleInput = pi.inputHandlers[0];
			assert.ok(handleInput);
			const pending = handleInput({ type: "input", text: "Fix the bug in src/auth.ts and add tests, then verify independently", source: "interactive" }, {
				cwd: root,
				mode: "tui",
				hasUI: true,
				signal: controller.signal,
				isIdle: () => true,
				ui: { select: async () => "Run as Mission", notify: (message: string) => notifications.push(message) },
			} as unknown as ExtensionContext);
			await observeStartedPromise;
			controller.abort();
			releaseObserve();
			assert.deepEqual(await pending, { action: "handled" });
			assert.equal(store.listMissions().length, 1);
			const views = await memory.listViews();
			assert.equal(views.some((rule) => rule.id === "concurrent-routing-update"), true);
			assert.ok(notifications.some((message) => message.includes("cancellation cleanup failed")));
			assert.equal(analytics.list().length, 4);
		} finally {
			store.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[U][fixture-pi-0.84.1] does not roll back over a pre-mutation routing-memory write", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-m12-smart-cancel-prewrite-"));
		const store = createMissionStore({ root: join(root, "missions") });
		const memory = new RoutingMemoryStore({ root: join(root, "memory"), id: (() => { let id = 0; return () => `cancel-prewrite-rule-${++id}`; })() });
		let observeStarted!: () => void;
		const observeStartedPromise = new Promise<void>((resolve) => { observeStarted = resolve; });
		let releaseObserve!: () => void;
		const observeGate = new Promise<void>((resolve) => { releaseObserve = resolve; });
		const originalObserve = memory.observeChoice.bind(memory);
		memory.observeChoice = (async (...args: Parameters<RoutingMemoryStore["observeChoice"]>) => {
			observeStarted();
			await observeGate;
			await memory.addExplicitMissionRule("Always orchestrate a pre-mutation concurrent update", { id: "pre-mutation-concurrent-update" });
			return originalObserve(args[0], args[1]);
		}) as RoutingMemoryStore["observeChoice"];
		const notifications: string[] = [];
		const controller = new AbortController();
		try {
			const pi = piFixture();
			createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: store, smartRoutingStore: new SmartRoutingSettingsStore({ root: join(root, "routing") }), routingMemoryStore: memory });
			const handleInput = pi.inputHandlers[0];
			assert.ok(handleInput);
			const pending = handleInput({ type: "input", text: "Fix the bug in src/auth.ts and add tests, then verify independently", source: "interactive" }, {
				cwd: root,
				mode: "tui",
				hasUI: true,
				signal: controller.signal,
				isIdle: () => true,
				ui: { select: async () => "Run as Mission", notify: (message: string) => notifications.push(message) },
			} as unknown as ExtensionContext);
			await observeStartedPromise;
			controller.abort();
			releaseObserve();
			assert.deepEqual(await pending, { action: "handled" });
			assert.equal((await memory.listViews()).some((rule) => rule.id === "pre-mutation-concurrent-update"), true);
			assert.ok(notifications.some((message) => message.includes("cancellation cleanup failed")));
		} finally {
			store.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[U][fixture-pi-0.84.1] learns Always, auto-missions strong matches, and suppresses repeated normal noise", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-m12-routing-memory-host-"));
		const missionRoot = join(root, "missions");
		try {
			const store = createMissionStore({ root: missionRoot, id: (() => { let id = 0; return () => `memory-mission-${++id}`; })() });
			const smartRoutingStore = new SmartRoutingSettingsStore({ root: join(root, "settings") });
			const routingMemoryStore = new RoutingMemoryStore({ root: join(root, "memory"), id: (() => { let id = 0; return () => `memory-rule-${++id}`; })(), now: () => "2026-08-14T00:00:00.000Z" });
			const pi = piFixture();
			createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: store, smartRoutingStore, routingMemoryStore });
			const selections: string[] = ["Always orchestrate similar tasks"];
			const notifications: string[] = [];
			const ctx = {
				cwd: "/private/tmp/pi-m12-routing-memory",
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				ui: {
					select: async () => selections.shift(),
					setEditorText: () => {},
					notify: (message: string) => notifications.push(message),
				},
			} as unknown as ExtensionContext;
			const handleInput = pi.inputHandlers[0];
			assert.ok(handleInput);
			const first = "Investigate the auth bug, fix the root cause, add tests, then verify independently";
			const similar = "Please diagnose the login problem, repair its cause, add regression tests, then verify independently";
			assert.deepEqual(await handleInput({ type: "input", text: first, source: "interactive" }, ctx), { action: "handled" });
			assert.equal(store.listMissions().length, 1);
			assert.equal((await routingMemoryStore.listViews()).filter((rule) => rule.source === "explicit").length, 1);
				assert.deepEqual(await handleInput({ type: "input", text: similar, source: "interactive" }, ctx), { action: "handled" });
				assert.equal(store.listMissions().length, 2);
				assert.equal(selections.length, 0, "strong explicit match must not ask for confirmation");
				assert.ok(notifications.some((message) => message.includes("saved rule")));
			assert.equal(JSON.stringify(await routingMemoryStore.listViews()).includes(first), false);

			const learnedRoot = join(root, "learned-mission");
			const learnedMissions = createMissionStore({ root: join(learnedRoot, "missions"), id: (() => { let id = 0; return () => `learned-mission-${++id}`; })() });
			const learnedSettings = new SmartRoutingSettingsStore({ root: join(learnedRoot, "settings") });
			const learnedMemory = new RoutingMemoryStore({ root: join(learnedRoot, "memory"), id: (() => { let id = 0; return () => `learned-rule-${++id}`; })(), now: () => "2026-08-14T00:00:00.000Z" });
			const learnedPi = piFixture();
			createPiHost(learnedPi.pi, { manager: managerFixture(projection()), missionStore: learnedMissions, smartRoutingStore: learnedSettings, routingMemoryStore: learnedMemory });
			const learnedSelections: string[] = ["Run as Mission", "Run as Mission", "Run as Mission"];
			const learnedCtx = { ...ctx, ui: { ...ctx.ui, select: async () => learnedSelections.shift() } } as unknown as ExtensionContext;
			const learnedHandler = learnedPi.inputHandlers[0];
			assert.ok(learnedHandler);
			for (let index = 0; index < 3; index += 1) assert.deepEqual(await learnedHandler({ type: "input", text: first, source: "interactive" }, learnedCtx), { action: "handled" });
			assert.equal((await learnedMemory.listViews()).find((rule) => rule.action === "mission" && rule.source === "learned")?.observations, 3);
				assert.deepEqual(await learnedHandler({ type: "input", text: similar, source: "interactive" }, learnedCtx), { action: "handled" });
				assert.equal(learnedMissions.listMissions().length, 4);
				assert.equal(learnedSelections.length, 0, "strong learned MISSION must auto-create one Mission");
				assert.ok(notifications.some((message) => message.includes("learned preference")));
			learnedMissions.close();

			const normalRoot = join(root, "normal");
			const normalMissions = createMissionStore({ root: join(normalRoot, "missions"), id: (() => { let id = 0; return () => `normal-mission-${++id}`; })() });
			const normalSettings = new SmartRoutingSettingsStore({ root: join(normalRoot, "settings") });
			const normalMemory = new RoutingMemoryStore({ root: join(normalRoot, "memory"), id: (() => { let id = 0; return () => `normal-rule-${++id}`; })(), now: () => "2026-08-14T00:00:00.000Z" });
			const normalPi = piFixture();
			createPiHost(normalPi.pi, { manager: managerFixture(projection()), missionStore: normalMissions, smartRoutingStore: normalSettings, routingMemoryStore: normalMemory });
			const normalSelections: string[] = ["Run Normally", "Run Normally", "Run Normally"];
			const normalCtx = { ...ctx, ui: { ...ctx.ui, select: async () => normalSelections.shift() } } as unknown as ExtensionContext;
			const normalHandler = normalPi.inputHandlers[0];
			assert.ok(normalHandler);
			const borderline = "Take a look at this feature; something feels wrong sometimes. Clean it up if needed.";
			for (let index = 0; index < 3; index += 1) assert.deepEqual(await normalHandler({ type: "input", text: borderline, source: "interactive" }, normalCtx), { action: "continue" });
			assert.equal((await normalMemory.listViews()).filter((rule) => rule.source === "learned" && rule.action === "normal").length, 1);
			assert.deepEqual(await normalHandler({ type: "input", text: borderline, source: "interactive" }, normalCtx), { action: "continue" });
			assert.equal(normalSelections.length, 0, "strong learned NORMAL must bypass the banner");
			const risky = "Investigate the production payment bug, fix it, add rollback tests, and verify independently";
			normalSelections.push("Run Normally");
			assert.deepEqual(await normalHandler({ type: "input", text: risky, source: "interactive" }, normalCtx), { action: "continue" });
			assert.equal(normalSelections.length, 0, "complexity escalation must not use a simple learned NORMAL rule");
			normalMissions.close();
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[U][fixture-pi-0.84.1] requeues explicit input after missing or failing mission storage", async () => {
		const notify = (): void => {};
		const missingPi = piFixture();
		const missingHost = createPiHost(missingPi.pi, { manager: managerFixture(projection()) });
		const missingHandler = missingPi.inputHandlers[0];
		assert.ok(missingHandler);
		const missingEditor: string[] = [];
		const missingCtx = { cwd: "/private/tmp/pi-m12-missing-store", mode: "tui", hasUI: true, isIdle: () => true, ui: { notify, setEditorText: (value: string) => missingEditor.push(value) } } as unknown as ExtensionContext;
		assert.deepEqual(await missingHandler({ type: "input", text: "@orchestrator recover this", source: "interactive" }, missingCtx), { action: "handled" });
		assert.deepEqual(missingEditor, ["@orchestrator recover this"]);
		assert.deepEqual(missingPi.sentUserMessages, []);

		const failingPi = piFixture();
		const failingStore = { createMission: () => { throw new Error("fixture store failure"); } } as unknown as MissionStoreAdapter;
		createPiHost(failingPi.pi, { manager: managerFixture(projection()), missionStore: failingStore });
		const failingHandler = failingPi.inputHandlers[0];
		assert.ok(failingHandler);
		const failingEditor: string[] = [];
		const failingCtx = { cwd: "/private/tmp/pi-m12-failing-store", mode: "tui", hasUI: true, isIdle: () => true, ui: { notify, setEditorText: (value: string) => failingEditor.push(value) } } as unknown as ExtensionContext;
		assert.deepEqual(await failingHandler({ type: "input", text: "@orchestrator retry after store error", source: "interactive" }, failingCtx), { action: "handled" });
		assert.deepEqual(failingEditor, ["@orchestrator retry after store error"]);
		assert.deepEqual(failingPi.sentUserMessages, []);
	});

	it("[U][fixture-pi-0.84.1] exposes Smart Routing settings inside the existing Routing & Fallback section", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-m12-routing-settings-"));
		try {
			const configStore = new ConfigStore({ root: join(root, "config") });
			await configStore.initialize(createDefaultConfig());
			const smartRoutingStore = new SmartRoutingSettingsStore({ root: join(root, "smart-routing") });
			const pi = piFixture();
			const host = createPiHost(pi.pi, { manager: managerFixture(projection()), configStore, smartRoutingStore });
			host.registerCommands();
			const calls: Array<{ title: string; options: readonly string[] }> = [];
			const rootSelections: Array<string | undefined> = ["Routing & Fallback", "Back"];
			let routingSettingsCalls = 0;
			await pi.commands.get("orchestrator")!.handler("", {
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				ui: {
					select: async (title: string, options: readonly string[]) => {
						calls.push({ title, options });
						if (title === "Pi Multi-Orchestrator") return rootSelections.shift();
						if (title === "Routing & Fallback" && routingSettingsCalls++ === 0) {
							assert.ok(options.some((option) => option === "Triage Primary (None)"));
							assert.equal(options.some((option) => option.includes("route-a")), false);
							return "Triage Primary (None)";
						}
						if (title === "Triage Primary route") {
							assert.deepEqual(options, ["None", "remote-a", "Back"]);
							return "remote-a";
						}
						return "Back";
					},
					notify: () => {},
				},
			} as unknown as ExtensionCommandContext);
			const settings = calls.find((call) => call.title === "Routing & Fallback");
			assert.ok(settings);
			assert.ok(settings.options.some((option) => option.startsWith("Smart Routing (ON)")));
			assert.ok(settings.options.includes("AI usage (ambiguous prompts only)"));
			assert.equal((await smartRoutingStore.load()).settings.primaryRouteId, "route-a");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[U][fixture-pi-0.84.1][M10] fails closed when Smart Routing settings are corrupt", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-m12-routing-corrupt-"));
		try {
			const smartRoutingStore = new SmartRoutingSettingsStore({ root: join(root, "smart-routing") });
			await smartRoutingStore.initialize();
			await writeFile(join(root, "smart-routing", "smart-routing.json"), "{", "utf8");
			const pi = piFixture();
			const host = createPiHost(pi.pi, { manager: managerFixture(projection()), smartRoutingStore });
			const notifications: string[] = [];
			const result = await pi.inputHandlers[0]!({ type: "input", text: "Fix the bug and add tests, then verify independently", source: "interactive" }, {
				mode: "tui", hasUI: true, isIdle: () => true, ui: { notify: (message: string) => notifications.push(message) },
			} as unknown as ExtensionContext);
			assert.deepEqual(result, { action: "continue" });
			assert.equal(notifications.length, 0);
			host.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[U][fixture-pi-0.84.1] labels direct verification workers separately from canonical M7 verification", async () => {
		const pi = piFixture();
		const requests: SubagentExecutionRequest[] = [];
		const result: SubagentRunResult = {
			protocolVersion: 1,
			runId: "direct-run",
			roleId: "debugger",
			poolId: "verification",
			terminalStatus: "completed",
			attempts: [],
			potentialMutationObserved: false,
			fallbackCount: 0,
			summary: "direct worker complete",
		};
		const executor = {
			run: async (request: SubagentExecutionRequest): Promise<SubagentRunResult> => {
				requests.push(request);
				return result;
			},
		} as unknown as SubagentExecutor;
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), subagentExecutor: executor });
		host.registerCommands();
		const notifications: string[] = [];
		const selections = ["Direct Verification Worker (verification)"];
		const inputs = ["quality-check", "Inspect the bounded result"];
		await pi.commands.get("subagent-run")!.handler("", {
			cwd: "/private/tmp/pi-m12-entry-dogfood",
			mode: "tui",
			hasUI: true,
			isIdle: () => true,
			ui: {
				select: async () => selections.shift(),
				input: async () => inputs.shift(),
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionCommandContext);
		assert.equal(requests[0]?.poolId, "verification");
		assert.ok(notifications.some((message) => message.includes("Direct Verification Worker")));
		assert.ok(notifications.some((message) => message.includes("does not create a canonical Mission task, M7 verification run")));
		assert.ok(notifications.some((message) => message.includes("Direct Worker completed") && message.includes("No canonical Mission task")));
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
		assert.deepEqual(titles, ["Pi Multi-Orchestrator", "Context & Mission Settings", "Pi Multi-Orchestrator"]);
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

	it("[RC22][U/TUI][fixture-pi-0.84.1] uses clean canonical labels for Investigation and Verification add-route selectors", async () => {
		const pools = emptyPoolCandidateFixture();
		const pi = piFixture();
		const host = createPiHost(pi.pi, { manager: managerFixture(projection()), poolManager: pools });
		host.registerCommands();
		for (const poolId of ["investigation", "verification"] as const) {
			let editorOpen = true;
			await pi.commands.get("pool-models")!.handler(poolId, {
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				ui: {
					select: async (title: string, options: readonly string[]) => {
						if (title === `${poolId[0]!.toUpperCase()}${poolId.slice(1)} Pool`) {
							if (editorOpen) {
								editorOpen = false;
								assert.ok(options.includes("No routes assigned."));
								return "Add Route";
							}
							return undefined;
						}
						assert.equal(title, `Add route to ${poolId[0]!.toUpperCase()}${poolId.slice(1)} Pool`);
						assert.deepEqual(options, ["ag/foo"]);
						assert.equal(options.some((option) => /r9-ninerouter|ag\/foo — ag\/foo|ACTIVE|Thinking/iu.test(option)), false);
						return "ag/foo";
					},
					notify: () => {},
				},
			} as unknown as ExtensionCommandContext);
		}
		assert.deepEqual(pools.added, [
			{ poolId: "investigation", routeId: "r9-ninerouter-ag-foo-1234567890abcdef" },
			{ poolId: "verification", routeId: "r9-ninerouter-ag-foo-1234567890abcdef" },
		]);
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
		const selections = ["remote-a", "Move Down", "Back"];
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
			"remote-a",
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
			"remote-a",
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
						if (healthSelection === 1) return options.find((option) => option.startsWith("remote-a"));
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

	it("[U][RC26] @orchestrator and Smart Routing Run as Mission enter the same canonical Boss loop", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-rc26-entry-"));
		const store = createMissionStore({ root: join(root, "missions"), id: () => `rc26-${Date.now()}-${Math.random().toString(16).slice(2)}` });
		const smartRoutingStore = new SmartRoutingSettingsStore({ root: join(root, "routing") });
		const routingMemoryStore = new RoutingMemoryStore({ root: join(root, "memory"), id: (() => { let id = 0; return () => `rc26-rule-${++id}`; })(), now: () => "2026-08-15T00:00:00.000Z" });
		const configStore = new ConfigStore({ root: join(root, "config") });
		try {
			await configStore.initialize(createDefaultConfig());
			const pi = piFixture();
			const host = createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: store, smartRoutingStore, routingMemoryStore, configStore });
			host.registerCommands();
			const notifications: string[] = [];
			const selections = ["Run as Mission", "Always orchestrate similar tasks"];
			const ctx = {
				cwd: "/private/tmp/pi-rc26-entry",
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				ui: {
					select: async () => selections.shift(),
					notify: (message: string) => notifications.push(message),
				},
			} as unknown as ExtensionContext;
			const handleInput = pi.inputHandlers[0];
			assert.ok(handleInput);

			assert.deepEqual(await handleInput({ type: "input", text: "@orchestrator prove shared goal loop", source: "interactive" }, ctx), { action: "handled" });
			const explicit = store.listMissions()[0];
			assert.ok(explicit);
			assert.equal(explicit.goal, "prove shared goal loop");
			assert.notEqual(explicit.status, "completed");

			const complexPrompt = "Fix the bug in src/auth.ts and add tests, then verify independently";
			assert.deepEqual(await handleInput({ type: "input", text: complexPrompt, source: "interactive" }, ctx), { action: "handled" });
			const similar = "Please repair the login bug in src/auth.ts, add regression tests, then verify independently";
			assert.deepEqual(await handleInput({ type: "input", text: similar, source: "interactive" }, ctx), { action: "handled" });
			assert.deepEqual(await handleInput({ type: "input", text: similar, source: "interactive" }, ctx), { action: "handled" });
			assert.equal(store.listMissions().length, 4);
			assert.ok(notifications.some((message) => message.includes("saved rule") || message.includes("learned preference") || /Routed to Mission/u.test(message)));
			const runtimeNotices = notifications.filter((message) => /canonical Boss runtime is unavailable/u.test(message));
			assert.equal(runtimeNotices.length, 4);
			assert.equal(new Set(runtimeNotices).size, 1);
			assert.equal(store.listMissions().every((mission) => mission.status !== "completed"), true);
		} finally {
			store.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[U][RC27] @orchestrator bootstraps Goal criteria and does not ask the user to add a Task", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-rc27-entry-"));
		const store = createMissionStore({ root, id: () => `rc27-${Date.now()}-${Math.random().toString(16).slice(2)}` });
		try {
			const pi = piFixture();
			const host = createPiHost(pi.pi, { manager: managerFixture(projection()), missionStore: store });
			host.registerCommands();
			const notifications: string[] = [];
			const ctx = {
				cwd: "/private/tmp/pi-rc27-entry",
				isIdle: () => true,
				ui: { notify: (message: string) => notifications.push(message) },
			} as unknown as ExtensionContext;
			const handleInput = pi.inputHandlers[0];
			assert.ok(handleInput);
			const goal = "Perform a bounded docs-only repository task.\n\nMission acceptance criteria:\n- docs mention the loop\n- no production code changes";
			assert.deepEqual(await handleInput({ type: "input", text: `@orchestrator ${goal}`, source: "interactive" }, ctx), { action: "handled" });
			const mission = store.listMissions()[0];
			assert.ok(mission);
			assert.deepEqual(mission.acceptanceCriteria, ["docs mention the loop", "no production code changes"]);
			assert.equal(store.listTasks(mission.missionId).length, 0);
			assert.match(notifications[0] ?? "", /Boss execution starting automatically/u);
			assert.doesNotMatch(notifications.join("\n"), /add a Task/iu);
		} finally {
			store.close();
			await rm(root, { recursive: true, force: true });
		}
	});
});
