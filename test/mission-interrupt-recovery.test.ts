import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createMissionStore } from "../src/core/mission/index.js";
import type { MissionStoreAdapter } from "../src/core/mission/types.js";

async function withStore<T>(run: (store: MissionStoreAdapter) => T | Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "pmo-interrupt-"));
	try {
		return await run(createMissionStore({
			root,
			clock: () => new Date("2026-08-17T00:00:00.000Z"),
		}));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("Mission-level INTERRUPTED recovery", () => {
	it("recovers stale running mission with running attempt to awaiting-review and INTERRUPTED terminal", async () => withStore((store) => {
		const m = store.createMission({ missionId: "m-stale-attempt", goal: "do work" });
		store.transitionMission(m.missionId, "running");
		const t = store.createTask({ missionId: m.missionId, roleId: "worker", executionClass: "implementation", objective: "code" });
		store.createAttempt({ taskId: t.taskId });

		const recovered = store.recoverInterrupted({ now: new Date("2026-08-17T01:00:00.000Z") });
		assert.equal(recovered.length, 1);
		assert.equal(recovered[0]?.status, "interrupted");

		const updatedMission = store.getMission(m.missionId);
		assert.equal(updatedMission?.status, "awaiting-review");
		assert.notEqual(updatedMission?.status, "cancelled");

		const plan = updatedMission?.plan as Record<string, any>;
		assert.equal(plan?.orchestration?.terminal, "INTERRUPTED");
	}));

	it("recovers stale running mission with running verification run to awaiting-review and INTERRUPTED terminal", async () => withStore((store) => {
		const m = store.createMission({ missionId: "m-stale-ver", goal: "verify work" });
		store.transitionMission(m.missionId, "running");
		const t = store.createTask({ missionId: m.missionId, roleId: "worker", executionClass: "implementation", objective: "code" });
		const a = store.createAttempt({ taskId: t.taskId });
		store.finishAttempt(a.attemptId, "succeeded");
		store.createVerificationRun({ missionId: m.missionId, taskId: t.taskId, targetRunId: a.attemptId, round: 0 });

		store.recoverInterrupted({ now: new Date("2026-08-17T01:00:00.000Z") });

		const updatedMission = store.getMission(m.missionId);
		assert.equal(updatedMission?.status, "awaiting-review");
		assert.notEqual(updatedMission?.status, "cancelled");

		const plan = updatedMission?.plan as Record<string, any>;
		assert.equal(plan?.orchestration?.terminal, "INTERRUPTED");
	}));

	it("does not mutate running mission if foreign lease is still active and unexpired", async () => withStore((store) => {
		const m = store.createMission({ missionId: "m-active-foreign", goal: "foreign work" });
		store.acquireLease(m.missionId, "foreign-worker", { ttlMs: 60_000 });
		store.transitionMission(m.missionId, "running");
		const t = store.createTask({ missionId: m.missionId, roleId: "worker", executionClass: "implementation", objective: "code" });
		store.createAttempt({ taskId: t.taskId, leaseOwner: "foreign-worker", leaseTtlMs: 60_000 });

		// Attempt recovery before foreign lease expires
		const recovered = store.recoverInterrupted({ now: new Date("2026-08-17T00:00:10.000Z") });
		assert.equal(recovered.length, 0);

		const updatedMission = store.getMission(m.missionId);
		assert.equal(updatedMission?.status, "running");
	}));
});
