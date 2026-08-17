import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { QualityService } from "../src/core/quality/index.js";
import { qualityPrecludesComplete, runMissionGoalLoop, type BossDecision, type BossRouteCandidate } from "../src/core/mission/boss.js";
import { qualityRejectionFingerprint } from "../src/core/mission/repair-fingerprint.js";
import { executeMissionTask } from "../src/core/mission/execution.js";
import { ContextBroker, missionStoreContextRepository } from "../src/core/context/index.js";
import { createMissionStore } from "../src/core/mission/index.js";
import type { StableId } from "../src/core/config/types.js";
import type { TaskRecord } from "../src/core/mission/types.js";
import type { VerificationResultV1 } from "../src/core/quality/types.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const route = (routeId: string): BossRouteCandidate => ({
	routeId: routeId as StableId,
	enabled: true,
	weight: 1,
	thinkingEffort: "auto",
	remoteModelId: `${routeId}-remote`,
});

const blockedResult = (fixes: readonly string[]): VerificationResultV1 => ({
	verdict: "blocked",
	criterionResults: [{ criterion: "report the public version", status: "not_verified", evidenceSummary: "missing registry proof" }],
	mechanicalChecks: [],
	findings: ["need public release evidence"],
	requiredFixes: [...fixes],
	risks: [],
	summary: "Evidence proves package version but not public registry/release state.",
});

