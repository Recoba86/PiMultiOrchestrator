import { ConfigValidationError, type ConfigIssue } from "./errors.js";
import { THINKING_EFFORTS } from "../thinking.js";
import { MAX_POOL_ENTRY_WEIGHT } from "./types.js";
import type {
  AnalyticsPolicyV1,
  BillingPolicyV2,
  BillingProfileV2,
  ConfigV2,
  ProjectOverrideV2,
  BossProfileV1,
  BossRouteV1,
  ConfigV1,
  ContextBudgetClass,
  DiversityPreference,
  GatewayConfigV1,
  OperationalProfileV1,
  PoolRouteV1,
  PoolV1,
  PoolSchedulingPolicy,
  PoolsV1,
  ProjectOverrideV1,
  QualityGate,
  QualityPolicyV1,
  ResourceClass,
  RoleConfigV1,
  RouteConfigV1,
  RouteMetadataV1,
  RoutingPolicyV1,
  SafetyPatchV1,
  SafetyPolicyV1,
  SecretRefV1,
  StoredConfigV1,
  StoredConfigV2,
} from "./types.js";

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const CURRENT_CONFIG_SCHEMA_VERSION = 2 as const;
export const CURRENT_STORAGE_VERSION = 1 as const;

const STABLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TAG = /^[a-z0-9][a-z0-9._:-]*$/;
const SAFE_REF = /^[A-Za-z0-9_.:-]+$/;
const MAX_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 160;
const MAX_REMOTE_MODEL_LENGTH = 256;
const MAX_ARRAY_LENGTH = 256;
const CURRENCY = /^[A-Z][A-Z0-9_-]{2,11}$/;
const EXECUTION_CLASSES = ["investigation", "implementation", "verification"] as const;
const RESOURCE_CLASSES = ["subscription", "metered-api", "unknown", "other"] as const;
const COST_PREFERENCES = ["low", "balanced", "quality"] as const;
const CONTEXT_BUDGETS = ["small", "medium", "large"] as const;
const DIVERSITY_PREFERENCES = [
  "none",
  "prefer-different-family",
  "prefer-different-resource",
  "require-different-family",
  "require-different-resource",
] as const;
const QUALITY_GATES = [
  "diff",
  "tests",
  "review",
  "acceptance",
  "regression",
  "no-critical-findings",
] as const;
const POOL_SCHEDULING_POLICIES = ["priority", "weighted"] as const satisfies readonly PoolSchedulingPolicy[];

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const issue = (issues: ConfigIssue[], code: string, path: string, message: string): void => {
  issues.push({ code, path, message });
};

const fieldPath = (path: string, key: string): string => (path ? `${path}.${key}` : key);

const ensureKeys = (
  value: RecordValue,
  allowed: readonly string[],
  path: string,
  issues: ConfigIssue[],
): void => {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issue(issues, "unknown-field", fieldPath(path, key), "Unknown field");
  }
};

const record = (value: unknown, path: string, issues: ConfigIssue[]): RecordValue | undefined => {
  if (!isRecord(value)) {
    issue(issues, "type", path, "Expected an object");
    return undefined;
  }
  return value;
};

const stringValue = (
  value: unknown,
  path: string,
  issues: ConfigIssue[],
  options: { maxLength: number; pattern?: RegExp; allowEmpty?: boolean },
): string | undefined => {
  if (typeof value !== "string") {
    issue(issues, "type", path, "Expected a string");
    return undefined;
  }
  if ((!options.allowEmpty && value.length === 0) || value.length > options.maxLength) {
    issue(issues, "string-length", path, "String length is outside the supported range");
  }
  if (/\p{Cc}/u.test(value)) issue(issues, "control-character", path, "Control characters are not allowed");
  if (options.pattern && !options.pattern.test(value)) issue(issues, "string-format", path, "String format is invalid");
  return value;
};

const stableId = (value: unknown, path: string, issues: ConfigIssue[]): string | undefined =>
  stringValue(value, path, issues, { maxLength: MAX_ID_LENGTH, pattern: STABLE_ID });

const boundedInteger = (
  value: unknown,
  path: string,
  issues: ConfigIssue[],
  min: number,
  max: number,
): number | undefined => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    issue(issues, "type", path, "Expected a safe integer");
    return undefined;
  }
  if (value < min || value > max) issue(issues, "range", path, "Number is outside the supported range");
  return value;
};

const booleanValue = (value: unknown, path: string, issues: ConfigIssue[]): boolean | undefined => {
  if (typeof value !== "boolean") issue(issues, "type", path, "Expected a boolean");
  return typeof value === "boolean" ? value : undefined;
};

const enumValue = <T extends string>(
  value: unknown,
  path: string,
  issues: ConfigIssue[],
  values: readonly T[],
): T | undefined => {
  if (typeof value !== "string" || !values.includes(value as T)) {
    issue(issues, "enum", path, "Value is not supported");
    return undefined;
  }
  return value as T;
};

