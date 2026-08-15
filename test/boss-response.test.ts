import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BossInfrastructureError, BossProtocolError } from "../src/core/mission/boss.js";
import {
	bossInvocationDiagnostic,
	classifyBossRequestFailure,
	extractBossAssistantText,
	parseBossAssistantResponse,
	wrapBossRequestFailure,
} from "../src/core/mission/boss-response.js";

const DECISION = {
	action: "dispatch",
	summary: "create the first bounded task",
	tasks: [{
		roleId: "implementer",
		executionClass: "implementation",
		poolId: "implementation",
		objective: "perform the bounded work",
		acceptanceCriteria: ["the change is documented"],
	}],
} as const;

const decisionText = JSON.stringify(DECISION);

const assistant = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	role: "assistant",
	content: [{ type: "text", text: decisionText }],
	api: "openai-completions",
	provider: "custom",
	model: "fixture-model",
	usage: { input: 11, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 18, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: 1,
	...overrides,
});

describe("RC28 Boss response normalization", () => {
	it("parses a normal Pi text JSON decision", () => {
		const decision = parseBossAssistantResponse(assistant(), { phase: "plan" });
		assert.equal(decision.action, "dispatch");
		assert.equal(decision.tasks.length, 1);
		assert.equal(decision.tokenUsage?.inputTokens, 11);
	});

	it("parses fenced JSON from the public text contract", () => {
		const decision = parseBossAssistantResponse(assistant({
			content: [{ type: "text", text: `\`\`\`json\n${decisionText}\n\`\`\`` }],
		}), { phase: "plan" });
		assert.equal(decision.summary, DECISION.summary);
	});

	it("ignores thinking blocks and uses only final assistant text", () => {
		const decision = parseBossAssistantResponse(assistant({
			content: [
				{ type: "thinking", thinking: "hidden chain of thought must never become the decision" },
				{ type: "text", text: decisionText },
			],
		}), { phase: "plan" });
		assert.equal(decision.action, "dispatch");
		assert.equal(extractBossAssistantText([{ type: "thinking", thinking: "hidden" }, { type: "text", text: "visible" }]).text, "visible");
		assert.equal(extractBossAssistantText([{ type: "thinking", thinking: "hidden" }, { type: "text", text: "visible" }]).thinkingBlocks, 1);
	});

	it("accepts Pi length stopReason when final text is a complete decision", () => {
		const decision = parseBossAssistantResponse(assistant({ stopReason: "length" }), { phase: "plan" });
		assert.equal(decision.action, "dispatch");
	});

	it("classifies truncated max-token output with no complete decision", () => {
		try {
			parseBossAssistantResponse(assistant({ stopReason: "length", content: [{ type: "thinking", thinking: "still reasoning" }] }), { phase: "plan" });
			assert.fail("expected truncated protocol error");
		} catch (error) {
			assert.equal(error instanceof BossProtocolError, true);
			assert.match((error as Error).message, /max_tokens with no complete decision/u);
			assert.equal(bossInvocationDiagnostic(error)?.failureClass, "truncated");
			assert.equal(bossInvocationDiagnostic(error)?.stage, "response");
			assert.equal(bossInvocationDiagnostic(error)?.hasText, false);
		}
	});

	it("reproduces the RC27 Cursor empty-response dogfood shape", () => {
		try {
			parseBossAssistantResponse(assistant({
				stopReason: "stop",
				content: [{ type: "thinking", thinking: "internal notes with no user-visible decision" }],
			}), { phase: "plan", routeId: "cu/cursor-grok-4.6-high", remoteModelId: "cu/cursor-grok-4.6-high" });
			assert.fail("expected empty-response protocol error");
		} catch (error) {
			assert.equal(error instanceof BossProtocolError, true);
			assert.equal((error as Error).message, "Boss response contained no assistant text");
			assert.equal(bossInvocationDiagnostic(error)?.failureClass, "empty_response");
			assert.equal(bossInvocationDiagnostic(error)?.stopReason, "stop");
			assert.equal(bossInvocationDiagnostic(error)?.hasText, false);
			assert.equal(bossInvocationDiagnostic(error)?.routeId, "cu/cursor-grok-4.6-high");
		}
	});

	it("classifies malformed decisions as protocol without weakening schema validation", () => {
		try {
			parseBossAssistantResponse(assistant({ content: [{ type: "text", text: '{"action":"dispatch","summary":"x","tasks":[]}' }] }), { phase: "plan" });
			assert.fail("expected protocol error");
		} catch (error) {
			assert.equal(error instanceof BossProtocolError, true);
			assert.match((error as Error).message, /dispatch requires at least one actionable task/u);
			assert.equal(bossInvocationDiagnostic(error)?.stage, "decision-protocol");
			assert.equal(bossInvocationDiagnostic(error)?.failureClass, "decision_protocol");
		}
	});

	it("classifies transport throws as infrastructure request failures", () => {
		const failure = new Error("socket hang up");
		(failure as Error & { code?: string }).code = "ECONNRESET";
		try {
			wrapBossRequestFailure(failure, { routeId: "tabi-route" });
		} catch (error) {
			assert.equal(error instanceof BossInfrastructureError, true);
			assert.match((error as Error).message, /Boss request failed: transport_error/u);
			assert.equal(bossInvocationDiagnostic(error)?.stage, "request");
			assert.equal(bossInvocationDiagnostic(error)?.failureClass, "transport_error");
			return;
		}
		assert.fail("expected wrap to throw");
	});

	it("classifies authentication and model-unavailable failures without persisting provider text", () => {
		const auth = classifyBossRequestFailure(Object.assign(new Error("401 unauthorized Bearer sk-ant-api03-not-a-real-secret"), { status: 401 }));
		assert.equal(auth.failureClass, "authentication_failed");
		const unavailable = parseBossAssistantResponse.bind(undefined, assistant({
			stopReason: "error",
			errorMessage: "model_not_found: Tabi/claude-opus-5-thinking",
			rawStopReason: "model_not_found",
			content: [],
		}), { phase: "plan", routeId: "tabi-route", remoteModelId: "Tabi/claude-opus-5-thinking" });
		try {
			unavailable();
			assert.fail("expected infrastructure error");
		} catch (error) {
			assert.equal(error instanceof BossInfrastructureError, true);
			assert.match((error as Error).message, /Boss request failed: model_unavailable/u);
			assert.doesNotMatch(JSON.stringify(bossInvocationDiagnostic(error)), /sk-ant|Bearer|authorization/u);
			assert.equal(bossInvocationDiagnostic(error)?.stage, "response");
		}
	});

	it("treats aborted completions as cancellation", () => {
		try {
			parseBossAssistantResponse(assistant({ stopReason: "aborted", content: [] }));
			assert.fail("expected abort");
		} catch (error) {
			assert.equal((error as Error).name, "AbortError");
		}
	});
});
