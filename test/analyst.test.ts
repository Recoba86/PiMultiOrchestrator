import assert from "node:assert/strict";
import test from "node:test";

import {
	RecommendationAnalystService,
	validateAnalystPacket,
	validateAnalystResult,
	type AnalystPacket,
} from "../src/core/analytics/analyst.js";

const packet = (): AnalystPacket => ({
	recommendationId: "rec-1",
	poolId: "implementation",
	candidateRouteId: "route-b",
	currentOrder: ["route-a", "route-b"],
	metrics: { runs: 12, successes: 11, prompt: "secret is filtered" },
	scoreComponents: [{ name: "reliability", contribution: 0.9 }],
	basis: ["route-b has better observed reliability"],
});

test("M8.5 analyst validates bounded packets, verdicts, and privacy", async () => {
	const safe = validateAnalystPacket(packet());
	assert.equal(JSON.stringify(safe).includes("secret"), false);
	for (const verdict of ["support", "oppose", "insufficient_evidence"] as const) {
		const result = validateAnalystResult({ verdict, explanation: "bounded explanation", reasoningFactors: ["sample size"], caveats: ["fixture"] }, { routeId: "route-v", packet: safe }, "2026-08-12T00:00:00.000Z");
		assert.equal(result.verdict, verdict);
		assert.equal(result.inputFingerprint.length, 64);
	}
	const privateResult = validateAnalystResult({ verdict: "support", explanation: "x", transcript: "secret" }, { routeId: "route-v", packet: safe }, new Date().toISOString());
	assert.equal("transcript" in privateResult, false);
});

test("M8.5 execution is explicit, deterministic mode does not call AI, and stale input is detectable", async () => {
	let calls = 0;
	const service = new RecommendationAnalystService({
		routeProvider: () => [{ routeId: "route-v", enabled: true, available: true }],
		execute: async () => { calls += 1; return { verdict: "support", explanation: "keep candidate" }; },
	});
	const deterministic = await service.analyze({ mode: "deterministic", routeId: "route-v", packet: packet() });
	assert.equal(deterministic.state, "idle");
	assert.equal(calls, 0);
	const completed = await service.analyze({ mode: "ai-assisted", routeId: "route-v", packet: packet() });
	assert.equal(completed.state, "completed");
	assert.equal(calls, 1);
	assert.equal(service.isStale(completed.latest!, { ...packet(), metrics: { runs: 13 } }), true);
});

test("M8.5 unavailable analyst leaves deterministic result usable", async () => {
	const service = new RecommendationAnalystService({ routeProvider: () => [{ routeId: "route-v", enabled: false, available: false }], execute: async () => ({ verdict: "support", explanation: "unused" }) });
	const status = await service.analyze({ mode: "ai-assisted", routeId: "route-v", packet: packet() });
	assert.equal(status.state, "failed");
	assert.match(status.message ?? "", /unavailable/);
});