const arrayValue = (value: unknown, path: string, issues: ConfigIssue[]): unknown[] | undefined => {
  if (!Array.isArray(value)) {
    issue(issues, "type", path, "Expected an array");
    return undefined;
  }
  if (value.length > MAX_ARRAY_LENGTH) issue(issues, "array-length", path, "Array is too large");
  return value;
};

const validateLabel = (value: unknown, path: string, issues: ConfigIssue[]): string | undefined =>
  stringValue(value, path, issues, { maxLength: MAX_LABEL_LENGTH });

const validateTagArray = (value: unknown, path: string, issues: ConfigIssue[]): string[] | undefined => {
  const values = arrayValue(value, path, issues);
  if (!values) return undefined;
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((entry, index) => {
    const tag = stringValue(entry, `${path}[${index}]`, issues, { maxLength: 64, pattern: TAG });
    if (tag) {
      if (seen.has(tag)) issue(issues, "duplicate", `${path}[${index}]`, "Duplicate value");
      seen.add(tag);
      result.push(tag);
    }
  });
  return result;
};

const validateIdArray = (value: unknown, path: string, issues: ConfigIssue[]): string[] | undefined => {
  const values = arrayValue(value, path, issues);
  if (!values) return undefined;
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((entry, index) => {
    const id = stableId(entry, `${path}[${index}]`, issues);
    if (id) {
      if (seen.has(id)) issue(issues, "duplicate", `${path}[${index}]`, "Duplicate ID");
      seen.add(id);
      result.push(id);
    }
  });
  return result;
};

const validateStringArray = (value: unknown, path: string, issues: ConfigIssue[]): string[] | undefined => {
  const values = arrayValue(value, path, issues);
  if (!values) return undefined;
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((entry, index) => {
    const item = stringValue(entry, `${path}[${index}]`, issues, { maxLength: 128 });
    if (item) {
      if (seen.has(item)) issue(issues, "duplicate", `${path}[${index}]`, "Duplicate value");
      seen.add(item);
      result.push(item);
    }
  });
  return result;
};

const validateSecretRef = (value: unknown, path: string, issues: ConfigIssue[]): SecretRefV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["store", "key"], path, issues);
  enumValue(object.store, fieldPath(path, "store"), issues, ["pi-auth", "env", "keychain"] as const);
  stringValue(object.key, fieldPath(path, "key"), issues, { maxLength: 128, pattern: SAFE_REF });
  return value as SecretRefV1;
};

const validateMetadata = (value: unknown, path: string, issues: ConfigIssue[]): RouteMetadataV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["underlyingFamily", "underlyingVersion", "sourceLabel", "thinkingLevelMap"], path, issues);
  for (const key of ["underlyingFamily", "underlyingVersion", "sourceLabel"] as const) {
    if (key in object) validateLabel(object[key], fieldPath(path, key), issues);
  }
  if ("thinkingLevelMap" in object) validateThinkingLevelMap(object.thinkingLevelMap, fieldPath(path, "thinkingLevelMap"), issues);
  return value as RouteMetadataV1;
};

const validateThinkingLevelMap = (value: unknown, path: string, issues: ConfigIssue[]): void => {
  const object = record(value, path, issues);
  if (!object) return;
  ensureKeys(object, ["off", "minimal", "low", "medium", "high", "xhigh", "max"], path, issues);
  for (const key of ["off", "minimal", ...THINKING_EFFORTS] as const) {
    if (!(key in object)) continue;
    const item = object[key];
    if (item !== null) stringValue(item, fieldPath(path, key), issues, { maxLength: 128 });
  }
};

const validateGateway = (value: unknown, path: string, issues: ConfigIssue[]): GatewayConfigV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["id", "kind", "baseUrl", "enabled", "timeoutMs", "credentialRef"], path, issues);
  stableId(object.id, fieldPath(path, "id"), issues);
  stringValue(object.kind, fieldPath(path, "kind"), issues, { maxLength: 64, pattern: TAG });
  const baseUrl = stringValue(object.baseUrl, fieldPath(path, "baseUrl"), issues, { maxLength: 2048 });
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        issue(issues, "url", fieldPath(path, "baseUrl"), "Gateway URL scheme is not supported");
      }
      if (url.username || url.password || url.search || url.hash) {
        issue(issues, "secret-boundary", fieldPath(path, "baseUrl"), "Gateway URL must not contain credentials or query state");
      }
    } catch {
      issue(issues, "url", fieldPath(path, "baseUrl"), "Gateway URL is invalid");
    }
  }
  booleanValue(object.enabled, fieldPath(path, "enabled"), issues);
  boundedInteger(object.timeoutMs, fieldPath(path, "timeoutMs"), issues, 1_000, 600_000);
  if ("credentialRef" in object) validateSecretRef(object.credentialRef, fieldPath(path, "credentialRef"), issues);
  return value as GatewayConfigV1;
};

