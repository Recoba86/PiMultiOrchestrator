import { createDefaultConfig } from "../config/defaults.js";
import { ConfigStore, type ConfigMutationResult } from "../config/store.js";
import type { ConfigV1, PoolRouteV1, RouteConfigV1, StableId } from "../config/types.js";
import { isSupportedThinkingEffort, isThinkingEffort, normalizeThinkingEffort, supportedThinkingEfforts, thinkingSupport, type ExplicitThinkingEffort, type ThinkingEffort, type ThinkingSupport } from "../thinking.js";
import { CatalogCacheStore } from "../ninerouter/cache.js";
import { normalizeNineRouterBaseUrl } from "../ninerouter/connection.js";
import { NINEROUTER_GATEWAY_ID, type CatalogCacheLoadResult, type CatalogCacheV1 } from "../ninerouter/types.js";

/** The only execution pools supported by the configuration schema. */
export const POOL_IDS = ["investigation", "implementation", "verification"] as const;
export type PoolId = (typeof POOL_IDS)[number];

export const POOL_LABELS: Readonly<Record<PoolId, string>> = {
	investigation: "Investigation",
	implementation: "Implementation",
	verification: "Verification",
};

export type PoolManagementState =
	| "active"
	| "global-disabled"
	| "missing"
	| "provider-unavailable"
	| "unknown";

export type PoolCatalogState = "fresh" | "stale" | "missing" | "unknown";

export interface PoolEntryView {
	/** Stable local route identity. */
	readonly routeId: StableId;
	readonly displayName: string;
	/** Exact remote model ID sent to the gateway. */
	readonly remoteModelId: string;
	/** Zero-based position in the persisted priority array. */
	readonly index: number;
	readonly globalEnabled: boolean;
	readonly poolEnabled: boolean;
	readonly state: PoolManagementState;
	readonly catalogState: PoolCatalogState;
	readonly gatewayId?: StableId;
	readonly resourceClass: RouteConfigV1["resource"]["class"];
	readonly resourceId?: StableId;
	readonly sourceLabel?: string;
	readonly underlyingFamily?: string;
	readonly underlyingVersion?: string;
	readonly provenance?: CatalogCacheV1["entries"][number]["provenance"];
	/** Whether the bound last-known-good catalog contains this remote ID. */
	readonly presentInCatalog?: boolean;
	readonly thinkingEffort?: ThinkingEffort;
	readonly supportedThinkingEfforts?: readonly ExplicitThinkingEffort[];
	readonly thinkingSupport?: ThinkingSupport;
	readonly thinkingEffortValid?: boolean;
}

export interface PoolView {
	readonly id: PoolId;
	readonly poolId: PoolId;
	readonly label: string;
	readonly entries: readonly PoolEntryView[];
}

export interface PoolStatus {
	readonly id: PoolId;
	readonly poolId: PoolId;
	readonly label: string;
	readonly total: number;
	readonly active: number;
	readonly poolDisabled: number;
	readonly globallyDisabled: number;
	readonly missing: number;
	readonly providerUnavailable: number;
	readonly unknown: number;
	readonly stale: number;
}

export interface PoolRouteCandidate extends Omit<PoolEntryView, "index" | "poolEnabled"> {
	readonly poolEnabled: false;
}

export interface PoolManagerOptions {
	readonly configStore: ConfigStore;
	readonly cacheStore?: CatalogCacheStore;
}

export interface PoolMutationResult extends ConfigMutationResult {
	readonly poolId: PoolId;
	readonly routeId: StableId;
}

export type PoolManagerErrorCode =
	| "invalid-pool"
	| "configuration-unavailable"
	| "route-not-found"
	| "duplicate-route"
	| "route-not-in-pool"
	| "invalid-thinking-effort"
	| "invalid-target-index";

export class PoolManagerError extends Error {
	readonly code: PoolManagerErrorCode;
	readonly poolId?: string;
	readonly routeId?: string;

