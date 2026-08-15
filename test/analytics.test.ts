import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AnalyticsQueryService, NoopAnalyticsSink, RecommendationApplicationService, RecommendationEngine, SQLiteAnalyticsStore, ScoreEngine, estimateReferenceCost, summarize, type AnalyticsEventV1 } from "../src/core/analytics/index.js";

const event = (id: string, patch: Partial<AnalyticsEventV1> = {}): AnalyticsEventV1 => ({ eventId: id, occurredAt: "2026-08-12T00:00:00.000Z", eventType: "run", poolId: "implementation", routeId: "route-a", outcome: "success", ...patch });

test("analytics store is privacy-minimal and idempotent across reopen", () => {
	const root = mkdtempSync(join(tmpdir(), "pmo-analytics-"));
	const first = new SQLiteAnalyticsStore({ root, enabled: true });
	assert.equal(first.append(event("run-1", { dimensions: { fixture: true, fallbackCount: 2, reviewerRouteId: "route-review", safe: true, innocuous: "RAW_DIMENSION_MARKER", Authorization: "Bearer secret-analytics-token", prompt: "private task text" }, tokenUsage: { inputTokens: 3, outputTokens: 2, provenance: "observed" } })), true);
	assert.equal(first.append(event("run-1", { outcome: "failed" })), false);
	first.close();
	const second = new SQLiteAnalyticsStore({ root, enabled: true });
	assert.equal(second.list().length, 1);
	assert.equal(JSON.stringify(second.list()).includes("prompt"), false);
	assert.equal(JSON.stringify(second.list()).includes("secret-analytics-token"), false);
	assert.equal(JSON.stringify(second.list()).includes("RAW_DIMENSION_MARKER"), false);
	assert.deepEqual(second.list()[0]?.dimensions, { fixture: true, fallbackCount: 2, reviewerRouteId: "route-review" });
	second.close();
});

test("analytics runtime sanitizes provenance fields", () => {
	const root = mkdtempSync(join(tmpdir(), "pmo-analytics-"));
	const store = new SQLiteAnalyticsStore({ root, enabled: true });
	const unsafe = event("unsafe", {
		tokenUsage: { totalTokens: 2, provenance: "private prompt text" as never },
		cost: { amountMicros: 5, currency: "USD", provenance: "credential payload" as never },
	});
	assert.equal(store.append(unsafe), true);
	const saved = store.list()[0];
	assert.equal(saved?.tokenUsage?.provenance, undefined);
	assert.equal(saved?.cost, undefined);
	assert.equal(JSON.stringify(saved).includes("private prompt text"), false);
	assert.equal(JSON.stringify(saved).includes("credential payload"), false);
	store.close();
});

test("analytics recommendation persistence is allowlisted", () => {
	const root = mkdtempSync(join(tmpdir(), "pmo-analytics-recommendation-"));
	const store = new SQLiteAnalyticsStore({ root, enabled: true });
	store.saveRecommendation({
		recommendationId: "rec-safe",
		poolId: "implementation",
		proposedRouteId: "route-a",
		sampleSize: 10,
		score: 0.9,
		formulaVersion: "quality-v1",
		evidence: ["prompt: RAW_RECOMMENDATION_PROMPT"],
		limitations: ["fixture"],
		proposedDiff: { baselineOrder: ["route-a"], innocuous: "RAW_RECOMMENDATION_FIELD" },
		status: "proposed",
	});
	const stored = JSON.stringify(store.listRecommendations());
	assert.equal(stored.includes("RAW_RECOMMENDATION_PROMPT"), false);
	assert.equal(stored.includes("RAW_RECOMMENDATION_FIELD"), false);
	assert.equal(stored.includes("baselineOrder"), true);
	store.close();
});