const validateRoute = (value: unknown, path: string, issues: ConfigIssue[]): RouteConfigV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["id", "displayName", "enabled", "gatewayId", "remoteModelId", "resource", "tags", "capabilities", "metadata"], path, issues);
  stableId(object.id, fieldPath(path, "id"), issues);
  validateLabel(object.displayName, fieldPath(path, "displayName"), issues);
  booleanValue(object.enabled, fieldPath(path, "enabled"), issues);
  if ("gatewayId" in object) stableId(object.gatewayId, fieldPath(path, "gatewayId"), issues);
  stringValue(object.remoteModelId, fieldPath(path, "remoteModelId"), issues, { maxLength: MAX_REMOTE_MODEL_LENGTH });
  const resource = record(object.resource, fieldPath(path, "resource"), issues);
  if (resource) {
    ensureKeys(resource, ["class", "id"], fieldPath(path, "resource"), issues);
    enumValue(resource.class, fieldPath(fieldPath(path, "resource"), "class"), issues, RESOURCE_CLASSES);
    if ("id" in resource) stableId(resource.id, fieldPath(fieldPath(path, "resource"), "id"), issues);
  }
  validateTagArray(object.tags, fieldPath(path, "tags"), issues);
  validateTagArray(object.capabilities, fieldPath(path, "capabilities"), issues);
  if ("metadata" in object) validateMetadata(object.metadata, fieldPath(path, "metadata"), issues);
  return value as RouteConfigV1;
};

const validatePoolEntry = (value: unknown, path: string, issues: ConfigIssue[]): PoolRouteV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["routeId", "enabled", "timeoutMs", "maxAttempts", "thinkingEffort", "weight"], path, issues);
  stableId(object.routeId, fieldPath(path, "routeId"), issues);
  booleanValue(object.enabled, fieldPath(path, "enabled"), issues);
  if ("timeoutMs" in object) boundedInteger(object.timeoutMs, fieldPath(path, "timeoutMs"), issues, 1_000, 600_000);
  if ("maxAttempts" in object) boundedInteger(object.maxAttempts, fieldPath(path, "maxAttempts"), issues, 1, 16);
  if ("thinkingEffort" in object) enumValue(object.thinkingEffort, fieldPath(path, "thinkingEffort"), issues, ["auto", ...THINKING_EFFORTS] as const);
  if ("weight" in object) boundedInteger(object.weight, fieldPath(path, "weight"), issues, 0, MAX_POOL_ENTRY_WEIGHT);
  return value as PoolRouteV1;
};

const validatePool = (value: unknown, path: string, issues: ConfigIssue[]): PoolV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["schedulingPolicy", "entries"], path, issues);
  if ("schedulingPolicy" in object) enumValue(object.schedulingPolicy, fieldPath(path, "schedulingPolicy"), issues, POOL_SCHEDULING_POLICIES);
  const entries = arrayValue(object.entries, fieldPath(path, "entries"), issues);
  if (entries) entries.forEach((entry, index) => validatePoolEntry(entry, `${path}.entries[${index}]`, issues));
  return value as PoolV1;
};

const validateRole = (value: unknown, path: string, issues: ConfigIssue[]): RoleConfigV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["id", "displayName", "executionClass", "instructionsRef", "allowedTools", "allowedActions", "resultSchemaId"], path, issues);
  stableId(object.id, fieldPath(path, "id"), issues);
  validateLabel(object.displayName, fieldPath(path, "displayName"), issues);
  enumValue(object.executionClass, fieldPath(path, "executionClass"), issues, EXECUTION_CLASSES);
  if ("instructionsRef" in object) stringValue(object.instructionsRef, fieldPath(path, "instructionsRef"), issues, { maxLength: 128, pattern: SAFE_REF });
  validateStringArray(object.allowedTools, fieldPath(path, "allowedTools"), issues);
  validateStringArray(object.allowedActions, fieldPath(path, "allowedActions"), issues);
  stableId(object.resultSchemaId, fieldPath(path, "resultSchemaId"), issues);
  return value as RoleConfigV1;
};

const validateBossProfile = (value: unknown, path: string, issues: ConfigIssue[]): BossProfileV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["id", "displayName", "enabled", "routeIds", "entries", "schedulingPolicy", "description"], path, issues);
  stableId(object.id, fieldPath(path, "id"), issues);
  validateLabel(object.displayName, fieldPath(path, "displayName"), issues);
  booleanValue(object.enabled, fieldPath(path, "enabled"), issues);
  validateIdArray(object.routeIds, fieldPath(path, "routeIds"), issues);
  if ("schedulingPolicy" in object) enumValue(object.schedulingPolicy, fieldPath(path, "schedulingPolicy"), issues, POOL_SCHEDULING_POLICIES);
  if ("entries" in object) {
    const entries = arrayValue(object.entries, fieldPath(path, "entries"), issues);
    if (entries) entries.forEach((entry, index) => validateBossEntry(entry, `${path}.entries[${index}]`, issues));
  }
  if ("description" in object) validateLabel(object.description, fieldPath(path, "description"), issues);
  return value as BossProfileV1;
};

