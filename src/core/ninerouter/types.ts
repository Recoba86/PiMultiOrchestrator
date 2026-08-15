import type { ResourceClass, StableId } from "../config/types.js";
import type { ThinkingLevelMap } from "../thinking.js";

// Config IDs follow M1's stable-ID grammar (must start with a letter).  The
// Pi provider namespace intentionally remains the user-facing "9router".
export const NINEROUTER_GATEWAY_ID = "ninerouter" as StableId;
export const NINEROUTER_PROVIDER_ID = "9router" as const;
/** Placeholder accepted by Pi provider registration; the actual key lives in Pi auth storage. */
export const NINEROUTER_PI_AUTH_REFERENCE = "$PMO_PI_AUTH" as const;

export type CatalogCapability = "chat" | "non-chat" | "unknown";
export type CatalogFieldProvenance = "remote" | "configured" | "conservative-default";

/** Bounded metadata from the current object-shaped 9Router capability schema. */
export interface CatalogCapabilityMetadata {
  readonly tools?: boolean;
  readonly search?: boolean;
  readonly audioInput?: boolean;
  readonly videoInput?: boolean;
  readonly thinkingFormat?: string;
  readonly thinkingCanDisable?: boolean;
}

/** Safe, bounded metadata extracted from one gateway catalog row. */
export interface RemoteCatalogEntry {
  readonly remoteId: string;
  readonly displayName: string;
  readonly owner?: string;
  readonly resourceClass: ResourceClass;
  readonly resourceId?: StableId;
  readonly underlyingFamily?: string;
  readonly underlyingVersion?: string;
  readonly capabilities: readonly string[];
  readonly input: readonly ("text" | "image")[];
  readonly reasoning?: boolean;
  readonly thinkingLevelMap?: ThinkingLevelMap;
  readonly vision?: boolean;
  readonly capabilityMetadata?: CatalogCapabilityMetadata;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly capability: CatalogCapability;
  readonly provenance: Readonly<Record<string, CatalogFieldProvenance>>;
}

export type CatalogErrorKind =
  | "auth"
  | "http"
  | "timeout"
  | "transport"
  | "cancelled"
  | "malformed"
  | "oversized"
  | "duplicate"
  | "invalid-url"
  | "secret";

export interface CatalogErrorSummary {
  readonly kind: CatalogErrorKind;
  readonly stage: string;
  readonly message: string;
  readonly status?: number;
  readonly at: string;
}

/** Runtime-only catalog cache. It is not part of ConfigV1 or exports. */
export interface CatalogCacheV1 {
  readonly cacheVersion: 1;
  readonly gatewayId: StableId;
  readonly baseUrl: string;
  readonly generation: number;
  readonly fetchedAt: string;
  readonly lastSuccessAt: string;
  readonly entries: readonly RemoteCatalogEntry[];
  readonly lastAttemptAt?: string;
  readonly lastError?: CatalogErrorSummary;
}

export type CatalogCacheLoadStatus = "missing" | "valid" | "corrupt";

export interface CatalogCacheLoadResult {
  readonly status: CatalogCacheLoadStatus;
  readonly cache?: CatalogCacheV1;
  readonly diagnostic?: string;
}

export type CatalogRowStatus = "new" | "present" | "missing" | "stale" | "ambiguous";

export interface CatalogRow {
  readonly entry: RemoteCatalogEntry;
  /** Host-facing aliases kept alongside the richer entry object. */
  readonly remoteModelId: string;
  readonly displayName: string;
  readonly routeId?: StableId;
  readonly enabled: boolean;
  readonly available?: boolean;
  readonly stale?: boolean;
  readonly missing?: boolean;
  readonly sourceLabel?: string;
  readonly status: CatalogRowStatus;
  readonly warning?: string;
}

/** Credential-blind model metadata supplied by Pi's existing provider registry. */
export interface PiProviderCatalogModel {
  readonly id: string;
  readonly name?: string;
  readonly reasoning?: boolean;
  readonly thinkingLevelMap?: ThinkingLevelMap;
  readonly input?: readonly ("text" | "image")[];
  readonly contextWindow?: number;
  readonly maxTokens?: number;
}

export interface PiProviderCatalog {
  readonly providerId: string;
  readonly available: boolean;
  readonly baseUrl?: string;
  readonly models: readonly PiProviderCatalogModel[];
}

export interface NineRouterStatus {
  readonly configured: boolean;
  readonly gatewayId: StableId;
  readonly baseUrl?: string;
  readonly gateway: "reachable" | "unreachable" | "not-checked";
  readonly cache: "fresh" | "stale" | "empty" | "corrupt";
  readonly catalogEntries: number;
  readonly enabledRoutes: number;
  readonly registeredModels: number;
  readonly missingEnabledRoutes: number;
  readonly lastSuccessfulRefresh?: string;
  readonly lastError?: CatalogErrorSummary;
  readonly state?: "unconfigured" | "pi-provider-ready" | "ready" | "stale" | "empty" | "error";
  readonly piProviderAvailable?: boolean;
  readonly piProviderModels?: number;
}

export interface ProviderModelProjection {
  readonly routeId: StableId;
  /** Exact remote ID; Pi sends this value to 9Router. */
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly thinkingLevelMap?: ThinkingLevelMap;
  readonly input: readonly ("text" | "image")[];
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly warning?: string;
}

export interface ProviderProjection {
  readonly providerId: typeof NINEROUTER_PROVIDER_ID;
  readonly gatewayId: StableId;
  readonly baseUrl?: string;
  /** Pi provider apiKey reference, never the resolved secret. */
  readonly apiKeyReference?: string;
  readonly authHeader: boolean;
  readonly api: "openai-completions";
  readonly models: readonly ProviderModelProjection[];
  readonly stale: boolean;
  readonly warnings: readonly string[];
}

export interface RefreshResult {
  readonly generation: number;
  readonly entries: readonly RemoteCatalogEntry[];
  readonly addedRemoteIds: readonly string[];
  readonly removedRemoteIds: readonly string[];
  readonly changedRemoteIds: readonly string[];
  readonly stale: false;
}

export interface SetEnabledResult {
  readonly changed: boolean;
  readonly enabled: boolean;
  readonly remoteId: string;
  readonly routeId: StableId;
  readonly generation: number;
}

export interface ConfigureResult {
  readonly generation: number;
  readonly gatewayId: StableId;
  readonly baseUrl: string;
}

export interface NineRouterManagerOptions {
  readonly configStore: import("../config/store.js").ConfigStore;
  readonly cacheStore: import("./cache.js").CatalogCacheStore;
  readonly client: import("./client.js").NineRouterClient;
  readonly now?: () => Date;
}

export interface ListOptions {
  readonly filter?: string;
}

export interface SetEnabledOptions {
  readonly activeRemoteModelId?: string;
}
