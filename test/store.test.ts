import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { createDefaultConfig } from "../src/core/config/defaults.js";
import { ConfigConflictError, ConfigImportError, ConfigPersistenceError, ConfigRecoveryError, ConfigValidationError } from "../src/core/config/errors.js";
import { ConfigStore } from "../src/core/config/store.js";
import type { ConfigV1, StableId } from "../src/core/config/types.js";

const id = (value: string): StableId => value as StableId;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pi-orchestrator-store-"));
  roots.push(value);
  return value;
}

function fixture(): ConfigV1 {
  const config = createDefaultConfig();
  config.gateways = {
    gateway: { id: id("gateway"), kind: "fake", baseUrl: "https://example.invalid", enabled: true, timeoutMs: 1_000 },
  };
  config.routes = {
    "route-a": {
      id: id("route-a"), displayName: "Route A", enabled: true, gatewayId: id("gateway"), remoteModelId: "model-a",
      resource: { class: "subscription", id: id("resource-a") }, tags: [], capabilities: [],
    },
    "route-b": {
      id: id("route-b"), displayName: "Route B", enabled: true, gatewayId: id("gateway"), remoteModelId: "model-a",
      resource: { class: "metered-api", id: id("resource-b") }, tags: [], capabilities: [],
    },
    "route-c": {
      id: id("route-c"), displayName: "Route C", enabled: true, gatewayId: id("gateway"), remoteModelId: "model-c",
      resource: { class: "unknown", id: id("resource-c") }, tags: [], capabilities: [],
    },
  };
  config.pools.implementation.entries = [
    { routeId: id("route-a"), enabled: true },
    { routeId: id("route-b"), enabled: true },
    { routeId: id("route-c"), enabled: true },
  ];
  config.bossProfiles["default-boss"]!.routeIds = [id("route-a")];
  return config;
}

function fixedClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}