const validateBossEntry = (value: unknown, path: string, issues: ConfigIssue[]): BossRouteV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["routeId", "enabled", "thinkingEffort", "weight"], path, issues);
  stableId(object.routeId, fieldPath(path, "routeId"), issues);
  booleanValue(object.enabled, fieldPath(path, "enabled"), issues);
  if ("thinkingEffort" in object) enumValue(object.thinkingEffort, fieldPath(path, "thinkingEffort"), issues, ["auto", ...THINKING_EFFORTS] as const);
  if ("weight" in object) boundedInteger(object.weight, fieldPath(path, "weight"), issues, 0, MAX_POOL_ENTRY_WEIGHT);
  return value as BossRouteV1;
};

const validateOperationalProfile = (value: unknown, path: string, issues: ConfigIssue[]): OperationalProfileV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["id", "displayName", "enabled", "maxAgents", "maxConcurrency", "investigatorCount", "reviewerCount", "costPreference", "diversityPreference", "escalationLimit", "contextBudgetClass"], path, issues);
  stableId(object.id, fieldPath(path, "id"), issues);
  validateLabel(object.displayName, fieldPath(path, "displayName"), issues);
  booleanValue(object.enabled, fieldPath(path, "enabled"), issues);
  boundedInteger(object.maxAgents, fieldPath(path, "maxAgents"), issues, 1, 64);
  boundedInteger(object.maxConcurrency, fieldPath(path, "maxConcurrency"), issues, 1, 64);
  boundedInteger(object.investigatorCount, fieldPath(path, "investigatorCount"), issues, 0, 64);
  boundedInteger(object.reviewerCount, fieldPath(path, "reviewerCount"), issues, 0, 64);
  enumValue(object.costPreference, fieldPath(path, "costPreference"), issues, COST_PREFERENCES);
  enumValue(object.diversityPreference, fieldPath(path, "diversityPreference"), issues, DIVERSITY_PREFERENCES);
  boundedInteger(object.escalationLimit, fieldPath(path, "escalationLimit"), issues, 0, 64);
  enumValue(object.contextBudgetClass, fieldPath(path, "contextBudgetClass"), issues, CONTEXT_BUDGETS);
  return value as OperationalProfileV1;
};

const validateRouting = (value: unknown, path: string, issues: ConfigIssue[]): RoutingPolicyV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["maxAttempts", "timeoutMs", "rateLimitCooldownMs", "quotaCooldownMs", "fallback", "diversityPreference"], path, issues);
  boundedInteger(object.maxAttempts, fieldPath(path, "maxAttempts"), issues, 1, 16);
  boundedInteger(object.timeoutMs, fieldPath(path, "timeoutMs"), issues, 1_000, 600_000);
  boundedInteger(object.rateLimitCooldownMs, fieldPath(path, "rateLimitCooldownMs"), issues, 0, 86_400_000);
  boundedInteger(object.quotaCooldownMs, fieldPath(path, "quotaCooldownMs"), issues, 0, 86_400_000);
  const fallback = record(object.fallback, fieldPath(path, "fallback"), issues);
  if (fallback) {
    ensureKeys(fallback, ["enabled"], fieldPath(path, "fallback"), issues);
    booleanValue(fallback.enabled, fieldPath(fieldPath(path, "fallback"), "enabled"), issues);
  }
  enumValue(object.diversityPreference, fieldPath(path, "diversityPreference"), issues, DIVERSITY_PREFERENCES);
  return value as RoutingPolicyV1;
};

const validateSafety = (value: unknown, path: string, issues: ConfigIssue[], patch = false): SafetyPolicyV1 | SafetyPatchV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  const allowed = ["maxAgents", "maxConcurrency", "maxAttempts", "timeoutMs", "maxOutputBytes", "maxTaskPacketBytes", "protectedPathPrefixes"] as const;
  ensureKeys(object, allowed, path, issues);
  if ("maxAgents" in object) boundedInteger(object.maxAgents, fieldPath(path, "maxAgents"), issues, 1, 64);
  if ("maxConcurrency" in object) boundedInteger(object.maxConcurrency, fieldPath(path, "maxConcurrency"), issues, 1, 64);
  if ("maxAttempts" in object) boundedInteger(object.maxAttempts, fieldPath(path, "maxAttempts"), issues, 1, 16);
  if ("timeoutMs" in object) boundedInteger(object.timeoutMs, fieldPath(path, "timeoutMs"), issues, 1_000, 600_000);
  if ("maxOutputBytes" in object) boundedInteger(object.maxOutputBytes, fieldPath(path, "maxOutputBytes"), issues, 1_024, 16_777_216);
  if ("maxTaskPacketBytes" in object) boundedInteger(object.maxTaskPacketBytes, fieldPath(path, "maxTaskPacketBytes"), issues, 1_024, 16_777_216);
  if ("protectedPathPrefixes" in object) {
    const paths = arrayValue(object.protectedPathPrefixes, fieldPath(path, "protectedPathPrefixes"), issues);
    if (paths) paths.forEach((entry, index) => stringValue(entry, `${path}.protectedPathPrefixes[${index}]`, issues, { maxLength: 1024 }));
  }
  return value as SafetyPolicyV1 | SafetyPatchV1;
};

