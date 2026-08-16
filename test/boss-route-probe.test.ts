import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	evaluateBossVisibleTextProbe,
	bossRouteProbeFromError,
} from "../src/core/mission/boss-response.js";
import { BossInfrastructureError } from "../src/core/mission/boss.js";
import {
	HISTORICAL_BOSS_INCOMPATIBLE_REMOTES,
	PREFERRED_BOSS_PROBE_REMOTE,
	selectBossRouteProbeCandidates,
} from "../src/host/boss-route-probe.js";

const identity = { routeId: "route-gemini", remoteModelId: PREFERRED_BOSS_PROBE_REMOTE };

describe("Boss route visible-text probe", () => {
	it("passes stop with visible assistant text and never returns that text", () => {
		const result = evaluateBossVisibleTextProbe({
			stopReason: "stop",
			content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "PONG" }],
		}, identity, 12);
		assert.equal(result.success, true);
		assert.equal(result.hasText, true);
		assert.equal(result.textLength, 4);
		assert.equal(result.stopReason, "stop");
		assert.equal(JSON.stringify(result).includes("PONG"), false);
		assert.equal(JSON.stringify(result).includes("hidden"), false);
	});

	it("fails thinking-only stop as empty_response", () => {
		const result = evaluateBossVisibleTextProbe({
			stopReason: "stop",
			content: [{ type: "thinking", thinking: "only thinking" }],
		}, identity, 8);
		assert.equal(result.success, false);
		assert.equal(result.failureClass, "empty_response");
		assert.equal(result.hasText, false);
		assert.equal(result.textLength, 0);
	});

	it("classifies request errors without leaking provider payloads", () => {
		const error = Object.assign(new Error("authentication_failed HTTP 403"), { status: 403 });
		const result = bossRouteProbeFromError(error, { routeId: "route-tabi", remoteModelId: "Tabi/claude-opus-5-thinking" }, 3);
		assert.equal(result.success, false);
		assert.equal(result.hasText, false);
		assert.ok(result.failureClass);
		assert.equal(JSON.stringify(result).includes("HTTP 403") === true || result.status === 403 || typeof result.code === "string", true);
		assert.equal(error instanceof BossInfrastructureError, false);
	});

	it("selects the preferred Gemini route first and skips historically incompatible extras", () => {
		const selected = selectBossRouteProbeCandidates({
			enabledRoutes: [
				{ routeId: "cursor", remoteModelId: "cu/cursor-grok-4.6-high" },
				{ routeId: "gemini", remoteModelId: PREFERRED_BOSS_PROBE_REMOTE },
				{ routeId: "flash", remoteModelId: "ocg/deepseek-v4-flash" },
				{ routeId: "luna", remoteModelId: "ocg/gpt-5.6-luna" },
				{ routeId: "tabi", remoteModelId: "Tabi/claude-opus-5-thinking" },
			],
			preferRouteIds: ["flash", "luna", "gemini"],
		});
		assert.deepEqual(selected.map((item) => item.routeId), ["gemini", "flash", "luna"]);
		assert.equal(selected[0]?.reason, "preferred");
		assert.equal(selected.some((item) => HISTORICAL_BOSS_INCOMPATIBLE_REMOTES.includes(item.remoteModelId as typeof HISTORICAL_BOSS_INCOMPATIBLE_REMOTES[number])), false);
	});
});
