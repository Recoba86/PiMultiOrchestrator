import type { MissionEventRecord, MissionRecord, MissionStoreAdapter, TaskRecord } from "./types.js";
import type { QualityDecisionRecord, VerificationRunRecord } from "../quality/types.js";
import type { EvidenceRecord } from "./types.js";

const DEFAULT_MAX_CYCLES = 4;
const DEFAULT_QUIET_MS = 8_000;
const HIDDEN_KEYS = new Set(["thinking", "reasoning", "cot", "hiddenreasoning", "providerpayload", "payload", "headers", "authorization", "body", "raw"]);

export interface LiveToolProjection {
	readonly toolName: string;
	readonly target?: string;
	readonly status: "ok" | "blocked" | "fail";
	readonly safetyBlockCode?: string;
}

export interface LiveProgressOverlay {
	readonly boss?: { readonly remoteModelId?: string; readonly startedAt: string };
	readonly worker?: {
		readonly routeId?: string;
		readonly remoteModelId?: string;
		readonly attemptId?: string;
		readonly startedAt: string;
		readonly retry?: boolean;
		readonly fallbackFrom?: string;
	};
	readonly tools?: readonly LiveToolProjection[];
	readonly m7?: { readonly remoteModelId?: string; readonly startedAt: string };
	readonly recovery?: { readonly action: string; readonly summary?: string };
	readonly finalization?: { readonly outcome: string; readonly attemptId?: string };
	readonly lastWorker?: string;
}

export interface MissionProgressCounts {
	readonly attempts?: number;
	readonly evidence?: number;
	readonly m7Pass?: number;
	readonly m7Blocks?: number;
	readonly m7Rounds?: number;
}

export interface MissionProgressInput {
	readonly store?: Pick<MissionStoreAdapter, "getMission" | "listEvents" | "listTasks" | "listEvidence" | "listVerificationRuns" | "listQualityDecisions">;
	readonly missionId?: string;
	readonly mission?: Pick<MissionRecord, "missionId" | "status" | "goal" | "createdAt" | "revision"> | undefined;
	readonly events?: readonly MissionEventRecord[];
	readonly tasks?: readonly Pick<TaskRecord, "taskId" | "executionClass" | "status" | "packetRevision" | "objective">[];
	readonly counts?: MissionProgressCounts;
	readonly live?: LiveProgressOverlay;
	readonly now?: Date;
	readonly quietAfterMs?: number;
	readonly maxCycles?: number;
	readonly sanitizer?: { sanitizeText(value: unknown): string };
}

export interface MissionProgressView {
	readonly active: boolean;
	readonly terminal: boolean;
	readonly fingerprint: string;
	readonly lines: readonly string[];
	readonly statusLine?: string | undefined;
	readonly workingMessage?: string | undefined;
}

export interface ProgressUi {
	readonly hasLiveSurface?: boolean;
	setWidget?(key: string, content: string[] | undefined): void;
	setStatus?(key: string, text: string | undefined): void;
	setWorkingMessage?(message?: string): void;
	notify?(message: string, type?: "info" | "warning" | "error"): void;
	append?(lines: readonly string[]): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const MODEL_ATOMS: Readonly<Record<string, string>> = {
	deepseek: "DeepSeek",
	gemini: "Gemini",
	grok: "Grok",
	claude: "Claude",
	gpt: "GPT",
	flash: "Flash",
	high: "High",
	pro: "Pro",
};

export function prettyModel(id: string | undefined): string {
	if (!id) return "unassigned";
	const leaf = id.split("/").pop() ?? id;
	return leaf.replace(/-thinking$/iu, "").split("-").filter(Boolean).map((part) => MODEL_ATOMS[part.toLowerCase()] ?? part.replace(/^\w/u, (ch) => ch.toUpperCase())).join(" ");
}

export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

const safeMeta = (value: unknown): Record<string, unknown> => {
	if (!isRecord(value)) return {};
	const nested = isRecord(value.kind) ? {} : isRecord(value) && isRecord(value) ? value : {};
	const source = isRecord(nested.kind) ? value : value;
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(source)) {
		if (HIDDEN_KEYS.has(key.toLowerCase())) continue;
		if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") out[key] = item;
		else if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) out[key] = item;
	}
	return out;
};