const validateQuality = (value: unknown, path: string, issues: ConfigIssue[]): QualityPolicyV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["requiredGates"], path, issues);
  const gates = arrayValue(object.requiredGates, fieldPath(path, "requiredGates"), issues);
  if (gates) {
    const seen = new Set<string>();
    gates.forEach((entry, index) => {
      const gate = enumValue(entry, `${path}.requiredGates[${index}]`, issues, QUALITY_GATES);
      if (gate) {
        if (seen.has(gate)) issue(issues, "duplicate", `${path}.requiredGates[${index}]`, "Duplicate gate");
        seen.add(gate);
      }
    });
  }
  return value as QualityPolicyV1;
};

const validateAnalytics = (value: unknown, path: string, issues: ConfigIssue[]): AnalyticsPolicyV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["enabled", "mode"], path, issues);
  booleanValue(object.enabled, fieldPath(path, "enabled"), issues);
  enumValue(object.mode, fieldPath(path, "mode"), issues, ["metadata-only"] as const);
  return value as AnalyticsPolicyV1;
};

const BILLING_MODES = ["metered_api", "subscription", "free", "unknown"] as const;
const BILLING_PROVENANCE = ["configured", "provider_reported", "unknown"] as const;

const validateBillingProfile = (value: unknown, path: string, issues: ConfigIssue[]): BillingProfileV2 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["id", "displayName", "billingMode", "provenance", "currency", "inputMicrosPerMillion", "outputMicrosPerMillion", "cacheReadMicrosPerMillion", "cacheWriteMicrosPerMillion", "label"], path, issues);
  stableId(object.id, fieldPath(path, "id"), issues);
  validateLabel(object.displayName, fieldPath(path, "displayName"), issues);
  enumValue(object.billingMode, fieldPath(path, "billingMode"), issues, BILLING_MODES);
  enumValue(object.provenance, fieldPath(path, "provenance"), issues, BILLING_PROVENANCE);
  if ("currency" in object) stringValue(object.currency, fieldPath(path, "currency"), issues, { maxLength: 12, pattern: CURRENCY });
  for (const key of ["inputMicrosPerMillion", "outputMicrosPerMillion", "cacheReadMicrosPerMillion", "cacheWriteMicrosPerMillion"] as const) {
    if (!(key in object)) continue;
    const valueAtKey = object[key];
    if (typeof valueAtKey !== "number" || !Number.isSafeInteger(valueAtKey) || valueAtKey < 0) issue(issues, "range", fieldPath(path, key), "Reference price must be a non-negative safe integer in micros per million tokens");
  }
  if ("label" in object) validateLabel(object.label, fieldPath(path, "label"), issues);
  return value as BillingProfileV2;
};

const validateBilling = (value: unknown, path: string, issues: ConfigIssue[]): BillingPolicyV2 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, ["profiles", "activeProfileId"], path, issues);
  const profiles = record(object.profiles, fieldPath(path, "profiles"), issues);
  if (profiles) {
    for (const [key, profile] of Object.entries(profiles)) {
      stableId(key, `${path}.profiles{id}`, issues);
      validateBillingProfile(profile, `${path}.profiles{${key}}`, issues);
      if (isRecord(profile) && profile.id !== key) issue(issues, "id-mismatch", `${path}.profiles{${key}}.id`, "Map key and entry ID must match");
    }
  }
  if ("activeProfileId" in object) stableId(object.activeProfileId, fieldPath(path, "activeProfileId"), issues);
  if (typeof object.activeProfileId === "string" && profiles && !Object.prototype.hasOwnProperty.call(profiles, object.activeProfileId)) issue(issues, "missing-reference", fieldPath(path, "activeProfileId"), "Active billing profile does not exist");
  return value as BillingPolicyV2;
};

const validateMap = <T>(
  value: unknown,
  path: string,
  issues: ConfigIssue[],
  validateEntry: (entry: unknown, entryPath: string, issues: ConfigIssue[]) => T | undefined,
): Record<string, T> | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  for (const [key, entry] of Object.entries(object)) {
    const keyPath = `${path}{id}`;
    const keyId = stableId(key, keyPath, issues);
    const entryValue = validateEntry(entry, `${path}{id}`, issues);
    if (keyId && isRecord(entry) && entry.id !== key) issue(issues, "id-mismatch", `${path}{id}.id`, "Map key and entry ID must match");
    void entryValue;
  }
  return value as Record<string, T>;
};

