import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { StableId } from "../src/core/config/types.js";
import { ContextBroker, missionStoreContextRepository } from "../src/core/context/index.js";
import { BOSS_SYSTEM_PROMPT, bossInferencePrompt, createMissionStore, executeMissionTask, evaluateMissionCapability, projectBossCanonicalState } from "../src/core/mission/index.js";
import { parseBossAssistantResponse } from "../src/core/mission/boss-response.js";
import { runMissionGoalLoop, type BossRouteCandidate } from "../src/core/mission/boss.js";
import { QualityService, reviewerPromptForExecutionClass } from "../src/core/quality/index.js";
import type { SubagentRunResult } from "../src/core/workers/index.js";

const route = (routeId: string, weight = 1): BossRouteCandidate => ({
	routeId: routeId as StableId,
	enabled: true,
	weight,
	thinkingEffort: "auto",
	remoteModelId: `${routeId}-remote`,
});

const passResult = (criterion: string) => ({
	verdict: "pass" as const,
	criterionResults: [{ criterion, status: "satisfied" as const, evidenceSummary: "worktree contains the required proof" }],
	mechanicalChecks: [{ command: "ls", outcome: "passed" as const, provenance: "reviewer" as const }],
	findings: [] as string[],
	requiredFixes: [] as string[],
	risks: [] as string[],
	summary: "pass",
});

const rejectResult = (criterion: string) => ({
	verdict: "reject" as const,
	criterionResults: [{ criterion, status: "failed" as const, evidenceSummary: "proof file missing" }],
	mechanicalChecks: [{ command: "ls", outcome: "failed" as const, provenance: "reviewer" as const }],
	findings: ["missing proof"],
	requiredFixes: ["write the proof file"],
	risks: [] as string[],
	summary: "reject",
});

const workerRun = (runId: string): SubagentRunResult => ({
	protocolVersion: 1,
	runId,
	roleId: "implementer",
	poolId: "implementation",
	terminalStatus: "completed",
	finalRouteId: "worker-a" as StableId,
	finalRemoteModelId: "worker-remote",
	fallbackCount: 0,
	potentialMutationObserved: false,
	summary: "wrote the local proof",
	structuredResult: { protocolVersion: 1, status: "completed", summary: "wrote the local proof", evidence: ["docs/proof.txt"], filesChanged: ["docs/proof.txt"], tests: [], risks: [], questions: [] },
	attempts: [{
		attemptId: `${runId}-attempt`,
		routeId: "worker-a" as StableId,
		remoteModelId: "worker-remote",
		retryIndex: 0,
		startedAt: "2026-08-16T00:00:00.000Z",
		endedAt: "2026-08-16T00:00:01.000Z",
		outcome: "completed",
		toolNamesUsed: ["write"],
		toolObservations: [],
		potentialMutationObserved: false,
		sessionTerminalState: "idle",
		structuredResult: { protocolVersion: 1, status: "completed", summary: "wrote the local proof", evidence: ["docs/proof.txt"], filesChanged: ["docs/proof.txt"], tests: [], risks: [], questions: [] },
	}],
});

const decisionText = (objective: string, taskId?: string): string => JSON.stringify({
	action: "dispatch",
	summary: "dispatch bounded local work",
	tasks: [{
		...(taskId === undefined ? {} : { taskId }),
		roleId: "implementer",
		executionClass: "implementation",
		poolId: "implementation",
		objective,
		acceptanceCriteria: ["the proof file exists"],
	}],
});

const assistant = (text: string): Record<string, unknown> => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-completions",
	provider: "custom",
	model: "fixture-model",
	usage: { input: 8, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 14, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: 1,
});

