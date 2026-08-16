import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import {
	createCanonicalMission,
	createMissionStore,
	executeMissionTask,
	SQLiteMissionStore,
	MissionClosedError,
	MissionConflictError,
	MissionCorruptError,
	MissionValidationError,
	MissionUnauthorizedError,
} from "../src/core/mission/index.js";
import { ContextBroker, missionStoreContextRepository } from "../src/core/context/index.js";
import { QualityService } from "../src/core/quality/index.js";
import type { SubagentRunResult } from "../src/core/workers/index.js";

async function withStore<T>(run: (root: string) => T | Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "pi-mission-"));
	try {
		return await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("SQLite mission store", () => {
	it("persists mission revisions, tasks, attempts, evidence, and checkpoints", async () => withStore((root) => {
		let id = 0;
		const store = createMissionStore({ root, id: () => String(++id) });
		const created = store.createMission({ missionId: "m1", goal: "ship", acceptanceCriteria: ["tests"] });
		const planned = store.transitionMission("m1", "planned", { expectedRevision: created.revision });
		assert.equal(planned.status, "planned");
		const task = store.createTask({ missionId: "m1", roleId: "investigator", executionClass: "investigation", objective: "inspect" });
		assert.equal(store.startTask(task.taskId).status, "running");
		const attempt = store.createAttempt({ taskId: task.taskId, routeId: "route-a", remoteModelId: "model-a", leaseOwner: "worker" });
		assert.equal(store.finishAttempt(attempt.attemptId, "succeeded", { result: { ok: true } }).status, "succeeded");
		const evidence = store.admitEvidence({ missionId: "m1", taskId: task.taskId, attemptId: attempt.attemptId, kind: "finding", content: { file: "x" } });
		assert.equal(store.promoteEvidence(evidence.evidenceId).status, "accepted");
		const checkpoint = store.recordCheckpoint("m1");
		assert.equal(checkpoint.revision, store.getMission("m1")?.revision);
		assert.equal(store.listEvidence("m1", "accepted").length, 1);
		assert.ok(store.listEvents("m1").length >= 5);
		store.close();
	}));

	it("uses compare-and-swap and protects completion from workers", async () => withStore((root) => {
		const store = createMissionStore({ root });
		const mission = store.createMission({ missionId: "m1", goal: "ship" });
		assert.throws(() => store.createTask({ missionId: "m1", roleId: "worker", executionClass: "implementation", poolId: "unknown", objective: "invalid" }), (error: unknown) => error instanceof MissionValidationError && error.issues[0]?.path === "poolId");
		assert.throws(() => store.updateMission("m1", { goal: "stale" }, { expectedRevision: 99 }), MissionConflictError);
		const review = store.transitionMission("m1", "planned", { expectedRevision: mission.revision });
		assert.throws(() => store.transitionMission("m1", "completed", { actor: "worker", expectedRevision: review.revision }), MissionUnauthorizedError);
		assert.throws(() => store.transitionMission("m1", "completed", { actor: "user", expectedRevision: review.revision }), MissionUnauthorizedError);
		assert.throws(() => store.transitionMission("m1", "completed", { actor: "boss", expectedRevision: review.revision }), MissionValidationError);
		const stale = store.admitEvidence({ missionId: "m1", sourceRevision: mission.revision, kind: "finding", content: { old: true } });
		assert.throws(() => store.promoteEvidence(stale.evidenceId), MissionConflictError);
		assert.equal(store.listEvidence("m1", "stale").length, 1);
		store.close();
	}));

	it("binds verification to the selected terminal Mission task attempt", async () => withStore((root) => {
		const store = createMissionStore({ root });
		store.createMission({ missionId: "m1", goal: "ship" });
		store.createMission({ missionId: "m2", goal: "other" });
		const task1 = store.createTask({ missionId: "m1", taskId: "t1", roleId: "worker", executionClass: "implementation", objective: "ship" });
		const task2 = store.createTask({ missionId: "m2", taskId: "t2", roleId: "worker", executionClass: "implementation", objective: "other" });
		const running = store.createAttempt({ taskId: task1.taskId, attemptId: "attempt-running" });
		assert.throws(() => store.createVerificationRun({ missionId: "m1", taskId: task1.taskId, targetRunId: running.attemptId }), MissionValidationError);
		store.finishAttempt(running.attemptId, "succeeded");
		const other = store.createAttempt({ taskId: task2.taskId, attemptId: "attempt-other" });
		store.finishAttempt(other.attemptId, "succeeded");
		assert.throws(() => store.createVerificationRun({ missionId: "m1", taskId: task1.taskId, targetRunId: other.attemptId }), MissionValidationError);
		assert.throws(() => store.admitEvidence({ missionId: "m1", taskId: task1.taskId, attemptId: other.attemptId, kind: "finding", content: { crossMission: true } }), MissionValidationError);
		const verification = store.createVerificationRun({ missionId: "m1", taskId: task1.taskId, targetRunId: running.attemptId });
		assert.throws(() => store.createVerificationRun({ missionId: "m1", taskId: task1.taskId, targetRunId: running.attemptId }), MissionValidationError);
		assert.equal(verification.targetRunId, running.attemptId);
		assert.throws(() => store.updateVerificationRun(verification.verificationId, { targetRunId: other.attemptId }), MissionValidationError);
		assert.throws(() => store.recordQualityDecision({ missionId: "m1", taskId: task1.taskId, verificationId: verification.verificationId, targetRunId: other.attemptId, round: 0, reviewerSummary: "mismatch", gate: { verdict: "blocked", reasons: [], criterionResults: [], mechanicalChecks: [] } }), MissionValidationError);
		assert.throws(() => store.setTaskQualityStatus({ taskId: task1.taskId, missionId: "m1" as never, status: "passed", qualityRound: 0, updatedAt: "2026-01-01T00:00:00.000Z" }), MissionValidationError);
		store.close();
	}));

	it("normalizes mission text and rejects invisible-only goals", async () => withStore((root) => {
		const store = createMissionStore({ root });
		const mission = createCanonicalMission(store, "\u200bＦｉｘ the bug\u2060");
		assert.equal(mission.goal, "Fix the bug");
		assert.throws(() => createCanonicalMission(store, "\u200b\ufeff\u2060"), MissionValidationError);
		store.close();
	}));

	it("recovers expired attempts and rejects corrupted JSON", async () => withStore((root) => {
		let now = new Date("2026-01-01T00:00:00.000Z");
		const store = createMissionStore({ root, clock: () => now });
		store.createMission({ missionId: "m1", goal: "ship" });
		const task = store.createTask({ missionId: "m1", roleId: "worker", executionClass: "verification", objective: "check" });
		const attempt = store.createAttempt({ taskId: task.taskId, leaseOwner: "worker", leaseTtlMs: 10 });
		now = new Date("2026-01-01T00:00:00.100Z");
		assert.equal(store.recoverInterrupted({ now })[0]?.status, "interrupted");
		store.integrityCheck();
		store.close();
		const raw = new DatabaseSync(join(root, "mission.sqlite"));
		raw.prepare("UPDATE missions SET constraints_json=? WHERE mission_id=?").run("{", "m1");
		raw.close();
		assert.throws(() => createMissionStore({ root }), MissionCorruptError);
	}));

	it("rejects a v2 SQLite backup that omits quality state", async () => withStore(async (root) => {
		const store = createMissionStore({ root });
		store.createMission({ missionId: "m1", goal: "ship" });
		const backup = await store.backup!(join(root, "backup.sqlite"));
		const corrupt = join(root, "corrupt.sqlite");
		await copyFile(backup, corrupt);
		store.close();
		const raw = new DatabaseSync(corrupt);
		raw.exec("DROP TABLE quality_decisions");
		raw.close();
		await assert.rejects(() => SQLiteMissionStore.restore({ root: join(root, "restored") }, corrupt), /missing/u);
	}));

	it("rolls back a faulted transaction and enforces closed state", async () => withStore((root) => {
		const store = createMissionStore({ root, hooks: { fault: (point) => { if (point === "after-event") throw new Error("fault"); } } });
		assert.throws(() => store.createMission({ missionId: "m1", goal: "ship" }));
		assert.equal(store.getMission("m1"), undefined);
		store.close();
		assert.throws(() => store.listMissions(), MissionClosedError);
	}));

	it("routes one task through M5-shaped execution and admits only proposed evidence", async () => withStore(async (root) => {
		const store = createMissionStore({ root });
		store.createMission({ missionId: "m1", goal: "ship", repository: { cwd: root } });
		const task = store.createTask({ missionId: "m1", taskId: "t1", roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "inspect", acceptanceCriteria: ["tests pass"] });
		const packetBroker = new ContextBroker(missionStoreContextRepository(store));
		const run: SubagentRunResult = {
			protocolVersion: 1, runId: "run-1", roleId: "implementer", poolId: "implementation", terminalStatus: "completed",
			finalRouteId: "route-a" as never, finalRemoteModelId: "remote-a", fallbackCount: 0, potentialMutationObserved: false,
			summary: "done", structuredResult: { protocolVersion: 1, status: "completed", summary: "done", evidence: ["read"], filesChanged: [], tests: [], risks: [], questions: [] },
			attempts: [{ attemptId: "worker-attempt", routeId: "route-a" as never, remoteModelId: "remote-a", retryIndex: 0, startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z", outcome: "completed", toolNamesUsed: ["read"], toolObservations: [], potentialMutationObserved: false, sessionTerminalState: "idle", resultFinalization: { required: false, attempted: false, succeeded: false, outcome: "not_required" }, structuredResult: { protocolVersion: 1, status: "completed", summary: "done", evidence: ["read"], filesChanged: [], tests: [], risks: [], questions: [] } }],
		};
		const result = await executeMissionTask({ store, contextBroker: packetBroker, executor: { run: async () => run }, missionId: "m1", taskId: task.taskId });
		assert.equal(result.evidence?.status, "proposed");
		assert.equal(store.listCanonicalItems("m1").length, 0);
		assert.equal(store.getTask("t1")?.status, "execution_completed");
		assert.equal(store.getTask("t1")?.packetRevision, 1);
		assert.ok(store.listCheckpoints("m1").some((checkpoint) => checkpoint.kind === "task-ended"));
		const finished = store.listEvents("m1").find((event) => event.kind === "attempt_succeeded");
		assert.equal((finished?.payload as { routes?: Array<{ finalizationAttempted?: boolean; routeId?: string }> } | undefined)?.routes?.[0]?.routeId, "route-a");
		assert.equal((finished?.payload as { routes?: Array<{ finalizationRequired?: boolean }> } | undefined)?.routes?.[0]?.finalizationRequired, false);
	}));

	it("completes using active Task identity and ignores cancelled historical rows", async () => withStore((root) => {
		const store = createMissionStore({ root });
		const quality = new QualityService(store);
		const created = store.createMission({ missionId: "m1", goal: "ship" });
		store.createTask({ missionId: "m1", taskId: "abandoned", roleId: "implementer", executionClass: "implementation", objective: "old draft" });
		store.finishTask("abandoned", "cancelled");
		const task = store.createTask({ missionId: "m1", taskId: "active", roleId: "implementer", executionClass: "implementation", objective: "ship docs" });
		const attempt = store.createAttempt({ taskId: task.taskId, routeId: "route-a", remoteModelId: "model-a" });
		store.finishAttempt(attempt.attemptId, "succeeded", { result: { ok: true } });
		const verification = quality.startVerification({ missionId: "m1", taskId: task.taskId, targetRunId: attempt.attemptId, round: 0 });
		quality.completeVerification(verification.verificationId, {
			verdict: "pass",
			criterionResults: [{ criterion: "ship", status: "satisfied", evidenceSummary: "done" }],
			mechanicalChecks: [{ command: "ls", outcome: "passed", provenance: "reviewer" }],
			findings: [],
			requiredFixes: [],
			risks: [],
			summary: "pass",
		}, ["ship"]);
		const running = store.transitionMission("m1", "running", { actor: "boss", expectedRevision: created.revision });
		const review = store.transitionMission("m1", "awaiting-review", { actor: "boss", expectedRevision: running.revision });
		const completed = store.transitionMission("m1", "completed", { actor: "boss", expectedRevision: review.revision });
		assert.equal(completed.status, "completed");
		assert.equal(store.getTask("abandoned")?.status, "cancelled");
		store.close();
	}));
});
