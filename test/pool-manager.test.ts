import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createDefaultConfig } from "../src/core/config/defaults.js";
import { ConfigStore } from "../src/core/config/store.js";
import type { ConfigV1, RouteConfigV1, StableId } from "../src/core/config/types.js";
import { CatalogCacheStore } from "../src/core/ninerouter/cache.js";
import { createNineRouterManager } from "../src/core/ninerouter/manager.js";
import { NINEROUTER_GATEWAY_ID, type CatalogCacheV1 } from "../src/core/ninerouter/types.js";
import {
	POOL_IDS,
	PoolManager,
	PoolManagerError,
	createPoolManager,
} from "../src/core/pools/index.js";

const id = (value: string): StableId => value as StableId;

function route(routeId: string, options: { enabled?: boolean; remoteModelId?: string; gateway?: boolean } = {}): RouteConfigV1 {
	return {
		id: id(routeId),
		displayName: routeId.toUpperCase(),
		enabled: options.enabled ?? true,
		...(options.gateway ? { gatewayId: NINEROUTER_GATEWAY_ID } : {}),
		remoteModelId: options.remoteModelId ?? `remote-${routeId}`,
		resource: { class: "subscription", id: id(`resource-${routeId}`) },
		tags: [],
		capabilities: ["chat"],
		metadata: { underlyingFamily: "same-family", sourceLabel: "fixture-source" },
	};
}

function fixture(): ConfigV1 {
	const config = createDefaultConfig();
	config.gateways[NINEROUTER_GATEWAY_ID] = {
		id: NINEROUTER_GATEWAY_ID,
		kind: "9router",
		baseUrl: "http://127.0.0.1:4100/v1",
		enabled: true,
		timeoutMs: 10_000,
	};
	for (const name of ["route-a", "route-b", "route-c", "route-d", "route-e"]) {
		config.routes[name] = route(name, { gateway: true, remoteModelId: name === "route-a" ? "same-model" : `remote-${name}` });
	}
	config.routes["route-disabled"] = route("route-disabled", { gateway: true, enabled: false });
	config.routes["route-missing"] = route("route-missing", { gateway: true });
	config.pools.implementation.entries = [
		{ routeId: id("route-a"), enabled: true },
		{ routeId: id("route-b"), enabled: true },
		{ routeId: id("route-c"), enabled: true },
		{ routeId: id("route-d"), enabled: true },
	];
	return config;
}

async function setup(): Promise<{ root: string; store: ConfigStore; manager: PoolManager }> {
	const root = await mkdtemp(join(tmpdir(), "pi-pool-manager-"));
	const store = new ConfigStore({ root });
	await store.initialize(fixture());
	return { root, store, manager: createPoolManager(root, store) };
}