describe("RC29 host-shaped Mission runtime harness", () => {
	it("does not treat negated commit/push language as a capability mismatch", () => {
		const result = evaluateMissionCapability("Create a local proof file. Do not commit, push, or publish.", ["the proof file exists"]);
		assert.equal(result.allowed, true);
	});

	it("flags git commit/push Goals as a capability mismatch", () => {
		const result = evaluateMissionCapability("Close RC28.\n- Commit and push the docs-only closure if all checks pass.");
		assert.equal(result.allowed, false);
		assert.equal(result.issues[0]?.code, "NETWORK_OR_PUBLICATION");
		const commitOnly = evaluateMissionCapability("Document the change.", ["git commit the docs-only note"]);
		assert.equal(commitOnly.allowed, false);
		assert.equal(commitOnly.issues[0]?.code, "COMMAND_NOT_ALLOWLISTED");
	});

	it("uses class-specific M7 prompts", () => {
		assert.match(reviewerPromptForExecutionClass("investigation", "m", "t", "run", ["facts"]), /investigation/u);
		assert.match(reviewerPromptForExecutionClass("implementation", "m", "t", "run", ["diff"]), /implementation run/u);
		assert.match(reviewerPromptForExecutionClass("verification", "m", "t", "run", ["checks"]), /verification-worker/u);
		assert.doesNotMatch(reviewerPromptForExecutionClass("investigation", "m", "t", "run", ["facts"]), /implementation run/u);
	});

	it("runs Goal → Plan → Task → worker boundary → Evidence → M7 → Evaluate → COMPLETED and inspects durable state", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-harness-"));
		try {
			const store = createMissionStore({ root });
			const broker = new ContextBroker(missionStoreContextRepository(store));
			const quality = new QualityService(store);
			const mission = store.createMission({
				missionId: "local-proof",
				goal: "Create a local proof file. Do not commit, push, or publish.",
				acceptanceCriteria: ["the proof file exists"],
				repository: { cwd: root },
			});
			const objective = "Write docs/proof.txt with a single proof line";
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a")],
				invoke: async (request) => {
					assert.match(BOSS_SYSTEM_PROMPT, /cannot git commit/u);
					assert.match(bossInferencePrompt(request), /Canonical mission projection/u);
					if (request.phase === "evaluate") {
						return { action: "complete", summary: "goal proven by task execution and M7", tasks: [], acceptanceSatisfied: true };
					}
					return parseBossAssistantResponse(assistant(decisionText(objective)), { phase: request.phase });
				},
				dispatch: async (task) => {
					const executed = await executeMissionTask({
						store,
						contextBroker: broker,
						executor: { run: async () => workerRun(`run-${String(task.taskId)}`) },
						missionId: String(mission.missionId),
						taskId: String(task.taskId),
						cwd: root,
					});
					return { taskId: String(task.taskId), status: executed.run.terminalStatus === "completed" ? "succeeded" : "failed", summary: executed.run.summary };
				},
				verify: async (task, outcome) => {
					if (outcome.status !== "succeeded") return { taskId: String(task.taskId), verdict: "blocked", summary: "worker failed" };
					const targetRunId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(targetRunId);
					const verification = quality.startVerification({ missionId: String(mission.missionId), taskId: task.taskId, targetRunId, round: 0 });
					const completed = quality.completeVerification(verification.verificationId, passResult("the proof file exists"), task.acceptanceCriteria);
					return { taskId: String(task.taskId), verdict: completed.decision.verdict, summary: completed.decision.reviewerSummary };
				},
				maxCycles: 4,
			});
			assert.equal(result.terminal, "COMPLETED");
			assert.equal(store.getMission(mission.missionId)?.status, "completed");
			assert.equal(store.listTasks(mission.missionId).length, 1);
			assert.equal(store.listEvidence(String(mission.missionId), "accepted").length, 1);
			assert.equal(store.getTaskQualityStatus(store.listTasks(mission.missionId)[0]!.taskId)?.status, "passed");
			const projection = projectBossCanonicalState(store, store.getMission(mission.missionId)!);
			assert.equal(projection.tasks[0]?.qualityStatus, "passed");
			assert.equal(projection.tasks[0]?.lifecycleStatus, "execution_completed");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("repairs the same logical Task after M7 reject without duplicating identity", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-repair-"));
		try {
			const store = createMissionStore({ root });
			const broker = new ContextBroker(missionStoreContextRepository(store));
			const quality = new QualityService(store);
			const mission = store.createMission({
				missionId: "repair-proof",
				goal: "Create a local proof file. Do not commit or push.",
				acceptanceCriteria: ["the proof file exists"],
				repository: { cwd: root },
			});
			const objective = "Write docs/proof.txt with a single proof line";
			let verifies = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a")],
				invoke: async ({ phase }) => {
					if (phase === "evaluate") {
						return verifies >= 2
							? { action: "complete", summary: "repaired work passed", tasks: [], acceptanceSatisfied: true }
							: { action: "replan", summary: "repair the same task", tasks: [], requiredFixes: ["write the proof file"] };
					}
					return parseBossAssistantResponse(assistant(decisionText(objective)), { phase });
				},
				dispatch: async (task) => {
					const executed = await executeMissionTask({
						store,
						contextBroker: broker,
						executor: { run: async () => workerRun(`run-${String(task.taskId)}-${verifies}`) },
						missionId: String(mission.missionId),
						taskId: String(task.taskId),
						cwd: root,
						...(task.status === "execution_completed" ? { allowQualityRepair: true } : {}),
					});
					return { taskId: String(task.taskId), status: "succeeded", summary: executed.run.summary };
				},
				verify: async (task) => {
					verifies += 1;
					const targetRunId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(targetRunId);
					const round = store.getTaskQualityStatus(task.taskId)?.qualityRound ?? 0;
					const verification = quality.startVerification({ missionId: String(mission.missionId), taskId: task.taskId, targetRunId, round });
					const payload = verifies === 1 ? rejectResult("the proof file exists") : passResult("the proof file exists");
					const completed = quality.completeVerification(verification.verificationId, payload, task.acceptanceCriteria);
					return { taskId: String(task.taskId), verdict: completed.decision.verdict, summary: completed.decision.reviewerSummary, requiredFixes: completed.decision.requiredFixes };
				},
				maxCycles: 4,
			});
			assert.equal(result.terminal, "COMPLETED");
			assert.equal(store.listTasks(mission.missionId).length, 1);
			assert.equal(store.getTaskQualityStatus(store.listTasks(mission.missionId)[0]!.taskId)?.status, "passed");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("completes a multi-task Mission and ignores a cancelled historical Task of a different identity", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-multitask-"));
		try {
			const store = createMissionStore({ root });
			const quality = new QualityService(store);
			const mission = store.createMission({
				missionId: "multi",
				goal: "Write two local notes. Do not commit or push.",
				acceptanceCriteria: ["notes exist"],
			});
			const stale = store.createTask({
				missionId: mission.missionId,
				taskId: "stale-cancelled",
				roleId: "implementer",
				executionClass: "implementation",
				poolId: "implementation",
				objective: "abandoned draft",
			});
			store.finishTask(stale.taskId, "cancelled");
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a")],
				invoke: async ({ phase }) => {
					if (phase === "evaluate") return { action: "complete", summary: "both notes proven", tasks: [], acceptanceSatisfied: true };
					return {
						action: "dispatch",
						summary: "two notes",
						tasks: [
							{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "Write note A", acceptanceCriteria: ["notes exist"] },
							{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "Write note B", acceptanceCriteria: ["notes exist"] },
						],
					};
				},
				dispatch: async (task) => {
					const attempt = store.createAttempt({ taskId: task.taskId, routeId: "worker-a", remoteModelId: "worker-remote" });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "wrote note" };
				},
				verify: async (task) => {
					const targetRunId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(targetRunId);
					const verification = quality.startVerification({ missionId: String(mission.missionId), taskId: task.taskId, targetRunId, round: 0 });
					quality.completeVerification(verification.verificationId, passResult("notes exist"), task.acceptanceCriteria);
					return { taskId: String(task.taskId), verdict: "pass", summary: "verified" };
				},
				maxCycles: 4,
			});
			assert.equal(result.terminal, "COMPLETED");
			assert.equal(store.listTasks(mission.missionId).length, 3);
			assert.equal(store.getTask("stale-cancelled")?.status, "cancelled");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("resumes persisted cycle feedback without recreating completed work", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-resume-"));
		try {
			const store = createMissionStore({ root });
			const quality = new QualityService(store);
			const created = store.createMission({
				missionId: "resume",
				goal: "Write a local note. Do not commit or push.",
				acceptanceCriteria: ["the note exists"],
			});
			const running = store.transitionMission(created.missionId, "running", { actor: "boss", expectedRevision: created.revision });
			store.updateMission(running.missionId, {
				plan: {
					orchestration: {
						version: 1,
						cycle: 1,
						repairCycles: 0,
						protocolFailures: 0,
						actionablePlanFailures: 0,
						productiveCycles: 1,
						fallbackHistory: [],
						lastFeedback: { kind: "boss-cycle-results", summary: "prior cycle persisted" },
						bossAssignment: {
							routeId: "boss-a",
							remoteModelId: "boss-a-remote",
							thinkingEffort: "auto",
							weight: 1,
							assignedAt: "2026-08-16T00:00:00.000Z",
						},
					},
				},
			}, { actor: "boss", expectedRevision: running.revision });
			const seen: Array<{ cycle: number; hasFeedback: boolean }> = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: created.missionId,
				entries: [route("boss-a")],
				invoke: async (request) => {
					seen.push({ cycle: request.cycle, hasFeedback: request.feedback !== undefined });
					if (request.phase === "evaluate") return { action: "complete", summary: "resumed and proven", tasks: [], acceptanceSatisfied: true };
					return parseBossAssistantResponse(assistant(decisionText("Write the resume note")), { phase: request.phase });
				},
				dispatch: async (task) => {
					const attempt = store.createAttempt({ taskId: task.taskId, routeId: "worker-a", remoteModelId: "worker-remote" });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "wrote note" };
				},
				verify: async (task) => {
					const targetRunId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(targetRunId);
					const verification = quality.startVerification({ missionId: String(created.missionId), taskId: task.taskId, targetRunId, round: 0 });
					quality.completeVerification(verification.verificationId, passResult("the proof file exists"), task.acceptanceCriteria);
					return { taskId: String(task.taskId), verdict: "pass", summary: "verified" };
				},
				maxCycles: 4,
			});
			assert.equal(result.terminal, "COMPLETED");
			assert.equal(seen[0]?.cycle, 1);
			assert.equal(seen[0]?.hasFeedback, true);
			assert.equal(store.listTasks(created.missionId).length, 1);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
