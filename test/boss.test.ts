import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createDefaultConfig } from "../src/core/config/defaults.js";
import { migrateBossRuntimeDefaults } from "../src/core/config/migrations.js";
import type { BossRouteV1, StableId } from "../src/core/config/types.js";
import { QualityService } from "../src/core/quality/index.js";
import { SQLiteAnalyticsStore } from "../src/core/analytics/index.js";
import { PathSafetyError, ProjectTrustRequiredError } from "../src/core/security/index.js";
import {
	BossInfrastructureError,
	BossProtocolError,
	formatBossLoopDiagnostics,
	normalizeBossDecision,
	runMissionGoalLoop,
	selectBossEntry,
	selectBossFallbackEntry,
	type BossDecision,
	type BossRouteCandidate,
} from "../src/core/mission/boss.js";
import { bossInfrastructureError, parseBossAssistantResponse } from "../src/core/mission/boss-response.js";
import { createMissionStore } from "../src/core/mission/index.js";
import type { TaskRecord } from "../src/core/mission/types.js";

const route = (routeId: string, weight: number): BossRouteCandidate => ({
	routeId: routeId as StableId,
	enabled: true,
	weight,
	thinkingEffort: "max",
	remoteModelId: `${routeId}-remote`,
});

describe("RC25 Boss runtime", () => {
	it("migrates RC24 Boss profiles additively without changing worker pools", () => {
		const input = createDefaultConfig();
		input.bossProfiles["default-boss"]!.routeIds = ["boss-a" as StableId];
		input.pools.implementation.schedulingPolicy = "weighted";
		input.pools.implementation.entries = [{ routeId: "worker-a" as StableId, enabled: true, weight: 7, thinkingEffort: "high" }];
		const migrated = migrateBossRuntimeDefaults(input);

		assert.deepEqual(migrated.pools, input.pools);
		assert.deepEqual(migrated.bossProfiles["default-boss"]!.entries, [{ routeId: "boss-a", enabled: true, weight: 1, thinkingEffort: "max" }]);
		assert.equal(migrated.bossProfiles["default-boss"]!.schedulingPolicy, "weighted");
		assert.deepEqual(input.bossProfiles["default-boss"]!.entries, []);
		assert.deepEqual(migrateBossRuntimeDefaults(migrated), migrated);
	});

	it("uses weighted Boss assignment once per mission key and ignores zero-weight routes", () => {
		const entries = [route("boss-a", 5), route("boss-b", 3), route("boss-c", 2), route("boss-zero", 0)];
		const selections = new Set<string>();
		for (let index = 0; index < 200; index += 1) {
			const selected = selectBossEntry(entries, `mission-${index}`);
			assert.ok(selected);
			assert.notEqual(selected.routeId, "boss-zero");
			selections.add(selected.routeId);
		}
		assert.deepEqual([...selections].sort(), ["boss-a", "boss-b", "boss-c"]);
		assert.equal(selectBossEntry(entries, "mission-pinned")?.routeId, selectBossEntry(entries, "mission-pinned")?.routeId);
	});

	it("runs a reject-then-repair goal loop and pins one Boss across every cycle", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-loop-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "mission-loop", goal: "ship the fix", acceptanceCriteria: ["tests pass"] });
			const quality = new QualityService(store);
			let createdTask: TaskRecord | undefined;
			let verificationRound = 0;
			const calls: Array<{ phase: string; cycle: number; routeId: string }> = [];
			const invoke = async (request: { readonly phase: string; readonly cycle: number; readonly assignment: { readonly routeId: string } }): Promise<BossDecision> => {
				calls.push({ phase: request.phase, cycle: request.cycle, routeId: request.assignment.routeId });
				if (request.phase === "plan" && request.cycle === 0) return { action: "dispatch", summary: "initial implementation", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "make the fix", acceptanceCriteria: ["tests pass"] }] };
				if (request.phase === "plan" && request.cycle === 1) return { action: "dispatch", summary: "repair the rejected implementation", tasks: [{ ...(createdTask?.taskId === undefined ? {} : { taskId: createdTask.taskId }), roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "repair the fix", acceptanceCriteria: ["tests pass"] }] };
				if (request.phase === "evaluate" && request.cycle === 0) return { action: "replan", summary: "verification rejected the first implementation", tasks: [], requiredFixes: ["repair the failing test"] };
				return { action: "complete", summary: "goal and acceptance criteria are satisfied", tasks: [], acceptanceSatisfied: true };
			};
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke,
				dispatch: async (task) => {
					createdTask ??= task;
					const attempt = store.createAttempt({ taskId: task.taskId, routeId: "worker-route", remoteModelId: "worker-remote" });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "worker completed" };
				},
				verify: async (task, _outcome) => {
					const attemptId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(attemptId);
					const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attemptId, round: verificationRound });
					const verdict = verificationRound === 0 ? "reject" : "pass";
					verificationRound += 1;
					quality.completeVerification(verification.verificationId, {
						verdict,
						criterionResults: [{ criterion: "tests pass", status: verdict === "pass" ? "satisfied" : "failed", evidenceSummary: verdict === "pass" ? "tests passed" : "test failed" }],
						mechanicalChecks: [{ command: "npm test", outcome: verdict === "pass" ? "passed" : "failed", provenance: "reviewer" }],
						findings: verdict === "pass" ? [] : ["test failure"],
						requiredFixes: verdict === "pass" ? [] : ["repair the failing test"],
						risks: [],
						summary: verdict === "pass" ? "pass" : "reject",
					}, task.acceptanceCriteria);
					return { verdict, summary: verdict === "pass" ? "pass" : "reject", requiredFixes: verdict === "pass" ? [] : ["repair the failing test"] };
				},
				maxCycles: 3,
			});

			assert.equal(result.status, "completed");
			assert.equal(store.getMission(mission.missionId)?.status, "completed");
			assert.ok(calls.length >= 4);
			assert.equal(new Set(calls.map((call) => call.routeId)).size, 1, JSON.stringify(calls));
			const state = (store.getMission(mission.missionId)?.plan as { orchestration?: { bossAssignment?: { routeId?: string }; repairCycles?: number } })?.orchestration;
			assert.equal(state?.bossAssignment?.routeId, calls[0]?.routeId);
			assert.equal(state?.repairCycles, 1);
			assert.deepEqual(store.listQualityDecisions(mission.missionId).map((decision) => decision.verdict), ["reject", "pass"]);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("falls back only on infrastructure failure and pins the replacement", async () => {
		const entries = [route("boss-a", 1), route("boss-b", 1), route("boss-c", 1)];
		const key = Array.from({ length: 100 }, (_, index) => `fallback-${index}`).find((candidate) => selectBossEntry(entries, candidate)?.routeId === "boss-a");
		assert.ok(key);
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-fallback-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "fallback-mission", goal: "recover" });
			const calls: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries,
				schedulingKey: key,
				invoke: async ({ assignment }) => {
					calls.push(assignment.routeId);
					if (assignment.routeId === "boss-a" || assignment.routeId === "boss-b") throw new BossInfrastructureError("provider unavailable");
					return { action: "blocked", summary: "no work after fallback", tasks: [] };
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "blocked", summary: "not reached" }),
				verify: async () => ({ verdict: "blocked", summary: "not reached" }),
				maxCycles: 1,
			});
			assert.equal(result.status, "blocked");
			assert.deepEqual(calls, ["boss-a", "boss-b", "boss-c"]);
			const state = (store.getMission(mission.missionId)?.plan as { orchestration?: { bossAssignment?: { routeId?: string; fallbackFromRouteId?: string }; fallbackHistory?: readonly unknown[] } })?.orchestration;
			assert.equal(state?.bossAssignment?.routeId, "boss-c", JSON.stringify({ state, calls, mission: store.getMission(mission.missionId), result }));
			assert.equal(state?.bossAssignment?.fallbackFromRouteId, "boss-b");
			assert.equal(state?.fallbackHistory?.length, 2);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("persists mission assignment, quality outcome, repair evidence, and observed Boss usage", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-analytics-"));
		try {
			const store = createMissionStore({ root: join(root, "missions") });
			const analytics = new SQLiteAnalyticsStore({ root: join(root, "analytics"), enabled: true });
			const mission = store.createMission({ missionId: "analytics-mission", goal: "prove Boss telemetry", acceptanceCriteria: ["tests pass"] });
			const quality = new QualityService(store);
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 5), route("boss-b", 3), route("boss-c", 2)],
				analytics,
				profileId: "profile-rc25",
				invoke: async ({ phase }) => phase === "plan"
					? { action: "dispatch", summary: "dispatch bounded proof", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "prove telemetry", acceptanceCriteria: ["tests pass"] }], tokenUsage: { inputTokens: 10, outputTokens: 5, provenance: "observed" } }
					: { action: "complete", summary: "proof accepted", tasks: [], acceptanceSatisfied: true, tokenUsage: { inputTokens: 7, outputTokens: 3, provenance: "observed" } },
				dispatch: async (task) => {
					const attempt = store.createAttempt({ taskId: task.taskId, routeId: "worker-route", remoteModelId: "worker-remote" });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "worker completed" };
				},
				verify: async (task) => {
					const taskRecord = store.getTask(task.taskId);
					assert.ok(taskRecord?.lastRunId);
					const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: taskRecord.lastRunId, round: 0 });
					quality.completeVerification(verification.verificationId, {
						verdict: "pass",
						criterionResults: [{ criterion: "tests pass", status: "satisfied", evidenceSummary: "tests passed" }],
						mechanicalChecks: [{ command: "npm test", outcome: "passed", provenance: "reviewer" }],
						findings: [], requiredFixes: [], risks: [], summary: "pass",
					}, task.acceptanceCriteria);
					return { taskId: String(task.taskId), verdict: "pass", summary: "pass" };
				},
				maxCycles: 2,
			});
			assert.equal(result.status, "completed");
			const events = analytics.list();
			assert.ok(events.some((event) => event.eventType === "custom" && event.poolId === "boss" && event.missionId === "analytics-mission" && event.dimensions?.bossAssigned === true));
			const terminal = events.find((event) => event.eventType === "attempt" && event.poolId === "boss");
			assert.equal(terminal?.outcome, "completed");
			assert.deepEqual(terminal?.tokenUsage, { inputTokens: 17, outputTokens: 8, provenance: "observed" });
			assert.equal(terminal?.dimensions?.bossTerminalState, "COMPLETED");
			assert.ok(events.some((event) => event.eventType === "quality" && event.poolId === "boss" && event.qualityOutcome === "pass"));
			analytics.close();
			const reopened = new SQLiteAnalyticsStore({ root: join(root, "analytics"), enabled: true });
			assert.ok(reopened.list().some((event) => event.eventType === "attempt" && event.missionId === "analytics-mission"));
			reopened.close();
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

