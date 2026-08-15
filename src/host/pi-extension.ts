import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	ModelRuntime,
	ProviderConfig,
	ProviderModelConfig,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { ModelRuntime as RuntimeModelRuntime } from "@earendil-works/pi-coding-agent";
import { createDefaultConfig } from "../core/config/defaults.js";
import type { SecretRefV1, StableId } from "../core/config/types.js";
import { ConfigStore } from "../core/config/store.js";
import { HealthStore, type RouteHealthRecord } from "../core/health/index.js";
import {
	previewRouting,
	type RouteAvailability,
	type RoutingCandidate,
	type RoutingPolicy,
	type RoutingDecision,
} from "../core/routing/index.js";
import {
	createPoolManager,
	PoolManagerError,
	POOL_IDS,
	type PoolEntryView as CorePoolEntryView,
	type PoolId,
	type PoolRouteCandidate,
	type PoolView as CorePoolView,
} from "../core/pools/index.js";

import {
	createNineRouterManager,
	NINEROUTER_PROVIDER_ID as DOMAIN_NINEROUTER_PROVIDER_ID,
	NineRouterError,
	NineRouterManagerError,
	SecretResolutionError,
	type CatalogRow,
	type ProviderProjection,
} from "../core/ninerouter/index.js";
import {
	createSubagentExecutor,
	WorkerError,
	 type ResultProtocolSpec,
	 type SubagentExecutionRequest,
	 type SubagentExecutor,
	 type SubagentRunResult,
	 type RouteAttemptAdapter,
	type ResolvedWorkerRoute,
} from "../core/workers/index.js";
import type { FailureClassification, RoutingRequest } from "../core/routing/index.js";
import type {
	EvidenceRecord,
	MissionId,
	MissionRecord,
	MissionStatus,
	MissionStoreAdapter,
} from "../core/mission/types.js";
import { createCanonicalMission, createMissionStore } from "../core/mission/index.js";
import { executeMissionTask } from "../core/mission/index.js";
import { ContextBroker, missionStoreContextRepository, renderTaskPacketPrompt, type TaskPacketV1 } from "../core/context/index.js";
import { createVerificationResultProtocol, QualityError, QualityService, type QualityPersistence, type TaskQualityStatus, type VerificationRunRecord } from "../core/quality/index.js";
import {
	AnalyticsQueryService,
	RecommendationApplicationService,
	RecommendationEngine,
	SQLiteAnalyticsStore,
	RecommendationAnalystService,
	createRecommendationAnalyst,
	type AnalystPacket,
	type AnalystRoute,
	type AnalyticsEventV1,
	type AnalyticsRoutingTelemetryV1,
	type AnalyticsRange,
	type AnalyticsStoreAdapter,
} from "../core/analytics/index.js";
import { TrustStore, PathSafetyPolicy, SecretSanitizer, getCapabilityMatrix } from "../core/security/index.js";
import { PACKAGE_INFO } from "../core/package-info.js";
import {
	SmartRouter,
	SmartRoutingSettingsStore,
	createDefaultSmartRoutingSettings,
	buildTriagePrompt,
	TriageCapabilityError,
	TRIAGE_SYSTEM_PROMPT,
	formatRoutingReasons,
	parseTriageResult,
	containsPersian,
	analyzeLocalSignals,
	MAX_ROUTING_INPUT_LENGTH,
	type SmartRoutingDecision,
	type SmartRoutingContext,
	type SmartRoutingSettings,
	type TriageClient,
} from "../core/smart-routing/index.js";
import { buildRoutingSignature, RoutingMemoryStore } from "../core/routing-memory/index.js";

export const NINEROUTER_PROVIDER_ID = DOMAIN_NINEROUTER_PROVIDER_ID;

type MaybePromise<T> = T | Promise<T>;

interface RoutingMemoryHostAdapter {
	match(signature: unknown): MaybePromise<unknown>;
	addExplicitMissionRule(signature: unknown, options?: { readonly signal?: AbortSignal }): MaybePromise<unknown>;
	observeChoice(signature: unknown, action: "mission" | "normal", options?: { readonly signal?: AbortSignal }): MaybePromise<unknown>;
	listViews(): MaybePromise<readonly unknown[]>;
	setEnabled(ruleId: string, enabled: boolean): MaybePromise<unknown>;
	deleteRule(ruleId: string): MaybePromise<unknown>;
	forgetLearned(): MaybePromise<unknown>;
	reset(): MaybePromise<unknown>;
	backup(destinationPath?: string): Promise<string>;
	restore(backupPath: string, options?: { readonly expectedGeneration?: number }): MaybePromise<unknown>;
}

interface RoutingMemoryRollback {
	rollback(expectedGeneration: number): Promise<void>;
	dispose(): Promise<void>;
}

const routingMemoryRecord = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

interface PoolEntryView extends CorePoolEntryView {
	readonly projectedPiAvailable?: boolean;
	readonly actualPiAvailable?: boolean;
}

interface PoolView extends Omit<CorePoolView, "entries"> {
	readonly entries: readonly PoolEntryView[];
}

export interface PoolManagerContract {
	listPools(): MaybePromise<readonly CorePoolView[]>;
	getPool(poolId: PoolId): MaybePromise<CorePoolView>;
	getAvailableCandidatesToAdd(poolId: PoolId, filter?: string): MaybePromise<readonly PoolRouteCandidate[]>;
	addRoute(poolId: PoolId, routeId: StableId): MaybePromise<unknown>;
	removeRoute(poolId: PoolId, routeId: StableId): MaybePromise<unknown>;
	moveRouteUp(poolId: PoolId, routeId: StableId): MaybePromise<unknown>;
	moveRouteDown(poolId: PoolId, routeId: StableId): MaybePromise<unknown>;
	moveRoute(poolId: PoolId, routeId: StableId, targetIndex: number): MaybePromise<unknown>;
	setPoolEntryEnabled(poolId: PoolId, routeId: StableId, enabled: boolean): MaybePromise<unknown>;
}

export type RecommendationAnalystMode = "deterministic" | "ai-assisted";

export interface RecommendationAnalystSettings {
	readonly mode: RecommendationAnalystMode;
	readonly routeId?: string;
}

export interface RecommendationAnalystRoute {
	readonly routeId: string;
	readonly displayName?: string;
	readonly remoteModelId?: string;
	readonly enabled?: boolean;
	readonly available?: boolean;
}

export interface RecommendationAnalystStatus {
	readonly state: "idle" | "running" | "completed" | "failed";
	readonly mode?: RecommendationAnalystMode;
	readonly routeId?: string;
	readonly lastAnalysisAt?: string;
	readonly recommendationCount?: number;
	readonly message?: string;
}

/**
 * Optional host adapter for the M8.5 analyst. The host only invokes `analyze`
 * after an explicit user action; it never schedules analysis or applies a
 * recommendation. The domain owns persistence and deterministic/AI policy.
 */
export interface RecommendationAnalystContract {
	getSettings(): MaybePromise<RecommendationAnalystSettings>;
	getStatus(): MaybePromise<RecommendationAnalystStatus>;
	listVerificationRoutes(): MaybePromise<readonly RecommendationAnalystRoute[]>;
	analyze(request: { readonly mode: RecommendationAnalystMode; readonly routeId: string }): MaybePromise<RecommendationAnalystStatus | unknown>;
}

export interface ModelManagerEntry {
	readonly remoteModelId: string;
	readonly routeId?: string;
	readonly displayName?: string;
	readonly enabled?: boolean;
	readonly available?: boolean;
	readonly stale?: boolean;
	readonly missing?: boolean;
	readonly sourceLabel?: string;
	readonly capability?: string;
	readonly status?: string;
	readonly warning?: string;
}


/** The narrow manager surface consumed by the host. Keep domain details out of Pi callbacks. */
export interface PiManagerContract {
	list(filter?: string): MaybePromise<readonly (CatalogRow | ModelManagerEntry)[]>;
	loadStatus(): MaybePromise<unknown>;
	refresh(signal?: AbortSignal): MaybePromise<unknown>;
	configure(baseUrl: string, credentialRef?: SecretRefV1 | string): MaybePromise<unknown>;
	setEnabled(
		remoteModelId: string,
		enabled: boolean,
		options?: { readonly activeRemoteModelId?: string },
	): MaybePromise<unknown>;
	providerProjection(): MaybePromise<ProviderProjection | undefined>;
}

export interface PiHostOptions {
	readonly manager: PiManagerContract;
	/** Existing Pi provider catalog, when the runtime has bound its model registry. */
	readonly providerRegistry?: PiProviderRegistry;
	readonly poolManager?: PoolManagerContract;
	readonly configStore?: ConfigStore;
	readonly healthStore?: HealthStore;
	/** Optional canonical mission store. The host never mirrors canonical state in Pi history. */
	readonly missionStore?: MissionStoreAdapter;
	readonly contextBroker?: ContextBroker;
	/** Optional quality persistence/service. Defaults to the mission store when present. */
	readonly qualityStore?: QualityPersistence;
	readonly qualityService?: QualityService;
	readonly qualityExecutor?: SubagentExecutor;
	readonly providerId?: string;
	readonly subagentExecutor?: SubagentExecutor;
	readonly analyticsStore?: AnalyticsStoreAdapter;
	readonly recommendationAnalyst?: RecommendationAnalystContract;
	readonly smartRoutingStore?: SmartRoutingSettingsStore;
	readonly routingMemoryStore?: RoutingMemoryStore;
	readonly triageClient?: TriageClient;
	/** Local-only project trust state; never part of portable ConfigStore data. */
	readonly trustStore?: TrustStore;
}

export interface PiProviderRegistry {
	getProvider(providerId: string): unknown;
}

export interface ReconcileResult {
	readonly changed: boolean;
	readonly registered: boolean;
	readonly modelCount: number;
	readonly error?: Error;
}

export interface PiHost {
	readonly manager: PiManagerContract;
	readonly poolManager: PoolManagerContract;
	readonly healthStore?: HealthStore;
	readonly missionStore?: MissionStoreAdapter;
	readonly contextBroker?: ContextBroker;
	readonly qualityStore?: QualityPersistence;
	readonly qualityService?: QualityService;
	readonly analyticsStore?: AnalyticsStoreAdapter;
	readonly recommendationAnalyst?: RecommendationAnalystContract;
	readonly smartRoutingStore?: SmartRoutingSettingsStore;
	readonly routingMemoryStore?: RoutingMemoryStore;
	readonly trustStore?: TrustStore;
	readonly qualityExecutor?: SubagentExecutor;
	reconcile(): Promise<ReconcileResult>;
	setProviderRegistry(registry: PiProviderRegistry): void;
	registerCommands(): void;
	dispose(): void;
}

const SUBAGENT_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	properties: {
		role: { type: "string", minLength: 1, maxLength: 160 },
		pool: { type: "string", enum: [...POOL_IDS] },
		task: { type: "string", minLength: 1, maxLength: 32_000 },
		acceptanceCriteria: { type: "array", maxItems: 16, items: { type: "string", maxLength: 1_000 } },
		timeoutMs: { type: "integer", minimum: 1, maximum: 86_400_000 },
	},
	required: ["role", "pool", "task"],
} as unknown;

const ANALYST_RESULT_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	properties: {
		verdict: { type: "string", enum: ["support", "oppose", "insufficient_evidence"] },
		suggestedMove: { type: "string", maxLength: 160 },
		reasoningFactors: { type: "array", maxItems: 16, items: { type: "string", maxLength: 512 } },
		caveats: { type: "array", maxItems: 16, items: { type: "string", maxLength: 512 } },
		explanation: { type: "string", maxLength: 1_000 },
	},
	required: ["verdict", "explanation"],
} as unknown;

const createAnalystResultProtocol = (_request: SubagentExecutionRequest): ResultProtocolSpec => {
	return {
		toolName: "submit_recommendation_analysis",
		parameters: ANALYST_RESULT_PARAMETERS as ToolDefinition["parameters"],
	};
};

const errorMessage = (error: unknown): string =>
	error instanceof NineRouterError
		? error.toJSON().message
		: error instanceof NineRouterManagerError || error instanceof SecretResolutionError || error instanceof PoolManagerError || error instanceof WorkerError
				? error.message
			: error instanceof QualityError
				? error.message
			: "operation unavailable";

const safeStatusLine = (status: unknown): string => {
	if (status === undefined || status === null) return "status: unknown";
	if (typeof status === "string" || typeof status === "number" || typeof status === "boolean") {
		return `status: ${String(status)}`;
	}
	if (typeof status !== "object") return "status: unknown";
	const candidate = status as Record<string, unknown>;
	const state = typeof candidate.state === "string" ? candidate.state : undefined;
	const configured = typeof candidate.configured === "boolean" ? candidate.configured : undefined;
	const gateway = typeof candidate.gateway === "string" ? candidate.gateway : undefined;
	const cache = typeof candidate.cache === "string" ? candidate.cache : undefined;
	const count = typeof candidate.catalogEntries === "number" ? candidate.catalogEntries : typeof candidate.catalogCount === "number" ? candidate.catalogCount : undefined;
	const enabled = typeof candidate.enabledRoutes === "number" ? candidate.enabledRoutes : typeof candidate.enabledCount === "number" ? candidate.enabledCount : undefined;
	const registered = typeof candidate.registeredModels === "number" ? candidate.registeredModels : undefined;
	const missing = typeof candidate.missingEnabledRoutes === "number" ? candidate.missingEnabledRoutes : undefined;
	const lastSuccess = typeof candidate.lastSuccessfulRefresh === "string" ? candidate.lastSuccessfulRefresh : undefined;
	const lastError = candidate.lastError && typeof candidate.lastError === "object" && typeof (candidate.lastError as Record<string, unknown>).kind === "string"
		? (candidate.lastError as Record<string, unknown>).kind as string
		: undefined;
	const pieces = [
		state ? `state=${state}` : undefined,
		configured === undefined ? undefined : `configured=${configured}`,
		gateway ? `gateway=${gateway}` : undefined,
		cache ? `cache=${cache}` : undefined,
		count === undefined ? undefined : `catalog=${count}`,
		enabled === undefined ? undefined : `enabled=${enabled}`,
		registered === undefined ? undefined : `registered=${registered}`,
		missing === undefined ? undefined : `missing=${missing}`,
		lastSuccess ? `last-success=${lastSuccess}` : undefined,
		lastError ? `last-error=${lastError}` : undefined,
	].filter(
		(value): value is string => value !== undefined,
	);
	return pieces.length > 0 ? pieces.join(" ") : "status: available";
};

const modelLabel = (entry: ModelManagerEntry): string => {
	const enabled = entry.enabled ? "[x]" : "[ ]";
	const state = entry.missing ? " ! missing" : entry.stale ? " ! stale" : entry.available === false ? " ! unavailable" : "";
	const ambiguity = entry.status === "ambiguous" ? " ! ambiguous" : "";
	const display = entry.displayName && entry.displayName !== entry.remoteModelId ? ` — ${entry.displayName}` : "";
	const route = entry.routeId ? ` (${entry.routeId})` : "";
	return `${enabled} ${entry.remoteModelId}${display}${route}${state}${ambiguity}`;
};

const poolLabels: Record<PoolId, string> = {
	investigation: "Investigation",
	implementation: "Implementation",
	verification: "Verification",
};

const directWorkerLabels: Record<PoolId, string> = {
	investigation: "Direct Investigation Worker",
	implementation: "Direct Implementation Worker",
	verification: "Direct Verification Worker",
};

export const parseOrchestratorInvocation = (text: string): { readonly goal: string } | undefined => {
	if (typeof text !== "string" || text.length > MAX_ROUTING_INPUT_LENGTH) return undefined;
	const match = /^\s*@orchestrator(?:\s+([\s\S]*))?\s*$/iu.exec(text);
	return match ? { goal: (match[1] ?? "").trim() } : undefined;
};

const isPoolId = (value: string): value is PoolId => (POOL_IDS as readonly string[]).includes(value);

const poolEntryState = (entry: PoolEntryView): string =>
	!entry.globalEnabled
		? "global-disabled"
		: !entry.poolEnabled
			? "pool-disabled"
			: entry.projectedPiAvailable === false || entry.actualPiAvailable === false
				? "provider-unavailable"
				: entry.state;

const poolEntryLabel = (entry: PoolEntryView): string => {
	return `${entry.index + 1}. ${entry.displayName} — ${entry.remoteModelId} [${poolEntryState(entry).toUpperCase()}] (${entry.routeId})`;
};

const poolCandidateLabel = (entry: PoolRouteCandidate): string =>
	`${entry.displayName} — ${entry.remoteModelId} [${entry.state.toUpperCase()}] (${entry.routeId})`;

const routeAvailability = (entry: PoolEntryView): RouteAvailability => {
	if (entry.state === "missing") return "missing";
	if (entry.catalogState === "stale") return "stale";
	if (entry.state === "provider-unavailable" || entry.projectedPiAvailable === false || entry.actualPiAvailable === false) return "unavailable";
	if (entry.state === "unknown" || entry.presentInCatalog === false) return "unknown";
	return "available";
};

const emptyPoolView = (poolId: PoolId): CorePoolView => ({
	id: poolId,
	poolId,
	label: poolLabels[poolId],
	entries: [],
});

const emptyPoolManager = (): PoolManagerContract => ({
	listPools: async () => POOL_IDS.map(emptyPoolView),
	getPool: async (poolId) => emptyPoolView(poolId),
	getAvailableCandidatesToAdd: async () => [],
	addRoute: async () => { throw new Error("pool manager unavailable"); },
	removeRoute: async () => { throw new Error("pool manager unavailable"); },
	moveRouteUp: async () => { throw new Error("pool manager unavailable"); },
	moveRouteDown: async () => { throw new Error("pool manager unavailable"); },
	moveRoute: async () => { throw new Error("pool manager unavailable"); },
	setPoolEntryEnabled: async () => { throw new Error("pool manager unavailable"); },
});

const ANALYTICS_SECTIONS = [
	"Overview",
	"Missions",
	"Pools",
	"Routes",
	"Tokens",
	"Cost",
	"Quality",
	"Fallbacks",
	"Recommendations",
	"Recommendation Analyst",
] as const;

type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];

const ANALYTICS_WINDOWS = ["Last 24 hours", "Last 7 days", "Last 30 days", "All time", "Custom range"] as const;

const unknownMetric = (value: unknown): string => value === undefined || value === null ? "UNKNOWN" : String(value);

const successRate = (successes: number, runs: number): string => runs > 0 ? `${Math.round((successes / runs) * 1000) / 10}%` : "UNKNOWN (no runs)";

const analyticsWindowLabel = (range?: AnalyticsRange): string => {
	if (!range?.from && !range?.to) return "All time";
	if (range.from && range.to) return `${range.from} → ${range.to}`;
	return range.from ? `since ${range.from}` : `through ${range.to}`;
};

const analyticsSection = (value: string | undefined): AnalyticsSection | undefined => {
	const normalized = value?.trim().toLocaleLowerCase();
	return ANALYTICS_SECTIONS.find((section) => section.toLocaleLowerCase() === normalized);
};

const analyticsWindow = (value: string | undefined): "24h" | "7d" | "30d" | "all" | undefined => {
	switch (value?.trim().toLocaleLowerCase()) {
		case "24h":
		case "last 24 hours":
			return "24h";
		case "7d":
		case "last 7 days":
			return "7d";
		case "30d":
		case "last 30 days":
			return "30d";
		case "all":
		case "all time":
			return "all";
		default:
			return undefined;
	}
};

const analyticsRangeForWindow = (window: "24h" | "7d" | "30d" | "all", now = Date.now()): AnalyticsRange | undefined => {
	if (window === "all") return undefined;
	const days = window === "24h" ? 1 / 24 : window === "7d" ? 7 : 30;
	return { from: new Date(now - days * 86_400_000).toISOString() };
};

const analyticsMapLines = (
	label: string,
	buckets: Readonly<Record<string, { readonly runs: number; readonly successes: number; readonly failures: number; readonly fallbacks: number; readonly tokens: number; readonly durationMs: number }>> | undefined,
): string[] => {
	const entries = Object.entries(buckets ?? {}).sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) return [`${label}: UNKNOWN (no identifiers were reported)`];
	return [
		`${label}: ${entries.length}`,
		...entries.map(([id, bucket]) => `${id}: runs=${bucket.runs} success=${bucket.successes} (${successRate(bucket.successes, bucket.runs)}) failures=${bucket.failures} fallbacks=${bucket.fallbacks} tokens=${bucket.tokens} latency-ms=${bucket.durationMs}`),
	];
};

const analyticsQualityLines = (
	label: string,
	buckets: Readonly<Record<string, { readonly observations: number; readonly passes: number; readonly rejects: number; readonly blocked: number; readonly firstPass: number; readonly repairRounds: number }>> | undefined,
): string[] => {
	const entries = Object.entries(buckets ?? {}).sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) return [`${label}: UNKNOWN (no quality observations were reported)`];
	return [
		`${label}: ${entries.length}`,
		...entries.map(([id, bucket]) => `${id}: observations=${bucket.observations} pass=${bucket.passes} reject=${bucket.rejects} blocked=${bucket.blocked} first-pass=${bucket.firstPass} repair-rounds=${bucket.repairRounds}`),
	];
};

/** Normalize the domain CatalogRow shape while allowing focused host fakes to use the compact shape. */
const normalizeModelEntry = (value: unknown): ModelManagerEntry | undefined => {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.remoteModelId === "string") {
		if (candidate.entry && typeof candidate.entry === "object") {
			const nested = candidate.entry as Record<string, unknown>;
			if (typeof candidate.capability !== "string" && typeof nested.capability === "string") {
				return { ...candidate, capability: nested.capability } as unknown as ModelManagerEntry;
			}
		}
		return candidate as unknown as ModelManagerEntry;
	}
	if (!candidate.entry || typeof candidate.entry !== "object") return undefined;
	const remote = candidate.entry as Record<string, unknown>;
	if (typeof remote.remoteId !== "string") return undefined;
	const status = typeof candidate.status === "string" ? candidate.status : undefined;
	return {
		remoteModelId: remote.remoteId,
		enabled: candidate.enabled === true,
		available: typeof candidate.available === "boolean" ? candidate.available : status !== "missing" && status !== "stale",
		stale: candidate.stale === true || status === "stale",
		missing: candidate.missing === true || status === "missing",
		...(typeof remote.displayName === "string" ? { displayName: remote.displayName } : {}),
		...(typeof candidate.routeId === "string" ? { routeId: candidate.routeId } : {}),
		...(typeof candidate.sourceLabel === "string" ? { sourceLabel: candidate.sourceLabel } : typeof remote.owner === "string" ? { sourceLabel: remote.owner } : {}),
		...(typeof remote.capability === "string" ? { capability: remote.capability } : {}),
		...(status ? { status } : {}),
		...(typeof candidate.warning === "string" ? { warning: candidate.warning } : {}),
	};
};

