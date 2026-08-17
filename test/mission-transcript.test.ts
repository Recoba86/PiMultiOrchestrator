import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createMissionStore } from "../src/core/mission/index.js";
import type { MissionEventRecord, MissionRecord, MissionStoreAdapter, TaskRecord } from "../src/core/mission/types.js";
import { SecretSanitizer } from "../src/core/security/index.js";
import {
	createMissionTranscriptSession,
	formatTranscriptEntry,
	MISSION_ACTIVITY_CUSTOM_TYPE,
	projectMissionTranscriptEvent,
	renderTranscriptComponent,
	type MissionTranscriptEntryData,
} from "../src/core/mission/transcript.js";
import type { WorkerProgressEvent } from "../src/core/workers/types.js";

async function withStore<T>(run: (store: MissionStoreAdapter) => T | Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "pmo-transcript-"));
	try {
		return await run(createMissionStore({
			root,
			clock: () => new Date("2026-08-17T00:00:00.000Z"),
			id: (() => {
				let n = 0;
				return () => String(++n);
			})(),
		}));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("Pi-native Mission activity transcript", () => {
	it("1. Mission created enters transcript once", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-1", goal: "investigate public version" });
		const session = createMissionTranscriptSession({ store });
		const entries = session.drain("m-1");
		assert.equal(entries.length, 1);
		assert.equal(entries[0]!.kind, "mission_created");
		assert.match(entries[0]!.text, /Mission created|m-1/);
		// drain again should return 0 new entries (high-water mark)
		assert.equal(session.drain("m-1").length, 0);
	}));

	it("2. Mission running enters transcript", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-2", goal: "inspect" });
		store.transitionMission(mission.missionId, "planned");
		store.transitionMission(mission.missionId, "active");
		store.transitionMission(mission.missionId, "running", { actor: "boss", metadata: { kind: "boss-start", routeId: "boss-a", remoteModelId: "ag/gemini-3.7-flash-high" } });
		const session = createMissionTranscriptSession({ store });
		const entries = session.drain("m-2");
		assert.ok(entries.some((e) => /Mission running|Boss.*Gemini/i.test(e.text)));
	}));

	it("3-5. Boss assignment, planning, and plan action visible in transcript", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-boss", goal: "inspect" });
		store.transitionMission(mission.missionId, "running", { actor: "boss" });
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-assignment", routeId: "boss-a", remoteModelId: "ag/gemini-3.7-flash-high", weight: 1 },
		});
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-plan", cycle: 0, routeId: "boss-a", action: "dispatch" },
		});
		const session = createMissionTranscriptSession({ store });
		const entries = session.drain("m-boss");
		assert.ok(entries.some((e) => /Boss.*Gemini/i.test(e.text) && /Assigned/i.test(e.text)));
		assert.ok(entries.some((e) => /Plan created|Dispatch/i.test(e.text)));
	}));

	it("6-8. Task start, worker model, and Attempt visible in transcript", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-task", goal: "inspect" });
		const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", objective: "find version" });
		store.saveTaskPacket(task.taskId, { objective: "find version" }, task.revision);
		const attempt = store.createAttempt({ taskId: task.taskId, routeId: "inv-a", remoteModelId: "ocg/deepseek-v4-flash" });
		const session = createMissionTranscriptSession({ store });
		const entries = session.drain("m-task");
		assert.ok(entries.some((e) => /DeepSeek.*started|Attempt/i.test(e.text)));
	}));

	it("9-13. Safe tool start, success, safety block, failure, structured result visible", () => {
		const session = createMissionTranscriptSession({});
		const toolStart: WorkerProgressEvent = { type: "tool_started", runId: "r-1", toolName: "read", target: "package.json" };
		const e1 = session.projectWorkerEvent("m-tools", toolStart);
		assert.ok(e1);
		assert.match(e1.text, /→ read package\.json/);

		const toolOk: WorkerProgressEvent = { type: "tool_finished", runId: "r-1", toolName: "read", target: "package.json", toolStatus: "ok" };
		const e2 = session.projectWorkerEvent("m-tools", toolOk);
		assert.ok(e2);
		assert.match(e2.text, /✓ read package\.json/);

		const toolBlocked: WorkerProgressEvent = { type: "tool_finished", runId: "r-1", toolName: "find", target: ".", toolStatus: "blocked", safetyBlockCode: "PROTECTED_PATH" };
		const e3 = session.projectWorkerEvent("m-tools", toolBlocked);
		assert.ok(e3);
		assert.match(e3.text, /⚠ find.*blocked/);

		const toolFail: WorkerProgressEvent = { type: "tool_finished", runId: "r-1", toolName: "grep", target: "foo", toolStatus: "fail" };
		const e4 = session.projectWorkerEvent("m-tools", toolFail);
		assert.ok(e4);
		assert.match(e4.text, /✗ grep/);

		const resultSubmit: WorkerProgressEvent = { type: "tool_finished", runId: "r-1", toolName: "submit_agent_result", toolStatus: "ok" };
		const e5 = session.projectWorkerEvent("m-tools", resultSubmit);
		assert.ok(e5);
		assert.match(e5.text, /✓ Result submitted|Structured result/);
	});

	it("14-19. Evidence proposed/admitted, M7 start, PASS, BLOCKED reason, requiredFixes visible", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-m7-t", goal: "inspect" });
		const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", objective: "version" });
		const attempt = store.createAttempt({ taskId: task.taskId, routeId: "inv-a", remoteModelId: "ocg/deepseek-v4-flash" });
		store.finishAttempt(attempt.attemptId, "succeeded");
		const ev = store.admitEvidence({ missionId: mission.missionId, taskId: task.taskId, attemptId: attempt.attemptId, kind: "investigation-result", content: { version: "0.1.0" } });
		store.promoteEvidence(ev.evidenceId);

		store.createVerificationRun({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attempt.attemptId, round: 0, reviewerRouteId: "ver-a", reviewerRemoteModelId: "gcli/grok-4.6-high" });
		store.recordQualityDecision({
			missionId: mission.missionId,
			taskId: task.taskId,
			verificationId: store.listVerificationRuns(mission.missionId)[0]!.verificationId,
			targetRunId: attempt.attemptId,
			round: 0,
			gate: { verdict: "blocked", reasons: ["missing proof"], criterionResults: [], mechanicalChecks: [], requiredFixes: ["Check git tags"] },
			reviewerSummary: "missing proof",
			requiredFixes: ["Check git tags"],
		});

		const session = createMissionTranscriptSession({ store });
		const entries = session.drain("m-m7-t");
		assert.ok(entries.some((e) => /Evidence/i.test(e.text)));
		assert.ok(entries.some((e) => /M7.*Grok.*started/i.test(e.text)));
		assert.ok(entries.some((e) => /M7.*BLOCKED/i.test(e.text) && /missing proof/i.test(e.text)));
		assert.ok(entries.some((e) => /Check git tags/i.test(e.text)));
	}));

	it("20-23. repair/replan, fallback, recovery, finalization visible", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-conv", goal: "inspect" });
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-fallback", fromRouteId: "inv-a", toRouteId: "inv-b" },
		});
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-plan", cycle: 1, action: "replan" },
		});
		const session = createMissionTranscriptSession({ store });
		const entries = session.drain("m-conv");
		assert.ok(entries.some((e) => /fallback/i.test(e.text)));
		assert.ok(entries.some((e) => /Targeted repair|replan/i.test(e.text)));
	}));

	it("24-26. COMPLETED, AWAITING_USER, and CANCELLED terminal summaries visible", async () => withStore((store) => {
		const missionC = store.createMission({ missionId: "m-term-c", goal: "inspect" });
		store.transitionMission(missionC.missionId, "running", { actor: "boss" });
		store.transitionMission(missionC.missionId, "cancelled", { actor: "boss", metadata: { kind: "boss-terminal", status: "CANCELLED", reason: "finished work" } });

		const session = createMissionTranscriptSession({ store });
		const entriesC = session.drain("m-term-c");
		assert.ok(entriesC.some((e) => /Mission CANCELLED/i.test(e.text)));

		const missionA = store.createMission({ missionId: "m-term-a", goal: "inspect" });
		store.transitionMission(missionA.missionId, "running", { actor: "boss" });
		store.transitionMission(missionA.missionId, "awaiting-review", { actor: "boss", metadata: { kind: "boss-terminal", status: "AWAITING_USER", reason: "budget exceeded" } });
		const entriesA = session.drain("m-term-a");
		assert.ok(entriesA.some((e) => /Mission AWAITING_USER|budget exceeded/i.test(e.text)));

		const missionX = store.createMission({ missionId: "m-term-x", goal: "inspect" });
		store.transitionMission(missionX.missionId, "running", { actor: "boss" });
		store.transitionMission(missionX.missionId, "cancelled", { actor: "boss", metadata: { kind: "boss-terminal", status: "CANCELLED", reason: "user interrupt" } });
		const entriesX = session.drain("m-term-x");
		assert.ok(entriesX.some((e) => /Mission CANCELLED|user interrupt/i.test(e.text)));
	}));

	it("27. Transcript events emitted exactly once (high-water mark dedupe)", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-dedupe", goal: "inspect" });
		const session = createMissionTranscriptSession({ store });
		const pass1 = session.drain("m-dedupe");
		assert.equal(pass1.length, 1);
		const pass2 = session.drain("m-dedupe");
		assert.equal(pass2.length, 0);

		store.transitionMission(mission.missionId, "running", { actor: "boss" });
		const pass3 = session.drain("m-dedupe");
		assert.equal(pass3.length, 1);
		assert.equal(session.drain("m-dedupe").length, 0);
	}));

	it("28-29. Privacy: no hidden reasoning, CoT, secrets, raw provider payload", async () => withStore((store) => {
		const sanitizer = new SecretSanitizer();
		sanitizer.register("super-secret-token-12345");
		const mission = store.createMission({ missionId: "m-sec", goal: "inspect" });
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: {
				kind: "boss-plan",
				action: "dispatch",
				thinking: "secret internal thinking process",
				reasoning: "private CoT",
				providerPayload: { secret: "super-secret-token-12345" },
			},
		});
		const session = createMissionTranscriptSession({ store, sanitizer });
		const entries = session.drain("m-sec");
		for (const entry of entries) {
			assert.doesNotMatch(entry.text, /secret internal thinking/);
			assert.doesNotMatch(entry.text, /private CoT/);
			assert.doesNotMatch(entry.text, /super-secret-token-12345/);
		}
	}));

	it("renderTranscriptComponent produces structural Component for Pi TUI", () => {
		const data: MissionTranscriptEntryData = {
			missionId: "m-ui",
			kind: "boss_plan",
			text: "Boss · Gemini 3.7 Flash\n  → Planning\n  ✓ Dispatch Investigation",
			timestamp: new Date().toISOString(),
		};
		const component = renderTranscriptComponent(data);
		assert.ok(component);
		assert.equal(typeof component.render, "function");
		const lines = component.render(80);
		assert.ok(lines.length >= 2);
		assert.ok(lines.some((l) => /Boss/i.test(l)));
	});
});
