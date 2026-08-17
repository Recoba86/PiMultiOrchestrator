import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createMissionStore } from "../src/core/mission/index.js";
import { executeMissionTask } from "../src/core/mission/execution.js";

const tempRoot = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix));

async function child(code: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		proc.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
		proc.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
		proc.on("error", reject);
		proc.on("close", (status) => status === 0 ? resolve(out.trim()) : reject(new Error(`child failed ${status}: ${err}`)));
	});
}

describe("Mission Execution Claim & Ownership", () => {
	it("claimMissionExecution atomically acquires lease and transitions mission to running", async () => {
		const root = await tempRoot("pmo-claim-atomic-");
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "m-claim-1", goal: "atomic claim goal" });
			assert.equal(mission.status, "draft");

			const result = store.claimMissionExecution("m-claim-1", "owner-1", { ttlMs: 10_000 });
			assert.equal(result.lease.owner, "owner-1");
			assert.equal(result.mission.status, "running");
			assert.equal(store.getMission("m-claim-1")?.status, "running");

			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("two-owner claim race: exactly one owner claims execution and the loser dispatches 0 attempts", async () => {
		const root = await tempRoot("pmo-claim-race-");
		try {
			const seed = createMissionStore({ root });
			seed.createMission({ missionId: "m-race", goal: "race test" });
			seed.close();

			const modulePath = join(process.cwd(), "dist-test/src/core/mission/index.js");
			const script = `
				import { createMissionStore } from ${JSON.stringify(modulePath)};
				const [root, owner] = process.argv.slice(-2);
				const store = createMissionStore({ root });
				try {
					const claimed = store.claimMissionExecution("m-race", owner, { ttlMs: 5000 });
					const task = store.createTask({ missionId: "m-race", roleId: "worker", executionClass: "investigation", objective: "investigate" });
					const attempt = store.createAttempt({ taskId: task.taskId, leaseOwner: owner });
					console.log("WINNER:" + owner + ":" + attempt.attemptId);
				} catch (e) {
					console.log("LOSER:" + owner + ":" + (e?.message ?? "error"));
				} finally {
					store.close();
				}
			`;

			const [resA, resB] = await Promise.all([
				child(script, [root, "owner-alpha"]),
				child(script, [root, "owner-beta"]),
			]);

			const results = [resA, resB];
			const winner = results.find((r) => r.startsWith("WINNER:"));
			const loser = results.find((r) => r.startsWith("LOSER:"));

			assert.ok(winner, "One process must win the claim");
			assert.ok(loser, "One process must lose the claim");
			assert.match(loser, /mission is leased by another owner/);

			const verifyStore = createMissionStore({ root });
			const attempts = verifyStore.listTasks("m-race");
			assert.equal(attempts.length, 1, "Exactly one task/attempt must have been created across both processes");
			verifyStore.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("createAttempt fails closed if caller provides an unleased or foreign-leased owner token", async () => {
		const root = await tempRoot("pmo-attempt-lease-check-");
		try {
			const store = createMissionStore({ root });
			const m = store.createMission({ missionId: "m-check", goal: "lease check" });
			store.claimMissionExecution("m-check", "legit-owner", { ttlMs: 10_000 });
			const t = store.createTask({ missionId: "m-check", roleId: "worker", executionClass: "implementation", objective: "do work" });

			// Attempt with correct owner succeeds
			const goodAttempt = store.createAttempt({ taskId: t.taskId, leaseOwner: "legit-owner" });
			assert.equal(goodAttempt.status, "running");
			store.finishAttempt(goodAttempt.attemptId, "succeeded");

			// Attempt with foreign owner fails
			assert.throws(() => {
				store.createAttempt({ taskId: t.taskId, leaseOwner: "fake-owner" });
			}, /parent mission is not actively leased by owner/);

			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("interruptOwnedExecution on dispose terminalizes attempt and verification, transitions mission to awaiting-review/INTERRUPTED, and releases lease", async () => {
		const root = await tempRoot("pmo-dispose-interrupt-");
		try {
			const store = createMissionStore({ root });
			const m = store.createMission({ missionId: "m-owner-dis", goal: "dispose goal" });
			store.claimMissionExecution("m-owner-dis", "my-owner", { ttlMs: 10_000 });
			const t = store.createTask({ missionId: "m-owner-dis", roleId: "worker", executionClass: "implementation", objective: "do code" });
			const a = store.createAttempt({ taskId: t.taskId, leaseOwner: "my-owner" });
			store.finishAttempt(a.attemptId, "succeeded");
			const vr = store.createVerificationRun({ missionId: "m-owner-dis", taskId: t.taskId, targetRunId: a.attemptId, round: 0 });

			// Another task with running attempt
			const t2 = store.createTask({ missionId: "m-owner-dis", roleId: "worker", executionClass: "investigation", objective: "investigate" });
			const a2 = store.createAttempt({ taskId: t2.taskId, leaseOwner: "my-owner" });

			// Wrong owner cannot interrupt
			assert.throws(() => {
				store.interruptOwnedExecution("m-owner-dis", "wrong-owner");
			}, /mission lease is not held by specified owner/);

			// Correct owner interrupts cleanly
			const interrupted = store.interruptOwnedExecution("m-owner-dis", "my-owner", { reason: "host shutdown" });
			assert.equal(interrupted.interruptedAttempts.length, 1);
			assert.equal(interrupted.mission.status, "awaiting-review");
			assert.notEqual(interrupted.mission.status, "cancelled");

			// Verification run is interrupted
			const vrCurrent = store.getVerificationRun(vr.verificationId);
			assert.equal(vrCurrent?.status, "interrupted");

			// Lease is cleanly deleted
			assert.throws(() => {
				store.heartbeatLease("m-owner-dis", "my-owner");
			}, /lease not held/);

			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