const validatePools = (value: unknown, path: string, issues: ConfigIssue[]): PoolsV1 | undefined => {
  const object = record(value, path, issues);
  if (!object) return undefined;
  ensureKeys(object, [...EXECUTION_CLASSES], path, issues);
  for (const executionClass of EXECUTION_CLASSES) {
    if (!(executionClass in object)) issue(issues, "missing-field", fieldPath(path, executionClass), "Required pool is missing");
    else validatePool(object[executionClass], fieldPath(path, executionClass), issues);
  }
  return value as PoolsV1;
};

const validateConfigStructure = (value: unknown, issues: ConfigIssue[]): ConfigV1 | undefined => {
  const object = record(value, "$", issues);
  if (!object) return undefined;
  ensureKeys(object, ["schemaVersion", "gateways", "routes", "pools", "roles", "bossProfiles", "activeBossProfileId", "operationalProfiles", "activeOperationalProfileId", "routing", "safety", "quality", "analytics"], "$", issues);
  if (object.schemaVersion !== CURRENT_SCHEMA_VERSION) issue(issues, "version", "schemaVersion", "Schema version is unsupported");
  validateMap(object.gateways, "gateways", issues, validateGateway);
  validateMap(object.routes, "routes", issues, validateRoute);
  validatePools(object.pools, "pools", issues);
  validateMap(object.roles, "roles", issues, validateRole);
  validateMap(object.bossProfiles, "bossProfiles", issues, validateBossProfile);
  stableId(object.activeBossProfileId, "activeBossProfileId", issues);
  validateMap(object.operationalProfiles, "operationalProfiles", issues, validateOperationalProfile);
  stableId(object.activeOperationalProfileId, "activeOperationalProfileId", issues);
  validateRouting(object.routing, "routing", issues);
  validateSafety(object.safety, "safety", issues);
  validateQuality(object.quality, "quality", issues);
  validateAnalytics(object.analytics, "analytics", issues);
  return value as ConfigV1;
};

const semanticConfigIssues = (config: ConfigV1): ConfigIssue[] => {
  const issues: ConfigIssue[] = [];
  const routes = config.routes;
  const gateways = config.gateways;
  const routeExists = (routeId: string): boolean => Object.prototype.hasOwnProperty.call(routes, routeId);
  const gatewayExists = (gatewayId: string): boolean => Object.prototype.hasOwnProperty.call(gateways, gatewayId);

  for (const [key, gateway] of Object.entries(gateways)) {
    if (gateway.id !== key) issue(issues, "id-mismatch", `gateways{${key}}.id`, "Map key and entry ID must match");
  }
  for (const [key, route] of Object.entries(routes)) {
    if (route.id !== key) issue(issues, "id-mismatch", `routes{${key}}.id`, "Map key and entry ID must match");
    if (route.gatewayId && !gatewayExists(route.gatewayId)) issue(issues, "missing-reference", `routes{${key}}.gatewayId`, "Gateway reference does not exist");
  }
  for (const executionClass of EXECUTION_CLASSES) {
    const entries = config.pools[executionClass].entries;
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (!routeExists(entry.routeId)) issue(issues, "missing-reference", `pools.${executionClass}.entries[${index}].routeId`, "Route reference does not exist");
      if (seen.has(entry.routeId)) issue(issues, "duplicate", `pools.${executionClass}.entries[${index}].routeId`, "Duplicate route in pool");
      seen.add(entry.routeId);
      if (entry.timeoutMs !== undefined && entry.timeoutMs > config.safety.timeoutMs) issue(issues, "safety-ceiling", `pools.${executionClass}.entries[${index}].timeoutMs`, "Pool timeout exceeds safety ceiling");
      if (entry.maxAttempts !== undefined && entry.maxAttempts > config.safety.maxAttempts) issue(issues, "safety-ceiling", `pools.${executionClass}.entries[${index}].maxAttempts`, "Pool attempts exceed safety ceiling");
    });
  }
  for (const [key, profile] of Object.entries(config.bossProfiles)) {
    if (profile.id !== key) issue(issues, "id-mismatch", `bossProfiles{${key}}.id`, "Map key and entry ID must match");
    profile.routeIds.forEach((routeId, index) => {
      if (!routeExists(routeId)) issue(issues, "missing-reference", `bossProfiles{${key}}.routeIds[${index}]`, "Route reference does not exist");
    });
    const seen = new Set<string>();
    for (const [index, entry] of (profile.entries ?? []).entries()) {
      if (!routeExists(entry.routeId)) issue(issues, "missing-reference", `bossProfiles{${key}}.entries[${index}].routeId`, "Route reference does not exist");
      if (seen.has(entry.routeId)) issue(issues, "duplicate", `bossProfiles{${key}}.entries[${index}].routeId`, "Duplicate route in Boss profile");
      seen.add(entry.routeId);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(config.bossProfiles, config.activeBossProfileId)) {
    issue(issues, "missing-reference", "activeBossProfileId", "Active Boss profile does not exist");
  }
  for (const [key, profile] of Object.entries(config.operationalProfiles)) {
    if (profile.id !== key) issue(issues, "id-mismatch", `operationalProfiles{${key}}.id`, "Map key and entry ID must match");
    if (profile.maxConcurrency > profile.maxAgents) issue(issues, "impossible-policy", `operationalProfiles{${key}}.maxConcurrency`, "Concurrency exceeds agent limit");
    if (profile.maxAgents > config.safety.maxAgents) issue(issues, "safety-ceiling", `operationalProfiles{${key}}.maxAgents`, "Agent limit exceeds safety ceiling");
    if (profile.maxConcurrency > config.safety.maxConcurrency) issue(issues, "safety-ceiling", `operationalProfiles{${key}}.maxConcurrency`, "Concurrency exceeds safety ceiling");
  }
  if (!Object.prototype.hasOwnProperty.call(config.operationalProfiles, config.activeOperationalProfileId)) {
    issue(issues, "missing-reference", "activeOperationalProfileId", "Active operational profile does not exist");
  } else if (!config.operationalProfiles[config.activeOperationalProfileId]?.enabled) {
    issue(issues, "inactive-reference", "activeOperationalProfileId", "Active operational profile is disabled");
  }
  if (config.routing.maxAttempts > config.safety.maxAttempts) issue(issues, "safety-ceiling", "routing.maxAttempts", "Routing attempts exceed safety ceiling");
  if (config.routing.timeoutMs > config.safety.timeoutMs) issue(issues, "safety-ceiling", "routing.timeoutMs", "Routing timeout exceeds safety ceiling");
  return issues;
};