	constructor(code: PoolManagerErrorCode, message: string, details: { poolId?: string; routeId?: string } = {}) {
		super(message);
		this.name = "PoolManagerError";
		this.code = code;
		if (details.poolId !== undefined) this.poolId = details.poolId;
		if (details.routeId !== undefined) this.routeId = details.routeId;
	}
}

export type PoolFilter = string | { readonly filter?: string } | undefined;

/**
 * Configuration-only execution pool manager.  It deliberately has no route
 * selection or provider-registration behavior; M4 owns those concerns.
 */
export class PoolManager {
	private readonly configStore: ConfigStore;
	private readonly cacheStore: CatalogCacheStore | undefined;

	constructor(options: PoolManagerOptions);
	constructor(configStore: ConfigStore, cacheStore?: CatalogCacheStore);
	constructor(optionsOrStore: PoolManagerOptions | ConfigStore, cacheStore?: CatalogCacheStore) {
		if (optionsOrStore instanceof ConfigStore) {
			this.configStore = optionsOrStore;
			this.cacheStore = cacheStore;
		} else {
			this.configStore = optionsOrStore.configStore;
			this.cacheStore = optionsOrStore.cacheStore;
		}
	}

	async listPools(): Promise<readonly PoolView[]> {
		const context = await this.loadContext();
		return POOL_IDS.map((poolId) => this.viewPool(context.config, context.cacheResult, poolId));
	}

	async getPool(poolId: PoolId): Promise<PoolView> {
		assertPoolId(poolId);
		const context = await this.loadContext();
		return this.viewPool(context.config, context.cacheResult, poolId);
	}

	async listMembers(poolId: PoolId): Promise<readonly PoolEntryView[]> {
		return (await this.getPool(poolId)).entries;
	}

	async getPoolStatus(poolId: PoolId): Promise<PoolStatus> {
		const pool = await this.getPool(poolId);
		const counts: Record<PoolManagementState, number> = {
			active: 0,
			"global-disabled": 0,
			missing: 0,
			"provider-unavailable": 0,
			unknown: 0,
		};
		for (const entry of pool.entries) counts[entry.state] += 1;
		return {
			id: pool.id,
			poolId: pool.poolId,
			label: pool.label,
			total: pool.entries.length,
			active: pool.entries.filter((entry) => entry.state === "active" && entry.poolEnabled).length,
			poolDisabled: pool.entries.filter((entry) => !entry.poolEnabled).length,
			globallyDisabled: counts["global-disabled"],
			missing: counts.missing,
			providerUnavailable: counts["provider-unavailable"],
			unknown: counts.unknown,
			stale: pool.entries.filter((entry) => entry.catalogState === "stale").length,
		};
	}

	async getAvailableCandidatesToAdd(poolId: PoolId, filter?: PoolFilter): Promise<readonly PoolRouteCandidate[]> {
		assertPoolId(poolId);
		const context = await this.loadContext();
		const pool = context.config.pools[poolId];
		const members = new Set(pool.entries.map((entry) => entry.routeId));
		const needle = typeof filter === "string" ? filter.trim().toLocaleLowerCase() : filter?.filter?.trim().toLocaleLowerCase();
		const routes = Object.values(context.config.routes)
			.filter((route) => !members.has(route.id))
			.filter((route) => route.enabled)
			.filter((route) => {
				if (!needle) return true;
				return `${route.id} ${route.displayName} ${route.remoteModelId}`.toLocaleLowerCase().includes(needle);
			});
		// Keep configured order stable while putting globally enabled routes first.
		routes.sort((left, right) => Number(right.enabled) - Number(left.enabled));
		return routes.map((route) => this.viewCandidate(context.config, context.cacheResult, route));
	}