describe("ConfigStore persistence", () => {
  it("[I][fixture-v1] load returns defaults without writing", async () => {
    const path = await root();
    const store = new ConfigStore({ root: path });
    const loaded = await store.load();
    assert.equal(loaded.status, "missing");
    assert.equal(loaded.snapshot?.generation, 0);
    await assert.rejects(readFile(join(path, "config.json")));
  });

	it("[I][fixture-v1] save is atomic with history and restrictive modes", async () => {
		const path = await root();
		const audit: unknown[] = [];
		const store = new ConfigStore({ root: path, clock: fixedClock(), onAudit: (event) => { audit.push(event); } });
    const first = await store.initialize(fixture());
    assert.equal(first.generation, 1);
    const second = await store.update((draft) => { draft.pools.implementation.entries.reverse(); });
    assert.equal(second.generation, 2);
    const active = JSON.parse(await readFile(join(path, "config.json"), "utf8")) as { generation: number };
    assert.equal(active.generation, 2);
    const history = await readdir(join(path, "history"));
    assert.deepEqual(history, ["config-00000000000000000001.json"]);
    assert.equal((await stat(join(path, "config.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(path, "history", history[0]!))).mode & 0o777, 0o600);
    assert.equal((await stat(path)).mode & 0o777, 0o700);
    assert.equal((await stat(join(path, "history"))).mode & 0o777, 0o700);
    const reloaded = await new ConfigStore({ root: path }).load();
    assert.deepEqual(reloaded.snapshot?.config.pools.implementation.entries.map((entry) => entry.routeId), [
      "route-c",
      "route-b",
      "route-a",
    ]);
    assert.equal(audit.length, 2);
    assert.deepEqual(audit[1], {
      action: "update",
      generation: 2,
      previousGeneration: 1,
      timestamp: "2026-01-01T00:00:01.000Z",
		});
	});

	it("[RC20][I][fixture-v1] persists Auto for legacy pool entries", async () => {
		const path = await root();
		const store = new ConfigStore({ root: path });
		await store.initialize(fixture());
		const persisted = JSON.parse(await readFile(join(path, "config.json"), "utf8")) as { config: ConfigV1 };
		assert.equal(persisted.config.pools.implementation.entries[0]?.thinkingEffort, "auto");
		assert.equal((await store.load()).snapshot?.config.pools.implementation.entries[0]?.thinkingEffort, "auto");
	});

	it("[I][fixture-v1] invalid save leaves active bytes unchanged", async () => {
    const path = await root();
    const store = new ConfigStore({ root: path });
    await store.initialize(fixture());
    const before = await readFile(join(path, "config.json"));
    const invalid = fixture();
    invalid.pools.implementation.entries[0]!.routeId = id("missing-route");
    await assert.rejects(store.save(invalid), ConfigValidationError);
    assert.deepEqual(await readFile(join(path, "config.json")), before);
    assert.deepEqual(await readdir(join(path, "history")), []);
  });

  it("[I][fixture-v1] save snapshots caller input before asynchronous persistence", async () => {
    const path = await root();
    const store = new ConfigStore({ root: path });
    const candidate = fixture();
    const saving = store.initialize(candidate);
    candidate.routes["route-a"]!.tags.push("late-mutation");
    await saving;
    const loaded = await store.load();
    assert.deepEqual(loaded.snapshot?.config.routes["route-a"]?.tags, []);
  });

  it("[I][fixture-v1] pre-rename fault leaves the old active file", async () => {
    const path = await root();
    let fail = true;
    const store = new ConfigStore({ root: path, hooks: { fault: (point) => { if (point === "active-sync" && fail) throw new Error("injected"); } } });
    await assert.rejects(store.initialize(fixture()), ConfigPersistenceError);
    fail = false;
    await store.initialize(fixture());
    const before = await readFile(join(path, "config.json"));
    fail = true;
    await assert.rejects(store.update((draft) => { draft.routing.maxAttempts = 2; }));
    assert.deepEqual(await readFile(join(path, "config.json")), before);
    fail = false;
    assert.equal((await store.load()).status, "valid");
  });

  it("[I][fixture-v1] history-write fault leaves active unchanged and removes temp files", async () => {
    const path = await root();
    let failHistory = false;
    const store = new ConfigStore({
      root: path,
      hooks: { fault: (point) => { if (point === "history-sync" && failHistory) throw new Error("injected"); } },
    });
    await store.initialize(fixture());
    const before = await readFile(join(path, "config.json"));
    failHistory = true;
    await assert.rejects(store.update((draft) => { draft.routing.maxAttempts = 2; }), ConfigPersistenceError);
    assert.deepEqual(await readFile(join(path, "config.json")), before);
    assert.deepEqual(await readdir(join(path, "history")), []);
  });

  it("[I][fixture-v1] A to B to C restore B creates a new generation", async () => {
    const path = await root();
    const store = new ConfigStore({ root: path, clock: fixedClock() });
    const config = fixture();
    await store.initialize(config);
    await store.update((draft) => { draft.routing.maxAttempts = 2; });
    const b = await store.load();
    await store.update((draft) => { draft.routing.maxAttempts = 3; });
    const restored = await store.restore(2);
    assert.equal(restored.generation, 4);
    const current = await store.load();
    assert.equal(current.snapshot?.config.routing.maxAttempts, b.snapshot?.config.routing.maxAttempts);
    const history = await store.listHistory();
    assert.deepEqual(history.entries.map((entry) => entry.generation), [3, 2, 1]);
  });

  it("[I][fixture-v1] corrupt active loads history in memory and repairs explicitly", async () => {
    const path = await root();
    const store = new ConfigStore({ root: path, clock: fixedClock(), hooks: { id: () => "fixed", now: () => "2026-01-01T00:00:00.000Z" } });
    await store.initialize(fixture());
    await store.update((draft) => { draft.routing.maxAttempts = 2; });
    const corrupt = Buffer.from("{not-json\n");
    await writeFile(join(path, "config.json"), corrupt, { mode: 0o600 });
    const loaded = await store.load();
    assert.equal(loaded.status, "recovered");
    assert.equal(loaded.repairRequired, true);
    assert.equal(loaded.snapshot?.config.routing.maxAttempts, 1);
    assert.deepEqual(await readFile(join(path, "config.json")), corrupt);
    const repaired = await store.recover();
    assert.equal(repaired.status, "recovered");
    assert.equal(repaired.snapshot?.generation, 3);
    assert.equal((await readdir(join(path, "quarantine"))).length, 1);
    assert.equal((await store.load()).status, "valid");
  });

  it("[I][fixture-v1] corrupt active without history never fabricates defaults", async () => {
    const path = await root();
    const store = new ConfigStore({ root: path });
    const corrupt = Buffer.from("bad");
    await writeFile(join(path, "config.json"), corrupt, { mode: 0o600 });
    await assert.rejects(store.recover(), ConfigRecoveryError);
    assert.deepEqual(await readFile(join(path, "config.json")), corrupt);
  });

  it("[I][fixture-v1] import preview requires confirmation and invalid input is inert", async () => {
    const path = await root();
    const store = new ConfigStore({ root: path });
    await store.initialize(fixture());
    const candidate = fixture();
    candidate.routing.maxAttempts = 2;
    const preview = await store.previewImport(JSON.stringify(candidate));
    assert.equal(preview.changed, true);
    await assert.rejects(store.activateImport(preview, { confirmed: false }), ConfigImportError);
    const result = await store.activateImport(preview, { confirmed: true, expectedGeneration: 1 });
    assert.equal(result.generation, 2);
    const before = await readFile(join(path, "config.json"));
    await assert.rejects(store.activateImport({ ...candidate, apiKey: "secret" }, { confirmed: true }));
    assert.deepEqual(await readFile(join(path, "config.json")), before);
  });

  it("[I][fixture-v1] queued updates compose and stale saves conflict", async () => {
    const path = await root();
    const store = new ConfigStore({ root: path });
    await store.initialize(fixture());
    const snapshot = await store.load();
    await assert.rejects(store.update(() => { throw new Error("mutator failed"); }));
    await Promise.all([
      store.update((draft) => { draft.routes["route-a"]!.tags.push("one"); }),
      store.update((draft) => { draft.routes["route-a"]!.tags.push("two"); }),
      store.update((draft) => { draft.routes["route-a"]!.tags.push("three"); }),
    ]);
    const current = await store.load();
    assert.deepEqual(current.snapshot?.config.routes["route-a"]?.tags, ["one", "two", "three"]);
    await assert.rejects(
      store.save(fixture(), snapshot.snapshot ? { expectedGeneration: snapshot.snapshot.generation } : {}),
      ConfigConflictError,
    );
    assert.equal((await store.load()).status, "valid");
  });

  it("[I][fixture-v1] retention prunes oldest valid history", async () => {
    const path = await root();
    const store = new ConfigStore({ root: path });
    await store.initialize(fixture());
    for (let index = 1; index <= 21; index += 1) {
      await store.update((draft) => { draft.routes["route-a"]!.tags.push(`generation-${index}`); });
    }
    const entries = await store.listHistory();
    assert.equal(entries.entries.length, 20);
    assert.equal(entries.entries[0]?.generation, 21);
    assert.equal(entries.entries.at(-1)?.generation, 2);
  });
});
