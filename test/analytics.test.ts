import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AnalyticsQueryService, NoopAnalyticsSink, RecommendationApplicationService, RecommendationEngine, SQLiteAnalyticsStore, ScoreEngine, estimateReferenceCost, summarize, type AnalyticsEventV1 } from "../src/core/analytics/index.js";

const event = (id: string, patch: Partial<AnalyticsEventV1> = {}): AnalyticsEventV1 => ({ eventId: id, occurredAt: "2026-08-12T00:00:00.000Z", eventType: "run", poolId: "implementation", routeId: "route-a", outcome: "success", ...patch });

test("analytics store is privacy-minimal and idempotent across reopen", () => {
	const root = mkdtempSync(join(tmpdir(), "pmo-analytics-"));
	const first = new SQLiteAnalyticsStore({ root, enabled: true });
	assert.equal(first.append(event("run-1", { dimensions: { safe: true, Authorization: "Bearer secret-analytics-token", prompt: "private task text" }, tokenUsage: { inputTokens: 3, outputTokens: 2, provenance: "observed" } })), true);
	assert.equal(first.append(event("run-1", { outcome: "failed" })), false);
	first.close();
	const second = new SQLiteAnalyticsStore({ root, enabled: true });
	assert.equal(second.list().length, 1);
	assert.equal(JSON.stringify(second.list()).includes("prompt"), false);
	assert.equal(JSON.stringify(second.list()).includes("secret-analytics-token"), false);
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