const abortError = (message: string): Error => {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
};

const orchestration = (store: ReturnType<typeof createMissionStore>, missionId: string): {
	readonly bossAssignment?: { readonly routeId?: string; readonly fallbackFromRouteId?: string };
	readonly fallbackHistory?: readonly unknown[];
	readonly repairCycles?: number;
	readonly protocolFailures?: number;
	readonly actionablePlanFailures?: number;
	readonly lastProtocolError?: string;
	readonly lastInvocation?: { readonly stage?: string; readonly failureClass?: string; readonly hasText?: boolean; readonly stopReason?: string; readonly fallbackAttempted?: boolean; readonly fallbackSelectedRouteId?: string };
	readonly acceptanceCriteriaProvenance?: string;
	readonly terminal?: string;
	readonly terminalReason?: string;
	readonly terminalProvenance?: string;
} | undefined => (store.getMission(missionId)?.plan as { orchestration?: {
	readonly bossAssignment?: { readonly routeId?: string; readonly fallbackFromRouteId?: string };
	readonly fallbackHistory?: readonly unknown[];
	readonly repairCycles?: number;
	readonly protocolFailures?: number;
	readonly actionablePlanFailures?: number;
	readonly lastProtocolError?: string;
	readonly lastInvocation?: { readonly stage?: string; readonly failureClass?: string; readonly hasText?: boolean; readonly stopReason?: string; readonly fallbackAttempted?: boolean; readonly fallbackSelectedRouteId?: string };
	readonly acceptanceCriteriaProvenance?: string;
	readonly terminal?: string;
	readonly terminalReason?: string;
	readonly terminalProvenance?: string;
} })?.orchestration;

