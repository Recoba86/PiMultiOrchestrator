import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	AnalyticsQueryService,
	RecommendationApplicationService,
	RecommendationEngine,
	SQLiteAnalyticsStore,
	type AnalyticsEventV1,
} from "../src/core/analytics/index.js";
import { ContextBroker, missionStoreContextRepository } from "../src/core/context/index.js";
import { createMissionStore, executeMissionTask } from "../src/core/mission/index.js";
import { QualityService } from "../src/core/quality/index.js";
import { classifyFailure } from "../src/core/routing/index.js";
import type { StableId } from "../src/core/config/types.js";
import type { SubagentRunResult } from "../src/core/workers/index.js";

const route = (value: string): StableId => value as StableId;
const at = (seconds: number): string => new Date(Date.parse("2026-08-12T00:00:00.000Z") + seconds * 1_000).toISOString();

function runWithFallback(): SubagentRunResult {
	return {
		protocolVersion: 1,
		runId: "run-m8-mission",
		roleId: "implementer",
		poolId: "implementation",
		terminalStatus: "completed",
		finalRouteId: route("route-b"),
		finalRemoteModelId: "fake/model-b",
		fallbackCount: 1,
		potentialMutationObserved: false,
		summary: "fallback completed",
		structuredResult: {
			protocolVersion: 1,
			status: "completed",
			summary: "bounded child result",
			evidence: ["fixture evidence"],
			filesChanged: [],
			tests: [],
			risks: [],
			questions: [],
		},
		attempts: [
			{
				attemptId: "child-attempt-a",
				routeId: route("route-a"),
				remoteModelId: "fake/model-a",
				retryIndex: 0,
				startedAt: at(1),
				endedAt: at(2),
				outcome: "infrastructure_failure",
				infrastructureFailure: classifyFailure({ status: 429 }),
				failureAction: "FALLBACK_NEXT_ROUTE",
				toolNamesUsed: ["read"],
				toolObservations: [],
				potentialMutationObserved: false,
				latencyMs: 1_000,
				usage: { input: 4, output: 2, totalTokens: 6 },
				sessionTerminalState: "error",
			},
			{
				attemptId: "child-attempt-b",
				routeId: route("route-b"),
				remoteModelId: "fake/model-b",
				retryIndex: 0,
				startedAt: at(3),
				endedAt: at(5),
				outcome: "completed",
				toolNamesUsed: ["read", "submit_agent_result"],
				toolObservations: [],
				potentialMutationObserved: false,
				latencyMs: 2_000,
				usage: { input: 12, output: 7, reasoning: 3, totalTokens: 22 },
				structuredResult: {
					protocolVersion: 1,
					status: "completed",
					summary: "bounded child result",
					evidence: ["fixture evidence"],
					filesChanged: [],
					tests: [],
					risks: [],
					questions: [],
				},
				sessionTerminalState: "idle",
			},
		],
	};
}

class FixturePoolManager {
	private order = ["route-a", "route-b"];

	getPool(poolId: string): { readonly poolId: string; readonly entries: readonly { readonly routeId: string; readonly index: number }[] } {
		return { poolId, entries: this.order.map((routeId, index) => ({ routeId, index })) };
	}

	moveRoute(_poolId: string, routeId: string, targetIndex: number): void {
		this.order = this.order.filter((item) => item !== routeId);
		this.order.splice(targetIndex, 0, routeId);
	}

	setOrder(order: readonly string[]): void { this.order = [...order]; }
	currentOrder(): readonly string[] { return [...this.order]; }
}

function appendQualityEvent(store: SQLiteAnalyticsStore, eventId: string, patch: Partial<AnalyticsEventV1>): void {
	assert.equal(store.append({
		eventId,
		occurredAt: at(eventId.endsWith("pass") ? 10 : 9),
		eventType: "quality",
		missionId: "mission-m8",
		taskId: "task-m8",
		poolId: "implementation",
		routeId: "route-b",
		qualityOutcome: eventId.endsWith("pass") ? "pass" : "reject",
		outcome: eventId.endsWith("pass") ? "pass" : "reject",
		...patch,
	}), true);
}

