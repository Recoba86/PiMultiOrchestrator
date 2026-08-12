import { join } from "node:path";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ModelRuntime,
	ProviderConfig,
	ProviderModelConfig,
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
	type SubagentExecutionRequest,
	type SubagentExecutor,
	type SubagentRunResult,
	type RouteAttemptAdapter,
} from "../core/workers/index.js";
import type { FailureClassification, RoutingRequest } from "../core/routing/index.js";
import type {
	EvidenceRecord,
	MissionCreateInput,
	MissionId,
	MissionRecord,
	MissionStatus,
	MissionStoreAdapter,
} from "../core/mission/types.js";
import { createMissionStore } from "../core/mission/index.js";
import { executeMissionTask } from "../core/mission/index.js";
import { ContextBroker, missionStoreContextRepository, renderTaskPacketPrompt, type TaskPacketV1 } from "../core/context/index.js";

export const NINEROUTER_PROVIDER_ID = DOMAIN_NINEROUTER_PROVIDER_ID;

type MaybePromise<T> = T | Promise<T>;

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
	readonly poolManager?: PoolManagerContract;
	readonly configStore?: ConfigStore;
	readonly healthStore?: HealthStore;
	/** Optional canonical mission store. The host never mirrors canonical state in Pi history. */
	readonly missionStore?: MissionStoreAdapter;
	readonly contextBroker?: ContextBroker;
	readonly providerId?: string;
	readonly subagentExecutor?: SubagentExecutor;
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
	reconcile(): Promise<ReconcileResult>;
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

const errorMessage = (error: unknown): string =>
	error instanceof NineRouterError
		? error.toJSON().message
		: error instanceof NineRouterManagerError || error instanceof SecretResolutionError || error instanceof PoolManagerError || error instanceof WorkerError
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

