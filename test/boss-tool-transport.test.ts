import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { StableId } from "../src/core/config/types.js";
import {
	BOSS_DECISION_TOOL_NAME,
	BOSS_DECISION_TOOL_SCHEMA,
	bossInfrastructureError,
	createBossDecisionTool,
	extractBossAssistantText,
	parseBossAssistantResponse,
} from "../src/core/mission/boss-response.js";
import {
	BOSS_SYSTEM_PROMPT,
	bossInferencePrompt,
} from "../src/core/mission/boss-prompt.js";
import {
	BossInfrastructureError,
	BossProtocolError,
	formatBossLoopDiagnostics,
	normalizeBossDecision,
	runMissionGoalLoop,
	type BossDecision,
	type BossRouteCandidate,
	type BossTaskSpec,
} from "../src/core/mission/boss.js";
import { createMissionStore } from "../src/core/mission/index.js";
import { QualityService } from "../src/core/quality/index.js";
import type { TaskRecord } from "../src/core/mission/types.js";

const passVerify = (store: ReturnType<typeof createMissionStore>, missionId: string, criterion = "verified") => async (task: TaskRecord) => {
	const quality = new QualityService(store);
	const attemptId = store.getTask(task.taskId)?.lastRunId;
	assert.ok(attemptId);
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

const VALID_DECISION: BossDecision = {
	action: "dispatch",
	summary: "create bounded investigation task",
	tasks: [{
		taskId: "inspect-state",
		roleId: "investigator",
		executionClass: "investigation",
		poolId: "investigation",
		objective: "inspect repository canonical state",
		acceptanceCriteria: ["canonical state is documented"],
	}],
};

const route = (routeId: string, weight = 1): BossRouteCandidate => ({
	routeId: routeId as StableId,
	enabled: true,
	weight,
	thinkingEffort: "auto",
	remoteModelId: `${routeId}-remote`,
});

const assistantMsg = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	role: "assistant",
	content: [],
	api: "openai-completions",
	provider: "custom",
	model: "fixture-model",
	usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: 1,
	...overrides,
});