export function validateConfig(value: unknown): ConfigV1 {
  const issues: ConfigIssue[] = [];
  const config = validateConfigStructure(value, issues);
  if (config && issues.length === 0) issues.push(...semanticConfigIssues(config));
  if (issues.length > 0 || !config) throw new ConfigValidationError(issues.length > 0 ? issues : [{ code: "type", path: "$", message: "Expected a configuration object" }]);
  return config;
}

/** Validate the current (V2) configuration shape without weakening V1 checks. */
export function validateConfigV2(value: unknown): ConfigV2 {
  const issues: ConfigIssue[] = [];
  const object = record(value, "$", issues);
  if (!object) throw new ConfigValidationError(issues);
  ensureKeys(object, ["schemaVersion", "gateways", "routes", "pools", "roles", "bossProfiles", "activeBossProfileId", "operationalProfiles", "activeOperationalProfileId", "routing", "safety", "quality", "analytics", "billing"], "$", issues);
  if (object.schemaVersion !== CURRENT_CONFIG_SCHEMA_VERSION) issue(issues, "version", "schemaVersion", "Schema version is unsupported");

  // Reuse the complete V1 structural and semantic validator for the stable
  // fields.  Only the version and V2 billing field are removed for that pass.
  const base: Record<string, unknown> = { ...object, schemaVersion: CURRENT_SCHEMA_VERSION };
  delete base.billing;
  try {
    validateConfig(base);
  } catch (error) {
    if (error instanceof ConfigValidationError) issues.push(...error.issues);
    else issue(issues, "config", "$", "Base configuration is invalid");
  }
  validateBilling(object.billing, "billing", issues);
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return value as ConfigV2;
}

/** Accept either a legacy V1 config or the current V2 shape. */
export function validateCurrentConfig(value: unknown): ConfigV1 | ConfigV2 {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && (value as { schemaVersion?: unknown }).schemaVersion === CURRENT_CONFIG_SCHEMA_VERSION) return validateConfigV2(value);
  return validateConfig(value);
}

