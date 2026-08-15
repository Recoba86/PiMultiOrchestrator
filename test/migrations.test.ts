import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultConfig } from "../src/core/config/defaults.js";
import { ConfigMigrationError, ConfigVersionError } from "../src/core/config/errors.js";
import {
  MigrationRegistry,
  createMigrationRegistry,
  migrateConfig,
  migratePoolScheduling,
} from "../src/core/config/migrations.js";

test("[U][fixture-v1] current schema migrates through the default registry without mutation", () => {
  const input = createDefaultConfig();
  const migrated = migrateConfig(input);

  assert.notEqual(migrated, input);
  assert.deepEqual(migrated, input);
  assert.equal(migrated.schemaVersion, 1);
});

test("[RC23][U] pool scheduling migration is deterministic, additive, and idempotent", () => {
  const input = createDefaultConfig();
  input.pools.implementation.entries = [{ routeId: "route-a" as never, enabled: true, thinkingEffort: "high" }];
  const migrated = migratePoolScheduling(input);
  assert.equal(migrated.pools.implementation.schedulingPolicy, "priority");
  assert.equal(migrated.pools.implementation.entries[0]?.weight, 1);
  assert.equal(migrated.pools.implementation.entries[0]?.thinkingEffort, "high");
  assert.equal(input.pools.implementation.schedulingPolicy, undefined);
  assert.equal(input.pools.implementation.entries[0]?.weight, undefined);
  assert.deepEqual(migratePoolScheduling(migrated), migrated);
});

test("[U][fixture-v1] sequential test migrations run in order and clone each step", () => {
  const input = { schemaVersion: 1, steps: [] as string[] };
  const registry = createMigrationRegistry({
    currentVersion: 3,
    steps: [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate(value) {
          const object = value as { schemaVersion: number; steps: string[] };
          object.steps.push("one");
          object.schemaVersion = 2;
          return object;
        },
      },
      {
        fromVersion: 2,
        toVersion: 3,
        migrate(value) {
          const object = value as { schemaVersion: number; steps: string[] };
          object.steps.push("two");
          object.schemaVersion = 3;
          return object;
        },
      },
    ],
    validateFinal(value) {
      return value;
    },
  });

  const result = registry.migrate(input) as { schemaVersion: number; steps: string[] };
  assert.deepEqual(result, { schemaVersion: 3, steps: ["one", "two"] });
  assert.deepEqual(input, { schemaVersion: 1, steps: [] });
});

test("[U][fixture-v1] missing sequential migration is typed and non-mutating", () => {
  const registry = new MigrationRegistry({ currentVersion: 3, validateFinal: (value) => value });
  const input = { schemaVersion: 1, value: "fixture" };

  assert.throws(
    () => registry.migrate(input),
    (error: unknown) =>
      error instanceof ConfigMigrationError &&
      error.fromVersion === 1 &&
      error.toVersion === 2 &&
      error.reasonCode === "missing-step",
  );
  assert.deepEqual(input, { schemaVersion: 1, value: "fixture" });
});

test("[U][fixture-v1] future schema is rejected before any migration step", () => {
  let called = false;
  const registry = new MigrationRegistry({
    currentVersion: 1,
    steps: [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate(value) {
          called = true;
          return value;
        },
      },
    ],
    validateFinal: (value) => value,
  });

  assert.throws(
    () => registry.migrate({ schemaVersion: 2 }),
    (error: unknown) => error instanceof ConfigVersionError && error.foundVersion === 2,
  );
  assert.equal(called, false);
});

test("[U][fixture-v1] migration step failure and malformed output are typed", () => {
  const failure = createMigrationRegistry({
    currentVersion: 2,
    steps: [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate() {
          throw new Error("synthetic failure should not escape");
        },
      },
    ],
    validateFinal: (value) => value,
  });
  assert.throws(
    () => failure.migrate({ schemaVersion: 1 }),
    (error: unknown) => error instanceof ConfigMigrationError && error.reasonCode === "step-failed",
  );

  const malformed = createMigrationRegistry({
    currentVersion: 2,
    steps: [{ fromVersion: 1, toVersion: 2, migrate: () => ({ schemaVersion: 1 }) }],
    validateFinal: (value) => value,
  });
  assert.throws(
    () => malformed.migrate({ schemaVersion: 1 }),
    (error: unknown) => error instanceof ConfigMigrationError && error.reasonCode === "invalid-step-output",
  );
});

test("[U][fixture-v1] missing schema version is rejected without assuming legacy v0", () => {
  assert.throws(
    () => migrateConfig({ routes: {} }),
    (error: unknown) => error instanceof ConfigVersionError && error.foundVersion === undefined,
  );
});

test("[U][fixture-v1] final migration validation failure is typed", () => {
  const registry = createMigrationRegistry({
    currentVersion: 2,
    steps: [{ fromVersion: 1, toVersion: 2, migrate: () => ({ schemaVersion: 2 }) }],
    validateFinal: () => {
      throw new Error("synthetic validation failure");
    },
  });

  assert.throws(
    () => registry.migrate({ schemaVersion: 1 }),
    (error: unknown) => error instanceof ConfigMigrationError && error.reasonCode === "final-validation-failed",
  );
});
