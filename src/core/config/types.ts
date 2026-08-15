import type { ThinkingEffort, ThinkingLevelMap } from "../thinking.js";

/**
 * Stable identifiers are deliberately human-readable.  Runtime validation
 * applies the syntax/length limits; the brand prevents accidentally passing a
 * display label where a configured ID is required in typed code.
 */
export type StableId = string & { readonly __stableId: unique symbol };

/** Legacy semantic configuration version. */
export type SchemaVersion = 1;
export type SchemaVersionV2 = 2;
export type StorageVersion = 1;

export type ExecutionClass = "investigation" | "implementation" | "verification";
export type ResourceClass = "subscription" | "metered-api" | "unknown" | "other";
export type CostPreference = "low" | "balanced" | "quality";
export type ContextBudgetClass = "small" | "medium" | "large";
export type DiversityPreference =
  | "none"
  | "prefer-different-family"
  | "prefer-different-resource"
  | "require-different-family"
  | "require-different-resource";

export type PoolSchedulingPolicy = "priority" | "weighted";
export const MAX_POOL_ENTRY_WEIGHT = 1_000_000 as const;

export type QualityGate =
  | "diff"
  | "tests"
  | "review"
  | "acceptance"
  | "regression"
  | "no-critical-findings";

export type SecretStore = "pi-auth" | "env" | "keychain";

/** A reference to an approved secret store; it never contains a secret. */
export interface SecretRefV1 {
  store: SecretStore;
  key: string;
}

export interface GatewayConfigV1 {
  id: StableId;
  kind: string;
  baseUrl: string;
  enabled: boolean;
  timeoutMs: number;
  credentialRef?: SecretRefV1;
}

export interface RouteResourceV1 {
  class: ResourceClass;
  id?: StableId;
}

/** Public, bounded route metadata.  Credentials and arbitrary blobs are not fields. */
export interface RouteMetadataV1 {
  underlyingFamily?: string;
  underlyingVersion?: string;
  sourceLabel?: string;
  /** Credential-blind Pi/provider capability mapping retained for pool validation. */
  thinkingLevelMap?: ThinkingLevelMap;
}

export interface RouteConfigV1 {
  id: StableId;
  displayName: string;
  enabled: boolean;
  gatewayId?: StableId;
  remoteModelId: string;
  resource: RouteResourceV1;
  tags: string[];
  capabilities: string[];
  metadata?: RouteMetadataV1;
}

export interface PoolRouteV1 {
  routeId: StableId;
  enabled: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Missing in RC19 configs; migration and runtime semantics treat it as auto. */
  thinkingEffort?: ThinkingEffort;
  /** Missing in pre-RC23 configs; migration treats it as the neutral weight 1. */
  weight?: number;
}

export interface PoolV1 {
  /** Missing in pre-RC23 configs; migration treats it as Priority. */
  schedulingPolicy?: PoolSchedulingPolicy;
  entries: PoolRouteV1[];
}

export interface PoolsV1 {
  investigation: PoolV1;
  implementation: PoolV1;
  verification: PoolV1;
}

export interface RoleConfigV1 {
  id: StableId;
  displayName: string;
  executionClass: ExecutionClass;
  instructionsRef?: string;
  allowedTools: string[];
  allowedActions: string[];
  resultSchemaId: StableId;
}

/** Boss-specific route policy; unlike worker pools it is pinned per Mission. */
export interface BossRouteV1 {
	routeId: StableId;
	enabled: boolean;
	thinkingEffort?: ThinkingEffort;
	weight?: number;
}

export interface BossProfileV1 {
	id: StableId;
	displayName: string;
	enabled: boolean;
	routeIds: StableId[];
	/** Additive RC25 shape; RC24 readers continue to use routeIds. */
	entries?: BossRouteV1[];
	schedulingPolicy?: PoolSchedulingPolicy;
	description?: string;
}

export interface OperationalProfileV1 {
  id: StableId;
  displayName: string;
  enabled: boolean;
  maxAgents: number;
  maxConcurrency: number;
  investigatorCount: number;
  reviewerCount: number;
  costPreference: CostPreference;
  diversityPreference: DiversityPreference;
  escalationLimit: number;
  contextBudgetClass: ContextBudgetClass;
}