test("legacy recommendation rows are sanitized before read and status updates", () => {
	const root = mkdtempSync(join(tmpdir(), "pmo-analytics-legacy-recommendation-"));
	const store = new SQLiteAnalyticsStore({ root, enabled: true });
	store.saveRecommendation({ recommendationId: "rec-legacy", poolId: "implementation", proposedRouteId: "route-a", sampleSize: 10, score: 0.9, formulaVersion: "quality-v1", evidence: ["safe"], limitations: ["fixture"], proposedDiff: { baselineOrder: ["route-a"] }, status: "proposed" });
	store.close();
	const raw = new DatabaseSync(join(root, "analytics.sqlite"));
	raw.prepare("UPDATE analytics_recommendations SET payload_json=? WHERE recommendation_id=?").run(JSON.stringify({ recommendationId: "rec-legacy", poolId: "implementation", proposedRouteId: "route-a", sampleSize: 10, score: 0.9, formulaVersion: "quality-v1", evidence: ["prompt: LEGACY_PRIVATE_PROMPT"], limitations: ["fixture"], proposedDiff: { baselineOrder: ["route-a"], content: "LEGACY_PRIVATE_FIELD" }, status: "proposed", prompt: "LEGACY_PRIVATE_PROMPT" }), "rec-legacy");
	raw.close();
	const reopened = new SQLiteAnalyticsStore({ root, enabled: true });
	const safe = reopened.listRecommendations()[0];
	assert.equal(JSON.stringify(safe).includes("LEGACY_PRIVATE"), false);
	assert.deepEqual(safe?.proposedDiff, { baselineOrder: ["route-a"] });
	assert.equal(reopened.updateRecommendationStatus("rec-legacy", "ignored"), true);
	reopened.close();
	const verified = new DatabaseSync(join(root, "analytics.sqlite"));
	const payload = verified.prepare("SELECT payload_json FROM analytics_recommendations WHERE recommendation_id=?").get("rec-legacy") as { payload_json: string };
	assert.equal(payload.payload_json.includes("LEGACY_PRIVATE"), false);
	verified.close();
});

test("disabled analytics does not persist and unknown cost is not zero", () => {
	const root = mkdtempSync(join(tmpdir(), "pmo-analytics-"));
	const first = new SQLiteAnalyticsStore({ root, enabled: true }); first.append(event("old")); first.close();
	const store = new SQLiteAnalyticsStore({ root, enabled: false });
	assert.equal(store.append(event("run-1", { cost: { provenance: "unknown" } })), false);
	assert.equal(store.list().length, 1);
	store.close();
});

test("summary separates fallback, quality, tokens and cost provenance", () => {
	const summary = summarize([
		event("a", { eventType: "attempt", durationMs: 100, tokenUsage: { totalTokens: 5, provenance: "observed" }, cost: { amountMicros: 10, currency: "USD", provenance: "observed", kind: "actual" } }),
		event("b", { eventType: "fallback", outcome: "fallback", fallbackFromRouteId: "route-a", fallbackToRouteId: "route-b" }),
		event("q", { eventType: "quality", qualityOutcome: "reject", repairRound: 1 }),
	]);
	assert.equal(summary.fallbacks, 1); assert.equal(summary.qualityRejects, 1); assert.equal(summary.tokens.total, 5); assert.equal(summary.actualCostMicros, 10); assert.equal(summary.unknownCostEvents, 0);
	assert.equal(summary.unknownTokenAttempts, 0);
});