const basename = (target: string): string => target.replace(/\\/gu, "/").split("/").filter(Boolean).pop() ?? target;

const toolLine = (tool: LiveToolProjection): string => {
	const name = tool.toolName === "submit_agent_result" ? "Structured result submitted" : tool.toolName;
	if (tool.toolName === "submit_agent_result" && tool.status === "ok") return "✓ Structured result submitted";
	const target = tool.target ? ` ${basename(tool.target)}` : "";
	if (tool.status === "blocked") {
		const reason = (tool.safetyBlockCode ?? "").includes("PROTECTED") ? "protected path" : (tool.safetyBlockCode ?? "blocked");
		return `⚠ ${name} blocked: ${reason}`;
	}
	if (tool.status === "fail") return `✗ ${name}${target}`;
	return `✓ ${name}${target}`;
};

const terminalLabel = (status: string, payloadStatus?: string): string => {
	if (payloadStatus === "SAFETY_STOP" || status === "blocked" && payloadStatus === "SAFETY_STOP") return "SAFETY_STOP";
	if (payloadStatus === "COMPLETED" || status === "completed") return "COMPLETED";
	if (payloadStatus === "AWAITING_USER" || status === "awaiting-review") return "AWAITING_USER";
	if (payloadStatus === "CANCELLED" || status === "cancelled") return "CANCELLED";
	if (payloadStatus === "BLOCKED" || status === "blocked") return "BLOCKED";
	return status;
};