const validateProjectStructure = (value: unknown, issues: ConfigIssue[]): ProjectOverrideV1 | undefined => {
  const object = record(value, "$", issues);
  if (!object) return undefined;
  ensureKeys(object, ["schemaVersion", "gateways", "routes", "pools", "roles", "bossProfiles", "activeBossProfileId", "operationalProfiles", "activeOperationalProfileId", "routing", "safety", "quality", "analytics"], "$", issues);
  if (object.schemaVersion !== CURRENT_SCHEMA_VERSION) issue(issues, "version", "schemaVersion", "Schema version is unsupported");
  if ("gateways" in object) validateMap(object.gateways, "gateways", issues, validateGateway);
  if ("routes" in object) validateMap(object.routes, "routes", issues, validateRoute);
  if ("pools" in object) {
    const pools = record(object.pools, "pools", issues);
    if (pools) {
      ensureKeys(pools, [...EXECUTION_CLASSES], "pools", issues);
      for (const executionClass of EXECUTION_CLASSES) {
        if (executionClass in pools) validatePool(pools[executionClass], `pools.${executionClass}`, issues);
      }
    }
  }
  if ("roles" in object) validateMap(object.roles, "roles", issues, validateRole);
  if ("bossProfiles" in object) validateMap(object.bossProfiles, "bossProfiles", issues, validateBossProfile);
  if ("activeBossProfileId" in object) stableId(object.activeBossProfileId, "activeBossProfileId", issues);
  if ("operationalProfiles" in object) validateMap(object.operationalProfiles, "operationalProfiles", issues, validateOperationalProfile);
  if ("activeOperationalProfileId" in object) stableId(object.activeOperationalProfileId, "activeOperationalProfileId", issues);
  if ("routing" in object) validateRouting(object.routing, "routing", issues);
  if ("safety" in object) validateSafety(object.safety, "safety", issues, true);
  if ("quality" in object) validateQuality(object.quality, "quality", issues);
  if ("analytics" in object) validateAnalytics(object.analytics, "analytics", issues);
  return value as ProjectOverrideV1;
};

export function validateProjectOverride(value: unknown): ProjectOverrideV1 {
  const issues: ConfigIssue[] = [];
  const project = validateProjectStructure(value, issues);
  if (issues.length > 0 || !project) throw new ConfigValidationError(issues.length > 0 ? issues : [{ code: "type", path: "$", message: "Expected a project override object" }]);
  return project;
}

export function validateProjectOverrideV2(value: unknown): ProjectOverrideV2 {
  const issues: ConfigIssue[] = [];
  const object = record(value, "$", issues);
  if (!object) throw new ConfigValidationError(issues);
  ensureKeys(object, ["schemaVersion", "gateways", "routes", "pools", "roles", "bossProfiles", "activeBossProfileId", "operationalProfiles", "activeOperationalProfileId", "routing", "safety", "quality", "analytics", "billing"], "$", issues);
  if (object.schemaVersion !== CURRENT_CONFIG_SCHEMA_VERSION) issue(issues, "version", "schemaVersion", "Schema version is unsupported");
  const base: Record<string, unknown> = { ...object, schemaVersion: CURRENT_SCHEMA_VERSION };
  delete base.billing;
  try {
    validateProjectOverride(base);
  } catch (error) {
    if (error instanceof ConfigValidationError) issues.push(...error.issues);
    else issue(issues, "config", "$", "Base project override is invalid");
  }
  if ("billing" in object) validateBilling(object.billing, "billing", issues);
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return value as ProjectOverrideV2;
}

export function validateStoredConfig(value: unknown): StoredConfigV1 {
  const issues: ConfigIssue[] = [];
  const object = record(value, "$", issues);
  if (!object) throw new ConfigValidationError(issues);
  ensureKeys(object, ["storageVersion", "generation", "savedAt", "config"], "$", issues);
  if (object.storageVersion !== CURRENT_STORAGE_VERSION) issue(issues, "version", "storageVersion", "Storage version is unsupported");
  boundedInteger(object.generation, "generation", issues, 0, Number.MAX_SAFE_INTEGER);
  const savedAt = stringValue(object.savedAt, "savedAt", issues, { maxLength: 64 });
  if (savedAt && Number.isNaN(Date.parse(savedAt))) issue(issues, "date", "savedAt", "Timestamp is invalid");
  try {
    validateConfig(object.config);
  } catch (error) {
    if (error instanceof ConfigValidationError) issues.push(...error.issues.map((entry) => ({ ...entry, path: `config.${entry.path}` })));
    else issue(issues, "config", "config", "Nested configuration is invalid");
  }
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return value as StoredConfigV1;
}

export function validateStoredConfigV2(value: unknown): StoredConfigV2 {
  const issues: ConfigIssue[] = [];
  const object = record(value, "$", issues);
  if (!object) throw new ConfigValidationError(issues);
  ensureKeys(object, ["storageVersion", "generation", "savedAt", "config"], "$", issues);
  if (object.storageVersion !== CURRENT_STORAGE_VERSION) issue(issues, "version", "storageVersion", "Storage version is unsupported");
  boundedInteger(object.generation, "generation", issues, 0, Number.MAX_SAFE_INTEGER);
  const savedAt = stringValue(object.savedAt, "savedAt", issues, { maxLength: 64 });
  if (savedAt && Number.isNaN(Date.parse(savedAt))) issue(issues, "date", "savedAt", "Timestamp is invalid");
  try {
    validateConfigV2(object.config);
  } catch (error) {
    if (error instanceof ConfigValidationError) issues.push(...error.issues.map((entry) => ({ ...entry, path: `config.${entry.path}` })));
    else issue(issues, "config", "config", "Nested configuration is invalid");
  }
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return value as StoredConfigV2;
}

export type { ContextBudgetClass, DiversityPreference, QualityGate, ResourceClass };