describe("RC26 Boss terminal semantics", () => {
	it("cancels an already-aborted Mission before Boss selection without fallback", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-cancel-entry-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "cancel-entry", goal: "stop before planning" });
			const controller = new AbortController();
			controller.abort();
			let invoked = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				signal: controller.signal,
				invoke: async () => {
					invoked += 1;
					return { action: "complete", summary: "should not plan", tasks: [], acceptanceSatisfied: true };
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "not dispatched" }),
				verify: async () => ({ verdict: "blocked", summary: "not verified" }),
				maxCycles: 3,
			});
			assert.equal(result.status, "cancelled");
			assert.equal(result.terminal, "CANCELLED");
			assert.equal(invoked, 0);
			assert.equal(store.getMission(mission.missionId)?.status, "cancelled");
			assert.equal(orchestration(store, String(mission.missionId))?.terminal, "CANCELLED");
			assert.equal(orchestration(store, String(mission.missionId))?.bossAssignment, undefined);
			assert.equal(orchestration(store, String(mission.missionId))?.fallbackHistory?.length ?? 0, 0);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("cancels during Boss planning without completing, blocking, falling back, or repairing", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-cancel-plan-"));
		try {
			const store = createMissionStore({ root });
			const analytics = new SQLiteAnalyticsStore({ root: join(root, "analytics"), enabled: true });
			const mission = store.createMission({ missionId: "cancel-plan", goal: "stop during planning" });
			const calls: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				analytics,
				invoke: async ({ assignment }) => {
					calls.push(assignment.routeId);
					throw abortError("planning aborted");
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "not dispatched" }),
				verify: async () => ({ verdict: "blocked", summary: "not verified" }),
				maxCycles: 3,
			});
			assert.equal(result.status, "cancelled");
			assert.equal(result.terminal, "CANCELLED");
			assert.equal(store.getMission(mission.missionId)?.status, "cancelled");
			assert.equal(calls.length, 1);
			const state = orchestration(store, String(mission.missionId));
			assert.equal(state?.terminal, "CANCELLED");
			assert.ok(state?.terminalReason);
			assert.equal(state?.fallbackHistory?.length ?? 0, 0);
			assert.equal(state?.repairCycles, 0);
			assert.equal(store.listTasks(mission.missionId).length, 0);
			const terminal = analytics.list().find((event) => event.eventType === "attempt" && event.poolId === "boss");
			assert.equal(terminal?.outcome, "cancelled");
			assert.equal(terminal?.dimensions?.bossTerminalState, "CANCELLED");
			assert.equal(analytics.list().some((event) => event.eventType === "fallback"), false);
			analytics.close();
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("cancels after the Mission has started progressing and during worker progression", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-cancel-worker-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "cancel-worker", goal: "stop during dispatch" });
			let dispatched = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async ({ phase }) => phase === "plan"
					? { action: "dispatch", summary: "dispatch work", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "do work" }] }
					: { action: "complete", summary: "should not complete", tasks: [], acceptanceSatisfied: true },
				dispatch: async (task) => {
					dispatched += 1;
					throw abortError("worker aborted");
				},
				verify: async () => ({ verdict: "pass", summary: "should not verify" }),
				maxCycles: 3,
			});
			assert.equal(result.status, "cancelled");
			assert.equal(result.terminal, "CANCELLED");
			assert.equal(store.getMission(mission.missionId)?.status, "cancelled");
			assert.equal(dispatched, 1);
			assert.equal(orchestration(store, String(mission.missionId))?.terminal, "CANCELLED");
			assert.equal(orchestration(store, String(mission.missionId))?.fallbackHistory?.length ?? 0, 0);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("cancels during verification without repair, replan, or fallback", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-cancel-verify-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "cancel-verify", goal: "stop during verification" });
			let evaluations = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async ({ phase }) => {
					if (phase === "evaluate") evaluations += 1;
					return phase === "plan"
						? { action: "dispatch", summary: "dispatch work", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "do work" }] }
						: { action: "replan", summary: "should not replan", tasks: [] };
				},
				dispatch: async (task) => {
					const attempt = store.createAttempt({ taskId: task.taskId, routeId: "worker-route", remoteModelId: "worker-remote" });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "worker completed" };
				},
				verify: async () => {
					throw abortError("verification aborted");
				},
				maxCycles: 3,
			});
			assert.equal(result.status, "cancelled");
			assert.equal(result.terminal, "CANCELLED");
			assert.equal(evaluations, 0);
			assert.equal(orchestration(store, String(mission.missionId))?.repairCycles, 0);
			assert.equal(orchestration(store, String(mission.missionId))?.fallbackHistory?.length ?? 0, 0);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("treats AbortSignal cancellation as cancelled even when infrastructure fallback routes exist", async () => {
		const entries = [route("boss-a", 1), route("boss-b", 1), route("boss-c", 1)];
		const key = Array.from({ length: 100 }, (_, index) => `cancel-fallback-${index}`).find((candidate) => selectBossEntry(entries, candidate)?.routeId === "boss-a");
		assert.ok(key);
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-cancel-fallback-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "cancel-fallback", goal: "do not fallback" });
			const controller = new AbortController();
			const calls: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries,
				schedulingKey: key,
				signal: controller.signal,
				invoke: async ({ assignment }) => {
					calls.push(assignment.routeId);
					controller.abort();
					throw abortError("cancelled during planning");
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "not dispatched" }),
				verify: async () => ({ verdict: "blocked", summary: "not verified" }),
				maxCycles: 3,
			});
			assert.equal(result.status, "cancelled");
			assert.deepEqual(calls, ["boss-a"]);
			assert.equal(orchestration(store, String(mission.missionId))?.bossAssignment?.routeId, "boss-a");
			assert.equal(orchestration(store, String(mission.missionId))?.fallbackHistory?.length ?? 0, 0);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not continue reject-repair after cancellation", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-cancel-repair-"));
		try {
			const store = createMissionStore({ root });
			const quality = new QualityService(store);
			const mission = store.createMission({ missionId: "cancel-repair", goal: "do not repair", acceptanceCriteria: ["tests pass"] });
			let plans = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async ({ phase }) => {
					if (phase === "plan") {
						plans += 1;
						return { action: "dispatch", summary: "dispatch", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "work", acceptanceCriteria: ["tests pass"] }] };
					}
					throw abortError("cancelled instead of repair");
				},
				dispatch: async (task) => {
					const attempt = store.createAttempt({ taskId: task.taskId, routeId: "worker-route", remoteModelId: "worker-remote" });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "worker completed" };
				},
				verify: async (task) => {
					const attemptId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(attemptId);
					const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attemptId, round: 0 });
					quality.completeVerification(verification.verificationId, {
						verdict: "reject",
						criterionResults: [{ criterion: "tests pass", status: "failed", evidenceSummary: "test failed" }],
						mechanicalChecks: [{ command: "npm test", outcome: "failed", provenance: "reviewer" }],
						findings: ["test failure"],
						requiredFixes: ["repair"],
						risks: [],
						summary: "reject",
					}, task.acceptanceCriteria);
					return { verdict: "reject", summary: "reject", requiredFixes: ["repair"] };
				},
				maxCycles: 4,
			});
			assert.equal(result.status, "cancelled");
			assert.equal(plans, 1);
			assert.equal(orchestration(store, String(mission.missionId))?.repairCycles, 1);
			assert.deepEqual(store.listQualityDecisions(mission.missionId).map((decision) => decision.verdict), ["reject"]);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("distinguishes SAFETY_STOP from ordinary BLOCKED and stops dispatch, fallback, and replan", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-safety-stop-"));
		try {
			const store = createMissionStore({ root });
			const blocked = store.createMission({ missionId: "ordinary-block", goal: "external dependency" });
			const blockedResult = await runMissionGoalLoop({
				store,
				missionId: blocked.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async () => ({ action: "blocked", summary: "waiting on an external business dependency", tasks: [] }),
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "blocked", summary: "not dispatched" }),
				verify: async () => ({ verdict: "blocked", summary: "not verified" }),
				maxCycles: 2,
			});
			assert.equal(blockedResult.status, "blocked");
			assert.equal(blockedResult.terminal, "BLOCKED");
			assert.equal(orchestration(store, String(blocked.missionId))?.terminal, "BLOCKED");

			const safety = store.createMission({ missionId: "safety-stop", goal: "must not mutate untrusted work" });
			const analytics = new SQLiteAnalyticsStore({ root: join(root, "analytics"), enabled: true });
			let dispatches = 0;
			let evaluations = 0;
			const safetyResult = await runMissionGoalLoop({
				store,
				missionId: safety.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				analytics,
				invoke: async ({ phase }) => {
					if (phase === "evaluate") evaluations += 1;
					return { action: "dispatch", summary: "dispatch mutating work", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "write files" }] };
				},
				dispatch: async () => {
					dispatches += 1;
					throw new ProjectTrustRequiredError();
				},
				verify: async () => ({ verdict: "pass", summary: "should not verify" }),
				maxCycles: 3,
			});
			assert.equal(safetyResult.status, "blocked");
			assert.equal(safetyResult.terminal, "SAFETY_STOP");
			assert.notEqual(safetyResult.terminal, blockedResult.terminal);
			assert.equal(store.getMission(safety.missionId)?.status, "blocked");
			assert.equal(orchestration(store, String(safety.missionId))?.terminal, "SAFETY_STOP");
			assert.equal(orchestration(store, String(safety.missionId))?.terminalProvenance, "PROJECT_TRUST_REQUIRED");
			assert.equal(orchestration(store, String(safety.missionId))?.fallbackHistory?.length ?? 0, 0);
			assert.equal(dispatches, 1);
			assert.equal(evaluations, 0);
			const safetyEvent = analytics.list().find((event) => event.eventType === "attempt" && event.missionId === "safety-stop");
			assert.equal(safetyEvent?.outcome, "safety_stop");
			assert.equal(safetyEvent?.dimensions?.bossTerminalState, "SAFETY_STOP");
			assert.equal(analytics.list().some((event) => event.eventType === "fallback"), false);
			analytics.close();

			const pathStop = store.createMission({ missionId: "path-stop", goal: "protected path" });
			const pathResult = await runMissionGoalLoop({
				store,
				missionId: pathStop.missionId,
				entries: [route("boss-a", 1)],
				invoke: async () => ({ action: "dispatch", summary: "dispatch", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "touch secrets" }] }),
				dispatch: async () => {
					throw new PathSafetyError({ decision: "BLOCK", reason: "credential or private-key path is protected", code: "CREDENTIAL_PATH" });
				},
				verify: async () => ({ verdict: "pass", summary: "should not verify" }),
				maxCycles: 2,
			});
			assert.equal(pathResult.terminal, "SAFETY_STOP");
			assert.equal(orchestration(store, String(pathStop.missionId))?.terminalProvenance, "CREDENTIAL_PATH");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps Investigation, Implementation, and Verification scheduling independent of pinned Boss assignment", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-boss-pool-schedule-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "pool-schedule", goal: "use all three worker classes", acceptanceCriteria: ["reviewed"] });
			const quality = new QualityService(store);
			const dispatched: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 5), route("boss-b", 3)],
				invoke: async ({ phase }) => phase === "plan"
					? {
						action: "dispatch",
						summary: "dispatch all worker classes",
						tasks: [
							{ roleId: "researcher", executionClass: "investigation", poolId: "investigation", objective: "inspect" },
							{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "change", acceptanceCriteria: ["reviewed"] },
							{ roleId: "reviewer", executionClass: "verification", poolId: "verification", objective: "review" },
						],
					}
					: { action: "complete", summary: "accepted", tasks: [], acceptanceSatisfied: true },
				dispatch: async (task) => {
					dispatched.push(`${task.executionClass}:${task.poolId}`);
					const attempt = store.createAttempt({ taskId: task.taskId, routeId: `worker-${task.executionClass}`, remoteModelId: `remote-${task.executionClass}` });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: `${task.executionClass} completed` };
				},
				verify: async (task) => {
					const attemptId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(attemptId);
					const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attemptId, round: 0 });
					quality.completeVerification(verification.verificationId, {
						verdict: "pass",
						criterionResults: [{ criterion: "reviewed", status: "satisfied", evidenceSummary: "ok" }],
						mechanicalChecks: [{ command: "ls", outcome: "passed", provenance: "reviewer" }],
						findings: [],
						requiredFixes: [],
						risks: [],
						summary: "pass",
					}, task.acceptanceCriteria);
					return { verdict: "pass", summary: "pass" };
				},
				maxCycles: 2,
			});
			assert.equal(result.status, "completed");
			assert.deepEqual(dispatched, [
				"investigation:investigation",
				"implementation:implementation",
				"verification:verification",
			]);
			assert.equal(orchestration(store, String(mission.missionId))?.bossAssignment?.routeId, result.assignment?.routeId);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

