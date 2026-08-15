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
import {
	BossInfrastructureError,
	runMissionGoalLoop,
	selectBossEntry,
	type BossDecision,
	type BossRouteCandidate,
} from "../src/core/mission/boss.js";
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