test("[RC23] analytics retains scheduler origin, effort, weight, and generates an explicit evidence-gated weight recommendation", async () => {
	const events: AnalyticsEventV1[] = [];
	for (let index = 0; index < 10; index += 1) {
		events.push(event(`weighted-a-${index}`, { eventType: "attempt", routeId: "route-a", outcome: "success", durationMs: 10, configuredWeight: 1, selectionKind: "scheduled", schedulerPolicy: "weighted", requestedThinkingEffort: "low" }));
		events.push(event(`weighted-b-${index}`, { eventType: "attempt", routeId: "route-b", outcome: index < 5 ? "success" : "infrastructure_failure", durationMs: 100, configuredWeight: 3, selectionKind: index === 0 ? "fallback" : "scheduled", schedulerPolicy: "weighted", requestedThinkingEffort: "high" }));
	}
	const summary = summarize(events);
	assert.equal(summary.performanceByPoolRoute?.["implementation:route-a"]?.scheduled, 10);
	assert.equal(summary.performanceByPoolRoute?.["implementation:route-b"]?.fallbackSelections, 1);
	assert.equal(summary.performanceByPoolRoute?.["implementation:route-a"]?.byThinkingEffort.low, 10);
	assert.equal(summary.performanceByPoolRoute?.["implementation:route-b"]?.observedWeights["3"], 10);
	assert.equal(new RecommendationEngine().generateWeightRebalance(summary, "implementation", { "route-a": 1, "route-b": 3 })?.recommendationKind, "weight-rebalance");

	const root = mkdtempSync(join(tmpdir(), "pmo-analytics-weight-"));
	const store = new SQLiteAnalyticsStore({ root, enabled: true });
	for (const item of events) store.append(item);
	const recommendation = new RecommendationEngine().generateWeightRebalance(store.summary(), "implementation", { "route-a": 1, "route-b": 3 });
	assert.ok(recommendation);
	store.saveRecommendation(recommendation!);
	let updates = 0;
	let appliedWeights: Readonly<Record<string, number>> | undefined;
	const pool = {
		getPool: () => ({ poolId: "implementation", entries: [{ routeId: "route-a", index: 0, weight: 1 }, { routeId: "route-b", index: 1, weight: 3 }] }),
		moveRoute: async () => undefined,
		updatePoolWeights: async (_poolId: string, weights: Readonly<Record<string, number>>) => { updates += 1; appliedWeights = weights; },
	};
	const application = new RecommendationApplicationService(store, pool);
	assert.equal(await application.apply(recommendation!.recommendationId), "applied");
	assert.equal(updates, 1);
	assert.deepEqual(appliedWeights, recommendation!.proposedDiff.suggestedWeights);
	assert.equal(application.ignore(recommendation!.recommendationId), false);
	store.close();
});

test("scores and recommendations require evidence and do not mutate config", async () => {
	const events = Array.from({ length: 10 }, (_, index) => event(`r-${index}`, { eventType: "run", routeId: "route-a" }));
	const summary = summarize([...events, ...Array.from({ length: 10 }, (_, index) => event(`v-${index}`, { eventType: "run", poolId: "verification", routeId: "route-b" }))]);
	assert.equal(ScoreEngine.score(summary, "implementation").state, "ready");
	const recommendation = new RecommendationEngine().generate(summary, "implementation");
	assert.ok(recommendation); assert.equal(recommendation?.status, "proposed"); assert.equal(recommendation?.proposedRouteId, "route-a");
	assert.equal(new RecommendationEngine().generate(summary, "implementation", { currentOrder: ["route-a"] }), undefined);
	const root = mkdtempSync(join(tmpdir(), "pmo-analytics-")); const store = new SQLiteAnalyticsStore({ root, enabled: true });
	store.saveRecommendation({ ...recommendation!, proposedDiff: { baselineOrder: ["route-a"] } });
	const application = new RecommendationApplicationService(store, { getPool: () => ({ poolId: "implementation", entries: [{ routeId: "route-a", index: 0 }] }), moveRoute: async () => undefined });
	assert.equal(await application.apply(recommendation!.recommendationId), "applied"); store.close();
	const sink = new NoopAnalyticsSink(); sink.record(event("ignored"));
});