	addRoute(poolId: PoolId, routeId: StableId): Promise<PoolMutationResult> {
		assertPoolId(poolId);
		return this.mutate(poolId, routeId, (pool, config) => {
			if (!Object.prototype.hasOwnProperty.call(config.routes, routeId)) {
				throw new PoolManagerError("route-not-found", `Configured route does not exist: ${routeId}`, { poolId, routeId });
			}
			if (pool.entries.some((entry) => entry.routeId === routeId)) {
				throw new PoolManagerError("duplicate-route", `Route is already assigned to ${poolId}: ${routeId}`, { poolId, routeId });
			}
			pool.entries.push({ routeId, enabled: true, thinkingEffort: "auto" });
		});
	}

	removeRoute(poolId: PoolId, routeId: StableId): Promise<PoolMutationResult> {
		assertPoolId(poolId);
		return this.mutate(poolId, routeId, (pool) => {
			const index = pool.entries.findIndex((entry) => entry.routeId === routeId);
			// Removal of an absent membership is an intentional idempotent no-op.
			if (index >= 0) pool.entries.splice(index, 1);
		});
	}

	moveRouteUp(poolId: PoolId, routeId: StableId): Promise<PoolMutationResult> {
		assertPoolId(poolId);
		return this.reorder(poolId, routeId, "up");
	}

	moveRouteDown(poolId: PoolId, routeId: StableId): Promise<PoolMutationResult> {
		assertPoolId(poolId);
		return this.reorder(poolId, routeId, "down");
	}

	moveRoute(poolId: PoolId, routeId: StableId, targetIndex: number): Promise<PoolMutationResult> {
		assertPoolId(poolId);
		if (!Number.isFinite(targetIndex)) {
			return Promise.reject(new PoolManagerError("invalid-target-index", "Target pool position must be finite", { poolId, routeId }));
		}
		return this.reorder(poolId, routeId, Math.trunc(targetIndex));
	}

	setPoolEntryEnabled(poolId: PoolId, routeId: StableId, enabled: boolean): Promise<PoolMutationResult> {
		assertPoolId(poolId);
		return this.mutate(poolId, routeId, (pool) => {
			const entry = pool.entries.find((candidate) => candidate.routeId === routeId);
			if (!entry) throw new PoolManagerError("route-not-in-pool", `Route is not assigned to ${poolId}: ${routeId}`, { poolId, routeId });
			entry.enabled = enabled;
		});
	}

	async setPoolEntryThinkingEffort(poolId: PoolId, routeId: StableId, thinkingEffort: ThinkingEffort): Promise<PoolMutationResult> {
		assertPoolId(poolId);
		if (!isThinkingEffort(thinkingEffort)) throw new PoolManagerError("invalid-thinking-effort", "Thinking effort is invalid", { poolId, routeId });
		const normalized = thinkingEffort;
		const context = await this.loadContext();
		const route = context.config.routes[routeId];
		const catalog = route ? boundCatalog(context.config, route, context.cacheResult) : undefined;
		const catalogEntry = catalog?.entries.find((candidate) => candidate.remoteId === route?.remoteModelId);
		if (normalized !== "auto" && (!route || !isSupportedThinkingEffort(routeThinkingMetadata(route, catalogEntry), normalized))) {
			throw new PoolManagerError("invalid-thinking-effort", `Thinking effort ${normalized} is not confirmed for ${route?.remoteModelId ?? routeId}`, { poolId, routeId });
		}
		return this.mutate(poolId, routeId, (pool, config) => {
			const entry = pool.entries.find((candidate) => candidate.routeId === routeId);
			if (!entry) throw new PoolManagerError("route-not-in-pool", `Route is not assigned to ${poolId}: ${routeId}`, { poolId, routeId });
			entry.thinkingEffort = normalized;
		});
	}

	private reorder(poolId: PoolId, routeId: StableId, target: number | "up" | "down"): Promise<PoolMutationResult> {
		return this.mutate(poolId, routeId, (pool) => {
			const index = pool.entries.findIndex((entry) => entry.routeId === routeId);
			if (index < 0) throw new PoolManagerError("route-not-in-pool", `Route is not assigned to ${poolId}: ${routeId}`, { poolId, routeId });
			const requested = target === "up" ? index - 1 : target === "down" ? index + 1 : target;
			const bounded = Math.min(Math.max(requested, 0), Math.max(pool.entries.length - 1, 0));
			if (bounded === index) return;
			const [entry] = pool.entries.splice(index, 1);
			if (entry) pool.entries.splice(bounded, 0, entry);
		});
	}

