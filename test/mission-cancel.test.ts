import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createMissionStore } from "../src/core/mission/index.js";
import type { MissionStoreAdapter } from "../src/core/mission/types.js";
import {
	cancelActiveMission,
	handleTerminalInputForMission,
	type MissionCancelResult,
} from "../src/core/mission/mission-cancel.js";

async function withStore<T>(run: (store: MissionStoreAdapter) => T | Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "pmo-cancel-"));
	try {
		return await run(createMissionStore({
			root,
			clock: () => new Date("2026-08-17T00:00:00.000Z"),
			id: (() => {
				let n = 0;
				return () => String(++n);
			})(),
		}));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("Reliable Mission cancellation and /mission-cancel command", () => {
	it("44. One Ctrl+C consumes interrupt and triggers abort", () => {
		let aborted = false;
		const abortController = new AbortController();
		const handler = handleTerminalInputForMission({
			hasActiveMission: () => true,
			abort: () => {
				aborted = true;
				abortController.abort();
			},
		});

		// normal key is not consumed
		const normal = handler("a");
		assert.equal(normal, undefined);
		assert.equal(aborted, false);

		// \u0003 is Ctrl+C
		const ctrlC = handler("\u0003");
		assert.deepEqual(ctrlC, { consume: true });
		assert.equal(aborted, true);
		assert.equal(abortController.signal.aborted, true);
	});

	it("45-50. Cancellation aborts active work and persists CANCELLED state in MissionStore", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-can", goal: "inspect" });
		store.transitionMission(mission.missionId, "running", { actor: "boss" });
		const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", objective: "find" });
		const attempt = store.createAttempt({ taskId: task.taskId, routeId: "inv-a" });

		const result = cancelActiveMission({
			store,
			missionId: "m-can",
			reason: "user requested cancellation via Ctrl+C",
		});

		assert.equal(result.status, "cancelled");
		const updatedMission = store.getMission("m-can");
		assert.equal(updatedMission?.status, "cancelled");

		// task marked cancelled
		const updatedTask = store.getTask(task.taskId);
		assert.equal(updatedTask?.status, "cancelled");
	}));

	it("51-52. Active verification run is terminalized on cancellation", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-ver-can", goal: "inspect" });
		store.transitionMission(mission.missionId, "running", { actor: "boss" });
		const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", objective: "find" });
		const attempt = store.createAttempt({ taskId: task.taskId, routeId: "inv-a" });
		store.finishAttempt(attempt.attemptId, "succeeded");
		const verification = store.createVerificationRun({
			missionId: mission.missionId,
			taskId: task.taskId,
			targetRunId: attempt.attemptId,
			round: 0,
		});

		const result = cancelActiveMission({
			store,
			missionId: "m-ver-can",
			reason: "user interrupt",
		});

		assert.equal(result.status, "cancelled");
		const updatedVer = store.getVerificationRun(verification.verificationId);
		assert.equal(updatedVer?.status, "blocked");
	}));

	it("58. Crash recovery (recoverInterrupted) remains distinct from clean cancellation", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-crash", goal: "inspect" });
		store.transitionMission(mission.missionId, "running", { actor: "boss" });
		const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", objective: "find" });
		const attempt = store.createAttempt({ taskId: task.taskId, routeId: "inv-a", leaseOwner: "test-owner" });

		// simulate process restart / crash recovery
		const recovered = store.recoverInterrupted({ now: new Date("2026-08-17T01:00:00.000Z") });
		assert.ok(recovered.length >= 1);
		assert.equal(recovered[0]?.status, "interrupted");
		assert.equal(recovered[0]?.terminalState, "recovered_interrupted");

		// crash recovery did NOT rewrite mission as clean user CANCELLED
		const currentMission = store.getMission("m-crash");
		assert.notEqual(currentMission?.status, "cancelled");
	}));

	it("/mission-cancel without ID cancels active owned mission", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-active-owned", goal: "inspect" });
		store.transitionMission(mission.missionId, "running", { actor: "boss" });

		const result = cancelActiveMission({
			store,
			activeOwnedMissionId: "m-active-owned",
		});

		assert.equal(result.status, "cancelled");
		assert.equal(result.missionId, "m-active-owned");
	}));

	it("/mission-cancel on already terminal Mission reports already terminal", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-already-term", goal: "inspect" });
		store.transitionMission(mission.missionId, "running", { actor: "boss" });
		store.transitionMission(mission.missionId, "cancelled", { actor: "boss" });

		const result = cancelActiveMission({
			store,
			missionId: "m-already-term",
		});

		assert.equal(result.status, "already_terminal");
	}));

	it("/mission-cancel on unknown Mission reports not found", async () => withStore((store) => {
		const result = cancelActiveMission({
			store,
			missionId: "m-nonexistent-12345",
		});
		assert.equal(result.status, "not_found");
	}));

	it("/mission-cancel without ID when ambiguous or none fails safely", async () => withStore((store) => {
		// none active
		const rNone = cancelActiveMission({ store });
		assert.equal(rNone.status, "no_active_mission");

		// two active missions (ambiguous)
		const m1 = store.createMission({ missionId: "m-amb-1", goal: "one" });
		store.transitionMission(m1.missionId, "running", { actor: "boss" });
		const m2 = store.createMission({ missionId: "m-amb-2", goal: "two" });
		store.transitionMission(m2.missionId, "running", { actor: "boss" });

		const rAmb = cancelActiveMission({ store });
		assert.equal(rAmb.status, "ambiguous");
	}));
});
