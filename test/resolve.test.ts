import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultConfig } from "../src/core/config/defaults.js";
import { ConfigValidationError } from "../src/core/config/errors.js";
import { resolveConfig } from "../src/core/config/resolve.js";
import { deterministicJson, serializeConfig } from "../src/core/config/serialize.js";
import type { ConfigV1, RouteConfigV1, StableId } from "../src/core/config/types.js";

const id = (value: string): StableId => value as StableId;

function route(routeId: string, displayName = routeId): RouteConfigV1 {
  return {
    id: id(routeId),
    displayName,
    enabled: true,
    remoteModelId: `model-${routeId}`,
    resource: { class: "subscription", id: id(`resource-${routeId}`) },
    tags: [`tag-${routeId}`, "ordered"],
    capabilities: ["text"],
  };
}

function fixture(): ConfigV1 {
  const config = createDefaultConfig();
  const first = route("route-a");
  const second = route("route-b");
  config.routes[first.id] = first;
  config.routes[second.id] = second;
  config.pools.implementation.entries = [
    { routeId: first.id, enabled: true },
    { routeId: second.id, enabled: true },
  ];
  return config;
}

test("[U][fixture-v1] SCOPE-01 scalar and keyed-map project overrides", () => {
  const config = fixture();
  const replacement = route("route-a", "Project route");
  const added = route("route-c");

  const result = resolveConfig(config, {
    projectTrusted: true,
    projectOverride: {
      routes: {
        [replacement.id]: replacement,
        [added.id]: added,
      },
      safety: { maxConcurrency: 1 },
    },
  });

  assert.equal(result.config.safety.maxConcurrency, 1);
  assert.equal(result.config.routes["route-a"]?.displayName, "Project route");
  assert.ok(result.config.routes["route-b"]);
  assert.ok(result.config.routes["route-c"]);
  assert.equal(result.diagnostics.length, 0);
});

test("[U][fixture-v1] keyed entries replace completely and arrays replace wholesale", () => {
  const config = fixture();
  const replacement = route("route-a", "Replacement");

  const result = resolveConfig(config, {
    projectTrusted: true,
    projectOverride: {
      routes: { [replacement.id]: replacement },
      pools: {
        implementation: { entries: [{ routeId: id("route-b"), enabled: false }] },
      },
    },
  });

  assert.deepEqual(result.config.routes["route-a"], replacement);
  assert.deepEqual(result.config.pools.implementation.entries, [{ routeId: id("route-b"), enabled: false }]);
  assert.deepEqual(result.config.pools.investigation.entries, []);
});

test("[U][fixture-v1] SCOPE-02 ordered arrays are not concatenated or sorted", () => {
  const config = fixture();
  config.pools.implementation.entries = [
    { routeId: id("route-b"), enabled: true },
    { routeId: id("route-a"), enabled: true },
  ];

  const result = resolveConfig(config, {
    projectTrusted: true,
    projectOverride: {
      pools: {
        implementation: {
          entries: [{ routeId: id("route-a"), enabled: false }],
        },
      },
    },
  });

  assert.deepEqual(result.config.pools.implementation.entries, [{ routeId: id("route-a"), enabled: false }]);
});

test("[U][fixture-v1] SCOPE-03 untrusted project override is ignored without parsing", () => {
  const config = fixture();
  const untrusted = {
    get schemaVersion(): never {
      throw new Error("untrusted project input must not be inspected");
    },
  };

  const result = resolveConfig(config, { projectOverride: untrusted, projectTrusted: false });

  assert.equal(result.config.safety.maxConcurrency, config.safety.maxConcurrency);
  assert.deepEqual(result.config.pools.implementation.entries, config.pools.implementation.entries);
  assert.deepEqual(result.diagnostics, [
    {
      code: "PROJECT_OVERRIDE_IGNORED",
      message: "Project override ignored because the project is not trusted.",
    },
  ]);
});

test("[U][fixture-v1] SCOPE-04 project safety can tighten but never loosen", () => {
  const config = fixture();
  const tightened = resolveConfig(config, {
    projectTrusted: true,
    projectOverride: {
      safety: {
        maxAgents: 2,
        protectedPathPrefixes: ["/workspace/protected"],
      },
    },
  });

  assert.equal(tightened.config.safety.maxAgents, 2);
  assert.deepEqual(tightened.config.safety.protectedPathPrefixes, ["/workspace/protected"]);

  assert.throws(
    () =>
      resolveConfig(config, {
        projectTrusted: true,
        projectOverride: { safety: { maxAgents: config.safety.maxAgents + 1 } },
      }),
    (error: unknown) => error instanceof ConfigValidationError && error.issues[0]?.code === "SAFETY_LOOSENING",
  );
});

test("[U][fixture-v1] mission override is applied after trusted project override", () => {
  const config = fixture();
  const result = resolveConfig(config, {
    projectTrusted: true,
    projectOverride: { safety: { maxConcurrency: 1 } },
    missionOverride: { safety: { maxConcurrency: 1 }, activeBossProfileId: config.activeBossProfileId },
  });

  assert.equal(result.config.safety.maxConcurrency, 1);
  assert.equal(result.config.activeBossProfileId, config.activeBossProfileId);
});

test("[U][fixture-v1] invalid resolved references are rejected", () => {
  const config = fixture();
  assert.throws(
    () => resolveConfig(config, {
      projectTrusted: true,
      projectOverride: {
        pools: { implementation: { entries: [{ routeId: id("missing-route"), enabled: true }] } },
      },
    }),
    ConfigValidationError,
  );
});

test("[U][fixture-v1] resolution returns a deeply frozen snapshot", () => {
  const config = fixture();
  const result = resolveConfig(config);

  assert.notEqual(result.config, config);
  assert.ok(Object.isFrozen(result.config));
  assert.ok(Object.isFrozen(result.config.routes));
  assert.ok(Object.isFrozen(result.config.routes["route-a"]));
  assert.ok(Object.isFrozen(result.config.pools.implementation.entries));
  assert.ok(Object.isFrozen(result.config.pools.implementation.entries[0]));
  assert.equal(Object.isFrozen(config), false);
});

test("[U][fixture-v1] deterministic JSON sorts objects and preserves arrays", () => {
  assert.equal(
    deterministicJson({ z: [2, 1], a: { b: 1, a: 2 } }),
    '{\n  "a": {\n    "a": 2,\n    "b": 1\n  },\n  "z": [\n    2,\n    1\n  ]\n}\n',
  );

  const serialized = serializeConfig(fixture());
  assert.equal(serialized.endsWith("\n"), true);
  const parsed = JSON.parse(serialized) as ConfigV1;
  assert.deepEqual(parsed.pools.implementation.entries, [
    { routeId: "route-a", enabled: true },
    { routeId: "route-b", enabled: true },
  ]);
});