	private mutate(
		poolId: PoolId,
		routeId: StableId,
		mutator: (pool: { entries: PoolRouteV1[] }, config: ConfigV1) => void,
	): Promise<PoolMutationResult> {
		return this.configStore.update((draft) => {
			mutator(draft.pools[poolId], draft);
		}).then((result) => ({ ...result, poolId, routeId }));
	}

	private async loadContext(): Promise<{ readonly config: ConfigV1; readonly cacheResult?: CatalogCacheLoadResult }> {
		const [loaded, cacheResult] = await Promise.all([
			this.configStore.load(),
			this.cacheStore?.load(),
		]);
		if (!loaded.snapshot && loaded.status !== "missing") {
			throw new PoolManagerError("configuration-unavailable", "Pool configuration is unavailable; recover it before editing pools");
		}
		return {
			config: loaded.snapshot?.config ?? createDefaultConfig(),
			...(cacheResult === undefined ? {} : { cacheResult }),
		};
	}

	private viewPool(
		config: ConfigV1,
		cacheResult: CatalogCacheLoadResult | undefined,
		poolId: PoolId,
	): PoolView {
		return {
			id: poolId,
			poolId,
			label: POOL_LABELS[poolId],
			entries: config.pools[poolId].entries.map((entry, index) => this.viewEntry(config, cacheResult, entry, index)),
		};
	}

	private viewCandidate(
		config: ConfigV1,
		cacheResult: CatalogCacheLoadResult | undefined,
		route: RouteConfigV1,
	): PoolRouteCandidate {
		const view = this.viewEntry(config, cacheResult, { routeId: route.id, enabled: false }, -1);
		return { ...view, poolEnabled: false };
	}

	private viewEntry(
		config: ConfigV1,
		cacheResult: CatalogCacheLoadResult | undefined,
		entry: PoolRouteV1,
		index: number,
	): PoolEntryView {
		const route = config.routes[entry.routeId];
		// A validated ConfigV1 cannot contain this state. Keep a safe placeholder
		// for callers inspecting a recovered/externally supplied snapshot.
		if (!route) {
			return {
				routeId: entry.routeId,
				displayName: "Unknown route",
				remoteModelId: "unknown",
				index,
				globalEnabled: false,
				poolEnabled: entry.enabled,
				state: "unknown",
				catalogState: "unknown",
				resourceClass: "unknown",
				presentInCatalog: false,
				thinkingEffort: normalizeThinkingEffort(entry.thinkingEffort),
				supportedThinkingEfforts: [],
				thinkingSupport: "unknown",
				thinkingEffortValid: entry.thinkingEffort === undefined || entry.thinkingEffort === "auto",
			};
		}
		const catalog = boundCatalog(config, route, cacheResult);
		const catalogEntry = catalog?.entries.find((candidate) => candidate.remoteId === route.remoteModelId);
		const state = managementState(config, route, catalog, catalogEntry);
		const effort = normalizeThinkingEffort(entry.thinkingEffort);
		const thinkingMetadata: { reasoning?: boolean; thinkingLevelMap?: import("../thinking.js").ThinkingLevelMap } = {};
		if (catalogEntry?.reasoning !== undefined) thinkingMetadata.reasoning = catalogEntry.reasoning;
		const thinkingLevelMap = catalogEntry?.thinkingLevelMap ?? route.metadata?.thinkingLevelMap;
		if (thinkingLevelMap !== undefined) thinkingMetadata.thinkingLevelMap = thinkingLevelMap;
		const availableThinkingEfforts = supportedThinkingEfforts(thinkingMetadata);
		const catalogState: PoolCatalogState = !catalog
			? "unknown"
			: !catalogEntry
				? "missing"
				: catalog.lastError
					? "stale"
					: "fresh";
		return {
			routeId: route.id,
			displayName: route.displayName,
			remoteModelId: route.remoteModelId,
			index,
			globalEnabled: route.enabled,
			poolEnabled: entry.enabled,
			state,
			catalogState,
			...(route.gatewayId ? { gatewayId: route.gatewayId } : {}),
			resourceClass: route.resource.class,
			...(route.resource.id ? { resourceId: route.resource.id } : {}),
			...(route.metadata?.sourceLabel ? { sourceLabel: route.metadata.sourceLabel } : {}),
			...(route.metadata?.underlyingFamily ? { underlyingFamily: route.metadata.underlyingFamily } : {}),
			...(route.metadata?.underlyingVersion ? { underlyingVersion: route.metadata.underlyingVersion } : {}),
			...(catalogEntry ? { provenance: catalogEntry.provenance } : {}),
			...(catalog ? { presentInCatalog: catalogEntry !== undefined } : {}),
			thinkingEffort: effort,
			supportedThinkingEfforts: availableThinkingEfforts,
			thinkingSupport: thinkingSupport(thinkingMetadata),
			thinkingEffortValid: effort === "auto" || isSupportedThinkingEffort(thinkingMetadata, effort),
		};
	}
}

