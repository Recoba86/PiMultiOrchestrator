import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMissionStore } from "../src/core/mission/index.js";
import { QualityService, selectReviewerRoute } from "../src/core/quality/index.js";
import { QualityError } from "../src/core/quality/index.js";

function completedAttempt(store: ReturnType<typeof createMissionStore>, taskId: string, attemptId: string): void {
	const attempt = store.createAttempt({ taskId, attemptId });
	store.finishAttempt(attempt.attemptId, "succeeded");
}

test("quality decisions stay separate from execution and persist escalation state", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-quality-"));
	try {
		const store = createMissionStore({ root });
		store.createMission({ missionId: "m1", goal: "ship", acceptanceCriteria: ["tests"] });
		const task = store.createTask({ missionId: "m1", taskId: "t1", roleId: "implementer", executionClass: "implementation", objective: "ship" });
		completedAttempt(store, task.taskId, "run-1");
		const quality = new QualityService(store);
		const verification = quality.startVerification({ missionId: "m1", taskId: task.taskId, targetRunId: "run-1", round: 0, implementationRouteId: "route-a" });
		assert.equal(store.getTaskQualityStatus(task.taskId)?.status, "verification_running");
		assert.throws(() => quality.completeVerification(verification.verificationId, { verdict: "pass" }), (error: unknown) => error instanceof QualityError && error.code === "invalid-result");
		assert.equal(store.getTaskQualityStatus(task.taskId)?.status, "blocked");
		const retry = quality.startVerification({ missionId: "m1", taskId: task.taskId, targetRunId: "run-1", round: 0, implementationRouteId: "route-a" });
		const rejected = quality.completeVerification(retry.verificationId, {
			verdict: "pass",
			criterionResults: [{ criterion: "tests", status: "failed", mandatory: true, evidenceSummary: "exit 1" }],
			mechanicalChecks: [{ command: "npm test", exitStatus: 1, outcome: "failed", provenance: "orchestrator" }],
			findings: ["test failure"], requiredFixes: ["fix test"], risks: [], summary: "reviewed",
		}, ["tests"]);
		assert.equal(rejected.decision.verdict, "reject");
		assert.deepEqual(rejected.decision.findings, ["test failure"]);
		assert.equal(store.getTaskQualityStatus(task.taskId)?.status, "rejected");
		const escalation = quality.escalate({ missionId: "m1", taskId: task.taskId, rejectedRunId: "run-1", verificationId: retry.verificationId, qualityRound: 0, failedCriteria: ["tests"], requiredFixes: ["fix test"], reviewerFindings: ["test failure"], priorImplementationRouteIds: ["route-a"], reviewerRouteId: "route-b", diversity: "prefer" });
		assert.equal(escalation.preferredPool, "implementation");
		assert.deepEqual(store.listQualityEscalations("m1", task.taskId).map((item) => item.escalationId), [escalation.escalationId]);
		completedAttempt(store, task.taskId, "run-2");
		const next = quality.startVerification({ missionId: "m1", taskId: task.taskId, targetRunId: "run-2", round: 1, implementationRouteId: "route-b", reviewerRouteId: "route-c" });
		const passed = quality.completeVerification(next.verificationId, { verdict: "pass", criterionResults: [{ criterion: "tests", status: "satisfied", mandatory: true, evidenceSummary: "exit 0" }], mechanicalChecks: [{ command: "npm test", exitStatus: 0, outcome: "passed", provenance: "orchestrator" }], findings: [], requiredFixes: [], risks: [], summary: "passed" }, ["tests"]);
		assert.equal(passed.status.status, "passed");
		assert.equal(store.listQualityDecisions("m1", task.taskId).length, 2);
		store.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("quality finalization rolls back decision, run, and task status together", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-quality-atomic-"));
	let fault = false;
	try {
		const store = createMissionStore({ root, hooks: { fault: (point) => { if (fault && point === "after-event") throw new Error("injected quality fault"); } } });
		store.createMission({ missionId: "m-atomic", goal: "ship", acceptanceCriteria: ["tests"] });
		const task = store.createTask({ missionId: "m-atomic", taskId: "t-atomic", roleId: "reviewer", executionClass: "implementation", objective: "verify" });
		completedAttempt(store, task.taskId, "run-atomic");
		const quality = new QualityService(store);
		const verification = quality.startVerification({ missionId: "m-atomic", taskId: task.taskId, targetRunId: "run-atomic", round: 0 });
		const result = { verdict: "pass" as const, criterionResults: [{ criterion: "tests", status: "satisfied" as const, evidenceSummary: "observed" }], mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "pass" };
		fault = true;
		assert.throws(() => quality.completeVerification(verification.verificationId, result, ["tests"]), /injected quality fault/u);
		fault = false;
		assert.equal(store.listQualityDecisions("m-atomic", task.taskId).length, 0);
		assert.equal(store.getVerificationRun(verification.verificationId)?.status, "running");
		assert.equal(store.getTaskQualityStatus(task.taskId)?.status, "verification_running");
		assert.equal(quality.completeVerification(verification.verificationId, result, ["tests"]).status.status, "passed");
		store.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("quality loop creates bounded escalation, repairs, and re-verifies without health fallback", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-quality-loop-"));
	try {
		const store = createMissionStore({ root });
		store.createMission({ missionId: "m-loop", goal: "ship", acceptanceCriteria: ["tests"] });
		const task = store.createTask({ missionId: "m-loop", taskId: "t-loop", roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "ship", acceptanceCriteria: ["tests"] });
		const quality = new QualityService(store);
		let round = 0;
		const repaired: string[] = [];
		const loop = await quality.runQualityLoop({
			authorizedForMutation: true,
			maxRounds: 2,
			diversity: "prefer",
			acceptanceCriteria: ["tests"],
			verify: async (currentRound) => {
				completedAttempt(store, task.taskId, `run-${currentRound}`);
				const verification = quality.startVerification({ missionId: "m-loop", taskId: task.taskId, targetRunId: `run-${currentRound}`, round: currentRound, implementationRouteId: currentRound === 0 ? "route-a" : "route-b", reviewerRouteId: "reviewer" });
				round = currentRound;
				return {
					verificationId: verification.verificationId,
					implementationRouteId: currentRound === 0 ? "route-a" : "route-b",
					result: currentRound === 0
						? { verdict: "reject", criterionResults: [{ criterion: "tests", status: "failed", mandatory: true, evidenceSummary: "exit 1" }], mechanicalChecks: [{ command: "npm test", outcome: "failed", exitStatus: 1, provenance: "orchestrator" }], findings: ["test failure"], requiredFixes: ["fix tests"], risks: [], summary: "reject" }
						: { verdict: "pass", criterionResults: [{ criterion: "tests", status: "satisfied", mandatory: true, evidenceSummary: "exit 0" }], mechanicalChecks: [{ command: "npm test", outcome: "passed", exitStatus: 0, provenance: "orchestrator" }], findings: [], requiredFixes: [], risks: [], summary: "pass" },
				};
			},
			repair: async () => { repaired.push("route-b"); return { implementationRouteId: "route-b" }; },
		});
		assert.equal(round, 1);
		assert.equal(loop.status, "passed");
		assert.equal(repaired.length, 1);
		assert.equal(store.listQualityEscalations("m-loop", task.taskId).length, 1);
		assert.equal(store.listQualityEscalations("m-loop", task.taskId)[0]?.status, "ready");
		assert.equal(store.getTaskQualityStatus(task.taskId)?.status, "passed");
		assert.equal(selectReviewerRoute([{ routeId: "route-a" }, { routeId: "route-b" }], "route-a", "require")?.routeId, "route-b");
		store.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("reopen marks an in-flight verification interrupted instead of rerunning it", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-quality-recovery-"));
	try {
		let store = createMissionStore({ root });
		store.createMission({ missionId: "m-recover", goal: "inspect" });
		const task = store.createTask({ missionId: "m-recover", taskId: "t-recover", roleId: "reviewer", executionClass: "verification", objective: "inspect" });
		completedAttempt(store, task.taskId, "attempt-1");
		const run = new QualityService(store).startVerification({ missionId: "m-recover", taskId: task.taskId, targetRunId: "attempt-1" });
		store.close();
		store = createMissionStore({ root });
		store.recoverInterrupted();
		assert.equal(store.getVerificationRun(run.verificationId)?.status, "interrupted");
		assert.equal(store.getTaskQualityStatus(task.taskId)?.status, "review_required");
		store.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