describe("RC29 Enforced Boss Decision Transport", () => {
	// 1. valid submit_boss_decision toolCall -> BossDecision
	it("parses valid submit_boss_decision toolCall into a canonical BossDecision", () => {
		const msg = assistantMsg({
			stopReason: "toolUse",
			content: [{
				type: "toolCall",
				id: "call-1",
				name: BOSS_DECISION_TOOL_NAME,
				arguments: VALID_DECISION,
			}],
		});
		const decision = parseBossAssistantResponse(msg, { phase: "plan" });
		assert.equal(decision.action, "dispatch");
		assert.equal(decision.summary, "create bounded investigation task");
		assert.equal(decision.tasks.length, 1);
		assert.equal(decision.tasks[0]!.roleId, "investigator");
	});

	// 2. toolCall arguments still pass normalizeBossDecision
	it("validates toolCall arguments against normalizeBossDecision strictly", () => {
		const msg = assistantMsg({
			stopReason: "toolUse",
			content: [{
				type: "toolCall",
				id: "call-1",
				name: BOSS_DECISION_TOOL_NAME,
				arguments: { action: "dispatch", summary: "empty plan", tasks: [] },
			}],
		});
		assert.throws(
			() => parseBossAssistantResponse(msg, { phase: "plan" }),
			(err) => err instanceof BossProtocolError && /dispatch requires at least one actionable task/u.test(err.message),
		);
	});

	// 3. hidden thinking ignored
	it("ignores thinking blocks when toolCall is present", () => {
		const msg = assistantMsg({
			stopReason: "toolUse",
			content: [
				{ type: "thinking", thinking: "hidden chain of thought" },
				{ type: "toolCall", id: "call-1", name: BOSS_DECISION_TOOL_NAME, arguments: VALID_DECISION },
			],
		});
		const decision = parseBossAssistantResponse(msg, { phase: "plan" });
		assert.equal(decision.action, "dispatch");
		assert.equal(decision.summary, VALID_DECISION.summary);
	});

	// 4. trailing assistant prose ignored when valid toolCall exists
	it("ignores trailing prose commentary when a valid toolCall is present", () => {
		const msg = assistantMsg({
			stopReason: "toolUse",
			content: [
				{ type: "toolCall", id: "call-1", name: BOSS_DECISION_TOOL_NAME, arguments: VALID_DECISION },
				{ type: "text", text: "-> skipped: multi-phase planning, add when needed" },
			],
		});
		const decision = parseBossAssistantResponse(msg, { phase: "plan" });
		assert.equal(decision.action, "dispatch");
		assert.equal(decision.summary, VALID_DECISION.summary);
	});

	// 5. no toolCall + valid legacy text JSON -> compatibility success
	it("accepts valid strict text JSON for compatibility when no toolCall exists", () => {
		const msg = assistantMsg({
			stopReason: "stop",
			content: [{ type: "text", text: JSON.stringify(VALID_DECISION) }],
		});
		const decision = parseBossAssistantResponse(msg, { phase: "plan" });
		assert.equal(decision.action, "dispatch");
		assert.equal(decision.summary, VALID_DECISION.summary);
	});

	// 6. worksheet JSON from real Gemini reproduction -> rejected
	it("rejects real Gemini worksheet-shaped JSON that omits action/summary/roleId", () => {
		const worksheetText = JSON.stringify({
			tasks: [{
				taskId: "inspect-canonical-project-state",
				description: "Inspect canonical project-state files",
				acceptanceCriteria: ["inspect only"],
			}],
		});
		const msg = assistantMsg({
			stopReason: "stop",
			content: [{ type: "text", text: `\`\`\`json\n${worksheetText}\n\`\`\`\n-> skipped: multi-phase planning` }],
		});
		assert.throws(
			() => parseBossAssistantResponse(msg, { phase: "plan" }),
			(err) => err instanceof BossProtocolError && /Boss decision action is invalid/u.test(err.message),
		);
	});

	// 7. missing action -> precise failure
	it("reports precise failure when action is missing from tool arguments or text", () => {
		const msg = assistantMsg({
			stopReason: "toolUse",
			content: [{
				type: "toolCall",
				id: "call-1",
				name: BOSS_DECISION_TOOL_NAME,
				arguments: { summary: "no action", tasks: [] },
			}],
		});
		assert.throws(
			() => parseBossAssistantResponse(msg, { phase: "plan" }),
			(err) => err instanceof BossProtocolError && /Boss decision action is invalid/u.test(err.message),
		);
	});

	// 8. missing summary -> precise failure
	it("reports precise failure when summary is missing from tool arguments", () => {
		const msg = assistantMsg({
			stopReason: "toolUse",
			content: [{
				type: "toolCall",
				id: "call-1",
				name: BOSS_DECISION_TOOL_NAME,
				arguments: { action: "dispatch", tasks: [{ roleId: "a", executionClass: "investigation", objective: "b" }] },
			}],
		});
		assert.throws(
			() => parseBossAssistantResponse(msg, { phase: "plan" }),
			(err) => err instanceof BossProtocolError && /Boss decision summary is missing/u.test(err.message),
		);
	});

	// 9. renamed description instead of objective -> rejected
	it("rejects task with description instead of objective", () => {
		const msg = assistantMsg({
			stopReason: "toolUse",
			content: [{
				type: "toolCall",
				id: "call-1",
				name: BOSS_DECISION_TOOL_NAME,
				arguments: {
					action: "dispatch",
					summary: "planning",
					tasks: [{ roleId: "a", executionClass: "investigation", description: "renamed objective" }],
				},
			}],
		});
		assert.throws(
			() => parseBossAssistantResponse(msg, { phase: "plan" }),
			(err) => err instanceof BossProtocolError && /Boss task plan is invalid/u.test(err.message),
		);
	});

	// 10. tool transport unavailable / no text -> capability/infrastructure classification
	it("classifies missing tool and empty text as infrastructure empty_response", () => {
		const msg = assistantMsg({
			stopReason: "stop",
			content: [],
		});
		assert.throws(
			() => parseBossAssistantResponse(msg, { phase: "plan", routeId: "gemini" }),
			(err) => err instanceof BossInfrastructureError,
		);
	});

	// 11. capability failure may fallback to another eligible Boss
	it("falls back to another eligible Boss on capability/infrastructure failure", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-cap-fallback-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "cap-fallback", goal: "recover from missing tool transport", acceptanceCriteria: ["recovered"] });
			const calls: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				schedulingKey: "boss-a",
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async ({ assignment, phase }) => {
					calls.push(`${phase}:${assignment.routeId}`);
					if (assignment.routeId === "boss-a") {
						throw bossInfrastructureError("Boss response contained no assistant text", {
							stage: "response",
							failureClass: "empty_response",
							hasText: false,
							normalized: false,
							routeId: assignment.routeId,
						});
					}
					if (phase === "evaluate") return { action: "complete", summary: "done", tasks: [], acceptanceSatisfied: true };
					return VALID_DECISION;
				},
				dispatch: succeedDispatch(store),
				verify: passVerify(store, String(mission.missionId), "canonical state is documented"),
				maxCycles: 2,
			});
			assert.equal(result.terminal, "COMPLETED");
			assert.deepEqual(calls, ["plan:boss-a", "plan:boss-b", "evaluate:boss-b"]);
			assert.equal(result.assignment?.routeId, "boss-b");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	// 12. semantic protocol failure does NOT infrastructure-fallback
	it("does not fallback to another Boss on semantic protocol failure", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-proto-nofallback-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "proto-nofallback", goal: "pin the same boss despite protocol error" });
			const calls: string[] = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				schedulingKey: "boss-a",
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async ({ assignment }) => {
					calls.push(assignment.routeId);
					throw new BossProtocolError("Boss decision action is invalid");
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "no dispatch" }),
				verify: async () => ({ verdict: "blocked", summary: "no verify" }),
				maxCycles: 3,
			});
			assert.equal(result.status, "awaiting-review");
			assert.equal(result.terminal, "AWAITING_USER");
			assert.deepEqual([...new Set(calls)], ["boss-a"]);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	// 13. repeated identical protocol fingerprint terminates early rather than blindly repeating
	it("detects repeated identical protocol fingerprint and terminates without consuming unbounded cycles", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-fingerprint-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "repeated-fingerprint", goal: "stop after identical protocol failures" });
			let cyclesRun = 0;
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1)],
				invoke: async () => {
					cyclesRun += 1;
					throw new BossProtocolError("Boss decision action is invalid");
				},
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "no" }),
				verify: async () => ({ verdict: "blocked", summary: "no" }),
				maxCycles: 8,
			});
			assert.equal(result.terminal, "AWAITING_USER");
			assert.ok(cyclesRun <= 4, `expected <= 4 cycles before repeated-fingerprint stop, ran ${cyclesRun}`);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	// 14. cancellation preserved
	it("preserves cancellation without dispatch or fallback", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-cancel-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "cancel-test", goal: "cancel during planning" });
			const controller = new AbortController();
			controller.abort();
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1), route("boss-b", 1)],
				signal: controller.signal,
				invoke: async () => VALID_DECISION,
				dispatch: async (task) => ({ taskId: String(task.taskId), status: "failed", summary: "must not run" }),
				verify: async () => ({ verdict: "blocked", summary: "must not verify" }),
				maxCycles: 2,
			});
			assert.equal(result.terminal, "CANCELLED");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	// 15. SAFETY_STOP preserved
	it("preserves SAFETY_STOP when security policy stops execution", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-safety-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "safety-test", goal: "protected path safety check" });
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				entries: [route("boss-a", 1)],
				invoke: async () => VALID_DECISION,
				dispatch: async () => {
					const err = new Error("access denied to credential path");
					Object.assign(err, { code: "CREDENTIAL_PATH" });
					throw err;
				},
				verify: async () => ({ verdict: "blocked", summary: "no" }),
				maxCycles: 2,
			});
			assert.equal(result.terminal, "SAFETY_STOP");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	// 16. no raw completion/reasoning persistence in feedback
	it("ensures corrective feedback does not persist raw completion or reasoning", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-clean-feedback-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "clean-feedback", goal: "check feedback contents", acceptanceCriteria: ["checked"] });
			let observedFeedback: unknown;
			await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				schedulingKey: "boss-a",
				entries: [route("boss-a", 1)],
				invoke: async (request) => {
					if (request.cycle === 1 && request.phase === "plan") {
						observedFeedback = request.feedback;
						return VALID_DECISION;
					}
					if (request.cycle === 1 && request.phase === "evaluate") {
						return { action: "complete", summary: "done", tasks: [], acceptanceSatisfied: true };
					}
					throw new BossProtocolError("Boss decision action is invalid");
				},
				dispatch: succeedDispatch(store),
				verify: passVerify(store, String(mission.missionId), "canonical state is documented"),
				maxCycles: 3,
			});
			const serialized = JSON.stringify(observedFeedback ?? {});
			assert.ok(!serialized.includes("rawCompletion"));
			assert.ok(!serialized.includes("thinking"));
			assert.match(serialized, /action is invalid/u);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	// 17. one Boss remains pinned after successful fallback
	it("keeps replacement Boss pinned across cycles after fallback", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc29-pin-after-fallback-"));
		try {
			const store = createMissionStore({ root });
			const mission = store.createMission({ missionId: "pin-fallback", goal: "pin the replacement", acceptanceCriteria: ["pinned"] });
			const calls: Array<{ cycle: number; routeId: string }> = [];
			const result = await runMissionGoalLoop({
				store,
				missionId: mission.missionId,
				schedulingKey: "boss-a",
				entries: [route("boss-a", 1), route("boss-b", 1)],
				invoke: async (request) => {
					calls.push({ cycle: request.cycle, routeId: request.assignment.routeId });
					if (request.assignment.routeId === "boss-a") {
						throw bossInfrastructureError("Boss response contained no assistant text", {
							stage: "response",
							failureClass: "empty_response",
							hasText: false,
							normalized: false,
							routeId: request.assignment.routeId,
						});
					}
					if (request.phase === "evaluate") return { action: "complete", summary: "done", tasks: [], acceptanceSatisfied: true };
					return VALID_DECISION;
				},
				dispatch: succeedDispatch(store),
				verify: passVerify(store, String(mission.missionId), "canonical state is documented"),
				maxCycles: 3,
			});
			assert.equal(result.terminal, "COMPLETED");
			const bossBCalls = calls.filter((c) => c.routeId === "boss-b");
			assert.ok(bossBCalls.length >= 2, "expected boss-b to be pinned for plan and evaluate");
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	// 18. tool definition exports and schema shape
	it("exports canonical BOSS_DECISION_TOOL_NAME and matching JSON schema", () => {
		assert.equal(BOSS_DECISION_TOOL_NAME, "submit_boss_decision");
		assert.equal(BOSS_DECISION_TOOL_SCHEMA.type, "object");
		assert.deepEqual(BOSS_DECISION_TOOL_SCHEMA.required, ["action", "summary", "tasks"]);
		const tool = createBossDecisionTool();
		assert.equal(tool.name, BOSS_DECISION_TOOL_NAME);
		assert.equal(tool.constrainedSampling?.type, "json_schema");
	});
});