const parseCredentialReference = (value: string): SecretRefV1 | undefined => {
	const match = /^env:([A-Z_][A-Z0-9_]*)$/u.exec(value.trim());
	return match ? { store: "env", key: match[1]! } : undefined;
};

const projectionFingerprint = (projection: ProviderProjection): string => JSON.stringify({
	baseUrl: projection.baseUrl,
	apiKeyReference: projection.apiKeyReference,
	authHeader: projection.authHeader,
	api: projection.api,
	models: projection.models,
});

const asProviderConfig = (projection: ProviderProjection): ProviderConfig | undefined => {
	if (!projection.baseUrl || !projection.apiKeyReference || projection.models.length === 0) return undefined;
	const config: ProviderConfig = {
		name: "9Router",
		baseUrl: projection.baseUrl,
		api: "openai-completions",
		apiKey: projection.apiKeyReference,
		authHeader: projection.authHeader,
		models: projection.models.map((model): ProviderModelConfig => ({
			id: model.id,
			name: model.name,
			reasoning: model.reasoning,
			input: [...model.input],
			cost: { ...model.cost },
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
		})),
	};
	return config;
};

/** Resolve one current route without selecting a worker pool or copying credentials. */
async function resolveHostRoute(manager: PiManagerContract, routeId: StableId): Promise<ResolvedWorkerRoute> {
	const projection = await manager.providerProjection();
	const selected = projection?.models.find((model) => model.routeId === routeId);
	if (!projection?.baseUrl || !projection.apiKeyReference || !selected) {
		throw new TriageCapabilityError("unavailable", "Selected route is not currently registered");
	}
	const runtime = await RuntimeModelRuntime.create({
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
		credentials: {
			read: async () => undefined,
			list: async () => [],
			modify: async (_provider: string, fn: (current: undefined) => Promise<undefined>) => fn(undefined),
			delete: async () => undefined,
		} as never,
	});
	runtime.registerProvider(projection.providerId, {
		name: "9Router",
		baseUrl: projection.baseUrl,
		api: projection.api,
		apiKey: projection.apiKeyReference,
		authHeader: projection.authHeader,
		models: [{
			id: selected.id,
			name: selected.name,
			reasoning: selected.reasoning,
			input: [...selected.input],
			cost: { ...selected.cost },
			contextWindow: selected.contextWindow,
			maxTokens: selected.maxTokens,
		}],
	} as never);
	await runtime.refresh({ providers: [projection.providerId], allowNetwork: false });
	const model = runtime.getModel(projection.providerId, selected.id);
	if (!model || model.id !== selected.id) throw new TriageCapabilityError("unavailable", "Selected route model is unavailable");
	return { routeId, remoteModelId: selected.id, model: model as never, modelRuntime: runtime };
}

const createHostTriageClient = (manager: PiManagerContract): TriageClient => ({
	classify: async (request, routeId, signal) => {
		const route = await resolveHostRoute(manager, routeId);
		let response: Awaited<ReturnType<typeof route.modelRuntime.completeSimple>>;
		try {
			response = await route.modelRuntime.completeSimple(route.model, {
				systemPrompt: TRIAGE_SYSTEM_PROMPT,
				messages: [{ role: "user", content: buildTriagePrompt(request), timestamp: Date.now() }],
			}, { signal });
		} catch (error) {
			throw error instanceof TriageCapabilityError ? error : new TriageCapabilityError("transport");
		}
		if (response.stopReason !== "stop") throw new TriageCapabilityError(response.stopReason === "aborted" ? "cancelled" : "protocol");
		const text = response.content.filter((block): block is { readonly type: "text"; readonly text: string } => block.type === "text").map((block) => block.text).join("").trim();
		if (!text) throw new TriageCapabilityError("malformed", "AI Triage returned no structured result");
		try { return parseTriageResult(JSON.parse(text) as unknown); }
		catch (error) { throw error instanceof TriageCapabilityError ? error : new TriageCapabilityError("malformed"); }
	},
});

/** Build the M5 adapter from the already-authoritative M3/M4 stores. */
async function createHostSubagentExecutor(
	manager: PiManagerContract,
	poolManager: PoolManagerContract,
	configStore: ConfigStore,
	healthStore: HealthStore | undefined,
	resultProtocolFactory?: (request: SubagentExecutionRequest) => ResultProtocolSpec,
	trustStore?: TrustStore,
): Promise<SubagentExecutor> {
	const loaded = await configStore.load();
	const initialPolicy = loaded.snapshot?.config.routing ?? createDefaultConfig().routing;
	const routeAdapter: RouteAttemptAdapter = {
		policy: initialPolicy,
		routingRequest: async ({ request, attemptedRouteIds, excludedRouteIds }): Promise<RoutingRequest> => {
			const currentPolicy = (await configStore.load()).snapshot?.config.routing ?? initialPolicy;
			const pool = await poolManager.getPool(request.poolId);
			const health = healthStore ? await healthStore.list() : {};
			return {
				poolId: request.poolId,
				policy: currentPolicy,
				now: new Date(),
				attemptedRouteIds,
				excludedRouteIds,
				...(request.diversity === undefined ? {} : { diversity: request.diversity }),
				candidates: pool.entries.map((entry): RoutingRequest["candidates"][number] => ({
					routeId: entry.routeId,
					poolId: request.poolId,
					poolPosition: entry.index,
					poolEnabled: entry.poolEnabled,
					globalEnabled: entry.globalEnabled,
					remoteModelId: entry.remoteModelId,
					...(entry.resourceId ? { resourceId: entry.resourceId } : {}),
					...(entry.underlyingFamily ? { underlyingFamily: entry.underlyingFamily } : {}),
					availability: entry.state === "missing" ? "missing" : entry.state === "provider-unavailable" ? "unavailable" : entry.state === "unknown" ? "unknown" : entry.catalogState === "stale" ? "stale" : "available",
					available: entry.state === "active" && entry.globalEnabled && entry.poolEnabled,
					...(health[entry.routeId] ? { health: health[entry.routeId] } : {}),
				})),
			};
		},
		resolveRoute: async (routeId) => {
			try { return await resolveHostRoute(manager, routeId); }
			catch (error) { throw error instanceof WorkerError ? error : new WorkerError("route-resolution", "Selected route is not currently registered"); }
		},
		...(healthStore ? {
			recordSuccess: (routeId: StableId, at: Date) => healthStore.recordSuccess(routeId, at),
			recordFailure: (routeId: StableId, failure: FailureClassification, at: Date) => healthStore.recordFailure(routeId, failure, { now: at }),
		} : {}),
	};
	return createSubagentExecutor({ routeAdapter, ...(trustStore === undefined ? {} : { safety: { trustStore } }), ...(resultProtocolFactory === undefined ? {} : { resultProtocolFactory }) });
}

/**
 * Build the Pi-facing adapter around a domain manager.  The adapter owns no
 * catalog/configuration state; it only projects the manager's current enabled
 * routes into Pi's dynamic provider registry and forwards user intents.
 */