export function projectMissionProgress(input: MissionProgressInput): MissionProgressView {
	const sanitizer = input.sanitizer ?? { sanitizeText: (value: unknown) => String(value ?? "") };
	const clean = (value: unknown): string => sanitizer.sanitizeText(value).replace(/\s+/gu, " ").trim();
	const missionId = input.missionId ?? (input.mission ? String(input.mission.missionId) : undefined);
	const mission = input.mission ?? (missionId && input.store ? input.store.getMission(missionId) : undefined);
	if (!mission) return { active: false, terminal: false, fingerprint: "", lines: [] };

	const events = input.events ?? (input.store && missionId ? input.store.listEvents(missionId) : []);
	const tasks = input.tasks ?? (input.store && missionId ? input.store.listTasks(missionId) : []);
	const evidence = input.store && missionId ? input.store.listEvidence(missionId) : [];
	const verifications = input.store && missionId ? input.store.listVerificationRuns(missionId) : [];
	const decisions = input.store && missionId ? input.store.listQualityDecisions(missionId) : [];
	const now = input.now ?? new Date();
	const maxCycles = input.maxCycles ?? DEFAULT_MAX_CYCLES;
	const quietAfterMs = input.quietAfterMs ?? DEFAULT_QUIET_MS;
	const live = input.live;

	const lines: string[] = [];
	let cycle = 0;
	let bossModel: string | undefined;
	let lastWorker: string | undefined = live?.lastWorker;
	let lastReason: string | undefined;
	let attempts = input.counts?.attempts ?? 0;
	let evidenceCount = input.counts?.evidence ?? 0;
	let m7Rounds = input.counts?.m7Rounds ?? 0;
	let m7Blocks = input.counts?.m7Blocks ?? 0;
	let m7Pass = input.counts?.m7Pass ?? 0;

	const push = (line: string): void => {
		const text = clean(line);
		if (text) lines.push(text);
	};

	for (const event of events) {
		const meta = safeMeta(event.payload);
		const kind = String(meta.kind ?? event.kind);
		const remote = typeof meta.remoteModelId === "string" ? meta.remoteModelId : undefined;
		if (typeof meta.cycle === "number") cycle = Math.max(cycle, meta.cycle);
		if (kind === "boss-assignment" || kind === "boss-start" || event.kind === "mission_running") {
			bossModel = remote ?? (typeof meta.routeId === "string" ? meta.routeId : bossModel);
			if (bossModel) push(`Boss · ${prettyModel(bossModel)}`);
			if (kind === "boss-assignment") push("✓ Assignment pinned");
		} else if (kind === "boss-plan" || event.kind === "mission_updated" && kind === "boss-plan") {
			const action = String(meta.action ?? "plan");
			push(`✓ Plan created`);
			if (action === "dispatch") push("→ Investigation dispatched");
			else if (action === "replan") push("→ Targeted repair planned");
			else if (action === "complete") push("→ Completion attempted");
			else push(`→ ${action}`);
		} else if (kind === "boss-evaluation") {
			const action = String(meta.action ?? "evaluate");
			push(`Boss · evaluation ${action}`);
			if (action === "complete") push("→ Completion attempted");
		} else if (kind === "boss-completion-rejected") {
			push(`✗ Completion rejected: ${String(meta.summary ?? "durable gates were not met")}`);
			lastReason = String(meta.summary ?? lastReason ?? "");
		} else if (kind === "boss-fallback") {
			push(`⚠ Route fallback ${prettyModel(String(meta.fromRouteId ?? ""))} → ${prettyModel(String(meta.toRouteId ?? remote ?? ""))}`);
		} else if (event.kind === "task_created") {
			const task = tasks.find((item) => String(item.taskId) === String(event.taskId));
			push(`Task · ${task?.executionClass ?? "work"} · ${String(event.taskId)}`);
			if (task) push(`status ${task.status} · packet revision ${task.packetRevision}`);
		} else if (event.kind === "task_packet_created") {
			push(`packet revision ${String(meta.packetRevision ?? "")}`.trim());
		} else if (event.kind === "task_started") {
			attempts += 1;
			push(`Worker · ${prettyModel(remote)} started`);
		} else if (event.kind.startsWith("attempt_")) {
			if (input.counts?.attempts === undefined) attempts += event.kind === "attempt_succeeded" || event.kind === "attempt_failed" || event.kind === "attempt_interrupted" ? 1 : 0;
			push(`Worker · attempt ${event.kind.replace("attempt_", "")}`);
		} else if (event.kind === "evidence_proposed" || event.kind === "evidence_accepted") {
			if (input.counts?.evidence === undefined) evidenceCount += 1;
			push(event.kind === "evidence_accepted" ? "✓ Evidence accepted" : "Evidence proposed");
		} else if (event.kind === "verification_started") {
			m7Rounds += input.counts?.m7Rounds === undefined ? 1 : 0;
			const run = verifications.find((item) => item.verificationId === meta.verificationId) ?? verifications.at(-1);
			push(`M7 · ${prettyModel(run?.reviewerRemoteModelId ?? remote)} · started`);
		} else if (event.kind === "quality_pass" || event.kind === "quality_blocked" || event.kind === "quality_reject") {
			const decision = decisions.find((item) => item.decisionId === meta.decisionId) ?? decisions.at(-1);
			if (event.kind === "quality_pass") {
				m7Pass += input.counts?.m7Pass === undefined ? 1 : 0;
				push("✓ M7 PASS");
			} else {
				m7Blocks += input.counts?.m7Blocks === undefined ? 1 : 0;
				const reason = decision?.reviewerSummary ?? "quality did not pass";
				lastReason = reason;
				push(`✗ BLOCKED`);
				push(`Reason: ${reason}`);
			}
		} else if (event.kind === "mission_completed" || event.kind === "mission_awaiting-review" || event.kind === "mission_blocked" || event.kind === "mission_cancelled") {
			lastReason = typeof meta.reason === "string" ? meta.reason : lastReason;
			if (typeof meta.cycles === "number") cycle = Math.max(cycle, meta.cycles);
		}
	}

	for (const item of evidence) {
		if (item.kind === "recovery-assessment") push("Recovery assessment recorded");
		if (item.status === "accepted" && !lines.some((line) => /Evidence accepted/u.test(line))) push("✓ Evidence accepted");
	}

	if (live?.tools) for (const tool of live.tools) push(toolLine(tool));
	if (live?.boss) push(`Boss · ${prettyModel(live.boss.remoteModelId)} · running`);
	if (live?.worker) {
		lastWorker = live.worker.remoteModelId ?? lastWorker;
		const elapsed = formatElapsed(now.getTime() - Date.parse(live.worker.startedAt));
		push(`Worker · ${prettyModel(live.worker.remoteModelId)} · ${elapsed}`);
		if (live.worker.retry) push("⚠ same-route retry");
		if (live.worker.fallbackFrom) push(`⚠ route fallback from ${prettyModel(live.worker.fallbackFrom)}`);
	}
	if (live?.finalization) push(`Worker result finalization · ${live.finalization.outcome}`);
	if (live?.recovery) {
		push(`Boss recovery action · ${live.recovery.action}`);
		if (live.recovery.summary) push(live.recovery.summary);
	}
	const lastEventAt = events.at(-1)?.createdAt ?? mission.createdAt;
	const quietMs = now.getTime() - Date.parse(lastEventAt);
	if (live?.m7) {
		push(`M7 · ${prettyModel(live.m7.remoteModelId)} · running`);
		push(`M7 verification in progress… ${formatElapsed(now.getTime() - Date.parse(live.m7.startedAt))}`);
	} else if (live?.worker && now.getTime() - Date.parse(live.worker.startedAt) >= quietAfterMs) {
		push(`${prettyModel(live.worker.remoteModelId)} still running… ${formatElapsed(now.getTime() - Date.parse(live.worker.startedAt))}`);
	} else if (live?.boss && now.getTime() - Date.parse(live.boss.startedAt) >= quietAfterMs) {
		push(`${prettyModel(live.boss.remoteModelId)} still running… ${formatElapsed(now.getTime() - Date.parse(live.boss.startedAt))}`);
	} else if (!live?.m7 && !live?.worker && !live?.boss && quietMs >= quietAfterMs && mission.status === "running") {
		push(`Boss still running… ${formatElapsed(quietMs)}`);
	}

	const elapsed = formatElapsed(now.getTime() - Date.parse(mission.createdAt));
	const running = mission.status === "running" || mission.status === "active" || mission.status === "draft" || mission.status === "planned";
	const terminal = ["completed", "awaiting-review", "blocked", "cancelled", "failed"].includes(mission.status);
	const payloadTerminal = events.map((event) => safeMeta(event.payload).status).find((status) => typeof status === "string") as string | undefined;
	const headerStatus = running && mission.status !== "draft" ? "running" : mission.status === "draft" ? "created" : mission.status;
	const header = `Mission ${headerStatus} · Cycle ${cycle}/${maxCycles}`;
	const goal = clean(mission.goal).slice(0, 180);
	const prefixed = [
		header,
		`ID: ${String(mission.missionId)}`,
		`Goal: ${goal}`,
		`Status: ${mission.status}`,
		`Elapsed: ${elapsed}`,
		...lines,
	];

	if (live?.m7 === undefined && decisions.some((item) => item.verdict === "pass") && !prefixed.some((line) => /M7 PASS/u.test(line))) {
		prefixed.push("✓ M7 PASS");
	}

	if (terminal) {
		const label = terminalLabel(mission.status, typeof safeMeta(events.at(-1)?.payload).status === "string" ? String(safeMeta(events.at(-1)?.payload).status) : payloadTerminal);
		const summary = [
			`Mission ${label} · ${elapsed}`,
			lastReason ? `Reason:\n${clean(lastReason)}` : "",
			`Boss cycles: ${cycle || (typeof safeMeta(events.at(-1)?.payload).cycles === "number" ? Number(safeMeta(events.at(-1)?.payload).cycles) : 0)}`,
			`Tasks: ${tasks.length || 1}`,
			`Worker attempts: ${attempts || input.counts?.attempts || events.filter((event) => event.kind.startsWith("attempt_")).length}`,
			`Evidence: ${evidenceCount || evidence.length}`,
			m7Pass || decisions.some((item) => item.verdict === "pass") ? "M7: PASS" : m7Blocks ? `M7 blocks: ${m7Blocks || input.counts?.m7Blocks || 0}` : m7Rounds ? `M7 rounds: ${m7Rounds}` : "",
			lastWorker ? `Final worker: ${prettyModel(lastWorker)}` : "",
		].filter(Boolean);
		prefixed.push("", ...summary);
	}

	const unique = [...new Set(prefixed.filter(Boolean))];
	const fingerprint = unique.map((line) => line
		.replace(/… \d+m \d+s/gu, "…")
		.replace(/… \d+s/gu, "…")
		.replace(/Elapsed: \d+m \d+s/gu, "Elapsed")
		.replace(/Elapsed: \d+s/gu, "Elapsed")
		.replace(/ · \d+s$/u, "")).join("\n");
	const working = live?.m7
		? `M7 · ${prettyModel(live.m7.remoteModelId)}`
		: live?.worker
			? `Worker · ${prettyModel(live.worker.remoteModelId)}`
			: running
				? `Mission ${String(mission.missionId)}`
				: undefined;
	return {
		active: true,
		terminal,
		fingerprint,
		lines: unique,
		...(unique[0] === undefined ? {} : { statusLine: unique[0] }),
		...(working === undefined ? {} : { workingMessage: working }),
	};
}

