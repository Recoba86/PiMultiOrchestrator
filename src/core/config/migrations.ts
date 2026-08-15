import { ConfigMigrationError, ConfigVersionError } from "./errors.js";
import { CURRENT_CONFIG_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION, validateConfig, validateConfigV2 } from "./schema.js";
import type { ConfigV1, ConfigV2, PoolRouteV1 } from "./types.js";

export { CURRENT_SCHEMA_VERSION } from "./schema.js";

export type MigrationValidator = (value: unknown) => unknown;

export interface MigrationStep {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (input: unknown) => unknown;
}

export interface MigrationRegistryOptions {
  readonly currentVersion?: number;
  readonly steps?: readonly MigrationStep[];
  readonly validateFinal?: MigrationValidator;
}

const clone = (value: unknown, fromVersion: number): unknown => {
  try {
    return structuredClone(value);
  } catch {
    throw new ConfigMigrationError(fromVersion, fromVersion + 1, "input-not-cloneable");
  }
};

const versionOf = (value: unknown): number | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === "number" && Number.isSafeInteger(version) ? version : undefined;
};

/**
 * Pure, sequential migration registry.  It never writes files and clones the
 * input before invoking user-supplied migration code.
 */
export class MigrationRegistry {
  readonly currentVersion: number;
  readonly steps: readonly MigrationStep[];
  readonly validateFinal: MigrationValidator;

  constructor(options: MigrationRegistryOptions = {}) {
    this.currentVersion = options.currentVersion ?? CURRENT_SCHEMA_VERSION;
    this.validateFinal = options.validateFinal ?? validateConfig;
    const steps = [...(options.steps ?? [])];
    const seen = new Set<number>();
    for (const step of steps) {
      if (
        !Number.isSafeInteger(step.fromVersion) ||
        !Number.isSafeInteger(step.toVersion) ||
        step.toVersion !== step.fromVersion + 1 ||
        step.fromVersion < 1 ||
        seen.has(step.fromVersion)
      ) {
        throw new ConfigMigrationError(step.fromVersion, step.toVersion, "invalid-step-registry");
      }
      seen.add(step.fromVersion);
    }
    this.steps = steps;
  }

  migrate(input: unknown): unknown {
    const sourceVersion = versionOf(input);
    if (sourceVersion === undefined) throw new ConfigVersionError(undefined, this.currentVersion);
    if (sourceVersion > this.currentVersion) throw new ConfigVersionError(sourceVersion, this.currentVersion);
    if (sourceVersion < 1) throw new ConfigMigrationError(sourceVersion, sourceVersion + 1, "unsupported-source-version");

    let value = clone(input, sourceVersion);
    let version = sourceVersion;
    while (version < this.currentVersion) {
      const step = this.steps.find((candidate) => candidate.fromVersion === version);
      if (!step) throw new ConfigMigrationError(version, version + 1, "missing-step");
      let migrated: unknown;
      try {
        migrated = step.migrate(clone(value, version));
      } catch {
        throw new ConfigMigrationError(version, step.toVersion, "step-failed");
      }
      if (versionOf(migrated) !== step.toVersion) {
        throw new ConfigMigrationError(version, step.toVersion, "invalid-step-output");
      }
      value = migrated;
      version = step.toVersion;
    }

    try {
      return this.validateFinal(value);
    } catch (error) {
      if (error instanceof ConfigMigrationError || error instanceof ConfigVersionError) throw error;
      throw new ConfigMigrationError(version, version, "final-validation-failed");
    }
  }
}

export const defaultMigrationRegistry = new MigrationRegistry();

export function createMigrationRegistry(options: MigrationRegistryOptions = {}): MigrationRegistry {
  return new MigrationRegistry(options);
}

export function migrateConfig(value: unknown, registry = defaultMigrationRegistry): ConfigV1 {
  return registry.migrate(value) as ConfigV1;
}

/** Deterministic V1 -> V2 migration.  No billing assumptions are introduced. */
export function migrateConfigV1ToV2(value: unknown): ConfigV2 {
  const source = migratePoolScheduling(migratePoolThinkingEffort(validateConfig(value)));
  return validateConfigV2({ ...structuredClone(source), schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION, billing: { profiles: {} } });
}

export const currentMigrationRegistry = new MigrationRegistry({
  currentVersion: CURRENT_CONFIG_SCHEMA_VERSION,
  steps: [{ fromVersion: CURRENT_SCHEMA_VERSION, toVersion: CURRENT_CONFIG_SCHEMA_VERSION, migrate: migrateConfigV1ToV2 }],
  validateFinal: validateConfigV2,
});

export function migrateConfigToCurrent(value: unknown): ConfigV2 {
	return currentMigrationRegistry.migrate(value) as ConfigV2;
}

/**
 * RC19 -> RC20 additive pool migration. It intentionally leaves the legacy
 * schema number alone because ConfigStore still persists the V1 semantic
 * envelope; the new field is optional for backward-compatible readers.
 */
export function migratePoolThinkingEffort(value: ConfigV1): ConfigV1 {
	const next = structuredClone(value);
	for (const pool of Object.values(next.pools)) {
		for (const entry of pool.entries as PoolRouteV1[]) {
			if (entry.thinkingEffort === undefined) entry.thinkingEffort = "auto";
		}
	}
	return next;
}

/** RC22 -> RC23 additive scheduling migration. It is pure, deterministic, and idempotent. */
export function migratePoolScheduling(value: ConfigV1): ConfigV1 {
	const next = structuredClone(value);
	for (const pool of Object.values(next.pools)) {
		pool.schedulingPolicy ??= "priority";
		for (const entry of pool.entries as PoolRouteV1[]) entry.weight ??= 1;
	}
	return next;
}

export function migratePoolRuntimeDefaults(value: ConfigV1): ConfigV1 {
	return migratePoolScheduling(migratePoolThinkingEffort(value));
}
