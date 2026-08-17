import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ConfigStore, createDefaultConfig } from "../src/core/config/index.js";
import { HealthStore, healthPath, healthRecordStatus } from "../src/core/health/index.js";
import { classifyFailure } from "../src/core/routing/index.js";
import type { StableId } from "../src/core/config/types.js";

const id = "route-a" as StableId;

describe("M4 runtime health store", () => {
	it("[I][fixture-v1] records bounded failure health, cooldown, and success recovery", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-health-"));
		try {
			let now = new Date("2026-01-01T00:00:00.000Z");
			const store = new HealthStore({ root, clock: () => now });
			const first = await store.recordFailure(id, classifyFailure({ status: 429 }), { policy: { rateLimitCooldownMs: 60_000 } });
			assert.equal(first.lastFailureClass, "rate_limited");
			assert.equal(healthRecordStatus(first, now), "Rate-limit cooldown");
			assert.equal(store.blocked(first, now), true);
			now = new Date("2026-01-01T00:01:01.000Z");
			assert.equal(store.blocked(first, now), false);
			const recovered = await store.recordSuccess(id, now);
			assert.equal(recovered.consecutiveFailures, 0);
			assert.equal(recovered.circuit, "healthy");
			assert.equal(healthRecordStatus(recovered, now), "Healthy");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] retry-after takes precedence and survives reload", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-health-"));
		try {
			const at = "2026-01-01T00:00:00.000Z";
			const store = new HealthStore({ root, clock: () => new Date(at) });
			const record = await store.recordFailure(id, classifyFailure({ status: 429, retryAfterMs: 120_000 }), { policy: { rateLimitCooldownMs: 1_000 } });
			assert.equal(record.cooldownUntil, "2026-01-01T00:02:00.000Z");
			const reloaded = new HealthStore({ root, clock: () => new Date(at) });
			assert.deepEqual(await reloaded.get(id), record);
			assert.match(await readFile(healthPath(root), "utf8"), /healthVersion/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] quota/auth/circuit reset are distinct and concurrent updates serialize", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-health-"));
		try {
			const now = new Date("2026-01-01T00:00:00.000Z");
			const store = new HealthStore({ root, clock: () => now, failureThreshold: 3 });
			await Promise.all([
				store.recordFailure(id, classifyFailure({ code: "quota_exhausted" })),
				store.recordFailure(id, classifyFailure({ status: 401 })),
				store.recordFailure(id, classifyFailure({ timeout: true })),
			]);
			const record = await store.get(id);
			assert.equal(record?.consecutiveFailures, 3);
			assert.equal(record?.circuit, "open");
			const reset = await store.reset(id, now);
			assert.equal(reset.circuit, "healthy");
			assert.equal(reset.consecutiveFailures, 0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] cancellation does not poison health and health stays outside config export/history", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-health-"));
		try {
			const store = new HealthStore({ root });
			const transient = await store.recordFailure(id, classifyFailure({ cancelled: true, message: "Bearer SECRET_SENTINEL" }));
			assert.equal(transient.circuit, "healthy");
			assert.equal((await store.get(id)), undefined);

			const config = new ConfigStore({ root });
			await config.initialize(createDefaultConfig());
			await config.update((draft) => ({ ...draft, routing: { ...draft.routing, maxAttempts: 2 } }));
			await store.recordFailure(id, classifyFailure({ status: 429 }), { retryAfterMs: 60_000 });
			const exported = await config.export();
			assert.equal(exported.includes("healthVersion"), false);
			const history = await config.listHistory();
			assert.ok(history.entries.length > 0);
			for (const entry of history.entries) assert.equal((await readFile(entry.path, "utf8")).includes("healthVersion"), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("[I][fixture-v1] corrupt health is isolated from ConfigStore and can be quarantined", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-health-"));
		try {
			await writeFile(healthPath(root), JSON.stringify({ healthVersion: 999, routes: { [id]: { secret: "Bearer SECRET_SENTINEL" } } }), { mode: 0o600 });
			const store = new HealthStore({ root });
			const loaded = await store.load();
			assert.equal(loaded.status, "corrupt");
			assert.equal(JSON.stringify(loaded).includes("SECRET_SENTINEL"), false);
			const config = new ConfigStore({ root });
			await config.initialize(createDefaultConfig());
			assert.equal((await config.load()).status, "valid");
			const recovered = await store.recover();
			assert.equal(recovered.status, "missing");
			const after = await store.recordFailure(id, classifyFailure({ status: 503, message: "Bearer SECRET_SENTINEL" }));
			assert.equal(JSON.stringify(after).includes("SECRET_SENTINEL"), false);
			assert.equal((await readFile(healthPath(root), "utf8")).includes("SECRET_SENTINEL"), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not report expired cooldownUntil as active in healthRecordStatus or blocked", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-health-expiry-"));
		try {
			const store = new HealthStore({ root });
			const record = {
				routeId: id,
				consecutiveFailures: 1,
				circuit: "degraded" as const,
				cooldownUntil: "2026-01-01T00:00:00.000Z",
				cooldownReason: "rate_limited" as const,
			};
			const futureDate = new Date("2026-01-01T00:05:00.000Z");
			assert.equal(store.blocked(record, futureDate), false);
			assert.equal(healthRecordStatus(record, futureDate), "Degraded");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