export function renderMissionProgress(view: MissionProgressView): string[] {
	return [...view.lines];
}

export function applyMissionProgressToUi(ui: ProgressUi, view: MissionProgressView): void {
	if (!view.active) return;
	const lines = renderMissionProgress(view);
	const live = ui.hasLiveSurface !== false && typeof ui.setWidget === "function";
	if (live) ui.setWidget?.("pmo-mission-progress", lines);
	else {
		if (typeof ui.notify === "function") ui.notify(lines.join("\n"), "info");
		ui.append?.(lines);
	}
	if (typeof ui.setStatus === "function") ui.setStatus("pmo-mission", view.statusLine);
	if (typeof ui.setWorkingMessage === "function") ui.setWorkingMessage(view.terminal ? undefined : view.workingMessage);
}

export function createMissionProgressSession(options: {
	readonly store: MissionProgressInput["store"] & Pick<MissionStoreAdapter, "getMission" | "listEvents">;
	readonly sanitizer?: MissionProgressInput["sanitizer"];
	readonly now?: () => Date;
	readonly quietAfterMs?: number;
	readonly maxCycles?: number;
}): {
	project(missionId: string, live?: LiveProgressOverlay): MissionProgressView;
	replay(missionId: string): MissionProgressView;
} {
	const project = (missionId: string, live?: LiveProgressOverlay): MissionProgressView => projectMissionProgress({
		store: options.store,
		missionId,
		...(live === undefined ? {} : { live }),
		...(options.sanitizer === undefined ? {} : { sanitizer: options.sanitizer }),
		...(options.now === undefined ? {} : { now: options.now() }),
		...(options.quietAfterMs === undefined ? {} : { quietAfterMs: options.quietAfterMs }),
		...(options.maxCycles === undefined ? {} : { maxCycles: options.maxCycles }),
	});
	return { project, replay: (missionId) => project(missionId) };
}

export type { EvidenceRecord, QualityDecisionRecord, VerificationRunRecord };