/** Build the M5 adapter from the already-authoritative M3/M4 stores. */
async function createHostSubagentExecutor(
	manager: PiManagerContract,
	poolManager: PoolManagerContract,
	configStore: ConfigStore,
	healthStore: HealthStore | undefined,
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
			const projection = await manager.providerProjection();
			const selected = projection?.models.find((model) => model.routeId === routeId);
			if (!projection?.baseUrl || !projection.apiKeyReference || !selected) {
				throw new WorkerError("route-resolution", "Selected route is not currently registered");
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
			if (!model || model.id !== selected.id) throw new WorkerError("route-model-mismatch", "Selected route model is unavailable");
			return { routeId, remoteModelId: selected.id, model: model as never, modelRuntime: runtime };
		},
		...(healthStore ? {
			recordSuccess: (routeId: StableId, at: Date) => healthStore.recordSuccess(routeId, at),
			recordFailure: (routeId: StableId, failure: FailureClassification, at: Date) => healthStore.recordFailure(routeId, failure, { now: at }),
		} : {}),
	};
	return createSubagentExecutor({ routeAdapter });
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
	let registeredFingerprint: string | undefined;
	let reconciled = false;
	const lifetime = new AbortController();

	const notifyError = (ctx: ExtensionContext | ExtensionCommandContext, prefix: string, error: unknown): void => {
		ctx.ui.notify(`${prefix}: ${errorMessage(error)}`, "error");
	};

	const requireIdle = (ctx: ExtensionContext | ExtensionCommandContext, subject = "9Router state"): boolean => {
		if (ctx.isIdle()) return true;
		ctx.ui.notify(`Wait for the current Pi turn to finish before changing ${subject}`, "warning");
		return false;
	};

	const reconcile = async (): Promise<ReconcileResult> => {
		const projection = await manager.providerProjection();
		const config = projection ? asProviderConfig(projection) : undefined;
		if (!config || !projection) {
			// Pi keeps extension provider state across /reload while recreating the
			// extension factory. Clear our owned namespace on the first empty
			// projection so a prior run cannot leave stale 9Router models behind.
			if (!reconciled || registeredFingerprint !== undefined) {
				pi.unregisterProvider(providerId);
				registeredFingerprint = undefined;
				reconciled = true;
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
			reconciled = true;
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
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/9router-models requires TUI mode", "error");
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

	const openControlCenter = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/orchestrator requires TUI mode", "error");
			return;
		}
		const choice = await ctx.ui.select("Pi Multi-Orchestrator", [
			"Models & 9Router",
			"Investigation Pool",
			"Implementation Pool",
			"Verification Pool",
			"Routing & Fallback",
			"Health & Quotas",
			"Context & Mission Settings",
			"Refresh 9Router catalog",
			"9Router status",
			"Pool status",
			"Connection setup",
			"Close",
		]);
		switch (choice) {
			case "Models & 9Router":
				await openModels(ctx);
			return;
			case "Investigation Pool":
				await openPoolEditor(ctx, "investigation");
				return;
			case "Implementation Pool":
				await openPoolEditor(ctx, "implementation");
				return;
			case "Verification Pool":
				await openPoolEditor(ctx, "verification");
				return;
			case "Routing & Fallback":
				await showRoutingStatus(ctx);
				return;
			case "Health & Quotas":
				await showRouteHealth(ctx);
				return;
			case "Context & Mission Settings":
				await openMissionControl(ctx);
				return;
			case "Refresh 9Router catalog":
				await refreshAndReconcile(ctx);
				return;
			case "9Router status":
				await showStatus(ctx);
				return;
			case "Pool status":
				await showPoolStatus(ctx);
				return;
			case "Connection setup":
				await configureConnection(ctx);
				return;
			default:
				return;
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
		params: { readonly role: string; readonly pool: string; readonly task: string; readonly acceptanceCriteria?: readonly string[]; readonly timeoutMs?: number },
		signal?: AbortSignal,
	): Promise<SubagentRunResult | undefined> => {
		if (!subagentExecutor || !isPoolId(params.pool)) {
			ctx.ui.notify("Routed subagent execution is unavailable", "error");
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
			ctx.ui.notify(`Subagent ${result.terminalStatus}: ${result.summary}`, result.terminalStatus === "completed" ? "info" : "warning");
			return result;
		} catch (error) {
			notifyError(ctx, "Subagent execution failed", error);
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
			ctx.ui.notify("Routed subagent execution is unavailable", "error");
			return;
		}
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("/subagent-run requires TUI or RPC UI mode", "error");
			return;
		}
		if (!requireIdle(ctx, "subagent execution")) return;
		const poolLabel = await ctx.ui.select("Execution pool", POOL_IDS.map((poolId) => `${poolLabels[poolId]} (${poolId})`));
		if (!poolLabel) return;
		const poolId = POOL_IDS.find((pool) => poolLabel.endsWith(`(${pool})`));
		if (!poolId) return;
		const role = await ctx.ui.input("Role ID", "debugger");
		const task = await ctx.ui.input("Task", "");
		if (!role?.trim() || !task?.trim()) return;
		ctx.ui.notify(`Pool: ${poolLabels[poolId]} | tools: ${poolId === "implementation" ? "read, grep, find, ls, bash, edit, write" : poolId === "verification" ? "read, grep, find, ls, bash" : "read, grep, find, ls"} | routing: M4 fallback policy`, "info");
		if (poolId === "implementation" && !(await ctx.ui.confirm("Implementation tools may modify files. Continue?", ctx.cwd))) return;
		await runSubagent(ctx, { role: role.trim(), pool: poolId, task: task.trim() }, ctx.signal);
	};

	const openRoutingSettings = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (!configStore) {
			ctx.ui.notify("Routing settings are unavailable until the configuration store is configured", "error");
			return;
		}
		if (ctx.mode !== "tui" && !ctx.hasUI) {
			ctx.ui.notify("Routing settings require TUI or RPC UI mode", "error");
			return;
		}
		if (!requireIdle(ctx, "routing policy")) return;
		try {
			const loaded = await configStore.load();
			if (!loaded.snapshot) throw new Error("configuration unavailable");
			const current = loaded.snapshot.config.routing;
			const choice = await ctx.ui.select("Routing & Fallback", [
				`Max attempts (${current.maxAttempts})`,
				`Timeout ms (${current.timeoutMs})`,
				`Rate-limit cooldown ms (${current.rateLimitCooldownMs})`,
				`Quota cooldown ms (${current.quotaCooldownMs})`,
				`Fallback enabled (${current.fallback.enabled})`,
				`Diversity (${current.diversityPreference})`,
				"Back",
			]);
			if (!choice || choice === "Back") return;
			if (choice.startsWith("Fallback enabled")) {
				await configStore.update((draft) => { draft.routing.fallback.enabled = !current.fallback.enabled; });
			} else if (choice.startsWith("Diversity")) {
				const value = await ctx.ui.select("Diversity preference", ["none", "prefer-different-family", "prefer-different-resource", "require-different-family", "require-different-resource"]);
				if (value) await configStore.update((draft) => { draft.routing.diversityPreference = value as typeof draft.routing.diversityPreference; });
			} else {
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
		`${mission.missionId} [${mission.status}] rev ${mission.revision} — ${mission.goal}`;

	const appendMissionPointer = (mission: MissionRecord): void => {
		// The session entry is only a pointer/status hint. Canonical state remains in
		// MissionStore and is never copied into Pi's LLM context.
		if (typeof (pi as unknown as { appendEntry?: unknown }).appendEntry !== "function") return;
		pi.appendEntry("pi-multi-orchestrator:mission", {
			missionId: mission.missionId,
			status: mission.status,
			revision: mission.revision,
		});
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
		].join("\n");
		if (ctx.mode !== "tui" && !ctx.hasUI) { ctx.ui.notify(details, "info"); return; }
		const actions = ["Inspect", "Build packet", ...(subagentExecutor && options.contextBroker ? ["Run task"] : []), "Back"];
		const action = await ctx.ui.select(details, actions);
		if (!action || action === "Back") return;
		if (action === "Inspect") { ctx.ui.notify(details, "info"); return; }
		if (action === "Build packet") { await showMissionPacket(ctx, String(mission.missionId), String(task.taskId)); return; }
		if (action !== "Run task" || !subagentExecutor || !options.contextBroker) return;
		if (!requireIdle(ctx, "mission task")) return;
		if (task.executionClass === "implementation" && !(await ctx.ui.confirm("Run implementation task?", "The child may modify the current working tree."))) return;
		try {
			const result = await executeMissionTask({ store, contextBroker: options.contextBroker, executor: subagentExecutor, missionId: mission.missionId, taskId: task.taskId, cwd: ctx.cwd });
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
			const updated = await Promise.resolve(store.transitionMission(mission.missionId, target, { actor: "user", expectedRevision: mission.revision }));
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
		const input: MissionCreateInput = {
			goal: goal.trim(),
			...(criteriaText?.trim() ? { acceptanceCriteria: criteriaText.split(";").map((value) => value.trim()).filter(Boolean) } : {}),
			repository: { cwd: ctx.cwd },
			actor: "user",
			status: "draft",
		};
		try {
			const mission = await Promise.resolve(store.createMission(input));
			appendMissionPointer(mission);
			ctx.ui.notify(`Mission created: ${mission.missionId}`, "info");
		} catch (error) {
			notifyError(ctx, "Mission creation failed", error);
		}
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
			const action = await ctx.ui.select("Context & Mission Settings", ["Missions", "Create mission", "Context settings", "Back"]);
			if (!action || action === "Back") return;
			if (action === "Missions") await listMissionRecords(ctx);
			else if (action === "Create mission") await createMission(ctx);
			else if (action === "Context settings") await showContextMissionSettings(ctx);
		}
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
				description: "Run one routed foreground subagent",
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
	};

	const dispose = (): void => {
		lifetime.abort();
		pi.unregisterProvider(providerId);
		const close = (options.missionStore as { readonly close?: unknown } | undefined)?.close;
		if (typeof close === "function") close.call(options.missionStore);
		registeredFingerprint = undefined;
		reconciled = true;
	};

		return { manager, poolManager, ...(healthStore ? { healthStore } : {}), ...(options.missionStore ? { missionStore: options.missionStore } : {}), reconcile, registerCommands, dispose };
}

export default async function piMultiOrchestratorExtension(pi: ExtensionAPI): Promise<void> {
	const runtime = await import("@earendil-works/pi-coding-agent");
	const root = process.env.PI_MULTI_ORCH_CONFIG_ROOT ?? join(runtime.getAgentDir(), "pi-multi-orchestrator");
	const configStore = new ConfigStore({ root });
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
		subagentExecutor = await createHostSubagentExecutor(manager, poolManager, configStore, healthStore);
	} catch {
		// Keep the M2/M3/M4 host available when no configured route can yet be resolved.
		subagentExecutor = undefined;
	}
	const host = createPiHost(pi, { manager, poolManager, configStore, healthStore, ...(missionStore ? { missionStore } : {}), ...(contextBroker ? { contextBroker } : {}), ...(subagentExecutor ? { subagentExecutor } : {}) });
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
	host.registerCommands();
	pi.on("session_shutdown", () => host.dispose());
}