test("[M8-FIX] mission child usage/fallback and quality decisions reach durable analytics", async () => {
	const root = await mkdtemp(join(tmpdir(), "pmo-m8-fix-mission-"));
	try {
		const mission = createMissionStore({ root });
		mission.createMission({ missionId: "mission-m8", goal: "prove analytics joins", repository: { cwd: root } });
		const task = mission.createTask({ missionId: "mission-m8", taskId: "task-m8", roleId: "implementer", executionClass: "implementation", poolId: "implementation", objective: "run fixture", acceptanceCriteria: ["reviewer approves"], status: "ready" });
		const analyticsStore = new SQLiteAnalyticsStore({ root, enabled: true });
		const result = await executeMissionTask({
			store: mission,
			contextBroker: new ContextBroker(missionStoreContextRepository(mission)),
			executor: { run: async () => runWithFallback() },
			missionId: "mission-m8",
			taskId: task.taskId,
			analytics: analyticsStore,
		});
		assert.equal(result.run.finalRouteId, route("route-b"));
		assert.equal(mission.getTask(task.taskId)?.status, "execution_completed");

		const quality = new QualityService(mission);
		const rejectedRun = quality.startVerification({ missionId: "mission-m8", taskId: task.taskId, targetRunId: result.attempt.attemptId, round: 0, implementationRouteId: route("route-b"), reviewerRouteId: route("route-review") });
		const rejected = quality.completeVerification(rejectedRun.verificationId, {
			verdict: "reject",
			criterionResults: [{ criterion: "reviewer approves", status: "failed", mandatory: true, evidenceSummary: "fixture rejection" }],
			mechanicalChecks: [],
			findings: ["one repair required"],
			requiredFixes: ["repair fixture"],
			risks: [],
			summary: "reject once",
		}, ["reviewer approves"]);
		assert.equal(rejected.decision.verdict, "reject");
		appendQualityEvent(analyticsStore, "quality-m8-reject", { verificationId: rejectedRun.verificationId, repairRound: 0, firstPass: false });

		const repairAttempt = mission.createAttempt({ taskId: task.taskId, attemptId: "run-m8-repair" });
		mission.finishAttempt(repairAttempt.attemptId, "succeeded");
		const passedRun = quality.startVerification({ missionId: "mission-m8", taskId: task.taskId, targetRunId: repairAttempt.attemptId, round: 1, implementationRouteId: route("route-b"), reviewerRouteId: route("route-review") });
		const passed = quality.completeVerification(passedRun.verificationId, {
			verdict: "pass",
			criterionResults: [{ criterion: "reviewer approves", status: "satisfied", mandatory: true, evidenceSummary: "fixture repaired" }],
			mechanicalChecks: [],
			findings: [],
			requiredFixes: [],
			risks: [],
			summary: "pass after repair",
		}, ["reviewer approves"]);
		assert.equal(passed.status.status, "passed");
		appendQualityEvent(analyticsStore, "quality-m8-pass", { verificationId: passedRun.verificationId, repairRound: 1, firstPass: false });

		const query = new AnalyticsQueryService(analyticsStore);
		const summary = query.overview();
		assert.equal(summary.fallbackTransitions?.["route-a->route-b:rate_limited"]?.count, 1);
		assert.equal(summary.tokens.total, 28);
		assert.equal(summary.qualityRejects, 1);
		assert.equal(summary.qualityPasses, 1);
		assert.equal(summary.repairRounds, 1);
		assert.equal(summary.byMission?.["mission-m8"]?.runs, 2);
		assert.equal(summary.byRoute["route-b"]?.successes, 1);
		analyticsStore.close();
		mission.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("[M8-FIX] recommendations are sample-gated, explicit, and stale-safe", async () => {
	const root = await mkdtemp(join(tmpdir(), "pmo-m8-fix-recommendation-"));
	try {
		const store = new SQLiteAnalyticsStore({ root, enabled: true });
		for (const routeId of ["route-a", "route-b"] as const) {
			for (let index = 0; index < 10; index += 1) {
				assert.equal(store.append({ eventId: `${routeId}-${index}`, occurredAt: at(index), eventType: "run", poolId: "implementation", routeId, outcome: routeId === "route-b" ? "success" : "failed" }), true);
			}
		}
		const summary = new AnalyticsQueryService(store).overview();
		const engine = new RecommendationEngine();
		assert.equal(engine.generate(summary, "implementation", { currentOrder: ["route-a", "route-b"] })?.proposedRouteId, "route-b");
		const recommendation = engine.generate(summary, "implementation", { currentOrder: ["route-a", "route-b"] });
		assert.ok(recommendation);
		const pool = new FixturePoolManager();
		store.saveRecommendation({ ...recommendation, proposedDiff: { ...recommendation.proposedDiff, baselineOrder: ["route-a", "route-b"] } });
		assert.deepEqual(pool.currentOrder(), ["route-a", "route-b"]);

		pool.setOrder(["route-b", "route-a"]);
		const application = new RecommendationApplicationService(store, pool);
		assert.equal(await application.apply(recommendation.recommendationId), "stale");
		assert.equal(store.listRecommendations()[0]?.status, "proposed");
		assert.equal(application.ignore(recommendation.recommendationId), true);
		assert.equal(store.listRecommendations()[0]?.status, "ignored");

		pool.setOrder(["route-a", "route-b"]);
		const applyId = "rec-m8-explicit-apply";
		store.saveRecommendation({ ...recommendation, recommendationId: applyId, proposedDiff: { ...recommendation.proposedDiff, baselineOrder: ["route-a", "route-b"] } });
		assert.equal(await application.apply(applyId), "applied");
		assert.deepEqual(pool.currentOrder(), ["route-b", "route-a"]);
		assert.equal(store.listRecommendations().find((item) => item.recommendationId === applyId)?.status, "applied");
		store.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
