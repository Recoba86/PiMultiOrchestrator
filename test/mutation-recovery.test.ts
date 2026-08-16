import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { StableId } from "../src/core/config/types.js";
import { ContextBroker, missionStoreContextRepository } from "../src/core/context/index.js";
import { createMissionStore, executeMissionTask } from "../src/core/mission/index.js";
import { runMissionGoalLoop } from "../src/core/mission/boss.js";
import { QualityService } from "../src/core/quality/index.js";
import {
	RECOVERY_ASSESSMENT_TOOL_NAME,
	classifyMutation,
	continuationRecoveryPrompt,
	createRecoveryAssessmentProtocol,
	normalizeRecoveryDecision,
	parseRecoveryAssessment,
	projectChangedWorktree,
	recoverAfterMutation,
	recoveryAssessmentPrompt,
	shouldEnterAutonomousRecovery,
} from "../src/core/recovery/index.js";
import { isWorkerResultToolName, toolProfileForPool, toolProfileForWorker, workerProfileFor } from "../src/core/workers/profiles.js";
import type { SubagentRunResult, StructuredChildResult, ToolObservation } from "../src/core/workers/types.js";

const tmp = () => mkdtemp(join(tmpdir(), "pmo-rc30-recovery-"));
const id = (value: string): StableId => value as StableId;

const observation = (toolName: string, extra: Partial<ToolObservation> = {}): ToolObservation => ({
	toolCallId: `call-${toolName}`,
	toolName,
	potentialMutation: toolName === "edit" || toolName === "write" || toolName === "bash",
	startedAt: "2026-08-16T00:00:00.000Z",
	endedAt: "2026-08-16T00:00:01.000Z",
	completed: true,
	...extra,
});

const structured = (summary: string): StructuredChildResult => ({
	protocolVersion: 1,
	status: "completed",
	summary,
	evidence: ["src/app.ts"],
	filesChanged: ["src/app.ts"],
	tests: [],
	risks: [],
	questions: [],
});

const mutatedOmitRun = (runId: string): SubagentRunResult => ({
	protocolVersion: 1,
	runId,
	roleId: "implementer",
	poolId: "implementation",
	terminalStatus: "partial_mutation_requires_review",
	finalRouteId: id("impl-a"),
	finalRemoteModelId: "impl-remote",
	fallbackCount: 0,
	potentialMutationObserved: true,
	summary: "Child result protocol failed after a potential mutation",
	attempts: [{
		attemptId: `${runId}-a`,
		routeId: id("impl-a"),
		remoteModelId: "impl-remote",
		retryIndex: 0,
		startedAt: "2026-08-16T00:00:00.000Z",
		endedAt: "2026-08-16T00:00:02.000Z",
		outcome: "invalid_child_result",
		toolNamesUsed: ["write"],
		toolObservations: [observation("write")],
		potentialMutationObserved: true,
		sessionTerminalState: "idle",
		resultFinalization: { required: true, attempted: true, succeeded: false, outcome: "missing" },
	}],
});

const completedRun = (runId: string): SubagentRunResult => {
	const result = structured("wrote the local change");
	return {
		...mutatedOmitRun(runId),
		terminalStatus: "completed",
		potentialMutationObserved: true,
		summary: "wrote the local change",
		structuredResult: result,
		attempts: [{
			...mutatedOmitRun(runId).attempts[0]!,
			attemptId: `${runId}-b`,
			outcome: "completed",
			structuredResult: result,
			resultFinalization: { required: false, attempted: false, succeeded: false, outcome: "not_required" },
		}],
	};
};

const assessmentPayload = {
	whatChanged: ["src/app.ts now contains the helper"],
	completeParts: ["helper signature"],
	incompleteParts: ["call site wiring"],
	suspectedIncorrect: [],
	recoverable: true,
	humanRequired: false,
	recommendedPlan: "Keep the helper and wire the remaining call site",
	continuationInstruction: "Do not restart. Inspect src/app.ts first, then finish the call site.",
};

