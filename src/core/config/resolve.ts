import { ConfigValidationError } from "./errors.js";
import { validateConfig, validateProjectOverride } from "./schema.js";
import type {
  ConfigPatchV1,
  ConfigV1,
  PoolsV1,
  SafetyPatchV1,
} from "./types.js";

export interface ResolutionDiagnostic {
  readonly code: "PROJECT_OVERRIDE_IGNORED";
  readonly message: string;
}

export interface ResolveConfigOptions {
  projectOverride?: unknown;
  projectTrusted?: boolean;
  missionOverride?: unknown;
}

export interface ResolveConfigResult {
  readonly config: ConfigV1;
  readonly diagnostics: readonly ResolutionDiagnostic[];
}

const SAFETY_LIMIT_KEYS = [
  "maxAgents",
  "maxConcurrency",
  "maxAttempts",
  "timeoutMs",
  "maxOutputBytes",
  "maxTaskPacketBytes",
] as const satisfies readonly (keyof SafetyPatchV1)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord<T extends object>(value: T): T {
  return { ...value };
}

function mergeKeyedMap<T>(base: Record<string, T>, patch: Record<string, T> | undefined): Record<string, T> {
  return patch === undefined ? cloneRecord(base) : { ...base, ...patch };
}

function mergePools(base: PoolsV1, patch: Partial<PoolsV1> | undefined): PoolsV1 {
  if (patch === undefined) {
    return {
      investigation: base.investigation,
      implementation: base.implementation,
      verification: base.verification,
    };
  }

  return {
    investigation: patch.investigation ?? base.investigation,
    implementation: patch.implementation ?? base.implementation,
    verification: patch.verification ?? base.verification,
  };
}

function invalidSafety(path: string, value: unknown, ceiling: number): ConfigValidationError {
  return new ConfigValidationError([
    {
      code: "SAFETY_LOOSENING",
      path,
      message: `must not exceed the current safety ceiling (${ceiling}); received ${String(value)}`,
    },
  ]);
}

function mergeSafety(base: ConfigV1["safety"], patch: SafetyPatchV1 | undefined): ConfigV1["safety"] {
  if (patch === undefined) {
    return {
      ...base,
      protectedPathPrefixes: [...base.protectedPathPrefixes],
    };
  }

  const result: ConfigV1["safety"] = {
    ...base,
    protectedPathPrefixes: [...base.protectedPathPrefixes],
  };

  for (const key of SAFETY_LIMIT_KEYS) {
    const requested = patch[key];
    if (requested === undefined) continue;
    const current = base[key];
    if (requested > current) {
      throw invalidSafety(`safety.${key}`, requested, current);
    }
    result[key] = requested;
  }

  if (patch.protectedPathPrefixes !== undefined) {
    result.protectedPathPrefixes = [...new Set([...base.protectedPathPrefixes, ...patch.protectedPathPrefixes])];
  }

  return result;
}

function mergePatch(base: ConfigV1, patch: ConfigPatchV1): ConfigV1 {
  return {
    ...base,
    gateways: mergeKeyedMap(base.gateways, patch.gateways),
    routes: mergeKeyedMap(base.routes, patch.routes),
    pools: mergePools(base.pools, patch.pools),
    roles: mergeKeyedMap(base.roles, patch.roles),
    bossProfiles: mergeKeyedMap(base.bossProfiles, patch.bossProfiles),
    activeBossProfileId: patch.activeBossProfileId ?? base.activeBossProfileId,
    operationalProfiles: mergeKeyedMap(base.operationalProfiles, patch.operationalProfiles),
    activeOperationalProfileId: patch.activeOperationalProfileId ?? base.activeOperationalProfileId,
    routing: patch.routing === undefined ? { ...base.routing, fallback: { ...base.routing.fallback } } : patch.routing,
    safety: mergeSafety(base.safety, patch.safety),
    quality: patch.quality === undefined ? { ...base.quality, requiredGates: [...base.quality.requiredGates] } : patch.quality,
    analytics: patch.analytics === undefined ? { ...base.analytics } : patch.analytics,
  };
}

function withSchemaVersion(value: unknown, schemaVersion: ConfigV1["schemaVersion"]): unknown {
  if (!isRecord(value)) return value;
  if (Object.prototype.hasOwnProperty.call(value, "schemaVersion")) return value;
  return { schemaVersion, ...value };
}

function toPatch(value: unknown, schemaVersion: ConfigV1["schemaVersion"]): ConfigPatchV1 {
  const candidate = withSchemaVersion(value, schemaVersion);
  const parsed = validateProjectOverride(candidate);
  const { schemaVersion: _schemaVersion, ...patch } = parsed;
  return patch;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

/** Resolve defaults/global, trusted project, and launch-time mission layers. */
export function resolveConfig(globalConfig: ConfigV1, options: ResolveConfigOptions = {}): ResolveConfigResult {
  validateConfig(globalConfig);
  const diagnostics: ResolutionDiagnostic[] = [];
  // Keep caller-owned inputs mutable; the returned snapshot is the frozen value.
  let resolved = structuredClone(globalConfig) as ConfigV1;

  if (options.projectOverride !== undefined) {
    if (options.projectTrusted !== true) {
      diagnostics.push({
        code: "PROJECT_OVERRIDE_IGNORED",
        message: "Project override ignored because the project is not trusted.",
      });
    } else {
      const projectPatch = toPatch(options.projectOverride, globalConfig.schemaVersion);
      resolved = mergePatch(resolved, projectPatch);
    }
  }

  if (options.missionOverride !== undefined) {
    const missionPatch = toPatch(options.missionOverride, globalConfig.schemaVersion);
    resolved = mergePatch(resolved, missionPatch);
  }

  validateConfig(resolved);
  return {
    config: deepFreeze(structuredClone(resolved) as ConfigV1),
    diagnostics,
  };
}
