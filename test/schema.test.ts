import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultConfig } from "../src/core/config/defaults.js";
import { ConfigValidationError } from "../src/core/config/errors.js";
import { validateConfig, validateProjectOverride, validateStoredConfig } from "../src/core/config/schema.js";
import type { ConfigV1, RouteConfigV1, StableId } from "../src/core/config/types.js";

const id = (value: string): StableId => value as StableId;

function route(routeId: string, resourceId: string, model = "model-alpha"): RouteConfigV1 {
  return {
    id: id(routeId),
    displayName: routeId,
    enabled: true,
    remoteModelId: model,
    resource: { class: "subscription", id: id(resourceId) },
    tags: ["synthetic"],
    capabilities: ["text"],
  };
}

function withRoutes(...routes: RouteConfigV1[]): ConfigV1 {
  const config = createDefaultConfig();
  for (const entry of routes) config.routes[entry.id] = entry;
  config.pools.implementation.entries = routes.map((entry) => ({ routeId: entry.id, enabled: true }));
  config.bossProfiles[config.activeBossProfileId]!.routeIds = routes.length > 0 ? [routes[0]!.id] : [];
  return config;
}

function expectValidation(value: unknown, code?: string): ConfigValidationError {
  let thrown: unknown;
  try {
    validateConfig(value);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ConfigValidationError);
  if (code) assert.ok(thrown.issues.some((entry) => entry.code === code), `missing issue code ${code}`);
  return thrown;
}

test("[U][fixture-v1] default configuration validates with exactly three empty pools", () => {
  const config = validateConfig(createDefaultConfig());

  assert.equal(config.schemaVersion, 1);
  assert.deepEqual(Object.keys(config.pools), ["investigation", "implementation", "verification"]);
  assert.deepEqual(config.pools.investigation.entries, []);
  assert.deepEqual(config.pools.implementation.entries, []);
  assert.deepEqual(config.pools.verification.entries, []);
  assert.deepEqual(config.routes, {});
  assert.deepEqual(config.gateways, {});
  assert.equal(config.analytics.enabled, false);
});

test("[U][fixture-v1] structural validation rejects unsupported version, malformed route, and extra pool", () => {
  const config = createDefaultConfig();
  expectValidation({ ...config, schemaVersion: 2 }, "version");

  const malformed = structuredClone(config) as unknown as Record<string, unknown>;
  malformed.routes = { "route-a": { ...route("route-a", "resource-a"), remoteModelId: 7 } };
  expectValidation(malformed, "type");

  const extraPool = structuredClone(config) as unknown as Record<string, unknown>;
  extraPool.pools = { ...config.pools, planning: { entries: [] } };
  expectValidation(extraPool, "unknown-field");
});

test("[U][fixture-v1] malformed required sections fail with typed validation errors", () => {
  for (const candidate of [
    { ...createDefaultConfig(), pools: undefined },
    { ...createDefaultConfig(), pools: null },
    { ...createDefaultConfig(), routes: null },
    { ...createDefaultConfig(), routing: undefined },
    { ...createDefaultConfig(), safety: undefined },
  ]) {
    assert.throws(() => validateConfig(candidate), ConfigValidationError);
  }
});

test("[U][fixture-v1] semantic validation rejects missing references and duplicate pool entries", () => {
  const missingRoute = createDefaultConfig();
  missingRoute.pools.investigation.entries = [{ routeId: id("missing-route"), enabled: true }];
  expectValidation(missingRoute, "missing-reference");

  const missingBossRoute = createDefaultConfig();
  missingBossRoute.bossProfiles[missingBossRoute.activeBossProfileId]!.routeIds = [id("missing-route")];
  expectValidation(missingBossRoute, "missing-reference");

  const missingProfile = createDefaultConfig();
  missingProfile.activeBossProfileId = id("missing-profile");
  expectValidation(missingProfile, "missing-reference");

  const duplicate = withRoutes(route("route-a", "resource-a"));
  duplicate.pools.implementation.entries.push({ routeId: id("route-a"), enabled: false });
  expectValidation(duplicate, "duplicate");

  const duplicateRouteId = withRoutes(route("route-a", "resource-a"));
  duplicateRouteId.routes["route-b"] = route("route-a", "resource-b");
  expectValidation(duplicateRouteId, "id-mismatch");

  const invalidRoleClass = createDefaultConfig() as unknown as { roles: Record<string, { executionClass: string }> };
  invalidRoleClass.roles.researcher!.executionClass = "planning";
  expectValidation(invalidRoleClass, "enum");
});

test("[U][fixture-v1] same remote model through two resources remains valid and distinct", () => {
  const config = withRoutes(route("route-a", "subscription-a"), route("route-b", "api-b"));
  config.routes["route-b"]!.resource.class = "metered-api";

  const validated = validateConfig(config);

  assert.equal(validated.routes["route-a"]!.remoteModelId, "model-alpha");
  assert.equal(validated.routes["route-b"]!.remoteModelId, "model-alpha");
  assert.notEqual(validated.routes["route-a"]!.resource.id, validated.routes["route-b"]!.resource.id);
  assert.deepEqual(validated.pools.implementation.entries.map((entry) => entry.routeId), ["route-a", "route-b"]);
});

test("[U][fixture-v1] strict schema rejects raw secret-shaped fields", () => {
  const config = createDefaultConfig();
  const withSecret = structuredClone(config) as unknown as Record<string, unknown>;
  withSecret.apiKey = "synthetic-secret-sentinel";
  expectValidation(withSecret, "unknown-field");

  const gatewayConfig = structuredClone(config) as unknown as Record<string, unknown>;
  gatewayConfig.gateways = {
    "gateway-a": {
      id: "gateway-a",
      kind: "9router",
      baseUrl: "https://gateway.example.test/v1",
      enabled: true,
      timeoutMs: 60_000,
      apiKey: "synthetic-secret-sentinel",
    },
  };
  expectValidation(gatewayConfig, "unknown-field");
});

test("[U][fixture-v1] project override schema validates known patch fields and rejects unknown fields", () => {
  const override = validateProjectOverride({
    schemaVersion: 1,
    pools: { implementation: { entries: [{ routeId: id("route-a"), enabled: false }] } },
    safety: { maxConcurrency: 1, protectedPathPrefixes: [".git"] },
  });
  assert.equal(override.schemaVersion, 1);
  assert.equal(override.pools?.implementation?.entries[0]?.routeId, "route-a");

  assert.throws(
    () => validateProjectOverride({ schemaVersion: 1, apiKey: "synthetic-secret-sentinel" }),
    (error: unknown) => error instanceof ConfigValidationError && error.issues.some((entry) => entry.code === "unknown-field"),
  );
});

test("[U][fixture-v1] stored envelope validates separately from semantic config", () => {
  const stored = validateStoredConfig({
    storageVersion: 1,
    generation: 7,
    savedAt: "2026-08-12T00:00:00.000Z",
    config: createDefaultConfig(),
  });

  assert.equal(stored.generation, 7);
  assert.equal(stored.config.schemaVersion, 1);
  assert.throws(
    () => validateStoredConfig({ ...stored, generation: -1 }),
    (error: unknown) => error instanceof ConfigValidationError && error.issues.some((entry) => entry.code === "range"),
  );
});
