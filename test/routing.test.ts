import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StableId } from "../src/core/config/types.js";
import {
	classifyFailure,
	createAttemptChain,
	decideFailureAction,
	nextAfterFailure,
	previewRouting,
	recordAttempt,
	selectRoute,
	type RoutingCandidate,
	type RoutingPolicy,
} from "../src/core/routing/index.js";

const id = (value: string): StableId => value as StableId;
const policy = (overrides: Partial<RoutingPolicy> = {}): RoutingPolicy => ({
	maxAttempts: 2,
	timeoutMs: 10_000,
	rateLimitCooldownMs: 60_000,
	quotaCooldownMs: 300_000,
	fallback: { enabled: true },
	diversityPreference: "none",
	...overrides,
});
const candidate = (routeId: string, position: number, overrides: Partial<RoutingCandidate> = {}): RoutingCandidate => ({
	routeId: id(routeId),
	poolId: "implementation",
	poolPosition: position,
	poolEnabled: true,
	globalEnabled: true,
	remoteModelId: `model-${routeId}`,
	availability: "available",
	...overrides,
});

describe("M4 pure routing", () => {
	it("[U][fixture-v1] selects the first eligible route without mutating pool order", () => {
		const candidates = [candidate("route-a", 0, { availability: "missing" }), candidate("route-b", 1), candidate("route-c", 2)];
		const decision = selectRoute({ poolId: "implementation", candidates, policy: policy(), now: "2026-01-01T00:00:00.000Z" });
		assert.equal(decision.kind, "SELECTED");
		if (decision.kind === "SELECTED") assert.deepEqual([decision.routeId, decision.poolPosition], [id("route-b"), 1]);
		assert.deepEqual(candidates.map((route) => route.routeId), [id("route-a"), id("route-b"), id("route-c")]);
	});

	it("[U][fixture-v1] excludes disabled, attempted, unavailable, and cooldown routes with actionable reasons", () => {
		const candidates = [
			candidate("route-a", 0, { globalEnabled: false }),
			candidate("route-b", 1, { health: { cooldownUntil: "2026-01-01T00:01:00.000Z", cooldownReason: "rate_limited" } }),
			candidate("route-c", 2, { availability: "unavailable" }),
		];
		const decision = selectRoute({ poolId: "implementation", candidates, policy: policy(), now: "2026-01-01T00:00:00.000Z" });
		assert.equal(decision.kind, "NO_ELIGIBLE_ROUTE");
		if (decision.kind === "NO_ELIGIBLE_ROUTE") {
			assert.equal(decision.earliestRetryAt, "2026-01-01T00:01:00.000Z");
			assert.match(decision.reasons[0]?.reasons.join(" ") ?? "", /globally disabled/);
			assert.match(decision.reasons[1]?.reasons.join(" ") ?? "", /cooldown/);
		}
	});

	it("[U][fixture-v1] global disable wins over cooldown without erasing health", () => {
		const cooldown = { cooldownUntil: "2026-01-01T00:01:00.000Z", cooldownReason: "rate_limited" as const };
		const disabled = selectRoute({
			poolId: "implementation",
			candidates: [candidate("route-a", 0, { globalEnabled: false, health: cooldown })],
			policy: policy(),
			now: "2026-01-01T00:00:00.000Z",
		});
		assert.equal(disabled.kind, "NO_ELIGIBLE_ROUTE");
		const reenabled = selectRoute({
			poolId: "implementation",
			candidates: [candidate("route-a", 0, { health: cooldown })],
			policy: policy(),
			now: "2026-01-01T00:00:00.000Z",
		});
		assert.equal(reenabled.kind, "NO_ELIGIBLE_ROUTE");
		const recovered = selectRoute({
			poolId: "implementation",
			candidates: [candidate("route-a", 0, { health: cooldown })],
			policy: policy(),
			now: "2026-01-01T00:01:01.000Z",
		});
		assert.equal(recovered.kind, "SELECTED");
	});

	it("[U][fixture-v1] diversity prefer skips explicit conflicts, then relaxes only when needed", () => {
		const candidates = [candidate("route-a", 0, { remoteModelId: "model-alpha" }), candidate("route-b", 1), candidate("route-c", 2)];
		const preferred = selectRoute({
			poolId: "implementation",
			candidates,
			policy: policy({ diversityPreference: "prefer" }),
			diversity: { avoidRemoteModelIds: ["model-alpha"] },
			now: "2026-01-01T00:00:00.000Z",
		});
		assert.equal(preferred.kind, "SELECTED");
		if (preferred.kind === "SELECTED") assert.equal(preferred.routeId, id("route-b"));
		const relaxed = selectRoute({
			poolId: "implementation",
			candidates: [candidates[0]!],
			policy: policy({ diversityPreference: "prefer" }),
			diversity: { avoidRemoteModelIds: ["model-alpha"] },
			now: "2026-01-01T00:00:00.000Z",
		});
		assert.equal(relaxed.kind, "SELECTED");
		if (relaxed.kind === "SELECTED") assert.equal(relaxed.diversityStatus, "preferred-conflict");
	});

	it("[U][fixture-v1] required diversity is a hard gate and uses explicit resource identity", () => {
		const candidates = [candidate("route-a", 0, { resourceId: id("resource-a"), underlyingFamily: "same" }), candidate("route-b", 1, { resourceId: id("resource-b"), underlyingFamily: "same" })];
		const decision = selectRoute({
			poolId: "implementation",
			candidates,
			policy: policy({ diversityPreference: "require-different-resource" }),
			diversity: { avoidResourceIds: [id("resource-a")] },
			now: "2026-01-01T00:00:00.000Z",
		});
		assert.equal(decision.kind, "SELECTED");
		if (decision.kind === "SELECTED") assert.equal(decision.routeId, id("route-b"));
		const sameModelExcluded = selectRoute({
			poolId: "implementation",
			candidates,
			policy: policy({ diversityPreference: "require" }),
			diversity: { avoidRemoteModelIds: ["model-route-a", "model-route-b"] },
			now: "2026-01-01T00:00:00.000Z",
		});
		assert.equal(sameModelExcluded.kind, "NO_ELIGIBLE_ROUTE");
	});

	it("[U][fixture-v1] classification is structured, conservative, and does not leak provider text", () => {
		assert.equal(classifyFailure({ status: 429 }).class, "rate_limited");
		assert.equal(classifyFailure({ status: 429, code: "quota_exhausted", message: "Bearer SECRET_SENTINEL" }).class, "quota_exhausted");
		assert.equal(classifyFailure({ cancelled: true, message: "secret" }).class, "cancelled");
		assert.equal(classifyFailure({ status: 400 }).class, "invalid_request");
		const unknown = classifyFailure({ message: "Bearer SECRET_SENTINEL" });
		assert.equal(unknown.class, "unknown");
		assert.equal(unknown.safeMessage.includes("SECRET_SENTINEL"), false);
	});

	it("[U][fixture-v1] failure actions bound retries and stop for cancellation/invalid/unknown", () => {
		const timeout = classifyFailure({ timeout: true });
		assert.equal(decideFailureAction({ classification: timeout, retryCount: 0, maxSameRouteRetries: 1, fallbackEnabled: true }), "RETRY_SAME_ROUTE");
		assert.equal(decideFailureAction({ classification: timeout, retryCount: 1, maxSameRouteRetries: 1, fallbackEnabled: true }), "FALLBACK_NEXT_ROUTE");
		assert.equal(decideFailureAction({ classification: classifyFailure({ cancelled: true }), retryCount: 0, maxSameRouteRetries: 5, fallbackEnabled: true }), "STOP");
		assert.equal(decideFailureAction({ classification: classifyFailure({ status: 400 }), retryCount: 0, maxSameRouteRetries: 5, fallbackEnabled: true }), "STOP");
		assert.equal(decideFailureAction({ classification: classifyFailure({}), retryCount: 0, maxSameRouteRetries: 5, fallbackEnabled: true }), "STOP");
	});

	it("[U][fixture-v1] attempt chains prevent repeated failed routes and preserve retry counts", () => {
		let chain = createAttemptChain("implementation", "2026-01-01T00:00:00.000Z");
		const failure = classifyFailure({ status: 429 });
		chain = recordAttempt(chain, id("route-a"), failure);
		assert.equal(nextAfterFailure(chain, failure, policy()), "RETRY_SAME_ROUTE");
		chain = recordAttempt(chain, id("route-a"), failure);
		assert.equal(nextAfterFailure(chain, failure, policy()), "FALLBACK_NEXT_ROUTE");
		const decision = previewRouting({
			poolId: "implementation",
			candidates: [candidate("route-a", 0), candidate("route-b", 1)],
			policy: policy(),
			now: "2026-01-01T00:00:00.000Z",
			attemptedRouteIds: chain.attemptedRouteIds,
		});
		assert.equal(decision.kind, "SELECTED");
		if (decision.kind === "SELECTED") assert.equal(decision.routeId, id("route-b"));
	});

	it("[U][fixture-v1] fake failure executor follows exact retry/fallback order without reordering the pool", () => {
		const pool = [
			candidate("route-a", 0),
			candidate("route-b", 1),
			candidate("route-c", 2, { globalEnabled: false }),
			candidate("route-d", 3),
		];
		const attempts: string[] = [];
		let chain = createAttemptChain("implementation", "2026-01-01T00:00:00.000Z");
		const choose = () => {
			const decision = selectRoute({
				poolId: "implementation",
				candidates: pool,
				policy: policy(),
				now: "2026-01-01T00:00:00.000Z",
				attemptedRouteIds: chain.attemptedRouteIds,
			});
			assert.equal(decision.kind, "SELECTED");
			if (decision.kind !== "SELECTED") throw new Error("fake executor expected a route");
			return decision.routeId;
		};
		const rate = classifyFailure({ status: 429 });
		const timeout = classifyFailure({ timeout: true });
		let route = choose();
		attempts.push(route);
		chain = recordAttempt(chain, route, rate);
		assert.equal(nextAfterFailure(chain, rate, policy()), "RETRY_SAME_ROUTE");
		attempts.push(route);
		chain = recordAttempt(chain, route, rate);
		pool[0] = { ...pool[0]!, health: { cooldownUntil: "2026-01-01T00:01:00.000Z", cooldownReason: "rate_limited" } };
		assert.equal(nextAfterFailure(chain, rate, policy()), "FALLBACK_NEXT_ROUTE");
		route = choose();
		assert.equal(route, id("route-b"));
		attempts.push(route);
		chain = recordAttempt(chain, route, timeout);
		assert.equal(nextAfterFailure(chain, timeout, policy()), "RETRY_SAME_ROUTE");
		attempts.push(route);
		chain = recordAttempt(chain, route, timeout);
		pool[1] = { ...pool[1]!, health: { cooldownUntil: "2026-01-01T00:01:00.000Z", cooldownReason: "timeout" } };
		assert.equal(nextAfterFailure(chain, timeout, policy()), "FALLBACK_NEXT_ROUTE");
		route = choose();
		assert.equal(route, id("route-d"));
		attempts.push(route);
		assert.deepEqual(attempts, [id("route-a"), id("route-a"), id("route-b"), id("route-b"), id("route-d")]);
		assert.deepEqual(pool.map((entry) => entry.routeId), [id("route-a"), id("route-b"), id("route-c"), id("route-d")]);
	});
});
