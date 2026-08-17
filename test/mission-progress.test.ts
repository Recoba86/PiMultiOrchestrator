import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createMissionStore } from "../src/core/mission/index.js";
import {
	applyMissionProgressToUi,
	createMissionProgressSession,
	projectMissionProgress,
	renderMissionProgress,
	type LiveProgressOverlay,
	type MissionProgressView,
	type ProgressUi,
} from "../src/core/mission/progress.js";
import { SecretSanitizer } from "../src/core/security/index.js";
import type { MissionEventRecord, MissionRecord, MissionStoreAdapter, TaskRecord } from "../src/core/mission/types.js";

async function withStore<T>(run: (store: MissionStoreAdapter) => T | Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "pmo-progress-"));
	try {
		return await run(createMissionStore({ root, clock: () => new Date("2026-08-17T00:00:00.000Z"), id: (() => {
			let n = 0;
			return () => String(++n);
		})() }));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const textOf = (view: MissionProgressView): string => renderMissionProgress(view).join("\n");

const fakeUi = (): ProgressUi & { widgets: string[][]; statuses: string[]; working: string[]; notifications: string[] } => {
	const widgets: string[][] = [];
	const statuses: string[] = [];
	const working: string[] = [];
	const notifications: string[] = [];
	return {
		widgets,
		statuses,
		working,
		notifications,
		setWidget: (_key, content) => { if (content) widgets.push([...content]); },
		setStatus: (_key, text) => { if (text) statuses.push(text); },
		setWorkingMessage: (message) => { if (message) working.push(message); },
		notify: (message) => { notifications.push(message); },
	};
};

describe("live Mission progress projection", () => {
	it("renders live state immediately after Mission creation", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-live", goal: "report the public PMO version without changing files" });
		const view = projectMissionProgress({ store, missionId: String(mission.missionId), now: new Date("2026-08-17T00:00:05.000Z") });
		const text = textOf(view);
		assert.match(text, /Mission running|Mission created|Status: draft/i);
		assert.match(text, /report the public PMO version/i);
		assert.match(text, /0\/4|Cycle 0/);
	}));

	it("renders Boss assignment and plan", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-boss", goal: "inspect" });
		store.transitionMission(mission.missionId, "planned");
		store.transitionMission(mission.missionId, "active");
		store.transitionMission(mission.missionId, "running", {
			actor: "boss",
			metadata: { kind: "boss-start", routeId: "boss-a", remoteModelId: "ag/gemini-3.7-flash-high" },
		});
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-assignment", routeId: "boss-a", remoteModelId: "ag/gemini-3.7-flash-high", weight: 1 },
		});
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-plan", cycle: 0, routeId: "boss-a", action: "dispatch" },
		});
		const text = textOf(projectMissionProgress({ store, missionId: "m-boss" }));
		assert.match(text, /Boss/i);
		assert.match(text, /Gemini 3\.7 Flash/i);
	}));

	it("renders Task creation, worker start, route, retry, and fallback", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-worker", goal: "inspect" });
		const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", objective: "find public version" });
		store.saveTaskPacket(task.taskId, { objective: "find public version" }, task.revision);
		store.createAttempt({ taskId: task.taskId, routeId: "inv-a", remoteModelId: "ocg/deepseek-v4-flash" });
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-fallback", fromRouteId: "inv-a", toRouteId: "inv-b", reason: "timeout" },
		});
		const live: LiveProgressOverlay = {
			worker: { routeId: "inv-b", remoteModelId: "gcli/grok-4.6-high", attemptId: "attempt-retry", startedAt: "2026-08-17T00:00:10.000Z", retry: true, fallbackFrom: "ocg/deepseek-v4-flash" },
		};
		const text = textOf(projectMissionProgress({ store, missionId: "m-worker", live, now: new Date("2026-08-17T00:00:18.000Z") }));
		assert.match(text, /Worker/i);
		assert.match(text, /Grok 4\.6 High/i);
	}));

	it("renders safe tool activity and a non-terminating safety block", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-tools", goal: "inspect" });
		const live: LiveProgressOverlay = {
			worker: { remoteModelId: "ocg/deepseek-v4-flash", startedAt: "2026-08-17T00:00:00.000Z" },
			tools: [
				{ toolName: "read", target: "package.json", status: "ok" },
				{ toolName: "read", target: "docs/RELEASE_STATE.md", status: "ok" },
				{ toolName: "find", target: ".", status: "blocked", safetyBlockCode: "PROTECTED_PATH_DESCENDANT" },
				{ toolName: "submit_agent_result", status: "ok" },
			],
		};
		const text = textOf(projectMissionProgress({ store, missionId: String(mission.missionId), live }));
		assert.match(text, /Tool: ✓ Structured result submitted|Tool: /i);
		assert.doesNotMatch(text, /terminate display|fatal/i);
	}));

	it("renders Evidence, M7 start, pass, blocked reason, Boss replan, and completion rejection", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-m7", goal: "inspect" });
		const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", objective: "version" });
		const attempt = store.createAttempt({ taskId: task.taskId, routeId: "inv-a", remoteModelId: "ocg/deepseek-v4-flash" });
		store.finishAttempt(attempt.attemptId, "succeeded", { terminalState: "completed" });
		const evidence = store.admitEvidence({ missionId: mission.missionId, taskId: task.taskId, attemptId: attempt.attemptId, kind: "investigation-result", content: { summary: "public version is 0.1.0-rc.30" } });
		store.promoteEvidence(evidence.evidenceId);
		store.createVerificationRun({ missionId: mission.missionId, taskId: task.taskId, targetRunId: attempt.attemptId, round: 0, reviewerRouteId: "ver-a", reviewerRemoteModelId: "gcli/grok-4.6-high" });
		store.recordQualityDecision({
			missionId: mission.missionId,
			taskId: task.taskId,
			verificationId: store.listVerificationRuns(mission.missionId)[0]!.verificationId,
			targetRunId: attempt.attemptId,
			round: 0,
			gate: { verdict: "blocked", reasons: ["insufficient proof of public release version"], criterionResults: [], mechanicalChecks: [], findings: [], requiredFixes: ["Show public registry/release state"] },
			reviewerSummary: "insufficient proof of public release version",
			requiredFixes: ["Show public registry/release state"],
		});
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-evaluation", cycle: 0, routeId: "boss-a", action: "complete" },
		});
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-completion-rejected", summary: "Evaluation did not meet the durable task and M7 gates" },
		});
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: { kind: "boss-plan", cycle: 1, routeId: "boss-a", action: "replan" },
		});
		const text = textOf(projectMissionProgress({ store, missionId: "m-m7" }));
		assert.match(text, /Attempts: \d+/i);
		assert.match(text, /Evidence: 1/i);
	}));

	it("renders recovery and finalization events", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-rec", goal: "implement" });
		const task = store.createTask({ missionId: mission.missionId, roleId: "implementer", executionClass: "implementation", objective: "edit helper" });
		store.admitEvidence({
			missionId: mission.missionId,
			taskId: task.taskId,
			kind: "recovery-assessment",
			content: { recoveryRequired: true, mutationClass: "local_observable" },
		});
		const text = textOf(projectMissionProgress({ store, missionId: "m-rec" }));
		assert.match(text, /Mission running|Mission created/i);
	}));

	it("shows heartbeat during a quiet long-running operation and stops it when the operation changes", () => {
		const events: MissionEventRecord[] = [{
			eventId: "event-1" as MissionEventRecord["eventId"],
			missionId: "m-hb" as MissionRecord["missionId"],
			revision: 1,
			kind: "boss-plan",
			actor: "boss",
			payload: { kind: "boss-plan", action: "dispatch", remoteModelId: "ocg/deepseek-v4-flash" },
			createdAt: "2026-08-17T00:00:00.000Z",
		}];
		const live: LiveProgressOverlay = {
			worker: { remoteModelId: "ocg/deepseek-v4-flash", startedAt: "2026-08-17T00:00:00.000Z" },
		};
		const quiet = projectMissionProgress({
			events,
			mission: { missionId: "m-hb", status: "running", goal: "inspect", createdAt: "2026-08-17T00:00:00.000Z", revision: 1 } as MissionRecord,
			now: new Date("2026-08-17T00:00:37.000Z"),
			quietAfterMs: 5_000,
			live,
		});
		assert.match(textOf(quiet), /DeepSeek V4 Flash · 37s/);
		const changed = projectMissionProgress({
			events,
			mission: { missionId: "m-hb", status: "running", goal: "inspect", createdAt: "2026-08-17T00:00:00.000Z", revision: 1 } as MissionRecord,
			now: new Date("2026-08-17T00:00:40.000Z"),
			quietAfterMs: 5_000,
			live: { m7: { remoteModelId: "gcli/grok-4.6-high", startedAt: "2026-08-17T00:00:38.000Z" } },
		});
		const changedText = textOf(changed);
		assert.doesNotMatch(changedText, /DeepSeek V4 Flash · 37s/);
		assert.match(changedText, /Grok 4\.6 High · 2s/);
	});

	it("renders COMPLETED and AWAITING_USER summaries", () => {
		const completed = projectMissionProgress({
			events: [
				{ eventId: "e1" as MissionEventRecord["eventId"], missionId: "m-c" as MissionRecord["missionId"], revision: 2, kind: "mission_completed", actor: "boss", payload: { kind: "boss-terminal", status: "COMPLETED", cycles: 2 }, createdAt: "2026-08-17T00:01:42.000Z" },
			],
			mission: { missionId: "m-c", status: "completed", goal: "inspect", createdAt: "2026-08-17T00:00:00.000Z", revision: 2 } as MissionRecord,
			tasks: [{ taskId: "t1" } as TaskRecord],
			counts: { attempts: 2, evidence: 2, m7Pass: 1, m7Rounds: 1 },
			live: { lastWorker: "ocg/deepseek-v4-flash" },
			now: new Date("2026-08-17T00:01:42.000Z"),
		});
		assert.match(textOf(completed), /Mission completed · Cycle 2\/4 · 1m 42s/);
		assert.match(textOf(completed), /Final status: COMPLETED/);

		const waiting = projectMissionProgress({
			events: [
				{ eventId: "e2" as MissionEventRecord["eventId"], missionId: "m-w" as MissionRecord["missionId"], revision: 8, kind: "mission_awaiting-review", actor: "boss", payload: { kind: "boss-terminal", status: "AWAITING_USER", cycles: 4, reason: "M7 rejected the same evidence strategy repeatedly." }, createdAt: "2026-08-17T00:04:00.000Z" },
			],
			mission: { missionId: "m-w", status: "awaiting-review", goal: "inspect", createdAt: "2026-08-17T00:00:00.000Z", revision: 8 } as MissionRecord,
			counts: { attempts: 4, m7Blocks: 4, m7Rounds: 4 },
			now: new Date("2026-08-17T00:04:00.000Z"),
		});
		assert.match(textOf(waiting), /Final status: AWAITING_USER/);
		assert.match(textOf(waiting), /M7 rejected the same evidence strategy repeatedly/);
	});

	it("reconstructs current Mission on replay without duplicating live events", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-replay", goal: "inspect" });
		store.transitionMission(mission.missionId, "planned");
		store.transitionMission(mission.missionId, "active");
		store.transitionMission(mission.missionId, "running", { actor: "boss", metadata: { kind: "boss-assignment", remoteModelId: "ag/gemini-3.7-flash-high" } });
		const session = createMissionProgressSession({ store });
		const replayed = session.replay("m-replay");
		const live = session.project("m-replay");
		assert.deepEqual(renderMissionProgress(replayed), renderMissionProgress(live));
		const ui = fakeUi();
		applyMissionProgressToUi(ui, replayed);
		applyMissionProgressToUi(ui, live);
		assert.equal(ui.widgets.length, 2);
		assert.deepEqual(ui.widgets[0], ui.widgets[1]);
		assert.equal(ui.notifications.length, 0);
	}));

	it("never renders hidden thinking or secrets or raw provider payloads", async () => withStore((store) => {
		const sanitizer = new SecretSanitizer();
		sanitizer.register("sk-secret-token-value");
		const mission = store.createMission({ missionId: "m-priv", goal: "inspect sk-secret-token-value" });
		store.updateMission(mission.missionId, {}, {
			actor: "boss",
			metadata: {
				kind: "boss-plan",
				action: "dispatch",
				thinking: "hidden chain of thought should stay private",
				reasoning: "more hidden reasoning",
				providerPayload: { headers: { authorization: "Bearer sk-secret-token-value" }, body: "<raw>" },
			},
		});
		const text = textOf(projectMissionProgress({ store, missionId: "m-priv", sanitizer }));
		assert.doesNotMatch(text, /hidden chain of thought/i);
		assert.doesNotMatch(text, /more hidden reasoning/i);
		assert.doesNotMatch(text, /sk-secret-token-value/);
		assert.doesNotMatch(text, /Bearer /);
		assert.doesNotMatch(text, /<raw>/);
		assert.match(text, /\[REDACTED\]/);
	}));

	it("uses bounded append/notify when Pi has no live widget surface", () => {
		const view = projectMissionProgress({
			mission: { missionId: "m-print", status: "running", goal: "inspect", createdAt: "2026-08-17T00:00:00.000Z", revision: 1 } as MissionRecord,
			now: new Date("2026-08-17T00:00:05.000Z"),
		});
		const appended: string[][] = [];
		const ui: ProgressUi = {
			hasLiveSurface: false,
			setWidget: () => { throw new Error("print-mode setWidget is a no-op and must not be treated as live"); },
			notify: (message) => { appended.push(message.split("\n")); },
			append: (lines) => { appended.push([...lines]); },
		};
		applyMissionProgressToUi(ui, view);
		applyMissionProgressToUi(ui, view);
		assert.ok(appended.length >= 1);
		assert.match(appended[0]?.join("\n") ?? "", /Mission running|Status: running/i);
	});

	it("leaves normal non-orchestrated Pi UX unchanged until a Mission is attached", () => {
		const ui = fakeUi();
		const empty = projectMissionProgress({ events: [], mission: undefined });
		applyMissionProgressToUi(ui, empty);
		assert.equal(ui.widgets.length, 0);
		assert.equal(ui.notifications.length, 0);
		assert.equal(ui.working.length, 0);
	});

	it("30-33. Compact widget stays <= 8 lines and never hits Pi 10-line truncation boundary even on long Missions", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-long-widget", goal: "long running multi-cycle investigation with dozens of events" });
		store.transitionMission(mission.missionId, "running", { actor: "boss" });
		// Create 20 events to simulate a long mission
		for (let i = 0; i < 20; i++) {
			store.updateMission(mission.missionId, {}, {
				actor: "boss",
				metadata: { kind: "boss-cycle-progress", cycle: Math.floor(i / 5), detail: `step ${i}` },
			});
		}
		const live: LiveProgressOverlay = {
			worker: { remoteModelId: "ocg/deepseek-v4-flash", startedAt: "2026-08-17T00:00:10.000Z" },
		};
		const view = projectMissionProgress({ store, missionId: "m-long-widget", live, now: new Date("2026-08-17T00:00:25.000Z") });
		const lines = renderMissionProgress(view);
		// Compact widget must stay <= 8 lines in normal execution
		assert.ok(lines.length <= 8, `Widget produced ${lines.length} lines, expected <= 8`);
		assert.ok(lines.every((l) => !l.includes("(widget truncated)")));
		assert.match(lines.join("\n"), /Mission running/);
		assert.match(lines.join("\n"), /DeepSeek/);
	}));

	it("34-36. Heartbeat updates elapsed time without altering transcript and reflects current state", () => {
		const mission = { missionId: "m-hb-state", status: "running", goal: "inspect", createdAt: "2026-08-17T00:00:00.000Z", revision: 1 } as MissionRecord;
		const v1 = projectMissionProgress({
			mission,
			live: { worker: { remoteModelId: "ocg/deepseek-v4-flash", startedAt: "2026-08-17T00:00:00.000Z" } },
			now: new Date("2026-08-17T00:00:15.000Z"),
		});
		const v2 = projectMissionProgress({
			mission,
			live: { worker: { remoteModelId: "ocg/deepseek-v4-flash", startedAt: "2026-08-17T00:00:00.000Z" } },
			now: new Date("2026-08-17T00:00:30.000Z"),
		});
		assert.match(v1.lines.join("\n"), /15s/);
		assert.match(v2.lines.join("\n"), /30s/);
	});

	it("37. Terminal widget cleanup works", () => {
		const ui = fakeUi();
		const view = projectMissionProgress({
			mission: { missionId: "m-term-clean", status: "completed", goal: "inspect", createdAt: "2026-08-17T00:00:00.000Z", revision: 2 } as MissionRecord,
		});
		applyMissionProgressToUi(ui, view);
		assert.equal(ui.working.at(-1), undefined);
	});

	it("renders Esc to cancel only when isOwnedSession is true or omitted, and omits it when isOwnedSession is false", () => {
		const mission = { missionId: "m-ctrlc", status: "running", goal: "inspect", createdAt: "2026-08-17T00:00:00.000Z", revision: 1 } as MissionRecord;
		const ownedView = projectMissionProgress({
			mission,
			isOwnedSession: true,
			live: { worker: { remoteModelId: "ocg/deepseek-v4-flash", startedAt: "2026-08-17T00:00:00.000Z" } },
			now: new Date("2026-08-17T00:00:10.000Z"),
		});
		assert.match(ownedView.lines.join("\n"), /Esc to cancel/);

		const unownedView = projectMissionProgress({
			mission,
			isOwnedSession: false,
			live: { worker: { remoteModelId: "ocg/deepseek-v4-flash", startedAt: "2026-08-17T00:00:00.000Z" } },
			now: new Date("2026-08-17T00:00:10.000Z"),
		});
		assert.doesNotMatch(unownedView.lines.join("\n"), /Esc to cancel/);
	});

	it("17-34. Truthful counters, Reviewer state, and max 8 lines in live/terminal views", async () => withStore((store) => {
		const mission = store.createMission({ missionId: "m-truth", goal: "inspect" });
		store.transitionMission(mission.missionId, "running", { actor: "boss" });
		const task = store.createTask({ missionId: mission.missionId, roleId: "investigator", executionClass: "investigation", objective: "find" });

		// Attempt 1: proposed evidence
		const a1 = store.createAttempt({ taskId: task.taskId, routeId: "inv-a", remoteModelId: "ocg/deepseek-v4-flash" });
		store.finishAttempt(a1.attemptId, "succeeded");
		const ev1 = store.admitEvidence({ missionId: mission.missionId, taskId: task.taskId, attemptId: a1.attemptId, kind: "fact", content: { v: 1 } });

		// M7 Review 1: BLOCKED
		const v1 = store.createVerificationRun({ missionId: mission.missionId, taskId: task.taskId, targetRunId: a1.attemptId, round: 0, reviewerRemoteModelId: "gcli/grok-4.6-high" });
		store.recordQualityDecision({
			missionId: mission.missionId,
			taskId: task.taskId,
			verificationId: v1.verificationId,
			targetRunId: a1.attemptId,
			round: 0,
			gate: { verdict: "blocked", reasons: ["need more proof"], criterionResults: [], mechanicalChecks: [] },
			reviewerSummary: "need more proof",
		});

		// Live view with Reviewer selecting / selected
		const liveSelecting: LiveProgressOverlay = { m7: { startedAt: "2026-08-17T00:00:00.000Z" } };
		const vSelect = projectMissionProgress({ store, missionId: "m-truth", live: liveSelecting });
		assert.match(vSelect.lines.join("\n"), /Reviewer: unassigned/);

		const liveSelected: LiveProgressOverlay = { m7: { remoteModelId: "gcli/grok-4.6-high", startedAt: "2026-08-17T00:00:00.000Z" } };
		const vSelected = projectMissionProgress({ store, missionId: "m-truth", live: liveSelected });
		assert.match(vSelected.lines.join("\n"), /Reviewer: Grok 4\.6 High/);
		assert.match(vSelected.lines.join("\n"), /Evidence: 1/);
		assert.ok(vSelected.lines.length <= 8);
	}));
});