test("Boss weight recommendations are persisted as manual-only profile changes", async () => {
	const events: AnalyticsEventV1[] = [];
	for (const routeId of ["boss-a", "boss-b"] as const) {
		for (let index = 0; index < 10; index += 1) events.push(event(`${routeId}-${index}`, { eventType: "attempt", missionId: `mission-${index}`, poolId: "boss", routeId, selectionKind: "scheduled", configuredWeight: routeId === "boss-a" ? 5 : 3, outcome: routeId === "boss-a" ? "completed" : "failed", durationMs: routeId === "boss-a" ? 10 : 100 }));
	}
	const summary = summarize(events);
	const recommendation = new RecommendationEngine().generateBossWeightRebalance(summary, "boss-profile", { "boss-a": 5, "boss-b": 3 });
	assert.ok(recommendation);
	assert.equal(recommendation?.recommendationKind, "boss-weight-rebalance");
	assert.equal(recommendation?.bossProfileId, "boss-profile");
	const root = mkdtempSync(join(tmpdir(), "pmo-boss-recommendation-"));
	const store = new SQLiteAnalyticsStore({ root, enabled: true });
	store.saveRecommendation(recommendation!);
	let updates = 0;
	let appliedWeights: Readonly<Record<string, number>> | undefined;
	const application = new RecommendationApplicationService(store, {
		getPool: () => ({ poolId: "boss", entries: [] }),
		moveRoute: async () => undefined,
		getBossProfile: () => ({ profileId: "boss-profile", entries: [{ routeId: "boss-a", index: 0, weight: 5 }, { routeId: "boss-b", index: 1, weight: 3 }] }),
		updateBossWeights: async (_profileId, weights) => { updates += 1; appliedWeights = weights; },
	});
	assert.equal(updates, 0);
	assert.equal(await application.apply(recommendation!.recommendationId), "applied");
	assert.equal(updates, 1);
	assert.deepEqual(appliedWeights, recommendation?.proposedDiff.suggestedWeights);
	store.close();
});

test("route buckets use one physical attempt when run and attempt events both exist", () => {
	const summary = summarize([
		event("run-1", { runId: "run-1", routeId: "route-b" }),
		event("attempt-a", { eventType: "attempt", runId: "run-1", attemptId: "attempt-a", routeId: "route-a", outcome: "infrastructure_failure" }),
		event("attempt-b", { eventType: "attempt", runId: "run-1", attemptId: "attempt-b", routeId: "route-b" }),
		event("fallback-1", { eventType: "fallback", runId: "run-1", fallbackFromRouteId: "route-a", fallbackToRouteId: "route-b", outcome: "fallback" }),
	]);
	assert.equal(summary.runs, 1);
	assert.equal(summary.attempts, 2);
	assert.equal(summary.successes, 1);
	assert.equal(summary.byPoolRoute["implementation:route-a"]?.runs, 1);
	assert.equal(summary.byPoolRoute["implementation:route-a"]?.failures, 1);
	assert.equal(summary.byPoolRoute["implementation:route-b"]?.runs, 1);
	assert.equal(summary.byPoolRoute["implementation:route-b"]?.successes, 1);
	assert.equal(summary.fallbackTransitions?.["route-a->route-b:unknown"]?.count, 1);
	assert.equal(summary.unknownTokenAttempts, 2);
});

test("cost currencies remain separate and actual cost requires observed provenance", () => {
	const summary = summarize([
		event("usd", { cost: { amountMicros: 100, currency: "USD", provenance: "observed", kind: "actual" } }),
		event("eur", { cost: { amountMicros: 200, currency: "EUR", provenance: "observed", kind: "actual" } }),
		event("unknown", { cost: { amountMicros: 0, currency: "USD", provenance: "unknown" } }),
	]);
	assert.deepEqual(summary.costByCurrency, { USD: { actualMicros: 100 }, EUR: { actualMicros: 200 } });
	assert.equal(summary.actualCostMicros, undefined);
	assert.equal(summary.unknownCostEvents, 1);
	const estimate = estimateReferenceCost({ inputTokens: 1_000_000, outputTokens: 500_000, provenance: "observed" }, { currency: "USD", inputMicrosPerMillion: 100, outputMicrosPerMillion: 200 }, "subscription");
	assert.equal(estimate.equivalent?.amountMicros, 200);
	assert.equal(estimate.avoided?.billingMode, "subscription");
});

test("query service exposes recomputed raw-event projections", () => {
	const root = mkdtempSync(join(tmpdir(), "pmo-analytics-")); const store = new SQLiteAnalyticsStore({ root, enabled: true }); store.append(event("run-1"));
	const query = new AnalyticsQueryService(store); assert.equal(query.overview().runs, 1); assert.equal(query.events().length, 1); store.close();
});