const passVerify = (store: ReturnType<typeof createMissionStore>, missionId: string, criterion = "tests pass") => async (task: TaskRecord) => {
	const attemptId = store.getTask(task.taskId)?.lastRunId;
	assert.ok(attemptId);
	const quality = new QualityService(store);
	const verification = quality.startVerification({ missionId, taskId: task.taskId, targetRunId: attemptId, round: 0 });
	quality.completeVerification(verification.verificationId, {
		verdict: "pass",
		criterionResults: [{ criterion, status: "satisfied", evidenceSummary: "ok" }],
		mechanicalChecks: [{ command: "npm test", outcome: "passed", provenance: "reviewer" }],
		findings: [],
		requiredFixes: [],
		risks: [],
		summary: "pass",
	}, task.acceptanceCriteria);
	return { verdict: "pass" as const, summary: "pass" };
};

const succeedDispatch = (store: ReturnType<typeof createMissionStore>) => async (task: TaskRecord) => {
	const attempt = store.createAttempt({ taskId: task.taskId, routeId: "worker-route", remoteModelId: "worker-remote" });
	store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
	return { taskId: String(task.taskId), status: "succeeded" as const, summary: "worker completed" };
};

describe("RC27 autonomous Mission bootstrap and Boss protocol", () => {
	it("rejects malformed BossDecision objects and empty dispatch/replan plans", () => {
		assert.throws(() => normalizeBossDecision({ summary: "no action", tasks: [] }), BossProtocolError);
		assert.throws(() => normalizeBossDecision({ action: "ship_it", summary: "wrong fields", tasks: [] }), BossProtocolError);
		assert.throws(() => normalizeBossDecision({ action: "dispatch", summary: "empty", tasks: [] }, { phase: "plan" }), /dispatch requires at least one actionable task/u);
		assert.throws(() => normalizeBossDecision({ action: "replan", summary: "empty", tasks: [] }, { phase: "plan" }), /replan requires at least one actionable task/u);
		assert.throws(() => normalizeBossDecision({ action: "dispatch", summary: "ok", tasks: [{ roleId: "x" }] }), BossProtocolError);
		assert.throws(() => normalizeBossDecision({ action: "complete", summary: "ok", tasks: [], acceptanceSatisfied: "yes" }), /acceptanceSatisfied/u);
		const complete = normalizeBossDecision({ action: "complete", summary: "done", tasks: [], acceptanceSatisfied: true });
		assert.equal(complete.action, "complete");
		const evaluateReplan = normalizeBossDecision({ action: "replan", summary: "need another plan cycle", tasks: [], requiredFixes: ["repair"] }, { phase: "evaluate" });
		assert.equal(evaluateReplan.action, "replan");
		assert.equal(evaluateReplan.tasks.length, 0);
	});

	it("creates the first canonical Task from an autonomous Goal without a pre-existing /missions Add Task", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc27-autonomous-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "autonomous-bootstrap", goal: "Perform a bounded docs-only repository task" });
			assert.equal(store.listTasks(mission.missionId).length, 0);
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async ({ phase }) => phase === "plan"
					? { action: "dispatch", summary: "create the first task", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "edit docs only", acceptanceCriteria: ["docs updated"] }] }
					: { action: "complete", summary: "goal satisfied", tasks: [], acceptanceSatisfied: true },
				dispatch: succeedDispatch(store),
				verify: passVerify(store, String(mission.missionId), "docs updated"),
				maxCycles: 2,
			});
			assert.equal(result.status, "completed");
			assert.equal(result.terminal, "COMPLETED");
			assert.equal(store.listTasks(mission.missionId).length, 1);
			assert.equal(store.getMission(mission.missionId)?.acceptanceCriteria.length === 0, false);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("repairs an invalid empty plan on the next pinned Boss inference, then completes through M7", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc27-self-repair-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "self-repair", goal: "ship the docs fix", acceptanceCriteria: ["docs updated"] });
			const calls: Array<{ phase: string; cycle: number; routeId: string }> = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async (request) => {
					calls.push({ phase: request.phase, cycle: request.cycle, routeId: request.assignment.routeId });
					if (request.phase === "plan" && request.cycle === 0) return { action: "dispatch", summary: "empty plan", tasks: [] };
					if (request.phase === "plan") return { action: "dispatch", summary: "repaired plan", tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "write the docs", acceptanceCriteria: ["docs updated"] }] };
					return { action: "complete", summary: "verified", tasks: [], acceptanceSatisfied: true };
				},
				dispatch: succeedDispatch(store),
				verify: passVerify(store, String(mission.missionId), "docs updated"),
				maxCycles: 4,
			});
			assert.equal(result.status, "completed");
			assert.equal(store.listTasks(mission.missionId).length, 1);
			assert.equal(new Set(calls.map((call) => call.routeId)).size, 1);
			assert.equal(orchestration(store, String(mission.missionId))?.fallbackHistory?.length ?? 0, 0);
			assert.equal((orchestration(store, String(mission.missionId))?.protocolFailures ?? 0) >= 1, true);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("models the RC26 dogfood failure: 4 empty Boss cycles never complete and stay informative AWAITING_USER", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc27-dogfood-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "mission-5f02627a-f84b-4ecb-95c1-a900dacfa5a8", goal: "Perform a bounded docs-only repository task" });
			const calls: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async ({ assignment, phase }) => {
					calls.push(`${phase}:${assignment.routeId}`);
					return { action: "dispatch", summary: "I will plan later", tasks: [] };
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "must not dispatch" }),
				verify: async () => ({ verdict: "blocked", summary: "must not verify" }),
				maxCycles: 4,
			});
			assert.equal(result.status, "awaiting-review");
			assert.equal(result.terminal, "AWAITING_USER");
			assert.notEqual(result.terminal, "COMPLETED");
			assert.equal(store.listTasks(mission.missionId).length, 0);
			assert.equal(store.getMission(mission.missionId)?.status, "awaiting-review");
			const state = orchestration(store, String(mission.missionId));
			assert.equal(state?.actionablePlanFailures, 4);
			assert.equal(state?.protocolFailures, 4);
			assert.equal(state?.fallbackHistory?.length ?? 0, 0);
			assert.match(state?.terminalReason ?? "", /tasks=0/u);
			assert.match(state?.terminalReason ?? "", /actionablePlanFailures=4/u);
			assert.equal(new Set(calls.map((item) => item.split(":")[1])).size, 1);
			const inspect = formatBossLoopDiagnostics(store.getMission(mission.missionId)!, 0);
			assert.ok(inspect.some((line) => line.includes("actionable-plan failures: 4")));
			assert.ok(inspect.some((line) => line.includes("tasks generated: 0")));
			assert.ok(inspect.some((line) => line.includes("why execution stopped:")));
			assert.ok(inspect.some((line) => line.includes("pinned Boss route:")));
			assert.ok(inspect.some((line) => line.includes("boss fallback: none")));
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not treat protocol failure as M4 infrastructure Boss fallback", async () => {
		const entries = [route("boss-a", 1), route("boss-b", 1), route("boss-c", 1)];
		const key = Array.from({ length: 100 }, (_, index) => `protocol-${index}`).find((candidate) => selectBossEntry(entries, candidate)?.routeId === "boss-a");
		assert.ok(key);
		const root = await mkdtemp(join(tmpdir(), "pmo-rc27-protocol-pin-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "protocol-pin", goal: "keep the same Boss" });
			const calls: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries,
				schedulingKey: key,
				invoke: async ({ assignment }) => {
					calls.push(assignment.routeId);
					throw new BossProtocolError("malformed Boss JSON object");
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "not dispatched" }),
				verify: async () => ({ verdict: "blocked", summary: "not verified" }),
				maxCycles: 3,
			});
			assert.equal(result.status, "awaiting-review");
			assert.equal(result.terminal, "AWAITING_USER");
			assert.deepEqual([...new Set(calls)], ["boss-a"]);
			assert.equal(orchestration(store, String(mission.missionId))?.bossAssignment?.routeId, "boss-a");
			assert.equal(orchestration(store, String(mission.missionId))?.fallbackHistory?.length ?? 0, 0);
			assert.equal(orchestration(store, String(mission.missionId))?.protocolFailures, 3);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("still falls back on genuine infrastructure failure", async () => {
		const entries = [route("boss-a", 1), route("boss-b", 1)];
		const key = Array.from({ length: 100 }, (_, index) => `infra-${index}`).find((candidate) => selectBossEntry(entries, candidate)?.routeId === "boss-a");
		assert.ok(key);
		const root = await mkdtemp(join(tmpdir(), "pmo-rc27-infra-fallback-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "infra-fallback", goal: "recover from provider outage" });
			const calls: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries,
				schedulingKey: key,
				invoke: async ({ assignment }) => {
					calls.push(assignment.routeId);
					if (assignment.routeId === "boss-a") throw new BossInfrastructureError("provider unavailable");
					return { action: "blocked", summary: "external dependency after fallback", tasks: [] };
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "blocked", summary: "not reached" }),
				verify: async () => ({ verdict: "blocked", summary: "not reached" }),
				maxCycles: 1,
			});
			assert.equal(result.terminal, "BLOCKED");
			assert.deepEqual(calls, ["boss-a", "boss-b"]);
			assert.equal(orchestration(store, String(mission.missionId))?.bossAssignment?.routeId, "boss-b");
			assert.equal(orchestration(store, String(mission.missionId))?.fallbackHistory?.length, 1);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps explicit Goal criteria and does not overwrite them with derived criteria", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc27-explicit-criteria-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "explicit-criteria", goal: "Do the work\nAcceptance criteria:\n- labelled", acceptanceCriteria: ["keep the user criterion"] });
			await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1)],
				invoke: async () => ({ action: "awaiting_user", summary: "need a human decision", tasks: [] }),
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "not dispatched" }),
				verify: async () => ({ verdict: "blocked", summary: "not verified" }),
				maxCycles: 1,
			});
			assert.deepEqual(store.getMission(mission.missionId)?.acceptanceCriteria, ["keep the user criterion"]);
			assert.equal(orchestration(store, String(mission.missionId))?.acceptanceCriteriaProvenance, "explicit");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

