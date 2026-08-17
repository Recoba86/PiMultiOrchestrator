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
	if (payloadStatus === "SAFETY_STOP" || (status === "blocked" && payloadStatus === "SAFETY_STOP")) return "SAFETY_STOP";
	if (payloadStatus === "COMPLETED" || status === "completed") return "COMPLETED";
	if (payloadStatus === "AWAITING_USER" || status === "awaiting-review") return "AWAITING_USER";
	if (payloadStatus === "CANCELLED" || status === "cancelled") return "CANCELLED";
	if (payloadStatus === "BLOCKED" || status === "blocked") return "BLOCKED";
	return status;
};

/**
 * Renders a compact, current-state snapshot widget (<= 8 lines) for Pi's setWidget.
 * Historical event logging is deferred to Pi's activity transcript.
 */
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
	const live = input.live;

	let cycle = 0;
	let bossModel: string | undefined;
	let lastWorker: string | undefined = live?.lastWorker;
	let lastReason: string | undefined;
	let attempts = input.counts?.attempts ?? 0;
	let evidenceCount = input.counts?.evidence ?? 0;
	let m7Pass = input.counts?.m7Pass ?? 0;
	let m7Blocks = input.counts?.m7Blocks ?? 0;

	for (const event of events) {
		const meta = safeMeta(event.payload);
		const kind = String(meta.kind ?? event.kind);
		const remote = typeof meta.remoteModelId === "string" ? meta.remoteModelId : undefined;
		if (typeof meta.cycle === "number") cycle = Math.max(cycle, meta.cycle);
		if (kind === "boss-assignment" || kind === "boss-start" || event.kind === "mission_running") {
			bossModel = remote ?? (typeof meta.routeId === "string" ? meta.routeId : bossModel);
		} else if (event.kind === "task_started" || event.kind.startsWith("attempt_")) {
			attempts += 1;
			if (remote) lastWorker = remote;
		} else if (event.kind === "evidence_admitted" || event.kind === "evidence_accepted") {
			evidenceCount += 1;
		} else if (event.kind === "quality_pass") {
			m7Pass += 1;
		} else if (event.kind === "quality_blocked" || event.kind === "quality_reject") {
			m7Blocks += 1;
			const decision = decisions.find((item) => item.decisionId === meta.decisionId) ?? decisions.at(-1);
			lastReason = decision?.reviewerSummary ?? "quality did not pass";
		} else if (event.kind === "mission_completed" || event.kind === "mission_awaiting-review" || event.kind === "mission_blocked" || event.kind === "mission_cancelled") {
			lastReason = typeof meta.reason === "string" ? meta.reason : lastReason;
			if (typeof meta.cycles === "number") cycle = Math.max(cycle, meta.cycles);
		}
	}

	const elapsed = formatElapsed(now.getTime() - Date.parse(mission.createdAt));
	const running = mission.status === "running" || mission.status === "active" || mission.status === "draft" || mission.status === "planned";
	const terminal = ["completed", "awaiting-review", "blocked", "cancelled", "failed"].includes(mission.status);
	const payloadTerminal = events.map((event) => safeMeta(event.payload).status).find((status) => typeof status === "string") as string | undefined;

	// Build compact snapshot (max 6-8 lines)
	const lines: string[] = [];
	const headerStatus = running && mission.status !== "draft" ? "running" : mission.status === "draft" ? "created" : mission.status;
	lines.push(`Mission ${headerStatus} · Cycle ${cycle}/${maxCycles} · ${elapsed}`);

	if (terminal) {
		const label = terminalLabel(mission.status, typeof safeMeta(events.at(-1)?.payload).status === "string" ? String(safeMeta(events.at(-1)?.payload).status) : payloadTerminal);
		lines.push(`Final status: ${label}`);
		if (lastReason) lines.push(`Reason: ${clean(lastReason).slice(0, 100)}`);
		lines.push(`Attempts: ${attempts} · Evidence: ${evidenceCount} · M7: ${m7Pass ? "PASS" : m7Blocks ? "BLOCKED" : "none"}`);
	} else if (live?.m7) {
		const m7Elapsed = formatElapsed(now.getTime() - Date.parse(live.m7.startedAt));
		lines.push(`Current: Quality Verification`);
		lines.push(`Reviewer: ${prettyModel(live.m7.remoteModelId)} · ${m7Elapsed}`);
		lines.push(`Attempts: ${attempts} · Evidence: ${evidenceCount}`);
		lines.push(`Ctrl+C to cancel`);
	} else if (live?.worker) {
		const workerElapsed = formatElapsed(now.getTime() - Date.parse(live.worker.startedAt));
		const activeTask = tasks.find((t) => t.status === "running" || t.status === "pending");
		lines.push(`Current: ${activeTask ? activeTask.executionClass : "Worker Execution"}`);
		lines.push(`Worker: ${prettyModel(live.worker.remoteModelId)} · ${workerElapsed}`);
		if (live.tools && live.tools.length > 0) {
			lines.push(`Tool: ${toolLine(live.tools[live.tools.length - 1]!)}`);
		}
		lines.push(`Attempts: ${attempts} · Evidence: ${evidenceCount}`);
		lines.push(`Ctrl+C to cancel`);
	} else if (running) {
		const goalPreview = clean(mission.goal).slice(0, 80);
		lines.push(`Current: Boss Planning`);
		if (bossModel) lines.push(`Boss: ${prettyModel(bossModel)}`);
		if (goalPreview) lines.push(`Goal: ${goalPreview}`);
		lines.push(`Attempts: ${attempts} · Evidence: ${evidenceCount}`);
		lines.push(`Ctrl+C to cancel`);
	}

	const unique = lines.slice(0, 8);
	const fingerprint = unique.map((line) => line
		.replace(/· \d+m \d+s/gu, "")
		.replace(/· \d+s/gu, "")).join("\n");

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