export function createPiHost(pi: ExtensionAPI, options: PiHostOptions): PiHost {
	const providerId = options.providerId ?? NINEROUTER_PROVIDER_ID;
	const manager = options.manager;
	const poolManager = options.poolManager ?? emptyPoolManager();
	const configStore = options.configStore;
	const healthStore = options.healthStore;
	const subagentExecutor = options.subagentExecutor;
	const qualityExecutor = options.qualityExecutor;
	const qualityStore = options.qualityStore ?? options.missionStore;
	const qualityService = options.qualityService ?? (qualityStore ? new QualityService(qualityStore) : undefined);
	const analyticsStore = options.analyticsStore;
	const recommendationAnalyst = options.recommendationAnalyst;
	const smartRoutingStore = options.smartRoutingStore;
	let inMemorySmartRoutingSettings = createDefaultSmartRoutingSettings();
	const disabledSmartRoutingSettings = (): SmartRoutingSettings => ({ ...createDefaultSmartRoutingSettings(), enabled: false, aiTriageEnabled: false, routingMemoryEnabled: false, learnFromRoutingChoices: false });
	const loadSmartRoutingSettings = async (): Promise<SmartRoutingSettings> => {
		if (!smartRoutingStore) return inMemorySmartRoutingSettings;
		try {
			const loaded = await smartRoutingStore.load();
			return loaded.status === "corrupt" ? disabledSmartRoutingSettings() : loaded.settings;
		} catch { return disabledSmartRoutingSettings(); }
	};
	const updateSmartRoutingSettings = async (mutator: (draft: SmartRoutingSettings) => SmartRoutingSettings): Promise<void> => {
		if (!smartRoutingStore) {
			inMemorySmartRoutingSettings = mutator(structuredClone(inMemorySmartRoutingSettings));
			return;
		}
		await smartRoutingStore.update(mutator);
	};
	const routingMemory = options.routingMemoryStore as unknown as RoutingMemoryHostAdapter | undefined;
	const routingMemoryMatch = async (prompt: string, settings: SmartRoutingSettings): Promise<{ readonly signature: unknown; readonly match?: Record<string, unknown> }> => {
		const signature = buildRoutingSignature(prompt, analyzeLocalSignals(prompt));
		if (!routingMemory || !settings.enabled || !settings.routingMemoryEnabled) return { signature };
		try {
			const result = await Promise.resolve(routingMemory.match(signature));
			const match = routingMemoryRecord(result);
			return match === undefined ? { signature } : { signature, match };
		} catch {
			return { signature };
		}
	};
	const routingMemoryContext = (match: Record<string, unknown> | undefined): SmartRoutingContext["memoryRecommendation"] | undefined => {
		if (!match) return undefined;
		const recommendation = routingMemoryRecord(match.recommendation) ?? match;
		const kind = recommendation.kind ?? recommendation.status;
		if (kind === "none" && typeof recommendation.reason === "string" && recommendation.reason.includes("complexity")) return { reasonCodes: ["routing_memory_bypassed_complexity"] };
		const source = recommendation.source === "explicit" || recommendation.source === "learned" ? recommendation.source : undefined;
		const action = recommendation.action === "mission" || recommendation.action === "normal" ? recommendation.action : undefined;
		const confidence = typeof recommendation.confidence === "number" && Number.isFinite(recommendation.confidence) ? recommendation.confidence : undefined;
		const similarity = typeof recommendation.similarity === "number" && Number.isFinite(recommendation.similarity) ? recommendation.similarity : undefined;
		const ruleId = typeof recommendation.ruleId === "string" ? recommendation.ruleId : undefined;
		if (kind === "conflict" || recommendation.conflict === true) return { reasonCodes: ["routing_memory_conflict"], conflict: true, ...(source === undefined ? {} : { source }), ...(action === undefined ? {} : { action }), ...(confidence === undefined ? {} : { confidence }), ...(similarity === undefined ? {} : { similarity }), ...(ruleId === undefined ? {} : { ruleId }) };
		if (kind !== "strong" && kind !== "match" && recommendation.strong !== true) return undefined;
		if (!source || !action) return undefined;
		if (source === "learned" && (confidence === undefined || confidence < 0.84 || similarity === undefined || similarity < 0.8)) return undefined;
		// M12.3 explicitly authorizes strong learned Mission preferences to
		// AUTO_MISSION; the source/evidence checks above keep this adapter fail-closed.
		return { mode: action === "mission" ? "AUTO_MISSION" : "NORMAL", reasonCodes: ["routing_memory_hit"], ...(source === undefined ? {} : { source }), action, ...(confidence === undefined ? {} : { confidence }), ...(similarity === undefined ? {} : { similarity }), ...(ruleId === undefined ? {} : { ruleId }) };
	};
	const smartRouter = new SmartRouter({ settings: loadSmartRoutingSettings, triageClient: options.triageClient ?? createHostTriageClient(manager) });
	const analytics = analyticsStore ? new AnalyticsQueryService(analyticsStore) : undefined;
	const recommendationApplication = analyticsStore ? new RecommendationApplicationService(analyticsStore, poolManager) : undefined;
	const sanitizer = new SecretSanitizer();
	const recordAnalytics = (event: AnalyticsEventV1): void => {
		try { const result = analyticsStore?.append(event); if (result && typeof (result as Promise<unknown>).then === "function") void (result as Promise<unknown>).catch(() => undefined); } catch { /* analytics is non-critical */ }
	};
	let registeredFingerprint: string | undefined;
	let providerRegistry = options.providerRegistry;
	let ownership: "unknown" | "external" | "owned" = "unknown";
	let disposed = false;
	const lifetime = new AbortController();
	let routingEventSequence = 0;

	const notifyError = (ctx: ExtensionContext | ExtensionCommandContext, prefix: string, error: unknown): void => {
		ctx.ui.notify(`${prefix}: ${sanitizer.sanitizeText(errorMessage(error))}`, "error");
	};

	const requireIdle = (ctx: ExtensionContext | ExtensionCommandContext, subject = "9Router state"): boolean => {
		if (ctx.isIdle()) return true;
		ctx.ui.notify(`Wait for the current Pi turn to finish before changing ${subject}`, "warning");
		return false;
	};

	const reconcile = async (): Promise<ReconcileResult> => {
		if (disposed) return { changed: false, registered: false, modelCount: 0 };
		const projection = await manager.providerProjection();
		const config = projection ? asProviderConfig(projection) : undefined;
		if (ownership !== "owned" && providerRegistry) {
			let providerExists = true;
			try { providerExists = providerRegistry.getProvider(providerId) !== undefined; }
			catch { /* Fail closed: an uninspectable provider namespace is external. */ }
			if (providerExists) {
				ownership = "external";
				registeredFingerprint = undefined;
				return { changed: false, registered: false, modelCount: projection?.models.length ?? 0 };
			}
			if (ownership === "external") ownership = "unknown";
		}
		if (!config || !projection) {
			if (ownership === "owned") {
				pi.unregisterProvider(providerId);
				registeredFingerprint = undefined;
				ownership = "unknown";
				return { changed: true, registered: false, modelCount: 0 };
			}
			return { changed: false, registered: false, modelCount: 0 };
		}

		const fingerprint = projectionFingerprint(projection);
		if (registeredFingerprint === fingerprint) {
			return { changed: false, registered: true, modelCount: projection.models.length };
		}

		const previousFingerprint = registeredFingerprint;
		try {
			// Pi 0.84.1 replaces the provider's model list when `models` is
			// supplied, so registration can update an existing projection in place.
			// This also preserves the previous safe registry if validation fails.
			pi.registerProvider(providerId, config);
			registeredFingerprint = fingerprint;
			ownership = "owned";
			return { changed: true, registered: true, modelCount: projection.models.length };
		} catch (error) {
			registeredFingerprint = previousFingerprint;
			return {
				changed: true,
				registered: previousFingerprint !== undefined,
				modelCount: projection.models.length,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	};

	const refreshAndReconcile = async (ctx: ExtensionContext | ExtensionCommandContext): Promise<void> => {
		if (!requireIdle(ctx)) return;
		try {
			await manager.refresh(AbortSignal.any(ctx.signal ? [ctx.signal, lifetime.signal] : [lifetime.signal]));
			const result = await reconcile();
			if (result.error) {
				notifyError(ctx, "9Router provider activation failed", result.error);
				return;
			}
			ctx.ui.notify(`9Router refreshed (${result.modelCount} enabled model${result.modelCount === 1 ? "" : "s"})`, "info");
		} catch (error) {
			notifyError(ctx, "9Router refresh failed", error);
		}
	};

	const modelEntries = async (filter?: string): Promise<readonly ModelManagerEntry[]> => {
		const raw = await manager.list(filter);
		return raw.map(normalizeModelEntry).filter((entry): entry is ModelManagerEntry => entry !== undefined);
	};

	const toggleEntry = async (ctx: ExtensionCommandContext, entry: ModelManagerEntry): Promise<void> => {
		if (!requireIdle(ctx)) return;
		const enabled = entry.enabled === true;
		const activeRemoteModelId = ctx.model?.provider === providerId ? ctx.model.id : undefined;
		if (enabled && activeRemoteModelId === entry.remoteModelId) {
			ctx.ui.notify("Disable the active 9Router model only after switching to another model", "warning");
			return;
		}
		const action = enabled ? "Disable" : "Enable";
		const confirmed = await ctx.ui.confirm(`${action} 9Router model?`, entry.remoteModelId);
		if (!confirmed) return;
		try {
			const options = activeRemoteModelId === undefined ? undefined : { activeRemoteModelId };
			await manager.setEnabled(entry.remoteModelId, !enabled, options);
			const result = await reconcile();
			if (result.error) {
				notifyError(ctx, "9Router provider activation failed", result.error);
				return;
			}
			ctx.ui.notify(`${action}d ${entry.remoteModelId}`, "info");
		} catch (error) {
			notifyError(ctx, `${action} failed`, error);
		}
	};

	const inspectEntry = (ctx: ExtensionCommandContext, entry: ModelManagerEntry): void => {
		const details = [
			`remote: ${entry.remoteModelId}`,
			`local route: ${entry.routeId ?? "not enabled"}`,
			`source: ${entry.sourceLabel ?? "unknown"}`,
			`capability: ${entry.capability ?? "unknown"}`,
			`state: ${entry.missing ? "missing" : entry.stale ? "stale" : entry.available === false ? "unavailable" : "available"}`,
			...(entry.warning ? [`warning: ${entry.warning}`] : []),
		].join("\n");
		ctx.ui.notify(details, "info");
	};

	const openModels = async (ctx: ExtensionCommandContext, initialFilter?: string): Promise<void> => {
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("/9router-models requires TUI or RPC UI mode", "error");
			return;
		}
		const filter = initialFilter?.trim() || undefined;
		let entries: readonly ModelManagerEntry[];
		try {
			entries = await modelEntries(filter);
		} catch (error) {
			notifyError(ctx, "9Router model list failed", error);
			return;
		}
		if (entries.length === 0) {
			ctx.ui.notify(filter ? `No 9Router models match '${filter}'` : "No 9Router models discovered", "warning");
			return;
		}
		while (true) {
			const selected = await ctx.ui.select("9Router Models — select a model", entries.map(modelLabel));
			if (!selected) return;
			const index = entries.map(modelLabel).indexOf(selected);
			const entry = index >= 0 ? entries[index] : undefined;
			if (!entry) return;
			const action = await ctx.ui.select(`9Router model: ${entry.remoteModelId}`, ["Inspect", entry.enabled ? "Disable" : "Enable", "Back"]);
			switch (action) {
				case "Inspect":
					inspectEntry(ctx, entry);
					break;
				case "Enable":
				case "Disable":
					await toggleEntry(ctx, entry);
					break;
				default:
					return;
			}
			try {
				entries = await modelEntries(filter);
			} catch (error) {
				notifyError(ctx, "9Router model list failed", error);
				return;
			}
			if (entries.length === 0) return;
		}
	};

	const showStatus = async (ctx: ExtensionContext | ExtensionCommandContext): Promise<void> => {
		try {
			const [status, entries, projection] = await Promise.all([
				manager.loadStatus(),
				modelEntries(),
				manager.providerProjection(),
			]);
			const enabled = entries.filter((entry) => entry.enabled).length;
			const projected = projection?.models.length ?? 0;
			const available = ctx.modelRegistry.getAvailable().filter((model) => model.provider === providerId).length;
			ctx.ui.notify(`${safeStatusLine(status)} catalog=${entries.length} enabled=${enabled} projected=${projected} available=${available}`, "info");
		} catch (error) {
			notifyError(ctx, "9Router status failed", error);
		}
	};

	const configureConnection = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Connection setup requires TUI mode", "error");
			return;
		}
		if (!requireIdle(ctx)) return;
		let projection: ProviderProjection | undefined;
		try {
			projection = await manager.providerProjection();
		} catch (error) {
			notifyError(ctx, "9Router connection status failed", error);
			return;
		}
		const baseUrl = await ctx.ui.input("9Router base URL", projection?.baseUrl ?? "");
		if (!baseUrl?.trim()) return;
		const defaultCredential = projection?.apiKeyReference?.startsWith("$")
			? `env:${projection.apiKeyReference.slice(1)}`
			: "env:NINEROUTER_API_KEY";
		const credentialRef = await ctx.ui.input("Credential reference (not the secret)", defaultCredential);
		if (!credentialRef?.trim()) return;
		const parsedCredentialRef = parseCredentialReference(credentialRef);
		if (!parsedCredentialRef) {
			ctx.ui.notify("Use an environment reference such as env:VARIABLE (not the secret)", "error");
			return;
		}
		try {
			await manager.configure(baseUrl.trim(), parsedCredentialRef);
			const result = await reconcile();
			if (result.error) {
				notifyError(ctx, "9Router provider activation failed", result.error);
				return;
			}
			ctx.ui.notify(
				result.registered
					? "9Router connection saved and provider activated"
					: "9Router connection saved; refresh the catalog and enable a model to activate the provider",
				result.registered ? "info" : "warning",
			);
		} catch (error) {
			notifyError(ctx, "9Router connection failed", error);
		}
	};

	const getPoolView = async (ctx: ExtensionContext | ExtensionCommandContext, poolId: PoolId): Promise<PoolView> => {
		const view = await poolManager.getPool(poolId);
		const projection = await Promise.resolve(manager.providerProjection()).catch(() => undefined);
		const projected = projection ? new Set(projection.models.map((model) => model.routeId)) : undefined;
		const available = ctx.modelRegistry?.getAvailable() ?? [];
		return {
			...view,
			entries: view.entries.map((entry) => ({
				...entry,
				...(projected ? { projectedPiAvailable: projected.has(entry.routeId) } : {}),
				...(ctx.modelRegistry ? {
					actualPiAvailable: available.some((model) => model.provider === NINEROUTER_PROVIDER_ID && model.id === entry.remoteModelId),
				} : {}),
			})),
		};
	};

	const listPoolViews = async (ctx: ExtensionContext | ExtensionCommandContext, poolId?: PoolId): Promise<readonly PoolView[]> => {
		if (poolId) return [await getPoolView(ctx, poolId)];
		return Promise.all((await poolManager.listPools()).map((pool) => getPoolView(ctx, pool.poolId)));
	};

	const poolStatusText = (view: PoolView): string => {
		let active = 0;
		let globalDisabled = 0;
		let poolDisabled = 0;
		let missing = 0;
		let providerUnavailable = 0;
		let unknown = 0;
		for (const entry of view.entries) {
			const state = poolEntryState(entry);
			if (state === "global-disabled") globalDisabled += 1;
			else if (state === "pool-disabled") poolDisabled += 1;
			else if (state === "missing") missing += 1;
			else if (state === "provider-unavailable" || entry.projectedPiAvailable === false || entry.actualPiAvailable === false) providerUnavailable += 1;
			else if (state === "unknown" || entry.projectedPiAvailable === undefined || entry.actualPiAvailable === undefined) unknown += 1;
			else active += 1;
		}
		const stale = view.entries.filter((entry) => entry.catalogState === "stale").length;
		const details = [`${view.label} Pool`, `  ${view.entries.length} route${view.entries.length === 1 ? "" : "s"}`, `  ${active} active`];
		if (globalDisabled > 0) details.push(`  ${globalDisabled} globally disabled`);
		if (poolDisabled > 0) details.push(`  ${poolDisabled} pool-disabled`);
		if (missing > 0) details.push(`  ${missing} missing`);
		if (providerUnavailable > 0) details.push(`  ${providerUnavailable} provider unavailable`);
		if (unknown > 0) details.push(`  ${unknown} availability unknown`);
		if (stale > 0) details.push(`  ${stale} stale`);
		if (view.entries.length === 0) details.push("  No routes assigned.");
		return details.join("\n");
	};

	const showPoolStatus = async (ctx: ExtensionContext | ExtensionCommandContext, requested?: string): Promise<void> => {
		const trimmed = requested?.trim();
		if (trimmed && !isPoolId(trimmed)) {
			ctx.ui.notify(`Unknown pool '${trimmed}'. Use investigation, implementation, or verification.`, "error");
			return;
		}
		try {
			const views = await listPoolViews(ctx, trimmed ? trimmed as PoolId : undefined);
			ctx.ui.notify(views.map(poolStatusText).join("\n\n"), "info");
		} catch (error) {
			notifyError(ctx, "Pool status failed", error);
		}
	};

	const inspectPoolEntry = (ctx: ExtensionCommandContext, view: PoolView, entry: PoolEntryView): void => {
		ctx.ui.notify([
			`pool: ${view.label}`,
			`position: ${entry.index + 1}`,
			`route: ${entry.routeId}`,
			`display: ${entry.displayName}`,
			`remote: ${entry.remoteModelId}`,
			`global enabled: ${entry.globalEnabled}`,
			`pool enabled: ${entry.poolEnabled}`,
			`state: ${poolEntryState(entry)}`,
			`gateway: ${entry.gatewayId ?? "unknown"}`,
			`source: ${entry.sourceLabel ?? "unknown"}`,
			`resource: ${entry.resourceClass}${entry.resourceId ? `/${entry.resourceId}` : ""}`,
			`catalog: ${entry.catalogState}`,
			`projected in Pi: ${entry.projectedPiAvailable ?? "unknown"}`,
			`available in Pi: ${entry.actualPiAvailable ?? "unknown"}`,
			`metadata provenance: ${entry.provenance ? [...new Set(Object.values(entry.provenance))].join(", ") : "unknown"}`,
		].join("\n"), "info");
	};

	const poolMutation = async (
		ctx: ExtensionCommandContext,
		label: string,
		mutate: () => MaybePromise<unknown>,
	): Promise<boolean> => {
		if (!requireIdle(ctx, "pool configuration")) return false;
		try {
			await mutate();
			ctx.ui.notify(`${label} saved`, "info");
			return true;
		} catch (error) {
			notifyError(ctx, `${label} failed`, error);
			return false;
		}
	};

	const addPoolRoute = async (ctx: ExtensionCommandContext, view: PoolView): Promise<void> => {
		try {
			const candidates = await poolManager.getAvailableCandidatesToAdd(view.poolId);
			if (candidates.length === 0) {
				ctx.ui.notify("No configured routes available to add.", "warning");
				return;
			}
			const selected = await ctx.ui.select(`Add route to ${view.label} Pool`, candidates.map(poolCandidateLabel));
			if (!selected) return;
			const entry = candidates[candidates.map(poolCandidateLabel).indexOf(selected)];
			if (!entry) return;
			await poolMutation(ctx, `Add ${entry.routeId}`, () => poolManager.addRoute(view.poolId, entry.routeId));
		} catch (error) {
			notifyError(ctx, "Pool candidate list failed", error);
		}
	};

	const openPoolEditor = async (ctx: ExtensionCommandContext, poolId: PoolId): Promise<void> => {
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("/pool-models requires TUI or RPC UI mode", "error");
			return;
		}
		if (poolId === "verification") ctx.ui.notify("Verification Pool — shared route configuration\nDirect Workers use it for read-only foreground work; canonical Mission reviewers use it for M7. Use /subagent-run for direct work and /verify-task for canonical M7 verification.", "info");
		while (true) {
			let view: PoolView;
			try {
				view = await getPoolView(ctx, poolId);
			} catch (error) {
				notifyError(ctx, `${poolLabels[poolId]} pool load failed`, error);
				return;
			}
			const entryOptions = view.entries.map(poolEntryLabel);
			const options = [
				...(entryOptions.length > 0 ? entryOptions : ["No routes assigned."]),
				"Add Route",
				"Refresh",
				"Back",
			];
			const selected = await ctx.ui.select(`${view.label} Pool`, options);
			if (!selected || selected === "Back") return;
			if (selected === "Refresh") continue;
			if (selected === "Add Route") {
				await addPoolRoute(ctx, view);
				continue;
			}
			if (selected === "No routes assigned.") continue;
			const entryIndex = entryOptions.indexOf(selected);
			const entry = entryIndex >= 0 ? view.entries[entryIndex] : undefined;
			if (!entry) continue;
			const toggleLabel = entry.poolEnabled ? "Disable" : "Enable";
			const action = await ctx.ui.select(`Route ${entry.routeId}`, ["Move Up", "Move Down", "Move to position", toggleLabel, "Inspect", "Remove", "Back"]);
			switch (action) {
				case "Move Up":
					if (entry.index === 0) ctx.ui.notify("Already first; priority unchanged.", "info");
					else await poolMutation(ctx, `Move ${entry.routeId} up`, () => poolManager.moveRouteUp(poolId, entry.routeId));
					break;
				case "Move Down":
					if (entry.index === view.entries.length - 1) ctx.ui.notify("Already last; priority unchanged.", "info");
					else await poolMutation(ctx, `Move ${entry.routeId} down`, () => poolManager.moveRouteDown(poolId, entry.routeId));
					break;
				case "Move to position": {
					const raw = await ctx.ui.input("Target position (1-based)", String(entry.index + 1));
					if (!raw?.trim()) break;
					const target = Number.parseInt(raw.trim(), 10);
					if (!Number.isInteger(target) || target < 1 || target > view.entries.length) {
						ctx.ui.notify(`Position must be between 1 and ${view.entries.length}.`, "error");
						break;
					}
					await poolMutation(ctx, `Move ${entry.routeId}`, () => poolManager.moveRoute(poolId, entry.routeId, target - 1));
					break;
				}
				case "Enable":
				case "Disable":
					await poolMutation(ctx, `${action} ${entry.routeId}`, () => poolManager.setPoolEntryEnabled(poolId, entry.routeId, action === "Enable"));
					break;
				case "Inspect":
					inspectPoolEntry(ctx, view, entry);
					break;
				case "Remove": {
					const confirmed = await ctx.ui.confirm("Remove route from pool?", `${entry.routeId} (${entry.displayName})`);
					if (confirmed) await poolMutation(ctx, `Remove ${entry.routeId}`, () => poolManager.removeRoute(poolId, entry.routeId));
					break;
				}
				default:
					return;
			}
		}
	};

	const openPoolSelector = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("/pool-models requires TUI or RPC UI mode", "error");
			return;
		}
		const options = [...POOL_IDS.map((poolId) => `${poolLabels[poolId]} Pool`), "Back"];
		const selected = await ctx.ui.select("Pool Models", options);
		const index = options.indexOf(selected ?? "");
		if (index >= 0 && index < POOL_IDS.length) await openPoolEditor(ctx, POOL_IDS[index]!);
	};

	const openPoolModels = async (ctx: ExtensionCommandContext, args?: string): Promise<void> => {
		const requested = args?.trim();
		if (requested) {
			const poolId = requested.split(/\s+/u)[0];
			if (!poolId || !isPoolId(poolId)) {
				ctx.ui.notify(`Unknown pool '${poolId ?? requested}'. Use investigation, implementation, or verification.`, "error");
				return;
			}
			await openPoolEditor(ctx, poolId);
			return;
		}
		await openPoolSelector(ctx);
	};

	const controlCenterStatusLabel = (status: unknown): string => {
		if (!status || typeof status !== "object") return "UNKNOWN";
		const value = status as Record<string, unknown>;
		const gateway = value.gateway;
		const cache = value.cache;
		const state = typeof value.state === "string" ? value.state.toUpperCase() : "";
		if (state.includes("LIVE") || state === "REACHABLE") return "LIVE";
		if (state.includes("STALE")) return "STALE";
		if (state.includes("CORRUPT") || state.includes("ERROR")) return "ERROR";
		if (state.includes("EMPTY") || state.includes("MISSING")) return "EMPTY";
		if (gateway === "reachable" && cache === "fresh") return "LIVE";
		if (gateway === "reachable" && cache === "stale") return "STALE";
		if (cache === "stale") return "CACHED/STALE";
		if (cache === "empty") return "EMPTY";
		if (cache === "corrupt") return "ERROR/CORRUPT";
		if (gateway === "unreachable") return "ERROR/UNREACHABLE";
		return "UNKNOWN";
	};

	const showControlCenterDashboard = async (ctx: ExtensionCommandContext): Promise<void> => {
		const lines = ["Pi Multi-Orchestrator — Home", "dashboard: LOADING"];
		try {
			const status = await manager.loadStatus();
			const value = status && typeof status === "object" ? status as Record<string, unknown> : {};
			const catalog = typeof value.catalogEntries === "number" ? value.catalogEntries : typeof value.catalogCount === "number" ? value.catalogCount : "UNKNOWN";
			const enabled = typeof value.enabledRoutes === "number" ? value.enabledRoutes : typeof value.enabledCount === "number" ? value.enabledCount : "UNKNOWN";
			lines[1] = `dashboard: READY | 9Router=${controlCenterStatusLabel(status)} | catalog=${catalog} | enabled=${enabled}`;
		} catch {
			lines[1] = "dashboard: ERROR | 9Router=UNKNOWN";
		}
		try {
			const pools = await listPoolViews(ctx);
			lines.push(`pools: ${pools.map((pool) => `${pool.label}=${pool.entries.length}`).join(" ") || "EMPTY"}`);
		} catch {
			lines.push("pools: ERROR");
		}
		if (healthStore) {
			try {
				const health = await healthStore.list();
				const unhealthy = Object.values(health).filter((record) => healthStore.status(record) !== "Healthy").length;
				lines.push(`health: ${unhealthy > 0 ? `UNHEALTHY=${unhealthy}` : "HEALTHY"}`);
			} catch {
				lines.push("health: UNKNOWN");
			}
		} else {
			lines.push("health: UNKNOWN");
		}
		if (options.missionStore) {
			try {
				const active = options.missionStore.listMissions().filter((mission) => ["active", "running", "awaiting-review"].includes(mission.status));
				lines.push(`missions: ${active.length > 0 ? `${active.length} active` : "EMPTY"}`);
			} catch {
				lines.push("missions: UNKNOWN");
			}
		} else {
			lines.push("missions: UNKNOWN");
		}
		lines.push(`pending evidence: ${options.missionStore ? "available in Context & Mission Settings" : "UNKNOWN"}`);
		lines.push(`quality review: ${qualityStore ? "available" : "UNKNOWN"}`);
		lines.push(`analytics collection: ${analyticsStore ? "available" : "DISABLED/UNKNOWN"}`);
		if (analytics) {
			try { lines.push(`recommendations: ${analytics.recommendations().filter((item) => item.status === "proposed").length} proposed`); }
			catch { lines.push("recommendations: UNKNOWN"); }
		} else {
			lines.push("recommendations: UNKNOWN");
		}
		if (recommendationAnalyst) {
			try {
				const analystStatus = await recommendationAnalyst.getStatus();
				lines.push(`AI Analyst: ${analystStatus.state} (manual-only)`);
			} catch { lines.push("AI Analyst: UNKNOWN"); }
		} else {
			lines.push("AI Analyst: UNKNOWN");
		}
		lines.push("latest warning/error: none observed in this view");
		lines.push(`latest accepted milestone: ${PACKAGE_INFO.latestAcceptedMilestone}`);
		lines.push(`${PACKAGE_INFO.developmentMilestone}: ${PACKAGE_INFO.developmentStatus}; production-ready: ${PACKAGE_INFO.productionReady ? "YES" : "NO"}`);
		lines.push("safe metadata only; use a section below or the direct commands");
		ctx.ui.notify(lines.join("\n"), "info");
	};

	const showPlannedControlCenterSection = (ctx: ExtensionCommandContext, section: string): void => {
		ctx.ui.notify(`${section}\nNot implemented yet — planned`, "warning");
	};

	const showBossProfiles = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (!configStore) {
			showPlannedControlCenterSection(ctx, "Boss / Orchestrator Profiles");
			return;
		}
		try {
			const loaded = await configStore.load();
			const config = loaded.snapshot?.config;
			if (!config) {
				ctx.ui.notify("Boss / Orchestrator Profiles\nconfiguration unavailable\nBoss runtime not implemented yet", "warning");
				return;
			}
			const active = config.bossProfiles[config.activeBossProfileId];
			const profiles = Object.values(config.bossProfiles).map((profile) => `${profile.id}: ${profile.displayName}`);
			ctx.ui.notify([
				"Boss / Orchestrator Profiles",
				`active profile: ${active?.displayName ?? config.activeBossProfileId}`,
				`profiles: ${profiles.join(", ") || "EMPTY"}`,
				"Boss runtime not implemented yet",
				"profile data is configuration only; no autonomous planning or scheduling",
			].join("\n"), "info");
		} catch (error) {
			notifyError(ctx, "Boss profile status failed", error);
		}
	};

	const showBudgetQualityProfiles = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (!configStore) {
			ctx.ui.notify("Budget / Quality Profiles\nconfiguration unavailable\nanalytics and billing state=UNKNOWN", "warning");
			return;
		}
		try {
			const loaded = await configStore.load();
			const config = loaded.snapshot?.config;
			const billing = (config as (typeof config & {
				readonly billing?: { readonly profiles?: Record<string, { readonly displayName?: string; readonly billingMode?: string; readonly currency?: string; readonly provenance?: string }> };
			}) | undefined)?.billing;
			if (!config) {
				ctx.ui.notify("Budget / Quality Profiles\nconfiguration unavailable", "warning");
				return;
			}
			const profiles = Object.values(billing?.profiles ?? {}).map((profile) => `${profile.displayName ?? "profile"} (${profile.billingMode ?? "unknown"}, ${profile.currency ?? "currency UNKNOWN"}, ${profile.provenance ?? "provenance UNKNOWN"})`);
			const details = [
				"Budget / Quality Profiles",
				`billing/reference profiles: ${profiles.join("; ") || "UNKNOWN (none configured)"}`,
				`analytics collection: ${config.analytics.enabled ? "ENABLED (metadata-only)" : "DISABLED"}`,
				`quality gates: ${config.quality.requiredGates.join(", ") || "none"}`,
				"costs without configured provenance remain UNKNOWN; no automatic budget routing",
				"Recommendation Analyst settings are available under Statistics & Analytics",
			].join("\n");
			ctx.ui.notify(details, "info");
			if (ctx.mode !== "tui" && !ctx.hasUI) return;
			const action = await ctx.ui.select("Budget / Quality Profiles", ["Inspect", "Back"]);
			if (action === "Inspect") ctx.ui.notify(details, "info");
		} catch (error) {
			notifyError(ctx, "Budget / quality status failed", error);
		}
	};

	const showDiagnostics = async (ctx: ExtensionCommandContext): Promise<void> => {
		const lines = ["Diagnostics", "safe operational metadata only", `package: ${PACKAGE_INFO.name}@${PACKAGE_INFO.version} (${PACKAGE_INFO.releaseStatus})`, `Pi compatibility: ${PACKAGE_INFO.piCompatibility}`, `schemas: config=${PACKAGE_INFO.configSchema}, mission=${PACKAGE_INFO.missionSchema}, analytics=${PACKAGE_INFO.analyticsSchema}`, "provider quota remaining: UNKNOWN"];
		try {
			const status = await manager.loadStatus();
			lines.push(`9Router: ${safeStatusLine(status)}`);
		} catch {
			lines.push("9Router: ERROR/UNAVAILABLE");
		}
		if (healthStore) {
			try {
				const health = await healthStore.list();
				const unhealthy = Object.values(health).filter((record) => healthStore.status(record) !== "Healthy").length;
				lines.push(`observed route health: ${unhealthy === 0 ? "HEALTHY" : `UNHEALTHY=${unhealthy}`}`);
			} catch {
				lines.push("observed route health: UNKNOWN");
			}
		} else {
			lines.push("observed route health: UNKNOWN");
		}
		const projectRoot = typeof ctx.cwd === "string" && ctx.cwd.trim().length > 0 ? ctx.cwd : "UNKNOWN";
		const trust = options.trustStore?.get(projectRoot);
		lines.push(`Security & Trust: ${trust?.state === "trusted" ? "TRUSTED" : "UNTRUSTED"}`);
		lines.push(`project path: ${trust?.projectRoot ?? projectRoot}`);
		lines.push("protected-path policy: ACTIVE (application-level; not an OS sandbox)");
		lines.push(`permission matrix: ${getCapabilityMatrix().length} profiles`);
		const missionHealth = options.missionStore ? (() => { try { options.missionStore.integrityCheck(); return "HEALTHY"; } catch { return "CORRUPT / RECOVERY REQUIRED"; } })() : "UNAVAILABLE";
		const analyticsHealth = analyticsStore?.integrityCheck ? (analyticsStore.integrityCheck().length === 0 ? "HEALTHY" : "DEGRADED") : analyticsStore ? "UNKNOWN" : "UNAVAILABLE";
		lines.push(`Mission DB: ${missionHealth}`, `Analytics DB: ${analyticsHealth}`);
		lines.push("logs, prompts, tool output, and credentials are not displayed");
		ctx.ui.notify(lines.join("\n"), "info");
		if (ctx.mode !== "tui" && !ctx.hasUI) return;
		const action = await ctx.ui.select("Diagnostics", ["Security & Trust", "Permission matrix", "Refresh", "Back"]);
		if (action === "Security & Trust") {
			const record = options.trustStore?.get(projectRoot);
			const security = new PathSafetyPolicy({ projectRoot: projectRoot === "UNKNOWN" ? "." : projectRoot, ...(options.trustStore ? { trustStore: options.trustStore } : {}) });
			const securityLines = ["Security & Trust", `project path: ${record?.projectRoot ?? projectRoot}`, `state: ${record?.state === "trusted" ? "TRUSTED" : "UNTRUSTED"}`, "mutations require explicit trust; protected paths and credentials remain denied", `sample policy: ${security.authorizeWrite(".m10-probe").decision}`];
			ctx.ui.notify(securityLines.join("\n"), "info");
			if (ctx.mode === "tui" || ctx.hasUI) {
				const trustAction = await ctx.ui.select("Security & Trust", ["Trust Project", "Revoke Trust", "Back"]);
				if (trustAction === "Trust Project" || trustAction === "Revoke Trust") {
					if (!(await ctx.ui.confirm(`${trustAction}?`, projectRoot))) return;
					if (!options.trustStore) { ctx.ui.notify("Local TrustStore unavailable", "warning"); return; }
					if (trustAction === "Trust Project") options.trustStore.trust(projectRoot);
					else options.trustStore.revoke(projectRoot);
					ctx.ui.notify(`Project ${trustAction === "Trust Project" ? "trusted" : "revoked"}; future mutating runs require the current state`, "info");
				}
			}
		} else if (action === "Permission matrix") {
			ctx.ui.notify(getCapabilityMatrix().map((row) => `${row.profile}: tools=${row.tools.join(",")} mutation=${row.mutation ? "YES" : "NO"} bash=${row.bash ? "YES" : "NO"} trust=${row.trustRequired ? "REQUIRED" : "NO"}`).join("\n"), "info");
		} else if (action === "Refresh") ctx.ui.notify(lines.join("\n"), "info");
	};

	const showBackupRestore = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (!configStore && !routingMemory) {
			ctx.ui.notify("Backup / Restore\nConfigStore and Routing Memory unavailable", "warning");
			return;
		}
		try {
			const loaded = configStore ? await configStore.load() : undefined;
			const history = configStore ? await configStore.listHistory() : { entries: [] };
			const generation = loaded?.snapshot?.generation ?? "UNKNOWN";
			const missionBackup = options.missionStore && typeof options.missionStore.backup === "function";
			const analyticsBackup = analyticsStore && typeof analyticsStore.backup === "function";
			const memoryBackup = routingMemory && typeof routingMemory.backup === "function";
			const details = [
				"Backup / Restore",
				`active ConfigStore generation: ${generation}`,
				`history entries: ${history.entries.length}`,
				`Mission DB backup: ${missionBackup ? "AVAILABLE" : "UNAVAILABLE"}`,
				`Analytics DB backup: ${analyticsBackup ? "AVAILABLE" : "UNAVAILABLE"}`,
				`Routing Memory backup: ${memoryBackup ? "AVAILABLE (abstract rules only)" : "UNAVAILABLE"}`,
				"restore requires preview, validation, and explicit confirmation; backups use SQLite-native consistent snapshots",
			].join("\n");
			ctx.ui.notify(details, "info");
			if (ctx.mode !== "tui" && !ctx.hasUI) return;
			const action = await ctx.ui.select("Backup / Restore", ["Export config", "Backup Mission DB", "Backup Analytics DB", "Backup Routing Memory", "Restore history generation", "Restore Routing Memory", "Back"]);
			if (action === "Export config") {
				if (!configStore) { ctx.ui.notify("Config export is unavailable", "warning"); return; }
				const exported = await configStore.export();
				if (typeof ctx.ui.editor === "function") await ctx.ui.editor("Config export (safe references only)", exported);
				else ctx.ui.notify(`Config export ready (${exported.length} bytes; secrets are environment references only)`, "info");
				return;
			}
			if (action === "Backup Mission DB" || action === "Backup Analytics DB") {
				if (!(await ctx.ui.confirm(`${action}?`, "Create a validated local backup snapshot"))) return;
				try {
					const backup = action === "Backup Mission DB" ? options.missionStore?.backup : analyticsStore?.backup;
					if (typeof backup !== "function") { ctx.ui.notify(`${action} is unavailable`, "warning"); return; }
					const path = await backup.call(action === "Backup Mission DB" ? options.missionStore : analyticsStore);
					ctx.ui.notify(`${action} created: ${path}`, "info");
				} catch (error) { notifyError(ctx, `${action} failed`, error); }
				return;
			}
			if (action === "Backup Routing Memory") {
				if (!memoryBackup || !(await ctx.ui.confirm("Backup Routing Memory?", "Only abstract routing rules will be exported"))) return;
				try {
					const path = await routingMemory.backup!();
					ctx.ui.notify(`Routing Memory backup created: ${path}`, "info");
				} catch (error) { notifyError(ctx, "Routing Memory backup failed", error); }
				return;
			}
			if (action === "Restore Routing Memory") {
				if (!routingMemory?.restore) { ctx.ui.notify("Routing Memory restore is unavailable", "warning"); return; }
				const backupPath = await ctx.ui.input("Routing Memory backup path", "");
				if (!backupPath?.trim() || !(await ctx.ui.confirm("Restore Routing Memory?", "The backup is validated before activation"))) return;
				try {
					await Promise.resolve(routingMemory.restore(backupPath.trim()));
					ctx.ui.notify("Routing Memory restored.", "info");
				} catch (error) { notifyError(ctx, "Routing Memory restore failed", error); }
				return;
			}
			if (action !== "Restore history generation") return;
			if (!configStore) return;
			if (history.entries.length === 0) {
				ctx.ui.notify("No ConfigStore history entries to restore", "warning");
				return;
			}
			const generationText = await ctx.ui.input("History generation to restore", String(history.entries[0]?.generation ?? ""));
			const target = Number.parseInt(generationText?.trim() ?? "", 10);
			if (!Number.isSafeInteger(target)) {
				ctx.ui.notify("Restore requires a valid history generation", "error");
				return;
			}
			if (!(await ctx.ui.confirm("Restore ConfigStore generation?", String(target)))) return;
			const current = loaded?.snapshot?.generation;
			const result = await configStore.restore(target, current === undefined ? {} : { expectedGeneration: current });
			ctx.ui.notify(`ConfigStore restored generation ${target} (active generation ${result.generation})`, "info");
		} catch (error) {
			notifyError(ctx, "Backup / restore failed", error);
		}
	};

	const openControlCenter = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("/orchestrator requires TUI or RPC UI mode", "error");
			return;
		}
		while (true) {
			await showControlCenterDashboard(ctx);
			const choice = await ctx.ui.select("Pi Multi-Orchestrator", [
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
			]);
			switch (choice) {
				case "Models & 9Router":
					await openModels(ctx);
					continue;
				case "Investigation Pool":
					await openPoolEditor(ctx, "investigation");
					continue;
				case "Implementation Pool":
					await openPoolEditor(ctx, "implementation");
					continue;
				case "Verification Pool":
					await openPoolEditor(ctx, "verification");
					continue;
				case "Boss / Orchestrator Profiles":
					await showBossProfiles(ctx);
					continue;
				case "Routing & Fallback":
					await showRoutingStatus(ctx);
					await openRoutingSettings(ctx);
					continue;
				case "Health & Quotas":
					await showRouteHealth(ctx);
					continue;
				case "Budget / Quality Profiles":
					await showBudgetQualityProfiles(ctx);
					continue;
				case "Context & Mission Settings":
					await openMissionControl(ctx);
					continue;
				case "Statistics & Analytics":
					await showAnalytics(ctx);
					continue;
				case "Diagnostics":
					await showDiagnostics(ctx);
					continue;
				case "Backup / Restore":
					await showBackupRestore(ctx);
					continue;
				default:
					return;
			}
		}
	};

	const routingCandidates = (pool: PoolView, health: Readonly<Record<string, RouteHealthRecord>>): readonly RoutingCandidate[] =>
		pool.entries.map((entry): RoutingCandidate => ({
			routeId: entry.routeId,
			poolId: pool.poolId,
			poolPosition: entry.index,
			poolEnabled: entry.poolEnabled,
			globalEnabled: entry.globalEnabled,
			remoteModelId: entry.remoteModelId,
			...(entry.resourceId ? { resourceId: entry.resourceId } : {}),
			...(entry.underlyingFamily ? { underlyingFamily: entry.underlyingFamily } : {}),
			availability: routeAvailability(entry),
			available: entry.projectedPiAvailable === false || entry.actualPiAvailable === false ? false : entry.state === "active",
			...(health[entry.routeId] ? { health: health[entry.routeId] } : {}),
		}));

	const routingDecisionText = (decision: RoutingDecision, pool: PoolView): string[] => {
		if (decision.kind === "SELECTED") {
			const entry = pool.entries.find((candidate) => candidate.routeId === decision.routeId);
			return [`Current first eligible: ${entry?.displayName ?? decision.routeId} (${decision.routeId})`, `  reason: ${decision.reason}`];
		}
		const lines = ["NO ELIGIBLE ROUTE"];
		if (decision.earliestRetryAt) lines.push(`  earliest retry: ${decision.earliestRetryAt}`);
		for (const reason of decision.reasons.filter((item) => item.reasons.length > 0)) {
			lines.push(`  ${reason.routeId}: ${reason.reasons.join(", ")}`);
		}
		return lines;
	};

	const showRoutingStatus = async (ctx: ExtensionContext | ExtensionCommandContext, requested?: string): Promise<void> => {
		if (!configStore) {
			ctx.ui.notify("Routing status is unavailable until the runtime store is configured", "error");
			return;
		}
		if (requested?.trim() && !isPoolId(requested.trim())) {
			ctx.ui.notify(`Unknown pool '${requested.trim()}'. Use investigation, implementation, or verification.`, "error");
			return;
		}
		try {
			const loaded = await configStore.load();
			if (!loaded.snapshot) {
				ctx.ui.notify("Routing status unavailable: configuration is not valid", "error");
				return;
			}
			const [views, health] = await Promise.all([
				listPoolViews(ctx, requested?.trim() ? requested.trim() as PoolId : undefined),
				healthStore ? healthStore.list() : Promise.resolve({} as Readonly<Record<string, RouteHealthRecord>>),
			]);
			const policy = loaded.snapshot.config.routing as RoutingPolicy;
			const now = new Date();
			const blocks: string[] = [];
			for (const pool of views) {
				const candidates = routingCandidates(pool, health);
				blocks.push(`${pool.label} Pool`);
				if (candidates.length === 0) {
					blocks.push("  NO ROUTES ASSIGNED");
					continue;
				}
				const decision = previewRouting({ poolId: pool.poolId, candidates, policy, now });
				for (const entry of pool.entries) {
					const evaluation = decision.kind === "SELECTED"
						? decision.evaluations.find((item) => item.routeId === entry.routeId)
						: decision.reasons.find((item) => item.routeId === entry.routeId);
					const record = health[entry.routeId];
					const status = healthStore ? healthStore.status(record, now) : "Unknown";
					const suffix = evaluation?.eligible ? "eligible" : evaluation?.reasons.join(", ") || "not eligible";
					blocks.push(`  ${entry.index + 1} ${entry.displayName} (${entry.routeId}) ${status} — ${suffix}`);
				}
				blocks.push(...routingDecisionText(decision, pool));
			}
			ctx.ui.notify(blocks.join("\n"), "info");
		} catch (error) {
			notifyError(ctx, "Routing status failed", error);
		}
	};

	const healthEntries = async (ctx: ExtensionContext | ExtensionCommandContext): Promise<readonly { entry: PoolEntryView; pools: readonly string[] }[]> => {
		const pools = await listPoolViews(ctx);
		const memberships = new Map<string, { entry: PoolEntryView; pools: string[] }>();
		for (const pool of pools) {
			for (const entry of pool.entries) {
				const existing = memberships.get(entry.routeId);
				if (existing) existing.pools.push(pool.label);
				else memberships.set(entry.routeId, { entry, pools: [pool.label] });
			}
		}
		return [...memberships.values()];
	};

	const healthLabel = (entry: PoolEntryView, record: RouteHealthRecord | undefined, pools: readonly string[]): string => {
		const status = healthStore ? healthStore.status(record) : "Unknown";
		const cooldown = record?.cooldownUntil ? ` until ${record.cooldownUntil}` : "";
		return `${entry.displayName} — ${entry.routeId} [${status}${cooldown}] (${pools.join(", ")})`;
	};

	const showRouteHealth = async (ctx: ExtensionContext | ExtensionCommandContext, filter?: string): Promise<void> => {
		if (!healthStore) {
			ctx.ui.notify("Route health is unavailable until the runtime store is configured", "error");
			return;
		}
		try {
			const health = await healthStore.list();
			const entries = (await healthEntries(ctx)).filter(({ entry, pools }) => {
				const needle = filter?.trim().toLocaleLowerCase();
				return !needle || `${entry.routeId} ${entry.displayName} ${entry.remoteModelId} ${pools.join(" ")}`.toLocaleLowerCase().includes(needle);
			});
			if (entries.length === 0) {
				ctx.ui.notify("No routes assigned", "warning");
				return;
			}
			const options = entries.map(({ entry, pools }) => healthLabel(entry, health[entry.routeId], pools));
			if (ctx.mode !== "tui" && !ctx.hasUI) {
				ctx.ui.notify(options.join("\n"), "info");
				return;
			}
			while (true) {
				const selected = await ctx.ui.select("Route Health", [...options, "Back"]);
				if (!selected || selected === "Back") return;
				const index = options.indexOf(selected);
				const selectedEntry = index >= 0 ? entries[index] : undefined;
				if (!selectedEntry) return;
				const record = health[selectedEntry.entry.routeId];
				const details = [
					`route: ${selectedEntry.entry.routeId}`,
					`display: ${selectedEntry.entry.displayName}`,
					`pools: ${selectedEntry.pools.join(", ")}`,
					`global enabled: ${selectedEntry.entry.globalEnabled}`,
					`catalog: ${selectedEntry.entry.catalogState}`,
					`health: ${healthStore.status(record)}`,
					`last success: ${record?.lastSuccessAt ?? "unknown"}`,
					`last failure: ${record?.lastFailureClass ?? "none"}`,
					`cooldown until: ${record?.cooldownUntil ?? "none"}`,
					`quota remaining: unknown (no authoritative metadata)`,
				].join("\n");
				const action = await ctx.ui.select(details, ["Inspect", "Reset health", "Back"]);
				if (action === "Inspect") {
					ctx.ui.notify(details, "info");
				} else if (action === "Reset health") {
					if (!requireIdle(ctx, "route health")) continue;
					const confirmed = await ctx.ui.confirm("Reset runtime health and cooldown?", selectedEntry.entry.routeId);
					if (confirmed) {
						const reset = await healthStore.reset(selectedEntry.entry.routeId);
						ctx.ui.notify(`Health reset for ${reset.routeId}`, "info");
					}
				} else {
					return;
				}
			}
		} catch (error) {
			notifyError(ctx, "Route health failed", error);
		}
	};

	const runSubagent = async (
		ctx: ExtensionContext | ExtensionCommandContext,
		params: { readonly role: string; readonly pool: string; readonly task: string; readonly acceptanceCriteria?: readonly string[]; readonly timeoutMs?: number; readonly standalone?: boolean },
		signal?: AbortSignal,
	): Promise<SubagentRunResult | undefined> => {
		if (!subagentExecutor || !isPoolId(params.pool)) {
			ctx.ui.notify("Routed subagent execution is unavailable", "error");
			return undefined;
		}
		if (params.pool === "implementation" && options.trustStore && !options.trustStore.isTrusted(ctx.cwd)) {
			ctx.ui.notify("TRUST REQUIRED — mutating agent execution is disabled for this project", "error");
			return undefined;
		}
		const request: SubagentExecutionRequest = {
			roleId: params.role,
			poolId: params.pool,
			task: params.task,
			cwd: ctx.cwd,
			...(params.acceptanceCriteria ? { acceptanceCriteria: params.acceptanceCriteria } : {}),
			...(params.timeoutMs === undefined ? {} : { timeoutMs: params.timeoutMs }),
		};
		const activeSignal = signal && ctx.signal ? AbortSignal.any([signal, ctx.signal]) : signal ?? ctx.signal;
		try {
			const result = await subagentExecutor.run(request, activeSignal);
			if (analyticsStore) {
				const base = { runId: result.runId, roleId: params.role, poolId: params.pool };
				const events: AnalyticsEventV1[] = [{ eventId: `run-${result.runId}`, occurredAt: new Date().toISOString(), eventType: "run", ...base, ...(result.finalRouteId ? { routeId: result.finalRouteId } : {}), ...(result.finalRemoteModelId ? { remoteModelId: result.finalRemoteModelId } : {}), outcome: result.terminalStatus, dimensions: { fallbackCount: result.fallbackCount } }];
				for (const attempt of result.attempts) { const attemptEvent: AnalyticsEventV1 = { eventId: `attempt-${attempt.attemptId}`, occurredAt: attempt.endedAt, eventType: "attempt", ...base, attemptId: attempt.attemptId, routeId: attempt.routeId, remoteModelId: attempt.remoteModelId, outcome: attempt.outcome }; if (attempt.latencyMs !== undefined) (attemptEvent as { durationMs?: number }).durationMs = attempt.latencyMs; if (attempt.infrastructureFailure?.class) (attemptEvent as { failureClass?: string }).failureClass = attempt.infrastructureFailure.class; if (attempt.usage) (attemptEvent as { tokenUsage?: AnalyticsEventV1["tokenUsage"] }).tokenUsage = { ...(attempt.usage.input === undefined ? {} : { inputTokens: attempt.usage.input }), ...(attempt.usage.output === undefined ? {} : { outputTokens: attempt.usage.output }), ...(attempt.usage.cacheRead === undefined ? {} : { cacheReadTokens: attempt.usage.cacheRead }), ...(attempt.usage.cacheWrite === undefined ? {} : { cacheWriteTokens: attempt.usage.cacheWrite }), ...(attempt.usage.reasoning === undefined ? {} : { reasoningTokens: attempt.usage.reasoning }), ...(attempt.usage.totalTokens === undefined ? {} : { totalTokens: attempt.usage.totalTokens }), provenance: "observed" }; events.push(attemptEvent); }
				for (let index = 0; index + 1 < result.attempts.length; index++) { const from = result.attempts[index]!; const to = result.attempts[index + 1]!; if (from.failureAction !== "FALLBACK_NEXT_ROUTE") continue; events.push({ eventId: `fallback-${result.runId}-${index}`, occurredAt: to.startedAt, eventType: "fallback", ...base, fallbackFromRouteId: from.routeId, fallbackToRouteId: to.routeId, ...(from.infrastructureFailure?.class ? { failureClass: from.infrastructureFailure.class } : {}), outcome: "fallback" }); }
				for (const event of events) { try { analyticsStore.append(event); } catch { /* analytics is non-critical */ } }
			}
			ctx.ui.notify(params.standalone
				? [`Direct Worker ${result.terminalStatus}: ${result.summary}`, "No canonical Mission task, M7 verification run, or quality history was created."].join("\n")
				: `Subagent ${result.terminalStatus}: ${result.summary}`, result.terminalStatus === "completed" ? "info" : "warning");
			return result;
		} catch (error) {
			notifyError(ctx, params.standalone ? "Direct worker execution failed" : "Subagent execution failed", error);
			return undefined;
		}
	};

	const registerSubagentTool = (): void => {
		if (!subagentExecutor || typeof (pi as unknown as { registerTool?: unknown }).registerTool !== "function") return;
		const tool = {
			name: "delegate_agent",
			label: "Delegate agent",
			description: "Run one bounded child worker through the configured execution pool and M4 route policy.",
			parameters: SUBAGENT_PARAMETERS,
			execute: async (_toolCallId: string, params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) => {
				if (!params || typeof params !== "object") return { content: [{ type: "text", text: "Invalid delegation request" }] };
				const input = params as Record<string, unknown>;
				if (typeof input.role !== "string" || typeof input.pool !== "string" || typeof input.task !== "string") {
					return { content: [{ type: "text", text: "Delegation requires role, pool, and task" }] };
				}
				const criteria = Array.isArray(input.acceptanceCriteria) && input.acceptanceCriteria.every((item) => typeof item === "string")
					? input.acceptanceCriteria as string[] : undefined;
				const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : undefined;
				const result = await runSubagent(ctx, { role: input.role, pool: input.pool, task: input.task, ...(criteria ? { acceptanceCriteria: criteria } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) }, signal);
				if (!result) return { content: [{ type: "text", text: "Delegation unavailable" }] };
				return {
					content: [{ type: "text", text: `${result.terminalStatus}: ${result.summary}` }],
					details: { terminalStatus: result.terminalStatus, finalRouteId: result.finalRouteId, fallbackCount: result.fallbackCount, potentialMutationObserved: result.potentialMutationObserved, structuredResult: result.structuredResult },
				};
			},
		};
		pi.registerTool(tool as never);
	};

	const openSubagentRunner = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (!subagentExecutor) {
			ctx.ui.notify("Direct Workers execution is unavailable", "error");
			return;
		}
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("Direct Workers require TUI or RPC UI mode", "error");
			return;
		}
		if (!requireIdle(ctx, "subagent execution")) return;
		const poolLabel = await ctx.ui.select("Direct Workers", POOL_IDS.map((poolId) => `${directWorkerLabels[poolId]} (${poolId})`));
		if (!poolLabel) return;
		const poolId = POOL_IDS.find((pool) => poolLabel.endsWith(`(${pool})`));
		if (!poolId) return;
		const role = await ctx.ui.input("Role ID", "debugger");
		const task = await ctx.ui.input("Task", "");
		if (!role?.trim() || !task?.trim()) return;
		ctx.ui.notify([
			directWorkerLabels[poolId],
			`Role: ${role.trim()}`,
			poolId === "verification"
				? "Runs a verification-role worker directly. This does not create a canonical Mission task, M7 verification run, or quality decision."
				: "Runs an ad-hoc foreground worker. This does not create a canonical Mission.",
			`Tools: ${poolId === "implementation" ? "read, grep, find, ls, bash, edit, write" : "read, grep, find, ls"}`,
			"Routing: M4 fallback policy",
		].join("\n"), "info");
		if (poolId === "implementation" && !(await ctx.ui.confirm("Implementation tools may modify files. Continue?", ctx.cwd))) return;
		await runSubagent(ctx, { role: role.trim(), pool: poolId, task: task.trim(), standalone: true }, ctx.signal);
	};

	const showLearnedBehaviors = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (!routingMemory) {
			ctx.ui.notify("Learned Behaviors are unavailable until Routing Memory is configured", "warning");
			return;
		}
		try {
			const rawViews = await Promise.resolve(routingMemory.listViews());
			const views = rawViews.map((value) => routingMemoryRecord(value)).filter((value): value is Record<string, unknown> => value !== undefined);
			const label = (view: Record<string, unknown>): string => {
				const id = typeof view.id === "string" ? view.id : "rule";
				const signature = routingMemoryRecord(view.signature);
				const family = typeof view.taskFamily === "string" ? view.taskFamily : typeof signature?.taskFamily === "string" ? signature.taskFamily : "general";
				const action = view.action === "mission" ? "MISSION" : "NORMAL";
				const source = view.source === "explicit" ? "explicit" : "learned";
				const confidence = typeof view.confidence === "number" ? view.confidence.toFixed(2) : "?";
				const observations = typeof view.observations === "number" ? String(view.observations) : "?";
				return `${id} — ${family} — ${action} (${source}, confidence ${confidence}, observations ${observations})${view.enabled === false ? " [DISABLED]" : ""}`;
			};
			const details = (view: Record<string, unknown>): string => {
				const signature = routingMemoryRecord(view.signature);
				const flags = signature ? Object.entries(signature).filter(([key, value]) => ["taskFamily", "language", "risk", "scope"].includes(key) === false && value === true).map(([key]) => key).slice(0, 12) : [];
				return ["Learned Behavior", `task family: ${typeof view.taskFamily === "string" ? view.taskFamily : String(signature?.taskFamily ?? "general")}`, `language: ${String(signature?.language ?? "mixed")}`, `preferred action: ${view.action === "mission" ? "MISSION" : "NORMAL"}`, `source: ${view.source === "explicit" ? "explicit" : "learned"}`, `confidence: ${typeof view.confidence === "number" ? view.confidence.toFixed(2) : "unknown"}`, `observations: ${String(view.observations ?? "unknown")}`, `enabled: ${view.enabled !== false}`, `abstract signals: ${flags.join(", ") || "none"}`].join("\n");
			};
			ctx.ui.notify(["Learned Behaviors", ...(views.length === 0 ? ["No routing preferences recorded"] : views.map(label)), "Rules contain abstract signatures only; prompts and reasoning are never shown."].join("\n"), "info");
			if (ctx.mode !== "tui" && !ctx.hasUI) return;
			while (true) {
				const choices = [...views.map(label), "Forget learned behaviors", "Reset all routing memory", "Back"];
				const choice = await ctx.ui.select("Learned Behaviors", choices);
				if (!choice || choice === "Back") return;
				if (choice === "Forget learned behaviors") {
					if (!(await ctx.ui.confirm("Forget learned behaviors?", "Explicit Always rules will be retained"))) continue;
					await Promise.resolve(routingMemory.forgetLearned());
					recordMemoryAction("learned_reset");
					ctx.ui.notify("Learned routing behaviors forgotten; explicit rules retained.", "info");
					return;
				}
				if (choice === "Reset all routing memory") {
					if (!(await ctx.ui.confirm("Reset all routing memory?", "This removes explicit and learned rules"))) continue;
					await Promise.resolve(routingMemory.reset());
					recordMemoryAction("full_reset");
					ctx.ui.notify("All routing memory reset.", "info");
					return;
				}
				const index = views.map(label).indexOf(choice);
				const selected = index >= 0 ? views[index] : undefined;
				if (!selected || typeof selected.id !== "string") return;
				ctx.ui.notify(details(selected), "info");
				const action = await ctx.ui.select("Routing rule", ["Inspect", selected.enabled === false ? "Enable" : "Disable", "Forget rule", "Back"]);
				if (action === "Inspect") ctx.ui.notify(details(selected), "info");
				else if (action === "Enable" || action === "Disable") {
					await Promise.resolve(routingMemory.setEnabled(selected.id, action === "Enable"));
					if (action === "Disable") recordMemoryAction("rule_disabled");
					ctx.ui.notify(`Routing rule ${action === "Enable" ? "enabled" : "disabled"}.`, "info");
				} else if (action === "Forget rule" && await ctx.ui.confirm("Forget this routing rule?", selected.id)) {
					await Promise.resolve(routingMemory.deleteRule(selected.id));
					recordMemoryAction("rule_deleted");
					ctx.ui.notify("Routing rule forgotten.", "info");
				}
				return;
			}
		} catch (error) {
			notifyError(ctx, "Learned Behaviors failed", error);
		}
	};

	const openRoutingSettings = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (!configStore && !smartRoutingStore) {
			ctx.ui.notify("Routing settings are unavailable until the configuration store is configured", "error");
			return;
		}
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("Routing settings require TUI or RPC UI mode", "error");
			return;
		}
		if (!requireIdle(ctx, "routing policy")) return;
		try {
			const loaded = configStore ? await configStore.load() : undefined;
			const current = loaded?.snapshot?.config.routing ?? createDefaultConfig().routing;
			const smart = await loadSmartRoutingSettings();
			const routeEntries: Array<{ readonly routeId: StableId; readonly label: string; readonly state: "available" | "missing" | "stale" | "unavailable" }> = (await manager.list()).flatMap((entry) => {
				if (!entry.routeId) return [];
				const state = entry.missing ? "missing" : entry.stale ? "stale" : entry.available === false ? "unavailable" : "available";
				return [{ routeId: entry.routeId as StableId, label: `${entry.displayName ?? entry.remoteModelId} — ${entry.routeId} [${state}]`, state }];
			});
			for (const routeId of [smart.primaryRouteId, smart.fallbackRouteId]) {
				if (routeId && !routeEntries.some((entry) => entry.routeId === routeId)) routeEntries.push({ routeId, label: `Configured route — ${routeId} [missing or stale]`, state: "missing" });
			}
			const routeOptions = [...new Map(routeEntries.map((entry) => [entry.routeId, entry])).values()];
			const primaryEntry = smart.primaryRouteId === undefined ? undefined : routeEntries.find((entry) => entry.routeId === smart.primaryRouteId);
			const triageLabel = primaryEntry?.state !== "available" ? "UNAVAILABLE" : smart.aiTriageEnabled ? "ON" : "OFF";
			const choice = await ctx.ui.select("Routing & Fallback", [
				`Smart Routing (${smart.enabled ? "ON" : "OFF"})`,
				`Routing Memory (${smart.routingMemoryEnabled ? "ON" : "OFF"})`,
				`Learn from routing choices (${smart.learnFromRoutingChoices ? "ON" : "OFF"})`,
				"Learned Behaviors",
				`AI Triage (${triageLabel})`,
				`Triage Primary (${smart.primaryRouteId ?? "None"})`,
				`Triage Fallback (${smart.fallbackRouteId ?? "None"})`,
				"AI usage (ambiguous prompts only)",
				`Max attempts (${current.maxAttempts})`,
				`Timeout ms (${current.timeoutMs})`,
				`Rate-limit cooldown ms (${current.rateLimitCooldownMs})`,
				`Quota cooldown ms (${current.quotaCooldownMs})`,
				`Fallback enabled (${current.fallback.enabled})`,
				`Diversity (${current.diversityPreference})`,
				"Back",
			]);
			if (!choice || choice === "Back") return;
			if (choice.startsWith("Smart Routing")) {
				await updateSmartRoutingSettings((draft) => ({ ...draft, enabled: !smart.enabled }));
			} else if (choice.startsWith("Routing Memory")) {
				await updateSmartRoutingSettings((draft) => ({ ...draft, routingMemoryEnabled: !smart.routingMemoryEnabled }));
			} else if (choice.startsWith("Learn from routing choices")) {
				await updateSmartRoutingSettings((draft) => ({ ...draft, learnFromRoutingChoices: !smart.learnFromRoutingChoices }));
			} else if (choice === "Learned Behaviors") {
				await showLearnedBehaviors(ctx);
				return;
			} else if (choice.startsWith("AI Triage")) {
				if (!smart.aiTriageEnabled && (!primaryEntry || primaryEntry.state !== "available")) {
					ctx.ui.notify("Configure an available Triage Primary route before enabling AI Triage.", "warning");
					return;
				}
				await updateSmartRoutingSettings((draft) => ({ ...draft, aiTriageEnabled: !smart.aiTriageEnabled }));
			} else if (choice.startsWith("Triage Primary")) {
				const labels = ["None", ...routeOptions.map((entry) => entry.label), "Back"];
				const selected = await ctx.ui.select("Triage Primary route", labels);
				if (selected && selected !== "Back") {
					const entry = routeOptions.find((candidate) => candidate.label === selected);
					await updateSmartRoutingSettings((draft) => {
						const { primaryRouteId: _old, ...rest } = draft;
						return entry ? { ...rest, primaryRouteId: entry.routeId, aiTriageEnabled: entry.state === "available" } : { ...rest, aiTriageEnabled: false };
					});
				}
			} else if (choice.startsWith("Triage Fallback")) {
				const labels = ["None", ...routeOptions.map((entry) => entry.label), "Back"];
				const selected = await ctx.ui.select("Triage Fallback route", labels);
				if (selected && selected !== "Back") {
					const entry = routeOptions.find((candidate) => candidate.label === selected);
					await updateSmartRoutingSettings((draft) => {
						const { fallbackRouteId: _old, ...rest } = draft;
						return entry ? { ...rest, fallbackRouteId: entry.routeId } : rest;
					});
				}
			} else if (choice.startsWith("AI usage")) {
				ctx.ui.notify("AI Triage runs only for locally ambiguous prompts.", "info");
			} else if (choice.startsWith("Fallback enabled")) {
				if (!configStore) throw new Error("configuration unavailable");
				await configStore.update((draft) => { draft.routing.fallback.enabled = !current.fallback.enabled; });
			} else if (choice.startsWith("Diversity")) {
				if (!configStore) throw new Error("configuration unavailable");
				const value = await ctx.ui.select("Diversity preference", ["none", "prefer-different-family", "prefer-different-resource", "require-different-family", "require-different-resource"]);
				if (value) await configStore.update((draft) => { draft.routing.diversityPreference = value as typeof draft.routing.diversityPreference; });
			} else {
				if (!configStore) throw new Error("configuration unavailable");
				const raw = await ctx.ui.input("New routing value", "");
				const value = Number.parseInt(raw?.trim() ?? "", 10);
				if (!Number.isInteger(value) || value < 0) {
					ctx.ui.notify("Routing value must be a non-negative integer", "error");
					return;
				}
				await configStore.update((draft) => {
					if (choice.startsWith("Max attempts")) draft.routing.maxAttempts = value;
					else if (choice.startsWith("Timeout")) draft.routing.timeoutMs = value;
					else if (choice.startsWith("Rate-limit")) draft.routing.rateLimitCooldownMs = value;
					else draft.routing.quotaCooldownMs = value;
				});
			}
			ctx.ui.notify("Routing settings saved", "info");
		} catch (error) {
			notifyError(ctx, "Routing settings failed", error);
		}
	};

	const missionStatusLabel = (mission: MissionRecord): string =>
		`${mission.missionId} [${mission.status}] rev ${mission.revision} — ${mission.goal.replace(/[\r\n\u2028\u2029]+/gu, " ")}`;

	const missionCreatedMessage = (mission: MissionRecord): string => [
		"Mission created",
		`Goal: ${mission.goal.replace(/[\r\n\u2028\u2029]+/gu, " ")}`,
		`Status: ${mission.status}`,
		`Next: open /missions ${mission.missionId} to add a Task`,
		`Mission ID: ${mission.missionId}`,
	].join("\n");

	const appendMissionPointer = (mission: MissionRecord): boolean => {
		// The session entry is only a pointer/status hint. Canonical state remains in
		// MissionStore and is never copied into Pi's LLM context.
		if (typeof (pi as unknown as { appendEntry?: unknown }).appendEntry !== "function") return true;
		try {
			pi.appendEntry("pi-multi-orchestrator:mission", {
				missionId: mission.missionId,
				status: mission.status,
				revision: mission.revision,
			});
			return true;
		} catch {
			return false;
		}
	};

	const missionStoreUnavailable = (ctx: ExtensionContext | ExtensionCommandContext): void => {
		ctx.ui.notify("Mission control is unavailable until the runtime mission store is configured", "error");
	};
	const showMissionPacket = async (ctx: ExtensionCommandContext, missionId: string, taskId: string): Promise<void> => {
		const store = options.missionStore;
		const broker = options.contextBroker;
		if (!store || !broker) { ctx.ui.notify("Mission packet generation is unavailable", "error"); return; }
		try {
			const task = store.getTask(taskId);
			if (!task || String(task.missionId) !== missionId) { ctx.ui.notify("Task was not found for this mission", "error"); return; }
			const revision = store.getMission(missionId)?.revision;
			const packet = broker.buildPacket({ missionId, taskId, ...(revision === undefined ? {} : { sourceMissionRevision: revision }) });
			store.saveTaskPacket(taskId, packet, task.revision);
			ctx.ui.notify(renderTaskPacketPrompt(packet), "info");
		} catch (error) { notifyError(ctx, "Mission packet failed", error); }
	};

	const qualityGetter = <T>(name: string): ((...args: readonly string[]) => T) | undefined => {
		const candidate = qualityStore as unknown as Record<string, unknown> | undefined;
		const method = candidate?.[name];
		return typeof method === "function" ? method as (...args: readonly string[]) => T : undefined;
	};

	const taskQualityStatus = (taskId: string): TaskQualityStatus | undefined => {
		const get = qualityGetter<TaskQualityStatus | undefined>("getTaskQualityStatus");
		return get ? get.call(qualityStore, taskId) : undefined;
	};

	const qualityList = <T>(name: string, missionId: string, taskId?: string): readonly T[] => {
		const list = qualityGetter<readonly T[]>(name);
		if (!list) return [];
		return list.call(qualityStore, missionId, ...(taskId === undefined ? [] : [taskId])) ?? [];
	};

	const qualityStatusLabel = (status: TaskQualityStatus | undefined): string =>
		status ? `${status.status} (round ${status.qualityRound})` : "unverified (round 0)";

	const qualityTaskDetails = (missionId: string, taskId: string, status: TaskQualityStatus | undefined): string[] => {
		const verifications = qualityList<VerificationRunRecord>("listVerificationRuns", missionId, taskId);
		const decisions = qualityList<{ readonly verdict: string; readonly reviewerSummary?: string; readonly reviewerRouteId?: string; readonly findings?: readonly string[]; readonly requiredFixes?: readonly string[] }>("listQualityDecisions", missionId, taskId);
		const escalations = qualityList("listQualityEscalations", missionId, taskId);
		const latestDecision = decisions.length > 0 ? decisions[decisions.length - 1] : undefined;
		return [
			`quality status: ${qualityStatusLabel(status)}`,
			`verification runs: ${verifications.length}`,
			`quality decisions: ${decisions.length}${latestDecision?.verdict ? ` (latest ${latestDecision.verdict})` : ""}`,
			`quality escalations: ${escalations.length}`,
		];
	};

	const qualityHistoryText = (missionId: string, taskId: string): string => {
		const verifications = qualityList<VerificationRunRecord>("listVerificationRuns", missionId, taskId);
		const decisions = qualityList<{ readonly decisionId?: string; readonly verdict: string; readonly round: number; readonly reviewerSummary?: string; readonly reviewerRouteId?: string; readonly findings?: readonly string[]; readonly requiredFixes?: readonly string[] }>("listQualityDecisions", missionId, taskId);
		const lines = ["Canonical Mission quality (M7)", `mission: ${missionId}`, `task: ${taskId}`, `verification history: ${verifications.length}`];
		for (const run of verifications) lines.push(`  run ${run.verificationId} round ${run.round}: ${run.status}${run.reviewerRouteId ? ` reviewer=${run.reviewerRouteId}` : ""}`);
		lines.push(`decisions: ${decisions.length}`);
		for (const decision of decisions) {
			lines.push(`  ${decision.decisionId ?? "decision"} round ${decision.round}: ${decision.verdict}${decision.reviewerRouteId ? ` reviewer=${decision.reviewerRouteId}` : ""}`);
			if (decision.reviewerSummary) lines.push(`    summary: ${decision.reviewerSummary}`);
			if (decision.findings?.length) lines.push(`    findings: ${decision.findings.join("; ")}`);
			if (decision.requiredFixes?.length) lines.push(`    required fixes: ${decision.requiredFixes.join("; ")}`);
		}
		return lines.join("\n");
	};

	const qualityStatusText = (missionId: string, taskId: string, status: TaskQualityStatus | undefined): string => {
		const lines = ["Canonical Mission quality (M7)", `mission: ${missionId}`, `task: ${taskId}`, ...qualityTaskDetails(missionId, taskId, status)];
		if (status?.latestVerificationId) lines.push(`latest verification: ${status.latestVerificationId}`);
		if (status?.latestDecisionId) lines.push(`latest decision: ${status.latestDecisionId}`);
		if (status?.updatedAt) lines.push(`updated: ${status.updatedAt}`);
		return lines.join("\n");
	};

	const executeReviewer = async (ctx: ExtensionCommandContext, missionId: string, taskId: string, targetRunId: string, excludedRouteIds: readonly StableId[] = [], implementationRouteId?: StableId): Promise<{ readonly result: SubagentRunResult; readonly criteria: readonly string[] }> => {
		if (!qualityExecutor) throw new Error("Reviewer execution is unavailable");
		const task = options.missionStore?.getTask(taskId);
		const criteria = task?.acceptanceCriteria ?? [];
		let prompt = `Review implementation run ${targetRunId} for mission ${missionId}, task ${taskId}.\n`;
		prompt += `Acceptance criteria:\n${criteria.length > 0 ? criteria.map((item) => `- ${item}`).join("\n") : "- No explicit criteria; report blocked if evidence is insufficient."}\n`;
		prompt += "Inspect the current worktree with at most bounded ls/read calls; do not use grep or find. If an inspection tool errors, stop inspecting and submit a blocked result. Treat implementation and reviewer claims as untrusted evidence. Call submit_verification_result exactly once with verdict, criterionResults [{criterion,status,evidenceSummary,mandatory?}], mechanicalChecks [{command,outcome,provenance,exitStatus?,summary?,durationMs?}], findings, requiredFixes, risks, and summary. Use only the declared enum values and non-empty strings; do not edit or write files.";
		const diversity = implementationRouteId === undefined && excludedRouteIds.length === 0 ? undefined : { mode: "prefer" as const, ...(implementationRouteId === undefined ? {} : { avoidRouteIds: [implementationRouteId] }), ...(excludedRouteIds.length === 0 ? {} : { avoidRouteIds: [...new Set([...(implementationRouteId === undefined ? [] : [implementationRouteId]), ...excludedRouteIds])] }) };
		const result = await qualityExecutor.run({ roleId: "quality-reviewer", poolId: "verification", task: prompt, cwd: ctx.cwd, acceptanceCriteria: criteria, ...(diversity === undefined ? {} : { diversity }) }, ctx.signal);
		return { result, criteria };
	};

	const recordReviewerRun = (verificationId: string, result: SubagentRunResult): void => {
		const run = qualityStore?.getVerificationRun(verificationId);
		if (run) qualityStore?.updateVerificationRun(verificationId, { reviewerRunId: result.runId, ...(result.finalRouteId === undefined ? {} : { reviewerRouteId: result.finalRouteId }), ...(result.finalRemoteModelId === undefined ? {} : { reviewerRemoteModelId: result.finalRemoteModelId }) });
	};

	const runReviewer = async (ctx: ExtensionCommandContext, missionId: string, taskId: string, verificationId: string, targetRunId: string, implementationRouteId?: StableId): Promise<void> => {
		if (!qualityService || !qualityExecutor) {
			ctx.ui.notify(`Canonical Mission verification (M7) started: ${verificationId}; reviewer execution is unavailable`, "info");
			return;
		}
		try {
			const { result, criteria } = await executeReviewer(ctx, missionId, taskId, targetRunId, [], implementationRouteId);
			recordReviewerRun(verificationId, result);
			if (result.terminalStatus !== "completed") {
				qualityService.failVerification(verificationId, result.potentialMutationObserved ? "interrupted" : "blocked", result.summary);
				recordAnalytics({ eventId: `quality-${verificationId}-blocked`, occurredAt: new Date().toISOString(), eventType: "quality", missionId, taskId, runId: targetRunId, verificationId, poolId: "verification", ...(result.finalRouteId === undefined ? {} : { routeId: result.finalRouteId }), outcome: result.terminalStatus, qualityOutcome: "blocked" });
				ctx.ui.notify(`Canonical Mission verification (M7) ${verificationId} ${result.terminalStatus}; quality remains review_required`, "warning");
				return;
			}
			const completed = qualityService.completeVerification(verificationId, result.protocolResult ?? result.structuredResult, criteria);
				recordAnalytics({ eventId: `quality-${completed.decision.decisionId}`, occurredAt: completed.decision.createdAt, eventType: "quality", missionId, taskId, runId: targetRunId, verificationId, qualityRound: completed.run.round, poolId: "implementation", ...(completed.run.implementationRouteId === undefined ? {} : { routeId: completed.run.implementationRouteId }), outcome: completed.decision.verdict, qualityOutcome: completed.decision.verdict, firstPass: completed.decision.verdict === "pass" && completed.run.round === 0, repairRound: completed.run.round, dimensions: completed.run.reviewerRouteId === undefined ? {} : { reviewerRouteId: completed.run.reviewerRouteId } });
			ctx.ui.notify(`Canonical Mission quality (M7) ${completed.decision.verdict}: ${completed.decision.reviewerSummary}`, completed.decision.verdict === "pass" ? "info" : "warning");
		} catch (error) {
			try { qualityService.failVerification(verificationId, "blocked", "Reviewer protocol or infrastructure result was unavailable"); } catch { /* preserve original bounded diagnostic */ }
			notifyError(ctx, "Task verification failed", error);
		}
	};

	const showQualityStatus = async (ctx: ExtensionCommandContext, args?: string): Promise<void> => {
		if (!qualityStore || !qualityGetter("getTaskQualityStatus")) {
			ctx.ui.notify("Quality status is unavailable until quality persistence is configured", "error");
			return;
		}
		const [missionId, taskId] = (args?.trim() ?? "").split(/\s+/u).filter(Boolean);
		try {
			if (missionId && taskId) {
				const task = options.missionStore?.getTask(taskId);
				if (task && String(task.missionId) !== missionId) {
					ctx.ui.notify("Task does not belong to the requested mission", "error");
					return;
				}
				ctx.ui.notify(qualityStatusText(missionId, taskId, taskQualityStatus(taskId)), "info");
				return;
			}
			if (!missionId) {
				const missions = options.missionStore ? await Promise.resolve(options.missionStore.listMissions()) : [];
				const lines: string[] = [];
				for (const mission of missions) {
					const tasks = options.missionStore ? options.missionStore.listTasks(mission.missionId) : [];
					if (tasks.length === 0) lines.push(`${mission.missionId}: no tasks`);
					for (const task of tasks) lines.push(`${mission.missionId}/${task.taskId}: ${qualityStatusLabel(taskQualityStatus(String(task.taskId)))}`);
				}
				ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "Usage: /quality-status <mission-id> [task-id]", lines.length > 0 ? "info" : "warning");
				return;
			}
			const tasks = options.missionStore ? options.missionStore.listTasks(missionId) : [];
			if (tasks.length > 0) {
				ctx.ui.notify(tasks.map((task) => `${task.taskId}: ${qualityStatusLabel(taskQualityStatus(String(task.taskId)))}`).join("\n"), "info");
				return;
			}
			const status = qualityList<TaskQualityStatus>("listVerificationRuns", missionId).length;
			ctx.ui.notify(status > 0 ? `${missionId}: ${status} verification run${status === 1 ? "" : "s"}` : `No tasks recorded for mission ${missionId}`, status > 0 ? "info" : "warning");
		} catch (error) { notifyError(ctx, "Quality status failed", error); }
	};

	const startTaskVerification = async (ctx: ExtensionCommandContext, missionId: string, taskId: string, requestedRunId?: string): Promise<void> => {
		if (!qualityService) {
			ctx.ui.notify("Task verification is unavailable until the quality service is configured", "error");
			return;
		}
		if (!requireIdle(ctx, "task verification")) return;
		const task = options.missionStore?.getTask(taskId);
		if (options.missionStore && !task) {
			ctx.ui.notify("Task was not found for this mission", "error");
			return;
		}
		if (task && String(task.missionId) !== missionId) {
			ctx.ui.notify("Task does not belong to the requested mission", "error");
			return;
		}
		const targetRunId = requestedRunId?.trim() || task?.lastRunId;
		if (!targetRunId) {
			ctx.ui.notify("Task verification requires a completed task run; pass a target run id or run the task first", "warning");
			return;
		}
		const targetAttempt = options.missionStore?.getAttempt(targetRunId);
		if (options.missionStore && !targetAttempt) {
			ctx.ui.notify("Target run was not found", "error");
			return;
		}
		if (targetAttempt && ((targetAttempt.missionId !== undefined && String(targetAttempt.missionId) !== missionId) || (targetAttempt.taskId !== undefined && String(targetAttempt.taskId) !== taskId))) {
			ctx.ui.notify("Target run does not belong to the requested mission task", "error");
			return;
		}
		if (targetAttempt?.status === "running") {
			ctx.ui.notify("Target run must be terminal before verification", "warning");
			return;
		}
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("Task verification requires explicit TUI confirmation", "error");
			return;
		}
		const confirmed = await ctx.ui.confirm("Start task verification?", `${missionId}/${taskId} target ${targetRunId}`);
		if (!confirmed) return;
		try {
			const status = taskQualityStatus(taskId);
			if (status?.status === "verification_running") {
				ctx.ui.notify(`Canonical Mission verification (M7) is already running (${status.latestVerificationId ?? "unknown run"})`, "warning");
				return;
			}
			const packet = task?.packet && typeof task.packet === "object" && typeof (task.packet as Record<string, unknown>).packetId === "string"
				? String((task.packet as Record<string, unknown>).packetId)
				: undefined;
			const run = qualityService.startVerification({
				missionId,
				taskId,
				targetRunId,
				...(packet ? { targetPacketId: packet } : {}),
				round: status?.qualityRound ?? 0,
				...(targetAttempt?.routeId === undefined ? {} : { implementationRouteId: targetAttempt.routeId }),
				...(task?.lastRunId ? {} : { potentialMutationObserved: false }),
			});
			if (qualityExecutor) await runReviewer(ctx, missionId, taskId, run.verificationId, targetRunId, targetAttempt?.routeId);
			else ctx.ui.notify(`Canonical Mission verification (M7) started: ${run.verificationId}; reviewer result is still required`, "info");
		} catch (error) { notifyError(ctx, "Task verification failed", error); }
	};

	const startQualityLoop = async (ctx: ExtensionCommandContext, missionId: string, taskId: string): Promise<void> => {
		if (!qualityService || !qualityExecutor || !subagentExecutor || !options.missionStore || !options.contextBroker) {
			ctx.ui.notify("Quality loop is unavailable until reviewer, repair, and mission services are configured", "error");
			return;
		}
		if (!requireIdle(ctx, "quality loop")) return;
		const task = options.missionStore.getTask(taskId);
		if (!task || String(task.missionId) !== missionId || task.status !== "execution_completed") {
			ctx.ui.notify("Quality loop requires an execution-completed task", "warning");
			return;
		}
		const targetAttempt = task.lastRunId ? options.missionStore.getAttempt(task.lastRunId) : undefined;
		let targetRunId = task.lastRunId;
		let implementationRouteId = targetAttempt?.routeId as StableId | undefined;
		if (!targetRunId) { ctx.ui.notify("Quality loop requires a completed task run", "warning"); return; }
		const confirmed = await ctx.ui.confirm("Run bounded quality loop?", "Verification is read-only; repair rounds may modify the shared worktree (maximum 2 repairs). ");
		if (!confirmed) return;
		try {
			const loop = await qualityService.runQualityLoop({
				authorizedForMutation: true,
				maxRounds: 2,
				diversity: "prefer",
				acceptanceCriteria: task.acceptanceCriteria,
				verify: async (round, exclusions) => {
					const verification = qualityService.startVerification({ missionId, taskId, targetRunId: targetRunId!, round, ...(implementationRouteId === undefined ? {} : { implementationRouteId }), });
					try {
						const executed = await executeReviewer(ctx, missionId, taskId, targetRunId!, exclusions as StableId[], implementationRouteId);
						recordReviewerRun(verification.verificationId, executed.result);
						if (executed.result.terminalStatus !== "completed") {
							qualityService.failVerification(verification.verificationId, executed.result.potentialMutationObserved ? "interrupted" : "blocked", executed.result.summary);
							throw new Error("Reviewer infrastructure did not complete");
						}
						return { verificationId: verification.verificationId, result: executed.result.protocolResult ?? executed.result.structuredResult, ...(implementationRouteId === undefined ? {} : { implementationRouteId }) };
					} catch (error) {
						try { qualityService.failVerification(verification.verificationId, "blocked", "Reviewer execution was unavailable"); } catch { /* preserve original failure */ }
						throw error;
					}
				},
				repair: async (_round, feedback, exclusions) => {
					if (task.executionClass !== "implementation" && task.poolId !== "implementation") throw new Error("Quality repair requires the Implementation pool");
					const repaired = await executeMissionTask({ store: options.missionStore!, contextBroker: options.contextBroker!, executor: subagentExecutor!, missionId, taskId, cwd: ctx.cwd, ...(analyticsStore ? { analytics: analyticsStore } : {}), ...(ctx.signal === undefined ? {} : { signal: ctx.signal }), ...(exclusions.length === 0 ? {} : { excludedRouteIds: exclusions as StableId[] }), allowQualityRepair: true, repairFeedback: feedback });
					targetRunId = repaired.attempt.attemptId;
					implementationRouteId = repaired.attempt.routeId as StableId | undefined;
					return { implementationRouteId: repaired.attempt.routeId ?? exclusions[0] ?? "repair-route" };
				},
			});
			for (const decision of qualityList<{ readonly decisionId: string; readonly verificationId: string; readonly targetRunId: string; readonly round: number; readonly verdict: "pass" | "reject" | "blocked"; readonly reviewerRouteId?: string; readonly implementationRouteId?: string; readonly createdAt: string }>("listQualityDecisions", missionId, taskId)) recordAnalytics({ eventId: `quality-${decision.decisionId}`, occurredAt: decision.createdAt, eventType: "quality", missionId, taskId, runId: decision.targetRunId, verificationId: decision.verificationId, qualityRound: decision.round, poolId: "implementation", ...(decision.implementationRouteId === undefined ? {} : { routeId: decision.implementationRouteId }), outcome: decision.verdict, qualityOutcome: decision.verdict, firstPass: decision.verdict === "pass" && decision.round === 0, repairRound: decision.round, dimensions: decision.reviewerRouteId === undefined ? {} : { reviewerRouteId: decision.reviewerRouteId } });
			ctx.ui.notify(`Quality loop ${loop.status} after round ${loop.rounds}`, loop.status === "passed" ? "info" : "warning");
		} catch (error) { notifyError(ctx, "Quality loop failed", error); }
	};

	const createMissionTask = async (ctx: ExtensionCommandContext, mission: MissionRecord): Promise<void> => {
		const store = options.missionStore;
		if (!store) { missionStoreUnavailable(ctx); return; }
		if (ctx.mode !== "tui" && !ctx.hasUI) { ctx.ui.notify("Task creation requires TUI or RPC UI mode", "error"); return; }
		if (!requireIdle(ctx, "mission task")) return;
		const roleId = (await ctx.ui.input("Role ID", "implementer"))?.trim();
		if (!roleId) return;
		const pool = await ctx.ui.select("Execution pool", [...POOL_IDS, "Back"]);
		if (!pool || pool === "Back" || !isPoolId(pool)) return;
		const executionClass = await ctx.ui.select("Execution class", ["investigation", "implementation", "verification", "Back"]);
		if (!executionClass || executionClass === "Back") return;
		const objective = (await ctx.ui.input("Task objective", "Describe the bounded task"))?.trim();
		if (!objective) return;
		const criteriaText = await ctx.ui.input("Acceptance criteria (optional; separate with ;)", "focused test passes");
		try {
			const task = store.createTask({
				missionId: mission.missionId,
				roleId,
				poolId: pool,
				executionClass: executionClass as "investigation" | "implementation" | "verification",
				objective,
				...(criteriaText?.trim() ? { acceptanceCriteria: criteriaText.split(";").map((value) => value.trim()).filter(Boolean) } : {}),
			});
			ctx.ui.notify(`Task created: ${task.taskId}`, "info");
		} catch (error) { notifyError(ctx, "Task creation failed", error); }
	};

	const showMissionTask = async (ctx: ExtensionCommandContext, mission: MissionRecord, task: import("../core/mission/types.js").TaskRecord): Promise<void> => {
		const store = options.missionStore;
		if (!store) { missionStoreUnavailable(ctx); return; }
		const details = [
			`task: ${task.taskId}`,
			`status: ${task.status}`,
			`role: ${task.roleId}`,
			`pool: ${task.poolId ?? "unassigned"}`,
			`execution class: ${task.executionClass}`,
			`objective: ${task.objective}`,
			`acceptance criteria: ${task.acceptanceCriteria.length}`,
			`packet revision: ${task.packetRevision}`,
			...qualityTaskDetails(String(mission.missionId), String(task.taskId), taskQualityStatus(String(task.taskId))),
		].join("\n");
		if (ctx.mode !== "tui" && !ctx.hasUI) { ctx.ui.notify(details, "info"); return; }
		const qualityStatus = taskQualityStatus(String(task.taskId));
		const verifyAction = qualityStatus?.latestVerificationId || qualityStatus?.status === "passed" || qualityStatus?.status === "rejected" || qualityStatus?.status === "blocked" ? "Re-verify" : "Verify";
		const actions = [
			"Inspect",
			"Quality status",
			...(qualityService ? [verifyAction] : []),
			...(qualityService && qualityExecutor && subagentExecutor && options.contextBroker ? ["Run quality loop"] : []),
			...(qualityStore ? ["Quality history"] : []),
			"Build packet",
			...(subagentExecutor && options.contextBroker ? ["Run task"] : []),
			"Back",
		];
		const action = await ctx.ui.select(details, actions);
		if (!action || action === "Back") return;
		if (action === "Inspect") { ctx.ui.notify(details, "info"); return; }
		if (action === "Quality status") { ctx.ui.notify(qualityStatusText(String(mission.missionId), String(task.taskId), taskQualityStatus(String(task.taskId))), "info"); return; }
		if (action === "Verify" || action === "Re-verify") { await startTaskVerification(ctx, String(mission.missionId), String(task.taskId)); return; }
		if (action === "Run quality loop") { await startQualityLoop(ctx, String(mission.missionId), String(task.taskId)); return; }
		if (action === "Quality history") { ctx.ui.notify(qualityHistoryText(String(mission.missionId), String(task.taskId)), "info"); return; }
		if (action === "Build packet") { await showMissionPacket(ctx, String(mission.missionId), String(task.taskId)); return; }
		if (action !== "Run task" || !subagentExecutor || !options.contextBroker) return;
		if (!requireIdle(ctx, "mission task")) return;
		if (task.executionClass === "implementation" && options.trustStore && !options.trustStore.isTrusted(ctx.cwd)) {
			ctx.ui.notify("TRUST REQUIRED — mutating mission execution is disabled for this project", "error");
			return;
		}
		if (task.executionClass === "implementation" && !(await ctx.ui.confirm("Run implementation task?", "The child may modify the current working tree."))) return;
		try {
			const result = await executeMissionTask({ store, contextBroker: options.contextBroker, executor: subagentExecutor, missionId: mission.missionId, taskId: task.taskId, cwd: ctx.cwd, ...(analyticsStore ? { analytics: analyticsStore } : {}) });
			ctx.ui.notify(`Task ${task.taskId} finished: ${result.run.terminalStatus}; evidence ${result.evidence?.status ?? "none"}`, "info");
		} catch (error) { notifyError(ctx, "Task execution failed", error); }
	};

	const listMissionTasks = async (ctx: ExtensionCommandContext, mission: MissionRecord): Promise<void> => {
		const store = options.missionStore;
		if (!store) { missionStoreUnavailable(ctx); return; }
		const tasks = [...store.listTasks(mission.missionId)];
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify(tasks.length === 0 ? "No tasks recorded" : tasks.map((task) => `${task.taskId} [${task.status}] ${task.objective}`).join("\n"), "info");
			return;
		}
		const labels = tasks.map((task) => `${task.taskId} [${task.status}] — ${task.objective}`);
		while (true) {
			const selected = await ctx.ui.select(`Tasks for ${mission.missionId}`, [...labels, "Create task", "Back"]);
			if (!selected || selected === "Back") return;
			if (selected === "Create task") { await createMissionTask(ctx, mission); return; }
			const index = labels.indexOf(selected);
			if (index >= 0 && tasks[index]) await showMissionTask(ctx, mission, tasks[index]!);
			return;
		}
	};

	const evidenceLabel = (evidence: EvidenceRecord): string =>
		`${evidence.evidenceId} [${evidence.status}] ${evidence.kind}`;

	const missionEvidence = (store: MissionStoreAdapter, missionId: string): readonly EvidenceRecord[] => {
		const list = (store as MissionStoreAdapter & { readonly listEvidence?: (id: string) => readonly EvidenceRecord[] }).listEvidence;
		return typeof list === "function" ? list.call(store, missionId) : [];
	};
	const missionCheckpoints = (store: MissionStoreAdapter, missionId: string): readonly unknown[] => {
		const list = (store as MissionStoreAdapter & { readonly listCheckpoints?: (id: string) => readonly unknown[] }).listCheckpoints;
		return typeof list === "function" ? list.call(store, missionId) : [];
	};
	const missionEvents = (store: MissionStoreAdapter, missionId: string): readonly unknown[] => {
		const list = (store as MissionStoreAdapter & { readonly listEvents?: (id: string) => readonly unknown[] }).listEvents;
		return typeof list === "function" ? list.call(store, missionId) : [];
	};

	const evidenceDetails = (evidence: EvidenceRecord): string => {
		const content = JSON.stringify(evidence.content);
		return [
			`evidence: ${evidence.evidenceId}`,
			`status: ${evidence.status}`,
			`kind: ${evidence.kind}`,
			`task: ${evidence.taskId ?? "unknown"}`,
			`attempt/run: ${evidence.attemptId ?? "unknown"} / ${evidence.runId ?? "unknown"}`,
			`route/model: ${evidence.routeId ?? "unknown"} / ${evidence.remoteModelId ?? "unknown"}`,
			`role/class: ${evidence.roleId ?? "unknown"} / ${evidence.executionClass ?? "unknown"}`,
			`packet revision: ${evidence.packetRevision ?? "unknown"}`,
			`source revision: ${evidence.sourceRevision ?? "unknown"}`,
			`admitted: ${evidence.admittedAt}`,
			`reviewed: ${evidence.reviewedAt ?? "not reviewed"}`,
			`content: ${content.length > 2_000 ? `${content.slice(0, 2_000)}…` : content}`,
			...(evidence.rejectionReason ? [`reason: ${evidence.rejectionReason}`] : []),
		].join("\n");
	};

	const showMissionEvidence = async (ctx: ExtensionCommandContext, mission: MissionRecord): Promise<void> => {
		const store = options.missionStore;
		if (!store) { missionStoreUnavailable(ctx); return; }
		const evidence = [...missionEvidence(store, String(mission.missionId))];
		if (typeof (store as MissionStoreAdapter & { readonly listEvidence?: unknown }).listEvidence !== "function") {
			ctx.ui.notify("Evidence review is unavailable for this mission store", "error");
			return;
		}
		if (evidence.length === 0) { ctx.ui.notify("No evidence recorded", "warning"); return; }
		const labels = evidence.map(evidenceLabel);
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify(evidence.map(evidenceDetails).join("\n\n"), "info");
			return;
		}
		while (true) {
			const selected = await ctx.ui.select(`Evidence for ${mission.missionId}`, [...labels, "Back"]);
			if (!selected || selected === "Back") return;
			const index = labels.indexOf(selected);
			const record = index >= 0 ? evidence[index] : undefined;
			if (!record) return;
			const actions = record.status === "proposed" ? ["Inspect", "Accept", "Reject", "Back"] : ["Inspect", "Back"];
			const action = await ctx.ui.select(evidenceDetails(record), actions);
			if (!action || action === "Back") return;
			if (action === "Inspect") { ctx.ui.notify(evidenceDetails(record), "info"); continue; }
			if (!requireIdle(ctx, "evidence review")) continue;
			try {
				if (action === "Accept") {
					const target = await ctx.ui.select("Canonical target", ["validatedFindings", "completedWork", "testReviewEvidence", "approvedDecisions", "Back"]);
					if (!target || target === "Back") continue;
					const currentMissionRevision = store.getMission(mission.missionId)?.revision;
					const accepted = store.promoteEvidence(record.evidenceId, {
						actor: "user",
						...(currentMissionRevision === undefined ? {} : { expectedRevision: currentMissionRevision }),
						target: target as "validatedFindings" | "completedWork" | "testReviewEvidence" | "approvedDecisions",
					});
					if (typeof (store as MissionStoreAdapter & { readonly recordCheckpoint?: unknown }).recordCheckpoint === "function") store.recordCheckpoint(mission.missionId, "evidence-promoted");
					ctx.ui.notify(`Evidence ${accepted.evidenceId} accepted`, "info");
					return;
				}
				const reason = await ctx.ui.input("Rejection reason", "Not sufficiently verified");
				if (!reason?.trim()) continue;
				const rejected = store.rejectEvidence(record.evidenceId, reason.trim(), "user");
				if (typeof (store as MissionStoreAdapter & { readonly recordCheckpoint?: unknown }).recordCheckpoint === "function") store.recordCheckpoint(mission.missionId, "status-changed");
				ctx.ui.notify(`Evidence ${rejected.evidenceId} rejected`, "info");
				return;
			} catch (error) {
				notifyError(ctx, "Evidence review failed", error);
			}
		}
	};

	const showMission = async (ctx: ExtensionCommandContext, mission: MissionRecord): Promise<void> => {
		const store = options.missionStore;
		if (!store) {
			missionStoreUnavailable(ctx);
			return;
		}
		const details = [
			`mission: ${mission.missionId}`,
			`status: ${mission.status}`,
			`revision: ${mission.revision}`,
			`goal: ${mission.goal}`,
			`repository: ${mission.repository.cwd ?? "unknown"}${mission.repository.revision ? ` @ ${mission.repository.revision}` : ""}`,
			`acceptance criteria: ${mission.acceptanceCriteria.length}`,
			`validated findings: ${mission.validatedFindings.length}`,
			`completed work: ${mission.completedWork.length}`,
			`next steps: ${mission.nextSteps.length}`,
			`tasks: ${store.listTasks(mission.missionId).length}`,
			`evidence: ${missionEvidence(store, String(mission.missionId)).length}`,
			`checkpoints: ${missionCheckpoints(store, String(mission.missionId)).length}`,
			`events: ${missionEvents(store, String(mission.missionId)).length}`,
		].join("\n");
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify(details, "info");
			return;
		}
		const actions = [
			"Inspect", "Tasks", "Evidence", "Checkpoint",
			...(mission.status === "paused" ? ["Resume mission"] : []),
			...(mission.status === "active" || mission.status === "running" ? ["Pause mission"] : []),
			"Start mission", "Awaiting review", "Complete", "Block", "Cancel", "Back",
		];
		const action = await ctx.ui.select(details, actions);
		if (!action || action === "Back") return;
		if (action === "Tasks") { await listMissionTasks(ctx, mission); return; }
		if (action === "Evidence") { await showMissionEvidence(ctx, mission); return; }
		if (action === "Checkpoint") {
			if (!requireIdle(ctx, "mission checkpoint")) return;
			if (typeof (store as MissionStoreAdapter & { readonly recordCheckpoint?: unknown }).recordCheckpoint !== "function") { ctx.ui.notify("Checkpointing is unavailable for this mission store", "error"); return; }
			try {
				const checkpoint = store.recordCheckpoint(mission.missionId, "manual");
				ctx.ui.notify(`Checkpoint ${checkpoint.checkpointId} recorded at revision ${checkpoint.revision}`, "info");
			} catch (error) { notifyError(ctx, "Checkpoint failed", error); }
			return;
		}
		if (action === "Inspect") {
			if (action === "Inspect") ctx.ui.notify(details, "info");
			return;
		}
		if (!requireIdle(ctx, "mission state")) return;
		const target: MissionStatus | undefined = action === "Start mission" || action === "Resume mission"
			? "running"
			: action === "Pause mission"
				? "paused"
			: action === "Awaiting review"
				? "awaiting-review"
				: action === "Complete"
					? "completed"
					: action === "Block"
						? "blocked"
						: action === "Cancel"
							? "cancelled"
							: undefined;
		if (!target) return;
		try {
			const updated = await Promise.resolve(store.transitionMission(mission.missionId, target, { actor: "boss", expectedRevision: mission.revision }));
			appendMissionPointer(updated);
			ctx.ui.notify(`Mission ${updated.missionId} is now ${updated.status}`, "info");
		} catch (error) {
			notifyError(ctx, "Mission transition failed", error);
		}
	};

	const createMission = async (ctx: ExtensionCommandContext): Promise<void> => {
		const store = options.missionStore;
		if (!store) {
			missionStoreUnavailable(ctx);
			return;
		}
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("Mission creation requires TUI or RPC UI mode", "error");
			return;
		}
		if (!requireIdle(ctx, "mission state")) return;
		const goal = await ctx.ui.input("Mission goal", "Describe the bounded mission");
		if (!goal?.trim()) return;
		const criteriaText = await ctx.ui.input("Acceptance criteria (optional; separate with ;)", "tests pass; review complete");
		try {
			const mission = await Promise.resolve(createCanonicalMission(store, goal, {
				repositoryCwd: ctx.cwd,
				...(criteriaText?.trim() ? { acceptanceCriteria: criteriaText.split(";").map((value) => value.trim()).filter(Boolean) } : {}),
			}));
			if (!appendMissionPointer(mission)) ctx.ui.notify("Mission created; the session pointer could not be saved.", "warning");
			ctx.ui.notify(missionCreatedMessage(mission), "info");
		} catch (error) {
			notifyError(ctx, "Mission creation failed", error);
		}
	};

	const createInputMission = (ctx: ExtensionContext, goal: string): MissionRecord | undefined => {
		if (!options.missionStore) {
			missionStoreUnavailable(ctx);
			return undefined;
		}
		try {
			const mission = createCanonicalMission(options.missionStore, goal, { repositoryCwd: ctx.cwd });
			if (!appendMissionPointer(mission)) ctx.ui.notify("Mission created; the session pointer could not be saved.", "warning");
			ctx.ui.notify(missionCreatedMessage(mission), "info");
			return mission;
		} catch (error) {
			notifyError(ctx, "Mission creation failed", error);
			return undefined;
		}
	};

	const memoryRuleWasCreated = (value: unknown): boolean => {
		const result = routingMemoryRecord(value);
		return result?.created === true || result?.ruleCreated === true;
	};
	const routingMemoryMutationGeneration = (value: unknown): number | undefined => {
		const result = routingMemoryRecord(value);
		return typeof result?.generation === "number" && Number.isSafeInteger(result.generation) && result.generation >= 0 ? result.generation : undefined;
	};
	const isRoutingMemoryCancellation = (error: unknown): boolean => error instanceof Error && error.message === "routing-memory-cancelled";
	const prepareRoutingMemoryRollback = async (memory: RoutingMemoryHostAdapter): Promise<RoutingMemoryRollback> => {
		const root = await mkdtemp(join(tmpdir(), "pi-multi-routing-memory-cancel-"));
		const backupPath = join(root, "before.json");
		try {
			await memory.backup(backupPath);
			const snapshotGeneration = routingMemoryMutationGeneration(JSON.parse(await readFile(backupPath, "utf8")) as unknown);
			if (snapshotGeneration === undefined) throw new Error("routing-memory-generation-unavailable");
			return {
				rollback: async (expectedGeneration) => {
					if (expectedGeneration === snapshotGeneration) return;
					if (expectedGeneration !== snapshotGeneration + 1) throw new Error("routing-memory-concurrent-write");
					await Promise.resolve(memory.restore(backupPath, { expectedGeneration }));
				},
				dispose: async () => { await rm(root, { recursive: true, force: true }); },
			};
		} catch {
			await rm(root, { recursive: true, force: true });
			throw new Error("routing-memory-backup-failed");
		}
	};
	const runCancellableMemoryMutation = async <T>(memory: RoutingMemoryHostAdapter, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<{ readonly value?: T; readonly cancelled: boolean }> => {
		if (signal?.aborted) return { cancelled: true };
		const rollback = signal === undefined ? undefined : await prepareRoutingMemoryRollback(memory);
		let rollbackAttempted = false;
		let rollbackFailure: unknown;
		const rollbackIfNeeded = async (value: unknown): Promise<void> => {
			if (rollbackAttempted || rollback === undefined) return;
			rollbackAttempted = true;
			try {
				const generation = routingMemoryMutationGeneration(value);
				if (generation === undefined) throw new Error("routing-memory-generation-unavailable");
				await rollback.rollback(generation);
			}
			catch (error) { rollbackFailure = error; throw error; }
		};
		let completedValue: unknown;
		try {
			if (signal?.aborted) return { cancelled: true };
			const value = await operation();
			completedValue = value;
			if (!signal?.aborted) return { value, cancelled: false };
			await rollbackIfNeeded(value);
			return { cancelled: true };
		} catch (error) {
			if (!signal?.aborted) throw error;
			if (isRoutingMemoryCancellation(error)) return { cancelled: true };
			if (rollbackFailure !== undefined) throw rollbackFailure;
			await rollbackIfNeeded(completedValue);
			if (rollbackFailure !== undefined) throw rollbackFailure;
			return { cancelled: true };
		} finally {
			await rollback?.dispose();
		}
	};
	const discardCancelledMemoryRule = async (memory: RoutingMemoryHostAdapter, value: unknown): Promise<void> => {
		const result = routingMemoryRecord(value);
		if (!result || !memoryRuleWasCreated(result)) return;
		const rule = routingMemoryRecord(result.rule) ?? result;
		const ruleId = typeof rule?.id === "string" ? rule.id : undefined;
		if (ruleId === undefined) return;
		try { await Promise.resolve(memory.deleteRule(ruleId)); } catch { /* cancellation cleanup is best effort */ }
	};

	const recordRoutingDecision = (decision: SmartRoutingDecision, action: AnalyticsRoutingTelemetryV1["action"], memory?: SmartRoutingDecision["memory"]): void => {
		if (!analyticsStore) return;
		const routing: AnalyticsRoutingTelemetryV1 = {
			decision: decision.mode === "NORMAL" ? "normal" : "suggest_mission",
			localPath: decision.local.path,
			triageCalls: decision.triage?.calls ?? 0,
			fallbackUsed: decision.triage?.fallbackUsed === true,
			reasonCodes: [...decision.reasonCodes],
			...(action === undefined ? {} : { action }),
			...(decision.triage?.failureClass === undefined ? {} : { failureClass: decision.triage.failureClass }),
			...(memory === undefined ? {} : { memory: { hit: true, ...(memory.source === undefined ? {} : { source: memory.source }), ...(memory.action === undefined ? {} : { action: memory.action }), ...(memory.confidence === undefined ? {} : { confidence: memory.confidence }), ...(memory.similarity === undefined ? {} : { similarity: memory.similarity }), ...(memory.conflict === undefined ? {} : { conflict: memory.conflict }) } }),
		};
		routingEventSequence += 1;
		recordAnalytics({
			eventId: `routing-${Date.now()}-${routingEventSequence}`,
			occurredAt: new Date().toISOString(),
			eventType: "routing",
			...(decision.triage?.routeId === undefined ? {} : { routeId: decision.triage.routeId }),
			...(decision.triage === undefined ? {} : { durationMs: decision.triage.latencyMs }),
			routing,
		});
	};
	const recordMemoryAction = (action: AnalyticsRoutingTelemetryV1["action"]): void => {
		if (!analyticsStore) return;
		routingEventSequence += 1;
		recordAnalytics({
			eventId: `routing-memory-${Date.now()}-${routingEventSequence}`,
			occurredAt: new Date().toISOString(),
			eventType: "routing",
			routing: { decision: "normal", localPath: "simple", triageCalls: 0, fallbackUsed: false, reasonCodes: ["routing_memory_hit"], ...(action === undefined ? {} : { action }) },
		});
	};

	const handleInput = async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> => {
		if (event.source === "extension") return { action: "continue" };
		if (event.text.length > MAX_ROUTING_INPUT_LENGTH) {
			if (/^\s*@orchestrator(?:\s|$)/iu.test(event.text.slice(0, 256))) {
				try { ctx.ui.setEditorText(event.text); } catch { return { action: "continue" }; }
				ctx.ui.notify("The prompt is too large for local routing; shorten it before using @orchestrator.", "warning");
				return { action: "handled" };
			}
			return { action: "continue" };
		}
		const invocation = parseOrchestratorInvocation(event.text);
		if (!invocation) {
			if (event.streamingBehavior !== undefined) return { action: "continue" };
			const inputCancelled = (): boolean => ctx.signal?.aborted === true;
			const memoryCallOptions = ctx.signal === undefined ? {} : { signal: ctx.signal };
			const smartSettings = await loadSmartRoutingSettings();
			const memoryProbe = await routingMemoryMatch(event.text, smartSettings);
			const memoryContext = routingMemoryContext(memoryProbe.match);
			let decision: SmartRoutingDecision;
			try { decision = await smartRouter.decide(event.text, ctx.signal, memoryContext === undefined ? undefined : { memoryRecommendation: memoryContext }); }
			catch {
				ctx.ui.notify("Smart Routing unavailable; continuing with the original prompt.", "warning");
				return { action: "continue" };
			}
			if (inputCancelled() || decision.triage?.failureClass === "cancelled") return { action: "continue" };
			if (decision.mode === "AUTO_MISSION") {
				if (inputCancelled()) return { action: "continue" };
				const mission = createInputMission(ctx, event.text);
				if (!mission) {
					recordRoutingDecision(decision, "failed", decision.memory);
					return { action: "continue" };
				}
				ctx.ui.notify(decision.memory?.source === "explicit" ? "Routed to Mission using your saved rule." : "Routed to Mission using a learned preference.", "info");
				recordRoutingDecision(decision, decision.memory?.source === "explicit" ? "auto_mission_explicit" : "auto_mission_learned", decision.memory);
				return { action: "handled" };
			}
			if (decision.mode === "NORMAL") {
				recordRoutingDecision(decision, decision.memory?.action === "normal" ? "learned_normal" : decision.memory?.conflict === true ? "memory_conflict" : "continued", decision.memory);
				return { action: "continue" };
			}
			if (decision.reasonCodes.includes("routing_memory_bypassed_complexity")) recordRoutingDecision(decision, "memory_bypassed_complexity");
			if (ctx.mode !== "tui" && !ctx.hasUI) {
				recordRoutingDecision(decision, "headless_normal");
				return { action: "continue" };
			}
			const locale = containsPersian(event.text) ? "fa" : "en";
			const reason = formatRoutingReasons(decision.reasonCodes, locale);
			ctx.ui.notify(`${locale === "fa" ? "پیشنهاد ارکستریتور" : "Orchestrator recommended"}\n${locale === "fa" ? "دلیل" : "Reason"}: ${reason || (locale === "fa" ? "کار چندمرحله‌ای" : "multi-step work")}`, "info");
			let action: string | undefined;
			try { action = await ctx.ui.select("Orchestrator recommended", ["Run as Mission", "Run Normally", "Always orchestrate similar tasks"]); }
			catch {
				recordRoutingDecision(decision, "failed");
				return { action: "continue" };
			}
			if (action === "Run as Mission") {
				if (inputCancelled()) return { action: "continue" };
				const mission = createInputMission(ctx, event.text);
				if (!mission) {
					recordRoutingDecision(decision, "failed", decision.memory);
					return { action: "continue" };
				}
				if (routingMemory && smartSettings.learnFromRoutingChoices) {
					try {
						const mutation = await runCancellableMemoryMutation(routingMemory, ctx.signal, () => Promise.resolve(routingMemory.observeChoice(memoryProbe.signature, "mission", memoryCallOptions)));
						if (mutation.cancelled) {
							await discardCancelledMemoryRule(routingMemory, mutation.value);
							return { action: "handled" };
						}
						const learned = mutation.value;
						if (inputCancelled()) {
							await discardCancelledMemoryRule(routingMemory, learned);
							return { action: "handled" };
						}
						if (memoryRuleWasCreated(learned)) recordRoutingDecision(decision, "rule_created_learned", decision.memory);
					} catch {
						if (inputCancelled()) ctx.ui.notify("Routing Memory cancellation cleanup failed; saved preferences need review.", "error");
					}
				}
				if (inputCancelled()) return { action: "handled" };
				recordRoutingDecision(decision, "run_as_mission", decision.memory);
				return { action: "handled" };
			}
			if (action === "Run Normally") {
				if (inputCancelled()) return { action: "continue" };
				// Pi's input runner continues this exact event once; it does not re-emit
				// the input handler, so no string sentinel or recursive dispatch is needed.
				if (routingMemory && smartSettings.learnFromRoutingChoices) {
					try {
						const mutation = await runCancellableMemoryMutation(routingMemory, ctx.signal, () => Promise.resolve(routingMemory.observeChoice(memoryProbe.signature, "normal", memoryCallOptions)));
						if (mutation.cancelled) {
							await discardCancelledMemoryRule(routingMemory, mutation.value);
							return { action: "handled" };
						}
						const learned = mutation.value;
						if (inputCancelled()) {
							await discardCancelledMemoryRule(routingMemory, learned);
							return { action: "handled" };
						}
						if (memoryRuleWasCreated(learned)) recordRoutingDecision(decision, "rule_created_learned", decision.memory);
					} catch {
						if (inputCancelled()) ctx.ui.notify("Routing Memory cancellation cleanup failed; saved preferences need review.", "error");
					}
				}
				if (inputCancelled()) return { action: "handled" };
				recordRoutingDecision(decision, "run_normally", decision.memory);
				return { action: "continue" };
			}
				if (action === "Always orchestrate similar tasks") {
					if (!routingMemory) {
					ctx.ui.notify("Routing Memory is unavailable; the original prompt will continue normally.", "warning");
					recordRoutingDecision(decision, "failed", decision.memory);
					return { action: "continue" };
				}
					if (inputCancelled()) return { action: "continue" };
					const mission = createInputMission(ctx, event.text);
					if (!mission) {
						recordRoutingDecision(decision, "failed", decision.memory);
						return { action: "continue" };
					}
					let explicitRuleCreated = false;
					try {
						const mutation = await runCancellableMemoryMutation(routingMemory, ctx.signal, () => Promise.resolve(routingMemory.addExplicitMissionRule(memoryProbe.signature, memoryCallOptions)));
						if (mutation.cancelled) {
							await discardCancelledMemoryRule(routingMemory, mutation.value);
							return { action: "handled" };
						}
						const saved = routingMemoryRecord(mutation.value);
						explicitRuleCreated = saved?.created === true;
						if (inputCancelled()) {
							await discardCancelledMemoryRule(routingMemory, saved);
							return { action: "handled" };
						}
					} catch {
						if (inputCancelled()) {
							ctx.ui.notify("Routing Memory cancellation cleanup failed; saved preferences need review.", "error");
							return { action: "handled" };
						}
						ctx.ui.notify("Mission created; the explicit routing preference could not be saved.", "warning");
						recordRoutingDecision(decision, "run_as_mission", decision.memory);
						return { action: "handled" };
					}
					if (inputCancelled()) return { action: "handled" };
					if (explicitRuleCreated) recordRoutingDecision(decision, "rule_created_explicit", { source: "explicit", action: "mission", confidence: 1, similarity: 1 });
				recordRoutingDecision(decision, "run_as_mission", { source: "explicit", action: "mission", confidence: 1, similarity: 1 });
				return { action: "handled" };
			}
			recordRoutingDecision(decision, "cancelled");
			try { ctx.ui.setEditorText(event.text); } catch { return { action: "continue" }; }
			ctx.ui.notify(locale === "fa" ? "پیشنهاد لغو شد؛ متن اصلی حفظ شد." : "Recommendation cancelled; the original prompt was preserved.", "info");
			return { action: "handled" };
		}
		if (!invocation.goal) {
			ctx.ui.notify("Add a goal after @orchestrator.", "warning");
			return { action: "handled" };
		}
		if (ctx.signal?.aborted === true) return { action: "continue" };
		const requeueOriginal = (): InputEventResult => {
			try { ctx.ui.setEditorText(event.text); }
			catch { return { action: "continue" }; }
			ctx.ui.notify("Mission entry failed; the original prompt was preserved in the editor.", "warning");
			return { action: "handled" };
		};
		const store = options.missionStore;
		if (!store) {
			missionStoreUnavailable(ctx);
			return requeueOriginal();
		}
		try {
			const mission = createCanonicalMission(store, invocation.goal, { repositoryCwd: ctx.cwd });
			if (!appendMissionPointer(mission)) ctx.ui.notify("Mission created; the session pointer could not be saved.", "warning");
			ctx.ui.notify(missionCreatedMessage(mission), "info");
		} catch (error) {
			notifyError(ctx, "Mission creation failed", error);
			return requeueOriginal();
		}
		return { action: "handled" };
	};

	const listMissionRecords = async (ctx: ExtensionCommandContext, requested?: string): Promise<void> => {
		const store = options.missionStore;
		if (!store) {
			missionStoreUnavailable(ctx);
			return;
		}
		try {
			const requestedId = requested?.trim();
			const records = requestedId
				? [await Promise.resolve(store.getMission(requestedId as MissionId))].filter((value): value is MissionRecord => value !== undefined)
				: [...await Promise.resolve(store.listMissions())];
			if (records.length === 0) {
				ctx.ui.notify(requestedId ? `Mission '${requestedId}' was not found` : "No missions recorded", "warning");
				return;
			}
			if (requestedId || (ctx.mode !== "tui" && !ctx.hasUI)) {
				if (records[0]) await showMission(ctx, records[0]);
				return;
			}
			const options = records.map(missionStatusLabel);
			while (true) {
				const selected = await ctx.ui.select("Missions", [...options, "Create mission", "Back"]);
				if (!selected || selected === "Back") return;
				if (selected === "Create mission") {
					await createMission(ctx);
					continue;
				}
				const index = options.indexOf(selected);
				if (index < 0 || !records[index]) return;
				await showMission(ctx, records[index]!);
				return;
			}
		} catch (error) {
			notifyError(ctx, "Mission list failed", error);
		}
	};

	const showContextMissionSettings = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (!configStore) {
			ctx.ui.notify("Context settings are unavailable until the configuration store is configured", "error");
			return;
		}
		try {
			const loaded = await configStore.load();
			const config = loaded.snapshot?.config;
			if (!config) {
				ctx.ui.notify("Context settings unavailable: configuration is not valid", "error");
				return;
			}
			const profile = config.operationalProfiles[config.activeOperationalProfileId];
			const details = [
				`active operational profile: ${profile?.displayName ?? config.activeOperationalProfileId}`,
				`context budget class: ${profile?.contextBudgetClass ?? "unknown"}`,
				`max task packet bytes: ${config.safety.maxTaskPacketBytes}`,
				`max agents/concurrency: ${profile?.maxAgents ?? "unknown"}/${profile?.maxConcurrency ?? "unknown"}`,
				`required gates: ${config.quality.requiredGates.join(", ") || "none"}`,
			].join("\n");
			if (ctx.mode !== "tui" && !ctx.hasUI) {
				ctx.ui.notify(details, "info");
				return;
			}
			const action = await ctx.ui.select("Context & Mission Settings", ["Inspect", "Change packet limit", "Back"]);
			if (action === "Inspect") ctx.ui.notify(details, "info");
			if (action !== "Change packet limit") return;
			if (!requireIdle(ctx, "context settings")) return;
			const raw = await ctx.ui.input("Maximum Task Packet bytes", String(config.safety.maxTaskPacketBytes));
			const value = Number.parseInt(raw?.trim() ?? "", 10);
			if (!Number.isInteger(value) || value < 1_024 || value > 16_777_216) {
				ctx.ui.notify("Packet limit must be between 1024 and 16777216 bytes", "error");
				return;
			}
			await configStore.update((draft) => { draft.safety.maxTaskPacketBytes = value; });
			ctx.ui.notify("Context settings saved", "info");
		} catch (error) {
			notifyError(ctx, "Context settings failed", error);
		}
	};

	const openMissionControl = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("Context & Mission Settings requires TUI or RPC UI mode", "error");
			return;
		}
		while (true) {
			const action = await ctx.ui.select("Context & Mission Settings", ["Missions", "Direct Workers", "Create mission", "Context settings", "Back"]);
			if (!action || action === "Back") return;
			if (action === "Missions") await listMissionRecords(ctx);
			else if (action === "Direct Workers") await openSubagentRunner(ctx);
			else if (action === "Create mission") await createMission(ctx);
			else if (action === "Context settings") await showContextMissionSettings(ctx);
		}
	};

	const analystModeLabel = (mode: RecommendationAnalystMode): string => mode === "ai-assisted" ? "AI-assisted" : "Deterministic only";
	const analystMode = (value: string | undefined): RecommendationAnalystMode | undefined => {
		switch (value?.trim().toLocaleLowerCase()) {
			case "deterministic":
			case "deterministic-only":
			case "deterministic only":
				return "deterministic";
			case "ai":
			case "ai-assisted":
			case "ai assisted":
				return "ai-assisted";
			default:
				return undefined;
		}
	};
	const analystStatusLines = (status: RecommendationAnalystStatus, settings: RecommendationAnalystSettings, routeLabel?: string): string[] => {
		const latest = (status as RecommendationAnalystStatus & { readonly latest?: { readonly verdict?: unknown; readonly explanation?: unknown } }).latest;
		return [
			"Recommendation Analyst",
			`state=${status.state}`,
			`mode=${analystModeLabel(status.mode ?? settings.mode)}`,
			`verification-route=${routeLabel ?? status.routeId ?? settings.routeId ?? "UNKNOWN"}`,
			`last-analysis=${status.lastAnalysisAt ?? "UNKNOWN"}`,
			`recommendations=${status.recommendationCount ?? "UNKNOWN"}`,
			...(latest?.verdict === undefined ? [] : [`verdict=${String(latest.verdict)}`]),
			...(latest?.explanation === undefined ? [] : [`analysis completed: ${String(latest.explanation)}`]),
			...(status.message ? [`message=${status.message}`] : []),
			"manual-only: no scheduled analysis; Apply remains under /recommendations",
		];
	};
	const analystRoutes = async (): Promise<readonly RecommendationAnalystRoute[]> => {
		if (!recommendationAnalyst) return [];
		const listed = await recommendationAnalyst.listVerificationRoutes();
		if (listed.length > 0) return listed;
		const pool = await poolManager.getPool("verification");
		return pool.entries.map((entry) => ({ routeId: entry.routeId, displayName: entry.displayName, remoteModelId: entry.remoteModelId, enabled: entry.poolEnabled && entry.globalEnabled, available: entry.state === "active" }));
	};
	const analystRouteLabel = (route: RecommendationAnalystRoute): string => `${route.displayName ?? route.remoteModelId ?? route.routeId} (${route.routeId})${route.available === false ? " [unavailable]" : route.enabled === false ? " [disabled]" : ""}`;
	const runRecommendationAnalysis = async (
		ctx: ExtensionContext | ExtensionCommandContext,
		mode: RecommendationAnalystMode,
		routeId: string | undefined,
		reanalyze: boolean,
	): Promise<void> => {
		if (!recommendationAnalyst) { ctx.ui.notify("Recommendation Analyst is unavailable", "warning"); return; }
		const routes = await analystRoutes();
		const selectedRoute = routeId ? routes.find((route) => route.routeId === routeId) : routes[0];
		if (!selectedRoute) { ctx.ui.notify("Recommendation Analyst requires a route in the Verification Pool", "warning"); return; }
		if (selectedRoute.available === false || selectedRoute.enabled === false) {
			ctx.ui.notify(`Verification route ${selectedRoute.routeId} is unavailable or disabled`, "warning");
			return;
		}
		const result = await recommendationAnalyst.analyze({ mode, routeId: selectedRoute.routeId });
		const status = await recommendationAnalyst.getStatus();
		const resultStatus = result && typeof result === "object" ? result as RecommendationAnalystStatus : status;
		ctx.ui.notify([
			...analystStatusLines(resultStatus, { mode, routeId: selectedRoute.routeId }, analystRouteLabel(selectedRoute)),
			`action=${reanalyze ? "re-analyze" : "analyze"}`,
		].join("\n"), resultStatus.state === "failed" ? "warning" : "info");
	};
	const showRecommendationAnalyst = async (ctx: ExtensionContext | ExtensionCommandContext, args?: string): Promise<void> => {
		if (!recommendationAnalyst) { ctx.ui.notify("Recommendation Analyst is unavailable", "warning"); return; }
		try {
			const initialSettings = await recommendationAnalyst.getSettings();
			const initialStatus = await recommendationAnalyst.getStatus();
			const routes = await analystRoutes();
			const defaultRoute = initialSettings.routeId && routes.some((route) => route.routeId === initialSettings.routeId) ? initialSettings.routeId : routes[0]?.routeId;
			const raw = (args ?? "").trim();
			const parts = raw.split(/\s+/u).filter(Boolean);
			const action = parts[0]?.toLocaleLowerCase();
			const requestedMode = analystMode(parts.find((part) => analystMode(part) !== undefined));
			const requestedRoute = parts.find((part) => routes.some((route) => route.routeId === part));
			if (action === "status" || action === "show") {
				ctx.ui.notify(analystStatusLines(initialStatus, initialSettings, routes.find((route) => route.routeId === (initialStatus.routeId ?? defaultRoute)) ? analystRouteLabel(routes.find((route) => route.routeId === (initialStatus.routeId ?? defaultRoute))!) : undefined).join("\n"), "info");
				return;
			}
			if (action === "analyze" || action === "reanalyze" || action === "re-analyze") {
				await runRecommendationAnalysis(ctx, requestedMode ?? initialSettings.mode, requestedRoute ?? defaultRoute, action !== "analyze");
				return;
			}
			if (raw && requestedMode === undefined && requestedRoute === undefined) {
				ctx.ui.notify("Usage: /recommendation-analyst [status|analyze|reanalyze] [deterministic|ai-assisted] [verification-route]", "error");
				return;
			}
			if (ctx.mode !== "tui" && !ctx.hasUI) {
				ctx.ui.notify(analystStatusLines(initialStatus, initialSettings, routes.find((route) => route.routeId === (initialStatus.routeId ?? defaultRoute)) ? analystRouteLabel(routes.find((route) => route.routeId === (initialStatus.routeId ?? defaultRoute))!) : undefined).join("\n"), "info");
				return;
			}
			let mode = initialSettings.mode;
			let routeId = defaultRoute;
			while (true) {
				const status = await recommendationAnalyst.getStatus();
				const route = routes.find((entry) => entry.routeId === routeId);
				const choice = await ctx.ui.select("Recommendation Analyst", [
					"Analyze Now",
					"Re-analyze",
					`Mode: ${analystModeLabel(mode)}`,
					`Verification route: ${route ? analystRouteLabel(route) : "UNKNOWN"}`,
					"Status",
					"Back",
				]);
				if (!choice || choice === "Back") return;
				if (choice === "Analyze Now" || choice === "Re-analyze") {
					await runRecommendationAnalysis(ctx, mode, routeId, choice === "Re-analyze");
					continue;
				}
				if (choice === "Status") {
					ctx.ui.notify(analystStatusLines(status, { mode, ...(routeId === undefined ? {} : { routeId }) }, route ? analystRouteLabel(route) : undefined).join("\n"), "info");
					continue;
				}
				if (choice.startsWith("Mode:")) {
					const selected = await ctx.ui.select("Recommendation Analyst mode", ["Deterministic only", "AI-assisted", "Back"]);
					if (selected && selected !== "Back") mode = selected === "AI-assisted" ? "ai-assisted" : "deterministic";
					continue;
				}
				if (choice.startsWith("Verification route:")) {
					const selected = await ctx.ui.select("Verification Pool route", [...routes.map(analystRouteLabel), "Back"]);
					const index = routes.map(analystRouteLabel).indexOf(selected ?? "");
					if (index >= 0) routeId = routes[index]!.routeId;
				}
			}
		} catch (error) { notifyError(ctx, "Recommendation Analyst failed", error); }
	};

	const showAnalytics = async (ctx: ExtensionContext | ExtensionCommandContext, args?: string): Promise<void> => {
		if (!analytics && !recommendationAnalyst) { ctx.ui.notify("Analytics is disabled or unavailable", "warning"); return; }
		try {
			const raw = (args ?? "").trim();
			const parts = raw.split(/\s+/u).filter(Boolean);
			let range: AnalyticsRange | undefined;
			let section: AnalyticsSection | undefined;
			let cursor = 0;
			const requestedWindow = analyticsWindow(parts[0]);
			if (requestedWindow) {
				range = analyticsRangeForWindow(requestedWindow);
				cursor = 1;
				if (requestedWindow === "all" && parts[1]?.toLocaleLowerCase() === "time") cursor = 2;
			} else if (parts[0]?.toLocaleLowerCase() === "custom") {
				if (!parts[1] || !parts[2] || Number.isNaN(Date.parse(parts[1])) || Number.isNaN(Date.parse(parts[2])) || Date.parse(parts[1]) > Date.parse(parts[2])) {
					ctx.ui.notify("Usage: /analytics custom FROM TO [section]", "error");
					return;
				}
				range = { from: new Date(parts[1]).toISOString(), to: new Date(parts[2]).toISOString() };
				cursor = 3;
			}
			section = analyticsSection(parts[cursor]);
			if (parts[cursor] && !section) {
				ctx.ui.notify(`Unknown analytics section '${parts[cursor]}'. Use ${ANALYTICS_SECTIONS.join(", ")}.`, "error");
				return;
			}
			if (!raw && (ctx.mode === "tui" || ctx.hasUI)) {
				const selectedWindow = await ctx.ui.select("Analytics time window", [...ANALYTICS_WINDOWS, "Back"]);
				if (!selectedWindow || selectedWindow === "Back") return;
				if (selectedWindow === "Custom range") {
					const from = await ctx.ui.input("Custom range start (ISO date)", "2026-01-01T00:00:00.000Z");
					const to = await ctx.ui.input("Custom range end (ISO date)", new Date().toISOString());
					if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(from) > Date.parse(to)) {
						ctx.ui.notify("Custom range requires two valid ISO dates", "error");
						return;
					}
					range = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
				} else {
					range = analyticsRangeForWindow(analyticsWindow(selectedWindow) ?? "all");
				}
				section = analyticsSection(await ctx.ui.select("Statistics & Analytics", [...ANALYTICS_SECTIONS, "Back"]));
				if (!section) return;
			}
			section ??= "Overview";
			if (section === "Recommendation Analyst") {
				await showRecommendationAnalyst(ctx);
				return;
			}
			if (!analytics) { ctx.ui.notify("Analytics is disabled or unavailable", "warning"); return; }
			const summary = analytics.overview(range);
			const lines = [
				`Statistics & Analytics — ${section}`,
				`window: ${analyticsWindowLabel(range)}`,
				"provenance: metadata-only; provider/Pi fields not reported remain UNKNOWN",
			];
			if (section === "Overview") {
				lines.push(`events=${summary.eventCount}`, `missions=${Object.keys(summary.byMission ?? {}).length}`, `runs=${summary.runs}`, `attempts=${summary.attempts}`, `successes=${summary.successes}`, `failures=${summary.failures}`, `success rate=${successRate(summary.successes, summary.runs)}`, `fallbacks=${summary.fallbacks}`, `quality pass/reject/blocked=${summary.qualityPasses}/${summary.qualityRejects}/${summary.qualityBlocked}`, `duration-ms=${summary.durationMs}`, `unknown token attempts=${summary.unknownTokenAttempts}`, `unknown cost events=${summary.unknownCostEvents}`, "Boss/profile/agent metrics: UNKNOWN (not reported)");
			} else if (section === "Missions") {
				lines.push(...analyticsMapLines("Missions", summary.byMission), ...analyticsMapLines("Roles", summary.byRole));
			} else if (section === "Pools") {
				lines.push(...analyticsMapLines("Pools", summary.byPool), ...analyticsQualityLines("Quality by pool", summary.qualityByPool));
			} else if (section === "Routes") {
				lines.push(...analyticsMapLines("Routes/models", summary.byRoute), ...analyticsQualityLines("Quality by route", summary.qualityByRoute));
				const models = new Map<string, string>();
				for (const event of analytics.events(range)) if (event.routeId && event.remoteModelId) models.set(event.routeId, event.remoteModelId);
				if (models.size > 0) lines.push(`model provenance: ${[...models.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([route, model]) => `${route}=${model}`).join(", ")}`);
				else lines.push("model provenance: UNKNOWN");
			} else if (section === "Tokens") {
				lines.push(`input=${unknownMetric(summary.tokens.input)}`, `output=${unknownMetric(summary.tokens.output)}`, `cache-read=${unknownMetric(summary.tokens.cacheRead)}`, `cache-write=${unknownMetric(summary.tokens.cacheWrite)}`, `reasoning=${unknownMetric(summary.tokens.reasoning)}`, `total=${unknownMetric(summary.tokens.total)}`, `unknown attempts=${summary.unknownTokenAttempts}`, "token provenance: observed/provider-reported/Pi-runtime-reported only");
			} else if (section === "Cost") {
				lines.push(`actual micros=${unknownMetric(summary.actualCostMicros)}`, `estimated equivalent micros=${unknownMetric(summary.estimatedCostMicros)}`, `estimated avoided micros=${unknownMetric(summary.avoidedCostMicros)}`, "subscription use=UNKNOWN (billing mode not aggregated)", `unknown cost events=${summary.unknownCostEvents}`, `currencies=${Object.keys(summary.costByCurrency).length > 0 ? JSON.stringify(summary.costByCurrency) : "UNKNOWN"}`, "cost provenance: actual is observed/provider-reported; estimates are labelled");
			} else if (section === "Quality") {
				lines.push(`pass=${summary.qualityPasses}`, `reject=${summary.qualityRejects}`, `blocked=${summary.qualityBlocked}`, `first-pass=${summary.firstPassSuccesses}`, `repair-rounds=${summary.repairRounds}`, "tests/escalations: UNKNOWN (not reported by analytics events)", ...analyticsQualityLines("Quality by pool", summary.qualityByPool), ...analyticsQualityLines("Quality by route", summary.qualityByRoute));
			} else if (section === "Fallbacks") {
				lines.push(`fallbacks=${summary.fallbacks}`);
				const transitions = Object.entries(summary.fallbackTransitions ?? {}).sort(([a], [b]) => a.localeCompare(b));
				if (transitions.length === 0) lines.push("transitions: UNKNOWN (no fallback edge was reported)");
				else lines.push("transitions:", ...transitions.map(([key, value]) => `${key}: ${value.count}`));
			} else if (section === "Recommendations") {
				const recommendations = analytics.recommendations();
				lines.push(`saved recommendations=${recommendations.length}`);
				if (recommendations.length === 0) lines.push("recommendations: UNKNOWN (none saved)");
				else for (const recommendation of recommendations) lines.push(`${recommendation.recommendationId}: pool=${recommendation.poolId} route=${recommendation.proposedRouteId} sample=${recommendation.sampleSize} score=${recommendation.score} formula=${recommendation.formulaVersion} status=${recommendation.status}`, `  evidence=${recommendation.evidence.join("; ") || "UNKNOWN"}`, `  limitations=${recommendation.limitations.join("; ") || "UNKNOWN"}`, `  actions: details/apply/ignore ${recommendation.recommendationId}`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		} catch (error) { notifyError(ctx, "Analytics failed", error); }
	};
	const showRecommendations = async (ctx: ExtensionContext | ExtensionCommandContext, args?: string): Promise<void> => {
		if (!analytics || !analyticsStore) { ctx.ui.notify("Recommendations are unavailable while analytics is disabled", "warning"); return; }
		try {
			const input = (args ?? "").trim(); const [action, id] = input.split(/\s+/u, 2); const saved = analytics.recommendations();
			if (action === "ignore" && id) { recommendationApplication?.ignore(id); ctx.ui.notify(`Recommendation ${id} ignored`, "info"); return; }
			if (action === "details" && id) { const recommendation = saved.find((item) => item.recommendationId === id); ctx.ui.notify(recommendation ? JSON.stringify(recommendation, null, 2) : `Recommendation ${id} not found`, recommendation ? "info" : "warning"); return; }
			if (action === "apply" && id) {
				const recommendation = saved.find((item) => item.recommendationId === id); if (!recommendation) { ctx.ui.notify(`Recommendation ${id} not found`, "warning"); return; }
				if (recommendation.status !== "proposed") { ctx.ui.notify(`Recommendation ${id} is already ${recommendation.status}`, "warning"); return; }
				if (ctx.mode === "tui" || ctx.hasUI) { if (!(await ctx.ui.confirm("Apply recommendation?", `${recommendation.poolId}: move ${recommendation.proposedRouteId} to first priority`))) return; }
				if (!isPoolId(recommendation.poolId) || !recommendationApplication) { ctx.ui.notify("Recommendation has an invalid pool", "warning"); return; }
				const applied = await recommendationApplication.apply(id); ctx.ui.notify(applied === "applied" ? `Recommendation ${id} applied` : applied === "stale" ? `Recommendation ${id} is stale; regenerate it` : `Recommendation ${id} is unavailable`, applied === "applied" ? "info" : "warning"); return;
			}
			const poolId = input || "implementation"; if (!isPoolId(poolId)) { ctx.ui.notify(`Unknown pool: ${poolId}`, "warning"); return; } const currentPool = await poolManager.getPool(poolId); const generated = new RecommendationEngine().generate(analytics.overview(), poolId, { currentOrder: currentPool.entries.map((entry) => entry.routeId) }); if (!generated) { ctx.ui.notify(`Insufficient analytics data or no priority change for ${poolId} (minimum 10 observed runs per route)`, "warning"); return; } const recommendation = { ...generated, proposedDiff: { ...generated.proposedDiff, baselineOrder: currentPool.entries.map((entry) => entry.routeId) } }; analyticsStore.saveRecommendation(recommendation); ctx.ui.notify([`recommendation=${recommendation.recommendationId}`, `pool=${recommendation.poolId}`, `route=${recommendation.proposedRouteId}`, `sample=${recommendation.sampleSize}`, `score=${recommendation.score}`, `formula=${recommendation.formulaVersion}`, `evidence=${recommendation.evidence.join("; ")}`, `limitations=${recommendation.limitations.join("; ")}`, "status=proposed (no configuration changed)", `actions: /recommendations details ${recommendation.recommendationId} | apply ${recommendation.recommendationId} | ignore ${recommendation.recommendationId}`].join("\n"), "info");
		} catch (error) { notifyError(ctx, "Recommendations failed", error); }
	};

	const registerCommands = (): void => {
		registerSubagentTool();
		pi.registerCommand("orchestrator", {
			description: "Open Pi Multi-Orchestrator control center",
			handler: async (_args, ctx) => openControlCenter(ctx),
		});
		pi.registerCommand("9router-models", {
			description: "Manage enabled 9Router models (optional filter)",
			handler: async (args, ctx) => openModels(ctx, args),
		});
		pi.registerCommand("9router-refresh", {
			description: "Refresh the 9Router model catalog",
			handler: async (_args, ctx) => refreshAndReconcile(ctx),
		});
		pi.registerCommand("9router-status", {
			description: "Show 9Router catalog/provider status",
			handler: async (_args, ctx) => showStatus(ctx),
		});
		pi.registerCommand("pool-models", {
			description: "Manage routes in an execution pool (optional pool id)",
			handler: async (args, ctx) => openPoolModels(ctx, args),
		});
		pi.registerCommand("pool-status", {
			description: "Show execution pool membership and readiness status",
			handler: async (args, ctx) => showPoolStatus(ctx, args),
		});
		pi.registerCommand("routing-status", {
			description: "Preview ordered route eligibility and fallback status",
			handler: async (args, ctx) => showRoutingStatus(ctx, args),
		});
		pi.registerCommand("route-health", {
			description: "Inspect and reset runtime route health",
			handler: async (args, ctx) => showRouteHealth(ctx, args),
		});
		pi.registerCommand("routing-settings", {
			description: "Edit the configured routing and fallback policy",
			handler: async (_args, ctx) => openRoutingSettings(ctx),
		});
		pi.registerCommand("subagent-run", {
			description: "Run one Direct Worker without a canonical Mission or M7 quality decision",
				handler: async (_args, ctx) => openSubagentRunner(ctx),
			});
		pi.registerCommand("missions", {
				description: "Inspect or create canonical missions (optional mission id)",
				handler: async (args, ctx) => listMissionRecords(ctx, args),
		});
		pi.registerCommand("mission-packet", {
			description: "Generate and inspect an immutable mission task packet",
			handler: async (args, ctx) => {
				const [missionId, taskId] = args.trim().split(/\s+/, 2);
				if (!missionId || !taskId) { ctx.ui.notify("Usage: /mission-packet <mission-id> <task-id>", "error"); return; }
				await showMissionPacket(ctx, missionId, taskId);
			},
		});
		pi.registerCommand("quality-status", {
			description: "Show task quality status (optional mission and task ids)",
			handler: async (args, ctx) => showQualityStatus(ctx, args),
		});
		pi.registerCommand("verify-task", {
			description: "Start an explicit-confirmation quality verification (mission task [run])",
			handler: async (args, ctx) => {
				const [missionId, taskId, runId] = args.trim().split(/\s+/u, 3);
				if (!missionId || !taskId) {
					ctx.ui.notify("Usage: /verify-task <mission-id> <task-id> [target-run-id]", "error");
					return;
				}
				await startTaskVerification(ctx, missionId, taskId, runId);
			},
		});
		pi.registerCommand("analytics", { description: "Show local metadata-only analytics", handler: async (args, ctx) => showAnalytics(ctx, args) });
		pi.registerCommand("recommendation-analyst", { description: "Run the manual Recommendation Analyst", handler: async (args, ctx) => showRecommendationAnalyst(ctx, args) });
		pi.registerCommand("recommendations", { description: "Show explainable pool recommendations", handler: async (args, ctx) => showRecommendations(ctx, args) });
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		lifetime.abort();
		if (ownership === "owned") pi.unregisterProvider(providerId);
		const close = (options.missionStore as { readonly close?: unknown } | undefined)?.close;
		if (typeof close === "function") close.call(options.missionStore);
		try { analyticsStore?.close?.(); } catch { /* analytics is non-critical */ }
		registeredFingerprint = undefined;
		ownership = "unknown";
	};

	const piOn = (pi as unknown as {
		on?: (event: "input", handler: (event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult>) => void;
	}).on;
	if (piOn) piOn.call(pi, "input", handleInput);

	const setProviderRegistry = (registry: PiProviderRegistry): void => {
		if (!disposed) providerRegistry = registry;
	};

	return { manager, poolManager, ...(healthStore ? { healthStore } : {}), ...(options.missionStore ? { missionStore: options.missionStore } : {}), ...(qualityStore ? { qualityStore } : {}), ...(qualityService ? { qualityService } : {}), ...(analyticsStore ? { analyticsStore } : {}), ...(recommendationAnalyst ? { recommendationAnalyst } : {}), ...(options.smartRoutingStore ? { smartRoutingStore: options.smartRoutingStore } : {}), ...(options.routingMemoryStore ? { routingMemoryStore: options.routingMemoryStore } : {}), ...(options.trustStore ? { trustStore: options.trustStore } : {}), reconcile, setProviderRegistry, registerCommands, dispose };
}

export default async function piMultiOrchestratorExtension(pi: ExtensionAPI): Promise<void> {
	const runtime = await import("@earendil-works/pi-coding-agent");
	let providerRegistry: PiProviderRegistry;
	try {
		const providerProbe = await RuntimeModelRuntime.create({
			modelsPath: join(runtime.getAgentDir(), "models.json"),
			allowModelNetwork: false,
			refreshOnCreate: false,
			credentials: {
				read: async () => undefined,
				list: async () => [],
				modify: async (_provider: string, fn: (current: undefined) => Promise<undefined>) => fn(undefined),
				delete: async () => undefined,
			} as never,
		});
		providerRegistry = { getProvider: (providerId) => providerProbe.getProvider(providerId) };
	} catch {
		// Never overwrite an uninspectable provider namespace at factory time.
		providerRegistry = { getProvider: () => { throw new Error("Pi provider registry is unavailable"); } };
	}
	const root = process.env.PI_MULTI_ORCH_CONFIG_ROOT ?? join(runtime.getAgentDir(), "pi-multi-orchestrator");
	const configStore = new ConfigStore({ root });
	const smartRoutingStore = new SmartRoutingSettingsStore({ root });
	const routingMemoryStore = new RoutingMemoryStore({ root });
	const trustStore = new TrustStore({ root: join(root, "trust") });
	let analyticsStore: AnalyticsStoreAdapter | undefined;
	try {
		const configSnapshot = await configStore.load();
		analyticsStore = new SQLiteAnalyticsStore({ root, enabled: configSnapshot.snapshot?.config.analytics.enabled === true });
	} catch {
		// Telemetry is non-critical; execution remains available if its DB is unavailable.
		analyticsStore = undefined;
	}
	const manager = createNineRouterManager(root, configStore) as PiManagerContract;
	const poolManager = createPoolManager(root, configStore);
	const healthStore = new HealthStore({ root });
	let missionStore: MissionStoreAdapter | undefined;
	let contextBroker: ContextBroker | undefined;
	try {
		missionStore = createMissionStore({ root });
		missionStore.recoverInterrupted();
		contextBroker = new ContextBroker(missionStoreContextRepository(missionStore), { maxChars: 32_768 });
	} catch {
		// Preserve a corrupt/unopenable mission DB; keep the non-mission host usable.
		missionStore = undefined;
		contextBroker = undefined;
	}
	let subagentExecutor: SubagentExecutor | undefined;
	try {
		subagentExecutor = await createHostSubagentExecutor(manager, poolManager, configStore, healthStore, undefined, trustStore);
	} catch {
		// Keep the M2/M3/M4 host available when no configured route can yet be resolved.
		subagentExecutor = undefined;
	}
	let qualityExecutor: SubagentExecutor | undefined;
	try {
		qualityExecutor = await createHostSubagentExecutor(manager, poolManager, configStore, healthStore, () => createVerificationResultProtocol(), trustStore);
	} catch {
		qualityExecutor = undefined;
	}
	let recommendationAnalyst: RecommendationAnalystService | undefined;
	if (analyticsStore) {
		let analystExecutor: SubagentExecutor | undefined;
		try { analystExecutor = await createHostSubagentExecutor(manager, poolManager, configStore, healthStore, (request) => createAnalystResultProtocol(request), trustStore); } catch { analystExecutor = undefined; }
		recommendationAnalyst = createRecommendationAnalyst({
			store: analyticsStore,
			routeProvider: async (): Promise<readonly AnalystRoute[]> => {
				const pool = await poolManager.getPool("verification");
				return pool.entries.map((entry) => ({ routeId: entry.routeId, displayName: entry.displayName, remoteModelId: entry.remoteModelId, enabled: entry.poolEnabled && entry.globalEnabled, available: entry.state === "active" }));
			},
			packetProvider: async (recommendationId): Promise<AnalystPacket> => {
				const recommendation = analyticsStore.listRecommendations().find((item) => item.status === "proposed" && (!recommendationId || item.recommendationId === recommendationId));
				if (!recommendation) throw new Error("no proposed recommendation is available for analysis");
				const poolId = recommendation.poolId;
				const pool = await poolManager.getPool(poolId as PoolId);
				const summary = analyticsStore.summary();
				return {
					recommendationId: recommendation.recommendationId,
					poolId,
					candidateRouteId: recommendation.proposedRouteId,
					currentOrder: pool.entries.map((entry) => entry.routeId),
					metrics: { sampleSize: recommendation.sampleSize, score: recommendation.score, runs: summary.runs, successes: summary.successes, fallbacks: summary.fallbacks, qualityPasses: summary.qualityPasses, qualityRejects: summary.qualityRejects, unknownTokenAttempts: summary.unknownTokenAttempts, unknownCostEvents: summary.unknownCostEvents },
					scoreComponents: [],
					basis: recommendation.evidence,
				};
			},
			execute: async ({ routeId, packet }) => {
				if (!analystExecutor) throw new Error("analyst execution is unavailable");
				const verificationPool = await poolManager.getPool("verification");
				const run = await analystExecutor.run({ roleId: "recommendation-analyst", poolId: "verification", task: `Analyze this bounded deterministic recommendation packet and submit one structured verdict:\n${JSON.stringify(packet)}`, cwd: root, acceptanceCriteria: ["Return support, oppose, or insufficient_evidence with concise factors and caveats."], excludedRouteIds: verificationPool.entries.filter((entry) => entry.routeId !== routeId).map((entry) => entry.routeId) });
				if (run.terminalStatus !== "completed" || run.protocolResult === undefined) throw new Error(run.summary);
				if (run.finalRouteId !== routeId) throw new Error("analyst route changed");
				return run.protocolResult;
			},
		});
	}
	const host = createPiHost(pi, { manager, poolManager, configStore, smartRoutingStore, routingMemoryStore, healthStore, trustStore, providerRegistry, ...(analyticsStore ? { analyticsStore } : {}), ...(recommendationAnalyst ? { recommendationAnalyst } : {}), ...(missionStore ? { missionStore, qualityStore: missionStore, qualityService: new QualityService(missionStore) } : {}), ...(contextBroker ? { contextBroker } : {}), ...(subagentExecutor ? { subagentExecutor } : {}), ...(qualityExecutor ? { qualityExecutor } : {}) });
	try {
		await manager.loadStatus();
		const result = await host.reconcile();
		if (result.error) {
			pi.events.emit("pi-multi-orchestrator:error", { stage: "provider-reconcile", error: "9Router provider activation unavailable" });
		}
	} catch {
		// Keep commands available for repair/status even when startup storage or
		// catalog state is unavailable. No exception text can contain secrets.
		pi.events.emit("pi-multi-orchestrator:error", { stage: "provider-reconcile", error: "9Router provider activation unavailable" });
		host.dispose();
	}
	pi.on("session_start", async (_event, ctx) => {
		host.setProviderRegistry(ctx.modelRegistry);
		try {
			await manager.loadStatus();
			const result = await host.reconcile();
			if (result.error) {
				pi.events.emit("pi-multi-orchestrator:error", { stage: "provider-reconcile", error: "9Router provider activation unavailable" });
			}
		} catch {
			// Keep commands available for repair/status even when startup storage or
			// catalog state is unavailable. No exception text can contain secrets.
			pi.events.emit("pi-multi-orchestrator:error", { stage: "provider-reconcile", error: "9Router provider activation unavailable" });
			host.dispose();
		}
	});
	host.registerCommands();
	pi.on("session_shutdown", () => host.dispose());
}