const rc28DecisionText = JSON.stringify({
	action: "dispatch",
	summary: "create the first bounded task",
	tasks: [{ roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "perform the bounded work", acceptanceCriteria: ["the change is documented"] }],
});

const rc28Assistant = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	role: "assistant",
	content: [{ type: "text", text: rc28DecisionText }],
	api: "openai-completions",
	provider: "custom",
	model: "fixture-model",
	usage: { input: 4, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: 1,
	...overrides,
});

describe("RC28 Boss invocation compatibility", () => {
	it("does not block at cycle 0 when a valid Pi-shaped response produces a BossDecision", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc28-valid-pi-"));
		try {
			const store = createMissionStore({ root });
			const quality = new QualityService(store);
			const mission = store.createMission({ missionId: "rc28-valid", goal: "ship the bounded change\nAcceptance criteria:\n- documented" });
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1)],
				invoke: async ({ phase }) => {
					if (phase === "evaluate") return { action: "complete", summary: "goal and acceptance criteria are satisfied", tasks: [], acceptanceSatisfied: true };
					return parseBossAssistantResponse(rc28Assistant({ stopReason: "length" }), { phase });
				},
				dispatch: async (task) => {
					const attempt = store.createAttempt({ taskId: task.taskId, routeId: "worker-route", remoteModelId: "worker-remote" });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "worker completed" };
				},
				verify: async (task) => {
					const attemptId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(attemptId);
					const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attemptId, round: 0 });
					quality.completeVerification(verification.verificationId, {
						verdict: "pass",
						criterionResults: [{ criterion: "the change is documented", status: "satisfied", evidenceSummary: "docs updated" }],
						mechanicalChecks: [{ command: "npm test", outcome: "passed", provenance: "reviewer" }],
						findings: [],
						requiredFixes: [],
						risks: [],
						summary: "pass",
					}, task.acceptanceCriteria);
					return { verdict: "pass", summary: "verified" };
				},
				maxCycles: 2,
			});
			assert.equal(result.terminal, "COMPLETED");
			assert.notEqual(result.cycles, 0);
			assert.equal(store.listTasks(mission.missionId).length, 1);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps empty assistant text as a precise protocol diagnostic without infrastructure fallback", async () => {
		const entries = [route("boss-a", 1), route("boss-b", 1)];
		const root = await mkdtemp(join(tmpdir(), "pmo-rc28-empty-text-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "mission-89d5e163-17ee-4218-b06c-dea5fa4b480b", goal: "bounded docs-only work\nAcceptance criteria:\n- one\n- two" });
			const calls: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries,
				invoke: async ({ assignment }) => {
					calls.push(assignment.routeId);
					return parseBossAssistantResponse(rc28Assistant({
						stopReason: "stop",
						content: [{ type: "thinking", thinking: "no user-visible decision" }],
					}), { phase: "plan", routeId: assignment.routeId, ...(assignment.remoteModelId === undefined ? {} : { remoteModelId: assignment.remoteModelId }) });
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "must not dispatch" }),
				verify: async () => ({ verdict: "blocked", summary: "must not verify" }),
				maxCycles: 4,
			});
			assert.equal(result.terminal, "AWAITING_USER");
			assert.equal(new Set(calls).size, 1);
			const state = orchestration(store, String(mission.missionId));
			assert.equal(state?.protocolFailures, 4);
			assert.equal(state?.fallbackHistory?.length ?? 0, 0);
			assert.equal(state?.lastProtocolError, "Boss response contained no assistant text");
			assert.equal(state?.lastInvocation?.stage, "response");
			assert.equal(state?.lastInvocation?.failureClass, "empty_response");
			assert.equal(state?.lastInvocation?.fallbackAttempted, false);
			const inspect = formatBossLoopDiagnostics(store.getMission(mission.missionId)!, 0);
			assert.ok(inspect.some((line) => line.includes("boss invocation stage: response")));
			assert.ok(inspect.some((line) => line.includes("boss invocation class: empty_response")));
			assert.ok(inspect.some((line) => line.includes("boss fallback: none")));
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps request transport failure as infrastructure and falls back to a weight-0 enabled route", async () => {
		const entries = [route("tabi", 1), route("cursor", 0)];
		const root = await mkdtemp(join(tmpdir(), "pmo-rc28-weight0-fallback-"));
		try {
			const store = createMissionStore({ root });
			const quality = new QualityService(store);
			const mission = store.createMission({ missionId: "mission-aa30ed69-3213-4cf0-882a-a60be426412d", goal: "recover from live Boss invocation failure" });
			const calls: string[] = [];
			const secret = "sk-ant-api03-not-a-real-secret-value";
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries,
				schedulingKey: "tabi-preferred",
				invoke: async ({ assignment, phase }) => {
					calls.push(assignment.routeId);
					if (assignment.routeId === "tabi") {
						throw bossInfrastructureError("Boss request failed: authentication_failed", {
							stage: "request",
							failureClass: "authentication_failed",
							hasText: false,
							normalized: false,
							code: "authentication_failed",
							routeId: assignment.routeId,
							...(assignment.remoteModelId === undefined ? {} : { remoteModelId: assignment.remoteModelId }),
						});
					}
					if (phase === "evaluate") return { action: "complete", summary: "goal and acceptance criteria are satisfied", tasks: [], acceptanceSatisfied: true };
					return parseBossAssistantResponse(rc28Assistant(), { phase });
				},
				dispatch: async (task) => {
					const attempt = store.createAttempt({ taskId: task.taskId, routeId: "worker-route", remoteModelId: "worker-remote" });
					store.finishAttempt(attempt.attemptId, "succeeded", { result: { status: "completed" } });
					return { taskId: String(task.taskId), status: "succeeded", summary: "worker completed" };
				},
				verify: async (task) => {
					const attemptId = store.getTask(task.taskId)?.lastRunId;
					assert.ok(attemptId);
					const verification = quality.startVerification({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attemptId, round: 0 });
					quality.completeVerification(verification.verificationId, {
						verdict: "pass",
						criterionResults: [{ criterion: "the change is documented", status: "satisfied", evidenceSummary: "docs updated" }],
						mechanicalChecks: [{ command: "npm test", outcome: "passed", provenance: "reviewer" }],
						findings: [],
						requiredFixes: [],
						risks: [],
						summary: "pass",
					}, task.acceptanceCriteria);
					return { verdict: "pass", summary: "verified" };
				},
				maxCycles: 2,
			});
			assert.equal(selectBossEntry(entries, "any-mission")?.routeId, "tabi");
			assert.equal(selectBossFallbackEntry(entries, { routeId: "tabi" as never, thinkingEffort: "auto", weight: 1, assignedAt: new Date().toISOString() }, [])?.routeId, "cursor");
			assert.deepEqual(calls.slice(0, 2), ["tabi", "cursor"]);
			assert.equal(result.assignment?.routeId, "cursor");
			const state = orchestration(store, String(mission.missionId));
			assert.equal(state?.bossAssignment?.routeId, "cursor");
			assert.equal(state?.bossAssignment?.fallbackFromRouteId, "tabi");
			assert.equal(state?.fallbackHistory?.length, 1);
			assert.equal(state?.lastInvocation?.stage, "request");
			assert.equal(state?.lastInvocation?.failureClass, "authentication_failed");
			assert.equal(state?.lastInvocation?.fallbackAttempted, true);
			assert.equal(state?.lastInvocation?.fallbackSelectedRouteId, "cursor");
			const persisted = JSON.stringify(store.getMission(mission.missionId)?.plan);
			assert.doesNotMatch(persisted, new RegExp(secret, "u"));
			assert.doesNotMatch(persisted, /authorization|apiKey|thinking":/u);
			const inspect = formatBossLoopDiagnostics(store.getMission(mission.missionId)!, store.listTasks(mission.missionId).length);
			assert.ok(inspect.some((line) => line.includes("boss invocation class: authentication_failed")));
			assert.ok(inspect.some((line) => line.includes("boss fallback attempted: yes")));
			assert.equal(result.terminal, "COMPLETED");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("blocks with a precise reason when Tabi-shaped infrastructure fails and no fallback remains", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc28-tabi-alone-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "tabi-alone", goal: "diagnose a live Boss invocation failure" });
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("tabi", 1)],
				invoke: async ({ assignment }) => parseBossAssistantResponse(rc28Assistant({
					stopReason: "error",
					errorMessage: "model_not_found",
					rawStopReason: "model_not_found",
					content: [],
				}), { phase: "plan", routeId: assignment.routeId, ...(assignment.remoteModelId === undefined ? {} : { remoteModelId: assignment.remoteModelId }) }),
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "must not dispatch" }),
				verify: async () => ({ verdict: "blocked", summary: "must not verify" }),
				maxCycles: 1,
			});
			assert.equal(result.terminal, "BLOCKED");
			assert.equal(result.cycles, 0);
			assert.match(result.mission.plan && typeof result.mission.plan === "object" ? String((orchestration(store, String(mission.missionId))?.terminalReason)) : "", /Boss request failed: model_unavailable; no configured fallback remains/u);
			const inspect = formatBossLoopDiagnostics(store.getMission(mission.missionId)!, 0);
			assert.ok(inspect.some((line) => line.includes("why execution stopped: Boss request failed: model_unavailable")));
			assert.ok(inspect.some((line) => line.includes("boss invocation stage: response")));
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