export interface RoutingPolicyV1 {
  maxAttempts: number;
  timeoutMs: number;
  rateLimitCooldownMs: number;
  quotaCooldownMs: number;
  fallback: {
    enabled: boolean;
  };
  diversityPreference: DiversityPreference;
}

export interface SafetyPolicyV1 {
  maxAgents: number;
  maxConcurrency: number;
  maxAttempts: number;
  timeoutMs: number;
  maxOutputBytes: number;
  maxTaskPacketBytes: number;
  protectedPathPrefixes: string[];
}

export interface QualityPolicyV1 {
  requiredGates: QualityGate[];
}

export interface AnalyticsPolicyV1 {
  enabled: boolean;
  mode: "metadata-only";
}

export type BillingModeV2 = "metered_api" | "subscription" | "free" | "unknown";
export type BillingProvenanceV2 = "configured" | "provider_reported" | "unknown";

/**
 * Operator-supplied billing/reference metadata.  Missing values are
 * intentional unknowns; they must never be interpreted as zero.
 */
export interface BillingProfileV2 {
  id: StableId;
  displayName: string;
  billingMode: BillingModeV2;
  provenance: BillingProvenanceV2;
  currency?: string;
  inputMicrosPerMillion?: number;
  outputMicrosPerMillion?: number;
  cacheReadMicrosPerMillion?: number;
  cacheWriteMicrosPerMillion?: number;
  label?: string;
}

export interface BillingPolicyV2 {
  profiles: Record<string, BillingProfileV2>;
  activeProfileId?: StableId;
}

/** The semantic user configuration.  Runtime state is deliberately absent. */
export interface ConfigV1 {
  schemaVersion: SchemaVersion;
  gateways: Record<string, GatewayConfigV1>;
  routes: Record<string, RouteConfigV1>;
  pools: PoolsV1;
  roles: Record<string, RoleConfigV1>;
  bossProfiles: Record<string, BossProfileV1>;
  activeBossProfileId: StableId;
  operationalProfiles: Record<string, OperationalProfileV1>;
  activeOperationalProfileId: StableId;
  routing: RoutingPolicyV1;
  safety: SafetyPolicyV1;
  quality: QualityPolicyV1;
  analytics: AnalyticsPolicyV1;
}

/** Current configuration shape.  V1 remains supported as an import source. */
export interface ConfigV2 extends Omit<ConfigV1, "schemaVersion"> {
  schemaVersion: SchemaVersionV2;
  billing: BillingPolicyV2;
}

export type ConfigCurrent = ConfigV2;

/** Trusted project configuration is a patch, not a second runtime state store. */
export interface SafetyPatchV1 {
  maxAgents?: number;
  maxConcurrency?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxTaskPacketBytes?: number;
  protectedPathPrefixes?: string[];
}

export interface ProjectOverrideV1 {
  schemaVersion: SchemaVersion;
  gateways?: Record<string, GatewayConfigV1>;
  routes?: Record<string, RouteConfigV1>;
  pools?: Partial<PoolsV1>;
  roles?: Record<string, RoleConfigV1>;
  bossProfiles?: Record<string, BossProfileV1>;
  activeBossProfileId?: StableId;
  operationalProfiles?: Record<string, OperationalProfileV1>;
  activeOperationalProfileId?: StableId;
  routing?: RoutingPolicyV1;
  safety?: SafetyPatchV1;
  quality?: QualityPolicyV1;
  analytics?: AnalyticsPolicyV1;
}

export interface ProjectOverrideV2 extends Omit<ProjectOverrideV1, "schemaVersion"> {
  schemaVersion: SchemaVersionV2;
  billing?: BillingPolicyV2;
}

/** Launch-time overlays use the same patch semantics but are not persisted. */
export type ConfigPatchV1 = Omit<ProjectOverrideV1, "schemaVersion">;
export type ConfigPatchV2 = Omit<ProjectOverrideV2, "schemaVersion">;

/** Storage metadata is kept outside semantic ConfigV1 equality. */
export interface StoredConfigV1 {
  storageVersion: StorageVersion;
  generation: number;
  savedAt: string;
  config: ConfigV1;
}

export interface StoredConfigV2 {
  storageVersion: StorageVersion;
  generation: number;
  savedAt: string;
  config: ConfigV2;
}