describe("RC31 M7 repair convergence", () => {
	it("blocks naive Boss complete while quality is blocked and keeps the completion gate as defense", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc31-complete-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "m-complete", goal: "report version", acceptanceCriteria: ["report the public version"] });
			const quality = new QualityService(store);
			const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", poolId: "investigation", objective: "report version", acceptanceCriteria: ["report the public version"], status: "planned" });
			const attempt = store.createAttempt({ taskId: task.taskId });
			store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
			const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attempt.attemptId, round: 0 });
			quality.completeVerification(verification.verificationId, blockedResult(["Obtain public registry evidence"]), task.acceptanceCriteria);
			const precluded = qualityPrecludesComplete(store, String(mission.missionId));
			assert.ok(precluded);
			assert.match(precluded.summary, /quality is blocked/u);
			assert.ok(precluded.requiredFixes.some((item) => /registry/u.test(item)));
			const feedback: unknown[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a")],
				invoke: async (request): Promise<BossDecision> => {
					if (request.feedback) feedback.push(request.feedback);
					if (request.phase === "plan") return { action: "complete", summary: "naive complete", tasks: [], acceptanceSatisfied: true };
					return { action: "awaiting_user", summary: "need a different repair", tasks: [] };
				},
				dispatch: async (item) => ({ taskId: String(item.taskId), status: "succeeded", summary: "not dispatched" }),
				verify: async () => ({ verdict: "blocked", summary: "not verified" }),
				maxCycles: 2,
			});
			assert.notEqual(result.status, "completed");
			assert.ok(store.listEvents(String(mission.missionId)).some((event) => isRecord(event.payload) && event.payload.kind === "boss-completion-rejected"));
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("injects M7 requiredFixes into a targeted repair packet that differs from the original", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc31-packet-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "m-packet", goal: "report version", acceptanceCriteria: ["report the public version"], repository: { cwd: root } });
			const quality = new QualityService(store);
			const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", poolId: "investigation", objective: "Determine public version.", acceptanceCriteria: ["report the public version"], status: "planned" });
			const attempt = store.createAttempt({ taskId: task.taskId });
			store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
			const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attempt.attemptId, round: 0 });
			const completed = quality.completeVerification(verification.verificationId, blockedResult(["Obtain admissible public registry/release evidence"]), task.acceptanceCriteria);
			const broker = new ContextBroker(missionStoreContextRepository(store));
			let received = "";
			await executeMissionTask({
				store,
				contextBroker: broker,
				executor: { run: async (request) => {
					received = request.task;
					return {
						protocolVersion: 1,
						runId: "run-1",
						roleId: "investigator",
						poolId: "investigation",
						terminalStatus: "completed",
						fallbackCount: 0,
						potentialMutationObserved: false,
						summary: "repaired",
						attempts: [],
						structuredResult: { protocolVersion: 1, status: "completed", summary: "repaired", evidence: ["npm view"], filesChanged: [], tests: [], risks: [], questions: [] },
					};
				} },
				missionId: mission.missionId,
				taskId: String(task.taskId),
				allowQualityRepair: true,
				repairFeedback: {
					verdict: completed.decision.verdict,
					criterionResults: completed.decision.criterionResults,
					mechanicalChecks: completed.decision.mechanicalChecks,
					findings: completed.decision.findings,
					requiredFixes: completed.decision.requiredFixes,
					risks: completed.decision.risks,
					summary: completed.decision.reviewerSummary,
				},
			});
			assert.match(received, /Obtain admissible public registry/u);
			assert.match(received, /VERIFICATION FEEDBACK/u);
			assert.notEqual(received.slice(0, 80), "Determine public version.");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fingerprints identical rejection+strategy and allows a materially different repair", () => {
		const same = qualityRejectionFingerprint({ taskId: "t1", verdict: "blocked", requiredFixes: ["get registry proof"], repairInstruction: "Determine public version." });
		const repeat = qualityRejectionFingerprint({ taskId: "t1", verdict: "blocked", requiredFixes: ["get registry proof"], repairInstruction: "Determine public version." });
		const different = qualityRejectionFingerprint({ taskId: "t1", verdict: "blocked", requiredFixes: ["get registry proof"], repairInstruction: "Do not repeat general inspection. Obtain public registry evidence." });
		assert.equal(same, repeat);
		assert.notEqual(same, different);
		const incomplete = qualityRejectionFingerprint({ taskId: "t1", verdict: "worker-incomplete", requiredFixes: ["no_eligible_route"], evidenceKind: "failed" });
		const incompleteRepeat = qualityRejectionFingerprint({ taskId: "t1", verdict: "worker-incomplete", requiredFixes: ["no_eligible_route"], evidenceKind: "failed" });
		const volatileIfObjectiveIncluded = qualityRejectionFingerprint({ taskId: "t1", verdict: "worker-incomplete", requiredFixes: ["no_eligible_route"], evidenceKind: "failed", repairInstruction: "Identify version (cycle 2)." });
		assert.equal(incomplete, incompleteRepeat);
		assert.notEqual(incomplete, volatileIfObjectiveIncluded);
		assert.notEqual(same, incomplete);
	});

	it("does not blindly re-dispatch the same blocked repair strategy", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc31-repeat-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "m-repeat", goal: "report version", acceptanceCriteria: ["report the public version"] });
			const quality = new QualityService(store);
			let created: TaskRecord | undefined;
			let dispatches = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a")],
				invoke: async (request): Promise<BossDecision> => {
					if (request.phase === "plan") {
						return {
							action: "dispatch",
							summary: "inspect",
							tasks: [{ ...(created?.taskId === undefined ? {} : { taskId: created.taskId }), roleId: "investigator", executionClass: "investigation", poolId: "investigation", objective: "Determine public version.", acceptanceCriteria: ["report the public version"] }],
						};
					}
					return { action: "complete", summary: "naive complete", tasks: [], acceptanceSatisfied: true };
				},
				dispatch: async (task) => {
					created ??= task;
					dispatches += 1;
					const attempt = store.createAttempt({ taskId: task.taskId });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "worker completed" };
				},
				verify: async (task) => {
					const attemptId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(attemptId);
					const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attemptId, round: 0 });
					quality.completeVerification(verification.verificationId, blockedResult(["Obtain public registry evidence"]), task.acceptanceCriteria);
					return { verdict: "blocked", summary: "blocked", requiredFixes: ["Obtain public registry evidence"] };
				},
				maxCycles: 4,
			});
			assert.equal(dispatches, 2);
			assert.equal(result.terminal, "AWAITING_USER");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("allows a materially different repair and then Boss complete after M7 pass", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc31-pass-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "m-pass", goal: "report version", acceptanceCriteria: ["report the public version"] });
			const quality = new QualityService(store);
			let created: TaskRecord | undefined;
			let round = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a")],
				invoke: async (request): Promise<BossDecision> => {
					if (request.phase === "plan" && request.cycle === 0) {
						return { action: "dispatch", summary: "inspect", tasks: [{ roleId: "investigator", executionClass: "investigation", poolId: "investigation", objective: "Determine public version.", acceptanceCriteria: ["report the public version"] }] };
					}
					if (request.phase === "plan") {
						return { action: "dispatch", summary: "targeted repair", tasks: [{ ...(created?.taskId === undefined ? {} : { taskId: created.taskId }), roleId: "investigator", executionClass: "investigation", poolId: "investigation", objective: "Obtain admissible public registry evidence. Do not repeat general inspection.", acceptanceCriteria: ["report the public version"] }] };
					}
					if (request.phase === "evaluate" && request.cycle === 0) return { action: "replan", summary: "need registry proof", tasks: [], requiredFixes: ["Obtain admissible public registry evidence"] };
					return { action: "complete", summary: "verified", tasks: [], acceptanceSatisfied: true };
				},
				dispatch: async (task) => {
					created ??= task;
					const attempt = store.createAttempt({ taskId: task.taskId });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "worker completed" };
				},
				verify: async (task) => {
					const attemptId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(attemptId);
					const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attemptId, round });
					const pass = round > 0;
					round += 1;
					quality.completeVerification(verification.verificationId, pass
						? { verdict: "pass", criterionResults: [{ criterion: "report the public version", status: "satisfied", evidenceSummary: "npm next is 0.1.0-rc.30" }], mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "pass" }
						: blockedResult(["Obtain admissible public registry evidence"]), task.acceptanceCriteria);
					return { verdict: pass ? "pass" : "blocked", summary: pass ? "pass" : "blocked", requiredFixes: pass ? [] : ["Obtain admissible public registry evidence"] };
				},
				maxCycles: 3,
			});
			assert.equal(result.status, "completed");
			assert.equal(result.terminal, "COMPLETED");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not burn the Boss cycle budget re-dispatching a worker-incomplete task that never reached M7", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc31-incomplete-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "m-incomplete", goal: "report public version", acceptanceCriteria: ["report the public version"] });
			let created: TaskRecord | undefined;
			let dispatches = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a")],
				invoke: async (request): Promise<BossDecision> => {
					const objective = `Identify the current public version from package/repo metadata (cycle ${request.cycle}).`;
					if (request.phase === "plan") {
						return {
							action: "dispatch",
							summary: "inspect metadata",
							tasks: [{ ...(created?.taskId === undefined ? {} : { taskId: created.taskId }), roleId: "investigator", executionClass: "investigation", poolId: "investigation", objective, acceptanceCriteria: ["Identify the current public version", "Verify that no files have been modified."] }],
						};
					}
					return { action: "replan", summary: "worker did not complete", tasks: [{ ...(created?.taskId === undefined ? {} : { taskId: created.taskId }), roleId: "investigator", executionClass: "investigation", poolId: "investigation", objective, acceptanceCriteria: ["Identify the current public version", "Verify that no files have been modified."] }] };
				},
				dispatch: async (task) => {
					created ??= task;
					dispatches += 1;
					const attempt = store.createAttempt({ taskId: task.taskId });
					store.finishAttempt(attempt.attemptId, "failed", { terminalState: "no_eligible_route" });
					return { taskId: String(task.taskId), status: "failed", summary: "No eligible route is available" };
				},
				verify: async (task, outcome) => {
					if (outcome.status !== "succeeded") return { taskId: String(task.taskId), verdict: "blocked", summary: "M7 verification cannot start because the worker did not complete" };
					return { taskId: String(task.taskId), verdict: "blocked", summary: "unexpected M7 start" };
				},
				maxCycles: 4,
			});
			assert.equal(store.listQualityDecisions(String(mission.missionId)).length, 0);
			assert.equal(store.listEvidence(String(mission.missionId)).length, 0);
			assert.equal(dispatches, 1);
			assert.equal(result.terminal, "AWAITING_USER");
			assert.ok(store.listEvents(String(mission.missionId)).some((event) => isRecord(event.payload) && event.payload.kind === "boss-repeat-rejected"));
			assert.match(String((isRecord(result.mission.plan) && isRecord(result.mission.plan.orchestration) ? result.mission.plan.orchestration.terminalReason : "") ?? ""), /worker-incomplete|did not complete|no_eligible_route/iu);
			assert.doesNotMatch(String((isRecord(result.mission.plan) && isRecord(result.mission.plan.orchestration) ? result.mission.plan.orchestration.terminalReason : "") ?? ""), /safety budget exhausted/iu);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not treat Boss objective rewording as a new strategy after interrupted worker-incomplete attempts", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc31-interrupted-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "m-interrupted", goal: "report public version", acceptanceCriteria: ["report the public version"] });
			let created: TaskRecord | undefined;
			let dispatches = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a")],
				invoke: async (request): Promise<BossDecision> => {
					const objective = `Inspect metadata files for the public version — attempt wording ${request.cycle}.`;
					return {
						action: request.phase === "plan" ? "dispatch" : "replan",
						summary: "continue inspection",
						tasks: [{ ...(created?.taskId === undefined ? {} : { taskId: created.taskId }), roleId: "investigator", executionClass: "investigation", poolId: "investigation", objective, acceptanceCriteria: ["Identify the current public version"] }],
					};
				},
				dispatch: async (task) => {
					created ??= task;
					dispatches += 1;
					const attempt = store.createAttempt({ taskId: task.taskId });
					store.finishAttempt(attempt.attemptId, "interrupted", { terminalState: "recovered_interrupted" });
					return { taskId: String(task.taskId), status: "failed", summary: "Attempt recovered as interrupted" };
				},
				verify: async (task, outcome) => {
					if (outcome.status !== "succeeded") return { taskId: String(task.taskId), verdict: "blocked", summary: "M7 verification cannot start because the worker did not complete" };
					return { taskId: String(task.taskId), verdict: "blocked", summary: "unexpected M7 start" };
				},
				maxCycles: 4,
			});
			assert.equal(dispatches, 2);
			assert.equal(result.terminal, "AWAITING_USER");
			assert.ok(store.listEvents(String(mission.missionId)).some((event) => isRecord(event.payload) && event.payload.kind === "boss-repeat-rejected"));
			assert.doesNotMatch(String((isRecord(result.mission.plan) && isRecord(result.mission.plan.orchestration) ? result.mission.plan.orchestration.terminalReason : "") ?? ""), /safety budget exhausted/iu);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("completes in one Boss cycle after a salvaged worker structured result", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc31-salvage-complete-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "m-salvage", goal: "report public version", acceptanceCriteria: ["report the public version"] });
			const quality = new QualityService(store);
			let dispatches = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a")],
				invoke: async (request): Promise<BossDecision> => {
					if (request.phase === "plan") {
						return { action: "dispatch", summary: "inspect", tasks: [{ roleId: "investigator", executionClass: "investigation", poolId: "investigation", objective: "Report the public version.", acceptanceCriteria: ["report the public version"] }] };
					}
					return { action: "complete", summary: "public version is 0.1.0-rc.30", tasks: [], acceptanceSatisfied: true };
				},
				dispatch: async (task) => {
					dispatches += 1;
					const attempt = store.createAttempt({ taskId: task.taskId });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed", summary: "public prerelease 0.1.0-rc.30" } });
					store.admitEvidence({ missionId: mission.missionId, taskId: task.taskId, attemptId: attempt.attemptId, kind: "implementation-result", content: { status: "completed", summary: "public prerelease 0.1.0-rc.30" }, actor: "worker" });
					return { taskId: String(task.taskId), status: "succeeded", summary: "salvaged structured result" };
				},
				verify: async (task) => {
					const attemptId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(attemptId);
					const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attemptId, round: 0 });
					quality.completeVerification(verification.verificationId, {
						verdict: "pass",
						criterionResults: [{ criterion: "report the public version", status: "satisfied", evidenceSummary: "npm next is 0.1.0-rc.30" }],
						mechanicalChecks: [],
						findings: [],
						requiredFixes: [],
						risks: [],
						summary: "pass",
					}, task.acceptanceCriteria);
					return { verdict: "pass", summary: "pass" };
				},
				maxCycles: 4,
			});
			assert.equal(dispatches, 1);
			assert.equal(result.cycles, 1);
			assert.equal(result.terminal, "COMPLETED");
			assert.equal(store.listEvidence(String(mission.missionId)).length > 0, true);
			assert.equal(store.listQualityDecisions(String(mission.missionId)).at(-1)?.verdict, "pass");
			assert.equal(store.listEvents(String(mission.missionId)).some((event) => isRecord(event.payload) && event.payload.kind === "boss-repeat-rejected"), false);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