describe("RC30 autonomous mutation recovery", () => {
	it("does not enter recovery when a mutating worker submitted a valid result", () => {
		assert.equal(shouldEnterAutonomousRecovery({
			terminalStatus: "completed",
			mutationObserved: true,
			structuredResultPresent: true,
			mutationClass: "local_observable",
		}), false);
		assert.equal(classifyMutation({ mutationObserved: true, observations: [observation("write")], structuredResultPresent: true }), "local_observable");
	});

	it("leaves ADR-049 non-mutating result-capability fallback outside recovery", () => {
		assert.equal(classifyMutation({ mutationObserved: false, observations: [observation("read", { potentialMutation: false })] }), "none");
		assert.equal(shouldEnterAutonomousRecovery({
			terminalStatus: "invalid_child_result",
			mutationObserved: false,
			structuredResultPresent: false,
			mutationClass: "none",
		}), false);
	});

	it("does not treat mutating misses as cross-route replay candidates", () => {
		assert.equal(shouldEnterAutonomousRecovery({
			terminalStatus: "partial_mutation_requires_review",
			mutationObserved: true,
			structuredResultPresent: false,
			mutationClass: "local_observable",
		}), true);
	});

	it("classifies local project-file edits as autonomous recovery, not human review", () => {
		assert.equal(classifyMutation({ mutationObserved: true, observations: [observation("edit"), observation("write")] }), "local_observable");
	});

	it("classifies git push and publication as unsafe external mutation", () => {
		assert.equal(classifyMutation({
			mutationObserved: true,
			observations: [observation("bash", { effectClass: "unsafe_external" })],
		}), "unsafe_external");
		assert.equal(shouldEnterAutonomousRecovery({
			terminalStatus: "partial_mutation_requires_review",
			mutationObserved: true,
			structuredResultPresent: false,
			mutationClass: "unsafe_external",
		}), false);
		assert.equal(normalizeRecoveryDecision({ action: "REQUEST_HUMAN", summary: "publication side effect" }).action, "REQUEST_HUMAN");
	});

	it("classifies unknown mutation boundaries as human-required", () => {
		assert.equal(classifyMutation({ mutationObserved: true, observations: [] }), "unknown");
		assert.equal(shouldEnterAutonomousRecovery({
			terminalStatus: "partial_mutation_requires_review",
			mutationObserved: true,
			structuredResultPresent: false,
			mutationClass: "unknown",
		}), false);
	});

	it("uses an enforced capture-only recovery assessment tool", () => {
		const protocol = createRecoveryAssessmentProtocol();
		assert.equal(protocol.toolName, RECOVERY_ASSESSMENT_TOOL_NAME);
		assert.equal(isWorkerResultToolName(protocol.toolName), true);
		assert.deepEqual(toolProfileForPool("investigation"), ["read", "grep", "find", "ls"]);
		assert.deepEqual(toolProfileForWorker(workerProfileFor("investigation", protocol.toolName)), ["read", "ls"]);
		const parsed = parseRecoveryAssessment(assessmentPayload);
		assert.equal(parsed.recoverable, true);
		assert.equal(parsed.humanRequired, false);
		assert.throws(() => parseRecoveryAssessment({ summary: "free prose is not control data" }));
	});

	it("builds a read-only assessment prompt with the changed-file projection", () => {
		const prompt = recoveryAssessmentPrompt({
			objective: "Add a helper and wire it",
			acceptanceCriteria: ["helper exists", "call site uses it"],
			failedAttemptId: "attempt-a",
			mutationClass: "local_observable",
			projection: { changedFileCount: 1, files: [{ path: "src/app.ts", status: "modified" }], diffStat: "1 file changed" },
		});
		assert.match(prompt, /READ-ONLY/u);
		assert.match(prompt, /src\/app\.ts/u);
		assert.match(prompt, /submit_recovery_assessment/u);
		assert.match(prompt, /ls and read/u);
		assert.doesNotMatch(prompt, /edit the files/iu);
	});

	it("projects bounded git status without persisting secrets", async () => {
		const root = await tmp();
		try {
			execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
			execFileSync("git", ["config", "user.email", "rc30@example.test"], { cwd: root, stdio: "pipe" });
			execFileSync("git", ["config", "user.name", "RC30"], { cwd: root, stdio: "pipe" });
			await writeFile(join(root, "keep.txt"), "keep\n", "utf8");
			execFileSync("git", ["add", "keep.txt"], { cwd: root, stdio: "pipe" });
			execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "pipe" });
			await writeFile(join(root, "keep.txt"), "changed\n", "utf8");
			await writeFile(join(root, "token.env"), "SECRET=sk-ant-secretvalue\n", "utf8");
			const projection = await projectChangedWorktree(root);
			assert.equal(projection.changedFileCount >= 1, true);
			assert.ok(projection.files.some((file) => file.path === "keep.txt"));
			assert.equal(JSON.stringify(projection).includes("sk-ant-secretvalue"), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("tells the continuation worker to start from the current worktree", () => {
		const prompt = continuationRecoveryPrompt({
			action: "REPAIR_EXISTING_WORK",
			objective: "Add a helper and wire it",
			acceptanceCriteria: ["helper exists"],
			failedAttemptId: "attempt-a",
			assessment: parseRecoveryAssessment(assessmentPayload),
			projection: { changedFileCount: 1, files: [{ path: "src/app.ts", status: "modified" }] },
		});
		assert.match(prompt, /CURRENT WORKTREE IS THE STARTING STATE/u);
		assert.match(prompt, /Do not perform the Task from zero/u);
		assert.match(prompt, /src\/app\.ts/u);
		assert.match(prompt, /REPAIR_EXISTING_WORK/u);
	});

	it("CONTINUE_EXISTING_WORK and REPAIR_EXISTING_WORK keep the same Task identity", async () => {
		const root = await tmp();
		try {
			const store = createMissionStore({ root });
			const broker = new ContextBroker(missionStoreContextRepository(store));
			const mission = store.createMission({ goal: "Finish local helper wiring", acceptanceCriteria: ["helper wired"], repository: { cwd: root } });
			const task = store.createTask({
				missionId: mission.missionId,
				roleId: "implementer",
				executionClass: "implementation",
				poolId: "implementation",
				objective: "Add a helper and wire it",
				acceptanceCriteria: ["helper wired"],
			});
			const failed = await executeMissionTask({
				store,
				contextBroker: broker,
				executor: { run: async () => mutatedOmitRun("run-a") },
				missionId: mission.missionId,
				taskId: task.taskId,
				cwd: root,
			});
			assert.equal(failed.run.terminalStatus, "partial_mutation_requires_review");
			assert.equal(failed.attempt.mutationObserved, true);
			assert.equal(failed.evidence, undefined);

			const recovered = await recoverAfterMutation({
				store,
				missionId: String(mission.missionId),
				taskId: String(task.taskId),
				cwd: root,
				failedAttemptId: String(failed.attempt.attemptId),
				failedRun: failed.run,
				assess: async () => parseRecoveryAssessment(assessmentPayload),
				decide: async () => normalizeRecoveryDecision({ action: "CONTINUE_EXISTING_WORK", summary: "finish remaining wiring" }),
				continueWork: async ({ recoveryPrompt }) => {
					assert.match(recoveryPrompt, /CURRENT WORKTREE IS THE STARTING STATE/u);
					return executeMissionTask({
						store,
						contextBroker: broker,
						executor: { run: async (request) => {
							assert.match(request.task, /CURRENT WORKTREE IS THE STARTING STATE/u);
							return completedRun("run-b");
						} },
						missionId: mission.missionId,
						taskId: task.taskId,
						cwd: root,
						recoveryPrompt,
					});
				},
			});
			assert.equal(recovered.outcome, "continued");
			assert.equal(recovered.action, "CONTINUE_EXISTING_WORK");
			assert.equal(store.listTasks(mission.missionId).length, 1);
			assert.equal(String(store.listTasks(mission.missionId)[0]?.taskId), String(task.taskId));
			assert.equal(store.getTask(task.taskId)?.status, "execution_completed");
			assert.ok(store.listEvidence(String(mission.missionId)).some((item) => item.kind === "recovery-assessment"));
			const attempts = [failed.attempt.attemptId, recovered.continuationAttemptId];
			assert.equal(new Set(attempts).size, 2);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("REPAIR_EXISTING_WORK also continues the same Task", async () => {
		const root = await tmp();
		try {
			const store = createMissionStore({ root });
			const broker = new ContextBroker(missionStoreContextRepository(store));
			const mission = store.createMission({ goal: "Repair local helper", acceptanceCriteria: ["helper wired"], repository: { cwd: root } });
			const task = store.createTask({
				missionId: mission.missionId,
				roleId: "implementer",
				executionClass: "implementation",
				poolId: "implementation",
				objective: "Add a helper and wire it",
			});
			const failed = await executeMissionTask({
				store,
				contextBroker: broker,
				executor: { run: async () => mutatedOmitRun("run-repair-a") },
				missionId: mission.missionId,
				taskId: task.taskId,
				cwd: root,
			});
			const recovered = await recoverAfterMutation({
				store,
				missionId: String(mission.missionId),
				taskId: String(task.taskId),
				cwd: root,
				failedAttemptId: String(failed.attempt.attemptId),
				failedRun: failed.run,
				assess: async () => parseRecoveryAssessment(assessmentPayload),
				decide: async () => normalizeRecoveryDecision({ action: "REPAIR_EXISTING_WORK", summary: "repair remaining wiring" }),
				continueWork: async () => executeMissionTask({
					store,
					contextBroker: broker,
					executor: { run: async () => completedRun("run-repair-b") },
					missionId: mission.missionId,
					taskId: task.taskId,
					cwd: root,
				}),
			});
			assert.equal(recovered.action, "REPAIR_EXISTING_WORK");
			assert.equal(String(store.getTask(task.taskId)?.taskId), String(task.taskId));
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("blocks autonomous continuation for unsafe external side effects", async () => {
		const root = await tmp();
		try {
			const store = createMissionStore({ root });
			const broker = new ContextBroker(missionStoreContextRepository(store));
			const mission = store.createMission({ goal: "Local only", repository: { cwd: root } });
			const task = store.createTask({
				missionId: mission.missionId,
				roleId: "implementer",
				executionClass: "implementation",
				poolId: "implementation",
				objective: "Do not publish",
			});
			const failed = await executeMissionTask({
				store,
				contextBroker: broker,
				executor: { run: async () => ({
					...mutatedOmitRun("run-push"),
					attempts: [{
						...mutatedOmitRun("run-push").attempts[0]!,
						toolNamesUsed: ["bash"],
						toolObservations: [observation("bash", { effectClass: "unsafe_external" })],
					}],
				}) },
				missionId: mission.missionId,
				taskId: task.taskId,
				cwd: root,
			});
			let continued = 0;
			const recovered = await recoverAfterMutation({
				store,
				missionId: String(mission.missionId),
				taskId: String(task.taskId),
				cwd: root,
				failedAttemptId: String(failed.attempt.attemptId),
				failedRun: failed.run,
				assess: async () => {
					throw new Error("assessment must not run for unsafe mutation");
				},
				decide: async () => normalizeRecoveryDecision({ action: "CONTINUE_EXISTING_WORK", summary: "should not happen" }),
				continueWork: async () => {
					continued += 1;
					throw new Error("continuation must not run");
				},
			});
			assert.equal(recovered.outcome, "human_required");
			assert.equal(recovered.action, "REQUEST_HUMAN");
			assert.equal(continued, 0);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not recurse recovery forever", async () => {
		const root = await tmp();
		try {
			const store = createMissionStore({ root });
			const broker = new ContextBroker(missionStoreContextRepository(store));
			const mission = store.createMission({ goal: "Bound recovery", repository: { cwd: root } });
			const task = store.createTask({
				missionId: mission.missionId,
				roleId: "implementer",
				executionClass: "implementation",
				poolId: "implementation",
				objective: "Finish helper",
			});
			const first = await executeMissionTask({
				store,
				contextBroker: broker,
				executor: { run: async () => mutatedOmitRun("run-limit-a") },
				missionId: mission.missionId,
				taskId: task.taskId,
				cwd: root,
			});
			await recoverAfterMutation({
				store,
				missionId: String(mission.missionId),
				taskId: String(task.taskId),
				cwd: root,
				failedAttemptId: String(first.attempt.attemptId),
				failedRun: first.run,
				assess: async () => parseRecoveryAssessment(assessmentPayload),
				decide: async () => normalizeRecoveryDecision({ action: "CONTINUE_EXISTING_WORK", summary: "try once" }),
				continueWork: async () => executeMissionTask({
					store,
					contextBroker: broker,
					executor: { run: async () => mutatedOmitRun("run-limit-b") },
					missionId: mission.missionId,
					taskId: task.taskId,
					cwd: root,
				}),
			});
			const secondFail = await executeMissionTask({
				store,
				contextBroker: broker,
				executor: { run: async () => mutatedOmitRun("run-limit-c") },
				missionId: mission.missionId,
				taskId: task.taskId,
				cwd: root,
			});
			const second = await recoverAfterMutation({
				store,
				missionId: String(mission.missionId),
				taskId: String(task.taskId),
				cwd: root,
				failedAttemptId: String(secondFail.attempt.attemptId),
				failedRun: secondFail.run,
				assess: async () => parseRecoveryAssessment(assessmentPayload),
				decide: async () => normalizeRecoveryDecision({ action: "CONTINUE_EXISTING_WORK", summary: "try again" }),
				continueWork: async () => {
					throw new Error("second autonomous sequence must not continue");
				},
			});
			assert.equal(second.outcome, "budget_exhausted");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("failed recovery inspection becomes a bounded truthful terminal", async () => {
		const root = await tmp();
		try {
			const store = createMissionStore({ root });
			const broker = new ContextBroker(missionStoreContextRepository(store));
			const mission = store.createMission({ goal: "Inspect failure", repository: { cwd: root } });
			const task = store.createTask({
				missionId: mission.missionId,
				roleId: "implementer",
				executionClass: "implementation",
				poolId: "implementation",
				objective: "Finish helper",
			});
			const failed = await executeMissionTask({
				store,
				contextBroker: broker,
				executor: { run: async () => mutatedOmitRun("run-inspect") },
				missionId: mission.missionId,
				taskId: task.taskId,
				cwd: root,
			});
			const recovered = await recoverAfterMutation({
				store,
				missionId: String(mission.missionId),
				taskId: String(task.taskId),
				cwd: root,
				failedAttemptId: String(failed.attempt.attemptId),
				failedRun: failed.run,
				assess: async () => undefined,
				decide: async () => normalizeRecoveryDecision({ action: "CONTINUE_EXISTING_WORK", summary: "no" }),
				continueWork: async () => {
					throw new Error("must not continue without assessment");
				},
			});
			assert.equal(recovered.outcome, "assessment_failed");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("preserves SAFETY_STOP and CANCELLED without recovery", () => {
		assert.equal(shouldEnterAutonomousRecovery({
			terminalStatus: "cancelled",
			mutationObserved: true,
			structuredResultPresent: false,
			mutationClass: "local_observable",
		}), false);
		assert.equal(shouldEnterAutonomousRecovery({
			terminalStatus: "partial_mutation_requires_review",
			mutationObserved: true,
			structuredResultPresent: false,
			mutationClass: "local_observable",
			safetyStop: true,
		}), false);
	});

	it("ROLLBACK_AND_RETRY without a proven local rollback boundary becomes REQUEST_HUMAN", () => {
		const decision = normalizeRecoveryDecision({ action: "ROLLBACK_AND_RETRY", summary: "reset and retry" }, { rollbackProven: false });
		assert.equal(decision.action, "REQUEST_HUMAN");
	});

	it("successful continuation admits Evidence and can reach COMPLETED through M7", async () => {
		const root = await tmp();
		try {
			await mkdir(join(root, "src"), { recursive: true });
			await writeFile(join(root, "src/app.ts"), "export const helper = 1;\n", "utf8");
			const store = createMissionStore({ root });
			const broker = new ContextBroker(missionStoreContextRepository(store));
			const quality = new QualityService(store);
			const mission = store.createMission({
				goal: "Finish local helper wiring. Do not commit or push.",
				acceptanceCriteria: ["helper wired"],
				repository: { cwd: root },
			});
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [{ routeId: id("boss-a"), enabled: true, weight: 1, thinkingEffort: "auto", remoteModelId: "boss-remote" }],
				invoke: async ({ phase }) => phase === "evaluate"
					? { action: "complete", summary: "recovered work passed M7", tasks: [], acceptanceSatisfied: true }
					: { action: "dispatch", summary: "implement helper wiring", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "Add a helper and wire it", acceptanceCriteria: ["helper wired"] }] },
				dispatch: async (task) => {
					const failed = await executeMissionTask({
						store,
						contextBroker: broker,
						executor: { run: async () => mutatedOmitRun("run-e2e-a") },
						missionId: mission.missionId,
						taskId: task.taskId,
						cwd: root,
					});
					const recovered = await recoverAfterMutation({
						store,
						missionId: String(mission.missionId),
						taskId: String(task.taskId),
						cwd: root,
						failedAttemptId: String(failed.attempt.attemptId),
						failedRun: failed.run,
						assess: async () => parseRecoveryAssessment(assessmentPayload),
						decide: async () => normalizeRecoveryDecision({ action: "REPAIR_EXISTING_WORK", summary: "finish wiring" }),
						continueWork: async () => executeMissionTask({
							store,
							contextBroker: broker,
							executor: { run: async () => completedRun("run-e2e-b") },
							missionId: mission.missionId,
							taskId: task.taskId,
							cwd: root,
						}),
					});
					assert.equal(recovered.outcome, "continued");
					const updated = store.getTask(task.taskId);
					return { taskId: String(task.taskId), status: updated?.status === "execution_completed" ? "succeeded" : "failed", summary: recovered.summary };
				},
				verify: async (task, outcome) => {
					if (outcome.status !== "succeeded") return { taskId: String(task.taskId), verdict: "blocked", summary: "worker failed" };
					const targetRunId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(targetRunId);
					const verification = quality.startVerification({ missionId: String(mission.missionId), taskId: task.taskId, targetRunId, round: 0 });
					const completed = quality.completeVerification(verification.verificationId, {
						verdict: "pass",
						criterionResults: [{ criterion: "helper wired", status: "satisfied", evidenceSummary: "src/app.ts contains helper" }],
						mechanicalChecks: [{ command: "ls src/app.ts", outcome: "passed", provenance: "reviewer" }],
						findings: [],
						requiredFixes: [],
						risks: [],
						summary: "pass",
					}, task.acceptanceCriteria);
					return { taskId: String(task.taskId), verdict: completed.decision.verdict, summary: completed.decision.reviewerSummary };
				},
				maxCycles: 4,
			});
			assert.equal(result.terminal, "COMPLETED");
			assert.equal(store.listTasks(mission.missionId).length, 1);
			assert.ok(store.listEvidence(String(mission.missionId)).some((item) => item.kind === "implementation-result"));
			assert.equal(store.getTaskQualityStatus(store.listTasks(mission.missionId)[0]!.taskId)?.status, "passed");
			const app = await readFile(join(root, "src/app.ts"), "utf8");
			assert.match(app, /helper/u);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
