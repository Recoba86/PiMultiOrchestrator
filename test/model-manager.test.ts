import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ConfigStore } from "../src/core/config/store.js";
import type { StableId } from "../src/core/config/types.js";
import {
  CatalogCacheStore,
  EnvSecretResolver,
  NINEROUTER_GATEWAY_ID,
  NineRouterClient,
  NineRouterManager,
  NineRouterManagerError,
  stableRouteId,
} from "../src/core/ninerouter/index.js";

interface FakeModel {
  readonly id: string;
  readonly name: string;
  readonly capabilities?: readonly string[] | Record<string, unknown>;
  readonly resource?: { readonly class: "subscription" | "metered-api"; readonly id: string };
  readonly underlying_family?: string;
}

const catalog = (count: number, start = 0): FakeModel[] => Array.from({ length: count }, (_, offset) => ({
  id: `remote-${start + offset}`,
  name: `Remote ${start + offset}`,
  capabilities: ["chat"],
}));

const response = (models: readonly FakeModel[]): Response => new Response(JSON.stringify({ data: models }), {
  status: 200,
  headers: { "content-type": "application/json" },
});

describe("NineRouterManager", () => {
  it("[I][fixture-v1] carries current capability metadata into the Pi projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-m2-manager-capabilities-"));
    try {
      const models: FakeModel[] = [
        { id: "ag/gemini-3.7-flash-high", name: "Gemini", capabilities: { vision: true, reasoning: true, contextWindow: 1_048_576, maxOutput: 65_536 } },
        { id: "cu/gpt-5.6-sol-high", name: "GPT", capabilities: { vision: false, reasoning: true, contextWindow: 400_000, maxOutput: 128_000 } },
        { id: "gcli/grok-4.6", name: "Grok", capabilities: { vision: false, reasoning: true }, context_length: 256_000, max_completion_tokens: 64_000 } as FakeModel,
      ];
      const client = new NineRouterClient({ fetchImpl: async () => response(models) });
      const configStore = new ConfigStore({ root });
      const manager = new NineRouterManager({ configStore, cacheStore: new CatalogCacheStore(root), client });
      await manager.configure("http://127.0.0.1:4100");
      await manager.refresh();
      for (const entry of models) await manager.setEnabled(entry.id, true);

      const projected = await manager.providerProjection();
      assert.deepEqual(projected.models.map((entry) => ({ id: entry.id, reasoning: entry.reasoning, input: entry.input, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens })), [
        { id: "ag/gemini-3.7-flash-high", reasoning: true, input: ["text", "image"], contextWindow: 1_048_576, maxTokens: 65_536 },
        { id: "cu/gpt-5.6-sol-high", reasoning: true, input: ["text"], contextWindow: 400_000, maxTokens: 128_000 },
        { id: "gcli/grok-4.6", reasoning: true, input: ["text"], contextWindow: 256_000, maxTokens: 64_000 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("[I][fixture-v1] selects 5 of 36 without mutating pools, keeps new models disabled, and handles disappearance/LKG failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-m2-manager-"));
    try {
      let remoteCatalog = catalog(36);
      let failed = false;
      const client = new NineRouterClient({
        resolver: new EnvSecretResolver({ M2_TEST_SECRET: "synthetic-value" }),
        fetchImpl: async () => {
          if (failed) throw new Error("synthetic transport failure");
          return response(remoteCatalog);
        },
      });
      const configStore = new ConfigStore({ root });
      const manager = new NineRouterManager({ configStore, cacheStore: new CatalogCacheStore(root), client });

      await manager.configure("http://127.0.0.1:4100/v1///", "env:M2_TEST_SECRET");
      const initial = await manager.refresh();
      assert.equal(initial.entries.length, 36);
      const beforePools = (await configStore.load()).snapshot?.config.pools;
      assert.ok(beforePools);

      for (const model of remoteCatalog.slice(0, 5)) await manager.setEnabled(model.id, true);

      const firstRoute = Object.values((await configStore.load()).snapshot!.config.routes).find((route) => route.remoteModelId === "remote-0")!;
      await configStore.update((draft) => {
        draft.routes[firstRoute.id] = {
          ...draft.routes[firstRoute.id]!,
          displayName: "User label",
          resource: { class: "subscription", id: "user-resource" as StableId },
          tags: ["user-tag"],
        };
      });
      await manager.setEnabled("remote-0", false);
      await manager.setEnabled("remote-0", true);
      const preserved = (await configStore.load()).snapshot!.config.routes[firstRoute.id]!;
      assert.equal(preserved.displayName, "User label");
      assert.deepEqual(preserved.resource, { class: "subscription", id: "user-resource" });
      assert.deepEqual(preserved.tags, ["user-tag"]);
      const selected = await manager.providerProjection();
      assert.deepEqual(selected.models.map((entry) => entry.id), remoteCatalog.slice(0, 5).map((model) => model.id));
      assert.deepEqual((await configStore.load()).snapshot?.config.pools, beforePools);

      remoteCatalog = [...remoteCatalog, { id: "remote-new", name: "Remote New", capabilities: ["chat"] }];
      await manager.refresh();
      const newRow = (await manager.list()).find((row) => row.remoteModelId === "remote-new");
      assert.equal(newRow?.status, "new");
      assert.equal(newRow?.enabled, false);
      assert.equal((await manager.providerProjection()).models.length, 5);

      remoteCatalog = remoteCatalog.filter((model) => model.id !== "remote-0");
      const removed = await manager.refresh();
      assert.deepEqual(removed.removedRemoteIds, ["remote-0"]);
      const missing = (await manager.list()).find((row) => row.remoteModelId === "remote-0");
      assert.equal(missing?.status, "missing");
      assert.equal(missing?.enabled, true);
      assert.equal(missing?.available, false);
      assert.equal((await manager.providerProjection()).models.some((entry) => entry.id === "remote-0"), false);

      failed = true;
      await assert.rejects(() => manager.refresh(), /catalog request failed|catalog request/i);
      const afterFailure = await manager.loadStatus();
      assert.equal(afterFailure.cache, "stale");
      assert.equal(afterFailure.catalogEntries, remoteCatalog.length);
      assert.equal((await manager.list()).find((row) => row.remoteModelId === "remote-1")?.stale, true);

      await assert.rejects(
        () => manager.setEnabled("remote-1", false, { activeRemoteModelId: "remote-1" }),
        (error: unknown) => error instanceof NineRouterManagerError && error.code === "active-route",
      );
      await manager.setEnabled("remote-1", false, { activeRemoteModelId: "remote-2" });
      const persisted = (await configStore.load()).snapshot?.config;
      const disabledRoute = Object.values(persisted?.routes ?? {}).find((route) => route.remoteModelId === "remote-1");
      assert.equal(disabledRoute?.enabled, false);
      assert.deepEqual(persisted?.pools, beforePools);

      await manager.configure("http://127.0.0.1:4200");
      assert.equal((await manager.providerProjection()).models.length, 0);
      assert.equal((await manager.loadStatus()).cache, "empty");
      await assert.rejects(() => manager.refresh(), /catalog request failed|catalog request/i);
      assert.equal((await manager.loadStatus()).gateway, "unreachable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("[I][fixture-v1] rejects malformed credentials, stable-ID collisions, and disabled-gateway projections", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-m2-manager-"));
    try {
      const collisionRemoteId = "collision-target";
      const models: FakeModel[] = [
        ...catalog(1),
        { id: "same-family-a", name: "Same Family", capabilities: ["chat"], resource: { class: "subscription", id: "resource-a" }, underlying_family: "same-family" },
        { id: "same-family-b", name: "Same Family", capabilities: ["chat"], resource: { class: "subscription", id: "resource-b" }, underlying_family: "same-family" },
        { id: collisionRemoteId, name: "Collision Target", capabilities: ["chat"] },
      ];
      const client = new NineRouterClient({ fetchImpl: async () => response(models) });
      const configStore = new ConfigStore({ root });
      const manager = new NineRouterManager({ configStore, cacheStore: new CatalogCacheStore(root), client });
      await assert.rejects(() => manager.configure("http://127.0.0.1:4100", "not-a-secret-ref"), /credential reference is invalid|env:NAME/u);
      await assert.rejects(() => manager.configure("http://127.0.0.1:4100", "env:lowercase"), /env:NAME/u);
      await manager.configure("http://127.0.0.1:4100");
      await manager.refresh();
      const collisionId = stableRouteId(NINEROUTER_GATEWAY_ID, collisionRemoteId);
      await configStore.update((draft) => {
        draft.routes[collisionId] = {
          id: collisionId,
          displayName: "Different remote",
          enabled: false,
          gatewayId: NINEROUTER_GATEWAY_ID,
          remoteModelId: "different-remote",
          resource: { class: "unknown" },
          tags: [],
          capabilities: ["chat"],
        };
      });
      await assert.rejects(
        () => manager.setEnabled(collisionRemoteId, true),
        (error: unknown) => error instanceof NineRouterManagerError && error.code === "route-id-collision",
      );
      const familyRoutes = await Promise.all([
        manager.setEnabled("same-family-a", true),
        manager.setEnabled("same-family-b", true),
      ]);
      assert.notEqual(familyRoutes[0]?.routeId, familyRoutes[1]?.routeId);
      assert.deepEqual(
        (await manager.providerProjection()).models.filter((entry) => entry.name === "Same Family").map((entry) => entry.id).sort(),
        ["same-family-a", "same-family-b"],
      );
      await configStore.update((draft) => {
        for (const id of ["duplicate-one", "duplicate-two"] as StableId[]) {
          draft.routes[id] = {
            id,
            displayName: id,
            enabled: true,
            gatewayId: NINEROUTER_GATEWAY_ID,
            remoteModelId: "remote-0",
            resource: { class: "unknown" },
            tags: [],
            capabilities: ["chat"],
          };
        }
      });
      assert.equal((await manager.list()).find((row) => row.remoteModelId === "remote-0")?.status, "ambiguous");
      assert.equal((await manager.providerProjection()).models.some((entry) => entry.id === "remote-0"), false);
      await assert.rejects(
        () => manager.setEnabled("remote-0", true),
        (error: unknown) => error instanceof NineRouterManagerError && error.code === "model-ambiguous",
      );
      const gateway = (await manager.loadStatus()).gatewayId;
      assert.equal(gateway, NINEROUTER_GATEWAY_ID);
      await configStore.update((draft) => {
        draft.gateways[NINEROUTER_GATEWAY_ID]!.enabled = false;
      });
      assert.equal((await manager.providerProjection()).models.length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("[I][fixture-v1] serializes refreshes and does not call an absent cache missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-m2-manager-"));
    try {
      let calls = 0;
      let releaseFirst!: () => void;
      let markFirstStarted!: () => void;
      const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
      const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
      const client = new NineRouterClient({
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            markFirstStarted();
            await firstGate;
          }
          return response(catalog(1, calls));
        },
      });
      const configStore = new ConfigStore({ root });
      const manager = new NineRouterManager({ configStore, cacheStore: new CatalogCacheStore(root), client });
      await manager.configure("http://127.0.0.1:4100");
      await configStore.update((draft) => {
        const id = stableRouteId(NINEROUTER_GATEWAY_ID, "configured-only");
        draft.routes[id] = {
          id,
          displayName: "Configured only",
          enabled: true,
          gatewayId: NINEROUTER_GATEWAY_ID,
          remoteModelId: "configured-only",
          resource: { class: "unknown" },
          tags: [],
          capabilities: ["chat"],
        };
      });
      assert.equal((await manager.list()).find((row) => row.remoteModelId === "configured-only")?.status, "stale");
      assert.equal((await manager.loadStatus()).missingEnabledRoutes, 0);

      const first = manager.refresh();
      const second = manager.refresh();
      await firstStarted;
      assert.equal(calls, 1);
      releaseFirst();
      assert.equal((await first).generation, 1);
      assert.equal((await second).generation, 2);
      assert.equal(calls, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("[RC19][I][fixture-pi-0.84.1] adopts an existing Pi catalog without importing credentials or shrinking it", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-m2-manager-pi-adoption-"));
    try {
      const configStore = new ConfigStore({ root });
      const manager = new NineRouterManager({
        configStore,
        cacheStore: new CatalogCacheStore(root),
        client: new NineRouterClient({ fetchImpl: async () => response([]) }),
      });
      const models = Array.from({ length: 27 }, (_, index) => ({ id: `pi-model-${index}`, name: `Pi Model ${index}`, reasoning: index % 2 === 0, input: ["text"] as const, contextWindow: 128_000, maxTokens: 8_000 }));
      await manager.adoptPiProviderCatalog({ providerId: "9router", available: true, baseUrl: "http://127.0.0.1:4300/v1", models });

      const status = await manager.loadStatus();
      assert.equal(status.state, "pi-provider-ready");
      assert.equal(status.catalogEntries, 27);
      assert.equal(status.piProviderModels, 27);
      assert.deepEqual((await manager.list()).map((row) => row.remoteModelId), models.map((model) => model.id));
      assert.ok((await manager.list()).every((row) => row.sourceLabel === "Pi 9Router" && row.status === "new"));

      await manager.setEnabled("pi-model-0", true);
      const persisted = (await configStore.load()).snapshot!.config;
      assert.equal(persisted.gateways.ninerouter?.credentialRef, undefined);
      assert.equal(Object.values(persisted.routes).find((route) => route.remoteModelId === "pi-model-0")?.enabled, true);
      const projection = await manager.providerProjection();
      assert.equal(projection.apiKeyReference, undefined);
      assert.deepEqual(projection.models.map((model) => model.id), ["pi-model-0"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("[RC21][I][fixture-pi-0.84.1] refreshes an external Pi catalog from upstream with transient auth and preserves PMO state", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-m2-manager-rc21-external-refresh-"));
    try {
      let remoteCatalog: FakeModel[] = [
        { id: "external-a", name: "External A", capabilities: { reasoning: true, vision: true, contextWindow: 128_000, maxOutput: 8_000 } },
        { id: "external-b", name: "External B", capabilities: ["chat"] },
        { id: "external-c", name: "External C", capabilities: ["chat"] },
      ];
      let failed = false;
      const requests: Array<{ url: string; authorization: string | null }> = [];
      const client = new NineRouterClient({
        fetchImpl: async (input, init) => {
          requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
          if (failed) throw new Error("synthetic upstream failure");
          return response(remoteCatalog);
        },
      });
      const configStore = new ConfigStore({ root });
      const manager = new NineRouterManager({ configStore, cacheStore: new CatalogCacheStore(root), client });
      const baseUrl = "http://127.0.0.1:4300/v1";

      const first = await manager.refreshExternalProviderCatalog(baseUrl, { apiKey: "fixture-secret" });
      assert.deepEqual(first.entries.map((entry) => entry.remoteId), ["external-a", "external-b", "external-c"]);
      assert.deepEqual((await manager.list()).map((row) => row.remoteModelId), ["external-a", "external-b", "external-c"]);
      await manager.setEnabled("external-a", true);
      const route = Object.values((await configStore.load()).snapshot!.config.routes).find((candidate) => candidate.remoteModelId === "external-a")!;
      await configStore.update((draft) => {
        draft.pools.implementation.entries = [{ routeId: route.id, enabled: true, thinkingEffort: "high" }];
      });
      const beforeConfig = (await configStore.load()).snapshot!.config;

      remoteCatalog = [
        { id: "external-a", name: "External A changed", capabilities: { reasoning: true, thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, vision: false } },
        { id: "external-b", name: "External B", capabilities: ["chat"] },
        { id: "external-d", name: "External D", capabilities: ["chat"] },
      ];
      const changed = await manager.refreshExternalProviderCatalog(baseUrl, { apiKey: "fixture-secret" });
      assert.deepEqual(changed.addedRemoteIds, ["external-d"]);
      assert.deepEqual(changed.removedRemoteIds, ["external-c"]);
      assert.deepEqual(changed.changedRemoteIds, ["external-a"]);
      assert.deepEqual(requests.at(-1), { url: `${baseUrl}/models`, authorization: "Bearer fixture-secret" });
      assert.deepEqual((await manager.list()).map((row) => row.remoteModelId), ["external-a", "external-b", "external-d"]);
      assert.deepEqual((await configStore.load()).snapshot!.config.pools, beforeConfig.pools);
      assert.equal((await configStore.load()).snapshot!.config.routes[route.id]?.enabled, true);

      failed = true;
      await assert.rejects(() => manager.refreshExternalProviderCatalog(baseUrl, { apiKey: "fixture-secret" }), /catalog request failed/i);
      assert.equal((await manager.loadStatus()).cache, "stale");
      assert.equal((await manager.list()).find((row) => row.remoteModelId === "external-a")?.displayName, "External A changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