export function createPoolManager(root: string, configStore = new ConfigStore({ root })): PoolManager {
	return new PoolManager({ configStore, cacheStore: new CatalogCacheStore(root) });
}

export function isPoolId(value: unknown): value is PoolId {
	return typeof value === "string" && (POOL_IDS as readonly string[]).includes(value);
}

function assertPoolId(value: unknown): asserts value is PoolId {
	if (!isPoolId(value)) throw new PoolManagerError("invalid-pool", `Unknown execution pool: ${String(value)}`);
}

function boundCatalog(
	config: ConfigV1,
	route: RouteConfigV1,
	cacheResult: CatalogCacheLoadResult | undefined,
): CatalogCacheV1 | undefined {
	if (!cacheResult?.cache || route.gatewayId !== NINEROUTER_GATEWAY_ID) return undefined;
	const gateway = config.gateways[NINEROUTER_GATEWAY_ID];
	if (!gateway || gateway.kind !== "9router") return undefined;
	try {
		return normalizeNineRouterBaseUrl(gateway.baseUrl) === cacheResult.cache.baseUrl ? cacheResult.cache : undefined;
	} catch {
		return undefined;
	}
}

function managementState(
	config: ConfigV1,
	route: RouteConfigV1,
	catalog: CatalogCacheV1 | undefined,
	catalogEntry: CatalogCacheV1["entries"][number] | undefined,
): PoolManagementState {
	if (!route.enabled) return "global-disabled";
	if (!route.gatewayId) return "active";
	const gateway = config.gateways[route.gatewayId];
	if (!gateway || !gateway.enabled) return "provider-unavailable";
	if (route.gatewayId !== NINEROUTER_GATEWAY_ID || gateway.kind !== "9router") return "active";
	if (!catalog) return "unknown";
	if (!catalogEntry) return "missing";
	if (catalogEntry.capability === "non-chat") return "provider-unavailable";
	return "active";
}

function routeThinkingMetadata(route: RouteConfigV1, catalogEntry?: CatalogCacheV1["entries"][number]): { reasoning?: boolean; thinkingLevelMap?: import("../thinking.js").ThinkingLevelMap } {
	const result: { reasoning?: boolean; thinkingLevelMap?: import("../thinking.js").ThinkingLevelMap } = {};
	if (catalogEntry?.reasoning !== undefined || route.metadata?.thinkingLevelMap !== undefined) result.reasoning = catalogEntry?.reasoning ?? true;
	const thinkingLevelMap = catalogEntry?.thinkingLevelMap ?? route.metadata?.thinkingLevelMap;
	if (thinkingLevelMap !== undefined) result.thinkingLevelMap = thinkingLevelMap;
	return result;
}