describe("PoolManager", () => {
	it("[I][fixture-v1] keeps exactly three ordered pools and supports add/remove/reorder", async () => {
		const { root, store, manager } = await setup();
		try {
			assert.deepEqual(POOL_IDS, ["investigation", "implementation", "verification"]);
			assert.deepEqual((await manager.listPools()).map((pool) => pool.poolId), [...POOL_IDS]);
			await manager.addRoute("implementation", id("route-e"));
			await manager.moveRoute("implementation", id("route-e"), 1);
			await manager.moveRouteUp("implementation", id("route-e"));
			await manager.moveRouteDown("implementation", id("route-e"));
			await manager.moveRoute("implementation", id("route-e"), 999);
			await manager.moveRouteDown("implementation", id("route-e"));
			await manager.moveRoute("implementation", id("route-e"), 1);
			await manager.moveRouteUp("implementation", id("route-a"));
			await manager.removeRoute("implementation", id("route-c"));
			assert.deepEqual((await manager.listMembers("implementation")).map((entry) => entry.routeId), [
				"route-a",
				"route-e",
				"route-b",
				"route-d",
			]);
			const reloaded = createPoolManager(root);
			assert.deepEqual((await reloaded.listMembers("implementation")).map((entry) => entry.routeId), [
				"route-a",
				"route-e",
				"route-b",
				"route-d",
			]);
			assert.ok((await store.listHistory()).entries.length > 0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] preserves cross-pool membership and same-family route identities", async () => {
		const { root, manager } = await setup();
		try {
			await manager.addRoute("investigation", id("route-a"));
			await manager.addRoute("verification", id("route-a"));
			await manager.addRoute("implementation", id("route-e"));
			const implementation = await manager.listMembers("implementation");
			assert.deepEqual(implementation.map((entry) => entry.routeId), ["route-a", "route-b", "route-c", "route-d", "route-e"]);
			assert.deepEqual((await manager.listMembers("investigation")).map((entry) => entry.routeId), ["route-a"]);
			assert.deepEqual((await manager.listMembers("verification")).map((entry) => entry.routeId), ["route-a"]);
			await manager.removeRoute("investigation", id("route-a"));
			assert.deepEqual((await manager.listMembers("verification")).map((entry) => entry.routeId), ["route-a"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] serializes concurrent membership mutations and rejects invalid additions", async () => {
		const { root, manager } = await setup();
		try {
			await Promise.all([
				manager.addRoute("investigation", id("route-a")),
				manager.addRoute("investigation", id("route-b")),
				manager.addRoute("investigation", id("route-c")),
			]);
			assert.deepEqual((await manager.listMembers("investigation")).map((entry) => entry.routeId), ["route-a", "route-b", "route-c"]);
			await assert.rejects(() => manager.addRoute("investigation", id("route-a")), (error: unknown) => error instanceof PoolManagerError && error.code === "duplicate-route");
			await assert.rejects(() => manager.addRoute("investigation", id("not-configured")), (error: unknown) => error instanceof PoolManagerError && error.code === "route-not-found");
			await assert.rejects(() => manager.getPool("not-a-pool" as never), (error: unknown) => error instanceof PoolManagerError && error.code === "invalid-pool");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] shares one config mutation queue with the model manager", async () => {
		const { root, store, manager } = await setup();
		try {
			const models = createNineRouterManager(root, store);
			await Promise.all([
				manager.addRoute("investigation", id("route-a")),
				models.configure("http://127.0.0.1:4200/v1", "env:NINEROUTER_TEST_KEY"),
			]);
			const loaded = await store.load();
			assert.equal(loaded.snapshot?.config.gateways[NINEROUTER_GATEWAY_ID]?.baseUrl, "http://127.0.0.1:4200/v1");
			assert.deepEqual(loaded.snapshot?.config.pools.investigation.entries.map((entry) => entry.routeId), ["route-a"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] lists configured add candidates without automatic assignment", async () => {
		const { root, manager } = await setup();
		try {
			assert.deepEqual((await manager.listMembers("investigation")).map((entry) => entry.routeId), []);
			assert.deepEqual((await manager.getAvailableCandidatesToAdd("implementation")).map((entry) => entry.routeId), [
				"route-e",
				"route-missing",
				"route-disabled",
			]);
			assert.deepEqual((await manager.getAvailableCandidatesToAdd("investigation", "DISABLED")).map((entry) => entry.routeId), ["route-disabled"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] retains disabled/missing routes and reports endpoint-bound catalog state", async () => {
		const { root, store, manager } = await setup();
		try {
			await store.update((draft) => {
				draft.pools.implementation.entries.push(
					{ routeId: id("route-disabled"), enabled: true },
					{ routeId: id("route-missing"), enabled: true },
				);
			});
			const cache: CatalogCacheV1 = {
				cacheVersion: 1,
				gatewayId: NINEROUTER_GATEWAY_ID,
				baseUrl: "http://127.0.0.1:4100/v1",
				generation: 1,
				fetchedAt: "2026-01-01T00:00:00.000Z",
				lastSuccessAt: "2026-01-01T00:00:00.000Z",
				lastAttemptAt: "2026-01-01T00:01:00.000Z",
				lastError: {
					kind: "timeout",
					stage: "catalog",
					message: "Catalog request timed out",
					at: "2026-01-01T00:01:00.000Z",
				},
				entries: [{
					remoteId: "same-model",
					displayName: "A",
					resourceClass: "subscription",
					capabilities: ["chat"],
					input: ["text"],
					capability: "chat",
					provenance: {
						remoteId: "remote",
						displayName: "remote",
						resourceClass: "remote",
						capabilities: "remote",
						input: "remote",
						capability: "remote",
					},
				}],
			};
			await new CatalogCacheStore(root).save(cache);
			const entries = await manager.listMembers("implementation");
			assert.equal(entries.find((entry) => entry.routeId === "route-a")?.state, "active");
			assert.equal(entries.find((entry) => entry.routeId === "route-a")?.catalogState, "stale");
			assert.equal(entries.find((entry) => entry.routeId === "route-a")?.gatewayId, NINEROUTER_GATEWAY_ID);
			assert.equal(entries.find((entry) => entry.routeId === "route-a")?.sourceLabel, "fixture-source");
			assert.equal(entries.find((entry) => entry.routeId === "route-a")?.resourceClass, "subscription");
			assert.equal(entries.find((entry) => entry.routeId === "route-a")?.provenance?.remoteId, "remote");
			assert.equal(entries.find((entry) => entry.routeId === "route-disabled")?.state, "global-disabled");
			assert.equal(entries.find((entry) => entry.routeId === "route-missing")?.state, "missing");
			await manager.setPoolEntryEnabled("implementation", id("route-b"), false);
			assert.equal((await manager.getPool("implementation")).entries.find((entry) => entry.routeId === "route-b")?.poolEnabled, false);
			const status = await manager.getPoolStatus("implementation");
			assert.equal(status.poolDisabled, 1);
			assert.equal(status.globallyDisabled, 1);
			assert.equal(status.missing, 4);
			assert.equal(status.stale, 1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] does not fabricate default pools when active configuration is corrupt", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-pool-manager-corrupt-"));
		try {
			await writeFile(join(root, "config.json"), "{not-json\n", { mode: 0o600 });
			await assert.rejects(
				() => createPoolManager(root).listPools(),
				(error: unknown) => error instanceof PoolManagerError && error.code === "configuration-unavailable",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
