import { classifyFailure, selectWeightedRoute } from "../routing/index.js";
import type { BossRouteV1, StableId } from "../config/types.js";
import { PathSafetyError, ProjectTrustRequiredError } from "../security/index.js";
import type { ThinkingEffort, ThinkingLevelMap } from "../thinking.js";
import type { AnalyticsEventV1 } from "../analytics/index.js";
import type { MissionId, MissionRecord, MissionStoreAdapter, MissionStatus, TaskRecord } from "./types.js";

export interface BossRouteCandidate extends BossRouteV1 {
	readonly remoteModelId?: string;
	readonly reasoning?: boolean;
	readonly thinkingLevelMap?: ThinkingLevelMap;
}

export interface BossAssignment {
	readonly routeId: StableId;
	readonly remoteModelId?: string;
	readonly thinkingEffort: ThinkingEffort;
	readonly weight: number;
	readonly assignedAt: string;
	readonly fallbackFromRouteId?: StableId;
	readonly fallbackReason?: string;
}

export interface BossTaskSpec {
	readonly taskId?: string;
	readonly roleId: string;
	readonly executionClass: "investigation" | "implementation" | "verification";
	readonly poolId?: "investigation" | "implementation" | "verification";
	readonly objective: string;
	readonly acceptanceCriteria?: readonly string[];
}

export type BossDecisionAction = "dispatch" | "replan" | "complete" | "blocked" | "awaiting_user";

export interface BossDecision {
	readonly action: BossDecisionAction;
	readonly summary: string;
	readonly tasks: readonly BossTaskSpec[];
	readonly acceptanceSatisfied?: boolean;
	readonly requiredFixes?: readonly string[];
	readonly tokenUsage?: AnalyticsEventV1["tokenUsage"];
}

export interface BossInferenceRequest {
	readonly mission: MissionRecord;
	readonly assignment: BossAssignment;
	readonly cycle: number;
	readonly phase: "plan" | "evaluate";
	readonly feedback?: unknown;
	readonly taskOutcomes?: readonly BossTaskOutcome[];
	readonly signal?: AbortSignal;
}

export interface BossTaskOutcome {
	readonly taskId?: string;
	readonly status: "succeeded" | "failed" | "blocked" | "cancelled";
	readonly summary: string;
}

export interface BossVerificationOutcome {
	readonly taskId?: string;
	readonly verdict: "pass" | "reject" | "blocked" | "cancelled";
	readonly summary: string;
	readonly requiredFixes?: readonly string[];
}

export interface BossLoopContext {
	readonly cycle: number;
	readonly assignment: BossAssignment;
	readonly feedback?: unknown;
}

export interface MissionGoalLoopOptions {
	readonly store: MissionStoreAdapter;
	readonly missionId: MissionId | string;
	readonly entries: readonly BossRouteCandidate[];
	readonly schedulingKey?: string;
	readonly invoke: (request: BossInferenceRequest) => Promise<BossDecision>;
	readonly dispatch: (task: TaskRecord, context: BossLoopContext) => Promise<BossTaskOutcome>;
	readonly verify: (task: TaskRecord, outcome: BossTaskOutcome, context: BossLoopContext) => Promise<BossVerificationOutcome>;
	readonly maxCycles?: number;
	readonly maxTasksPerCycle?: number;
	readonly clock?: () => Date;
	readonly profileId?: string;
	readonly analytics?: { append(event: AnalyticsEventV1): Promise<unknown> | unknown };
	readonly signal?: AbortSignal;
}

export interface BossMissionState {
	readonly version: 1;
	readonly cycle: number;
	readonly repairCycles: number;
	readonly bossAssignment?: BossAssignment;
	readonly fallbackHistory: readonly { readonly fromRouteId: StableId; readonly toRouteId: StableId; readonly reason: string }[];
	readonly tokenUsage?: AnalyticsEventV1["tokenUsage"];
	readonly lastDecision?: { readonly phase: "plan" | "evaluate"; readonly action: BossDecisionAction; readonly summary: string };
	readonly terminal?: BossTerminalState;
	readonly terminalReason?: string;
	readonly terminalProvenance?: string;
}

export type BossTerminalState = "COMPLETED" | "BLOCKED" | "AWAITING_USER" | "CANCELLED" | "SAFETY_STOP";

export interface MissionGoalLoopResult {
	readonly status: Extract<MissionStatus, "completed" | "blocked" | "awaiting-review" | "cancelled">;
	readonly terminal: BossTerminalState;
	readonly cycles: number;
	readonly mission: MissionRecord;
	readonly assignment?: BossAssignment;
}

export class BossRuntimeError extends Error {
	readonly kind: "infrastructure" | "protocol" | "unconfigured" | "disabled";

	constructor(kind: BossRuntimeError["kind"], message: string) {
		super(message);
		this.name = "BossRuntimeError";
		this.kind = kind;
	}
}

export class BossInfrastructureError extends BossRuntimeError {
	constructor(message = "Boss provider infrastructure is unavailable") {
		super("infrastructure", message);
		this.name = "BossInfrastructureError";
	}
}

export class BossProtocolError extends BossRuntimeError {
	constructor(message = "Boss response was invalid") {
		super("protocol", message);
		this.name = "BossProtocolError";
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 2_000): string => typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, max) : "";
const nowIso = (clock: () => Date): string => clock().toISOString();

const normalizedTokenUsage = (value: unknown): AnalyticsEventV1["tokenUsage"] | undefined => {
	if (!isRecord(value)) return undefined;
	const number = (key: string): number | undefined => typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= Number.MAX_SAFE_INTEGER ? value[key] : undefined;
	const inputTokens = number("inputTokens");
	const outputTokens = number("outputTokens");
	const cacheReadTokens = number("cacheReadTokens");
	const cacheWriteTokens = number("cacheWriteTokens");
	const reasoningTokens = number("reasoningTokens");
	const totalTokens = number("totalTokens");
	const provenance: "observed" | "provider_reported" | "pi_runtime_reported" | undefined = value.provenance === "observed" || value.provenance === "provider_reported" || value.provenance === "pi_runtime_reported" ? value.provenance : undefined;
	const usage = {
		...(inputTokens === undefined ? {} : { inputTokens }),
		...(outputTokens === undefined ? {} : { outputTokens }),
		...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
		...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
		...(reasoningTokens === undefined ? {} : { reasoningTokens }),
		...(totalTokens === undefined ? {} : { totalTokens }),
		...(provenance === undefined ? {} : { provenance }),
	};
	return Object.keys(usage).length === 0 ? undefined : usage;
};

const mergeTokenUsage = (previous: AnalyticsEventV1["tokenUsage"] | undefined, next: AnalyticsEventV1["tokenUsage"] | undefined): AnalyticsEventV1["tokenUsage"] | undefined => {
	if (!previous) return next;
	if (!next) return previous;
	const add = (left: number | undefined, right: number | undefined): number | undefined => left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
	const inputTokens = add(previous.inputTokens, next.inputTokens);
	const outputTokens = add(previous.outputTokens, next.outputTokens);
	const cacheReadTokens = add(previous.cacheReadTokens, next.cacheReadTokens);
	const cacheWriteTokens = add(previous.cacheWriteTokens, next.cacheWriteTokens);
	const reasoningTokens = add(previous.reasoningTokens, next.reasoningTokens);
	const totalTokens = add(previous.totalTokens, next.totalTokens);
	return {
		...(inputTokens === undefined ? {} : { inputTokens }),
		...(outputTokens === undefined ? {} : { outputTokens }),
		...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
		...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
		...(reasoningTokens === undefined ? {} : { reasoningTokens }),
		...(totalTokens === undefined ? {} : { totalTokens }),
		...(previous.provenance === "observed" || next.provenance === "observed" ? { provenance: "observed" as const } : previous.provenance === "provider_reported" || next.provenance === "provider_reported" ? { provenance: "provider_reported" as const } : previous.provenance === "pi_runtime_reported" || next.provenance === "pi_runtime_reported" ? { provenance: "pi_runtime_reported" as const } : {}),
	};
};

const SAFETY_STOP_CODES = new Set([
	"PROJECT_TRUST_REQUIRED",
	"CREDENTIAL_PATH",
	"CREDENTIAL_PATH_DESCENDANT",
	"PROTECTED_PATH",
	"PROTECTED_PATH_DESCENDANT",
	"OUTSIDE_WORKSPACE",
	"PRIVILEGE_ESCALATION",
	"DEVICE_OPERATION",
	"CREDENTIAL_OR_PERMISSION",
	"DESTRUCTIVE_DELETE",
	"DESTRUCTIVE_GIT",
	"NETWORK_OR_PUBLICATION",
	"SYMLINK_DESCENDANT",
	"RECURSIVE_PATH_UNVERIFIED",
]);

const cancellationError = (message = "Mission cancelled"): Error => {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
};

export function isBossCancellationCause(error: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) return true;
	if (!error || typeof error !== "object") return false;
	const name = "name" in error && typeof error.name === "string" ? error.name.toLowerCase() : "";
	if (name === "aborterror" || name === "cancellationerror") return true;
	const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
	const category = "category" in error && typeof error.category === "string" ? error.category : undefined;
	return classifyFailure({ ...(code === undefined ? {} : { code }), ...(category === undefined ? {} : { category }), cancelled: false }).class === "cancelled";
}

export function isBossSafetyStopCause(error: unknown): boolean {
	if (error instanceof ProjectTrustRequiredError || error instanceof PathSafetyError) return true;
	if (!error || typeof error !== "object") return false;
	const name = "name" in error && typeof error.name === "string" ? error.name : "";
	if (name === "ProjectTrustRequiredError" || name === "PathSafetyError") return true;
	const code = "code" in error && typeof error.code === "string" ? error.code : "";
	return SAFETY_STOP_CODES.has(code);
}

export function bossSafetyStopProvenance(error: unknown): string {
	if (error instanceof ProjectTrustRequiredError) return error.code;
	if (error instanceof PathSafetyError) return error.code.slice(0, 64);
	if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.slice(0, 64);
	return "SAFETY_POLICY";
}

const throwIfCancelled = (signal?: AbortSignal): void => {
	if (signal?.aborted) throw cancellationError();
};

const missionStatusForTerminal = (terminalState: BossTerminalState): Extract<MissionStatus, "completed" | "blocked" | "awaiting-review" | "cancelled"> => {
	if (terminalState === "COMPLETED") return "completed";
	if (terminalState === "CANCELLED") return "cancelled";
	if (terminalState === "AWAITING_USER") return "awaiting-review";
	return "blocked";
};

const analyticsOutcomeForTerminal = (terminalState: BossTerminalState): string => {
	if (terminalState === "COMPLETED") return "completed";
	if (terminalState === "CANCELLED") return "cancelled";
	if (terminalState === "SAFETY_STOP") return "safety_stop";
	return "failed";
};

export function selectBossEntry(entries: readonly BossRouteCandidate[], schedulingKey: string): BossRouteCandidate | undefined {
	return selectWeightedRoute(entries.filter((entry) => entry.enabled && (entry.weight ?? 1) > 0), schedulingKey);
}

const defaultState = (): BossMissionState => ({ version: 1, cycle: 0, repairCycles: 0, fallbackHistory: [] });

const readState = (mission: MissionRecord): BossMissionState => {
	if (!isRecord(mission.plan) || !isRecord(mission.plan.orchestration)) return defaultState();
	const value = mission.plan.orchestration;
	const assignmentValue = isRecord(value.bossAssignment) ? value.bossAssignment : isRecord(value.assignment) ? value.assignment : undefined;
	const assignment = typeof assignmentValue?.routeId === "string" && typeof assignmentValue.assignedAt === "string"
		? {
			routeId: assignmentValue.routeId as StableId,
			...(typeof assignmentValue.remoteModelId === "string" ? { remoteModelId: assignmentValue.remoteModelId } : {}),
			thinkingEffort: assignmentValue.thinkingEffort === "auto" || assignmentValue.thinkingEffort === "low" || assignmentValue.thinkingEffort === "medium" || assignmentValue.thinkingEffort === "high" || assignmentValue.thinkingEffort === "xhigh" || assignmentValue.thinkingEffort === "max" ? assignmentValue.thinkingEffort : "auto",
			weight: typeof assignmentValue.weight === "number" && Number.isFinite(assignmentValue.weight) ? assignmentValue.weight : 1,
			assignedAt: assignmentValue.assignedAt,
			...(typeof assignmentValue.fallbackFromRouteId === "string" ? { fallbackFromRouteId: assignmentValue.fallbackFromRouteId as StableId } : {}),
			...(typeof assignmentValue.fallbackReason === "string" ? { fallbackReason: assignmentValue.fallbackReason.slice(0, 240) } : {}),
		} satisfies BossAssignment
		: undefined;
	const history = Array.isArray(value.fallbackHistory) ? value.fallbackHistory.flatMap((item) => {
		if (!isRecord(item) || typeof item.fromRouteId !== "string" || typeof item.toRouteId !== "string" || typeof item.reason !== "string") return [];
		return [{ fromRouteId: item.fromRouteId as StableId, toRouteId: item.toRouteId as StableId, reason: item.reason.slice(0, 240) }];
	}) : [];
	const last = isRecord(value.lastDecision) && (value.lastDecision.phase === "plan" || value.lastDecision.phase === "evaluate") && typeof value.lastDecision.action === "string" && typeof value.lastDecision.summary === "string"
		? { phase: value.lastDecision.phase as "plan" | "evaluate", action: value.lastDecision.action as BossDecisionAction, summary: value.lastDecision.summary.slice(0, 2_000) }
		: undefined;
	return {
		version: 1,
		cycle: typeof value.cycle === "number" && Number.isSafeInteger(value.cycle) && value.cycle >= 0 ? value.cycle : 0,
		repairCycles: typeof value.repairCycles === "number" && Number.isSafeInteger(value.repairCycles) && value.repairCycles >= 0 ? value.repairCycles : 0,
		...(assignment === undefined ? {} : { bossAssignment: assignment }),
		fallbackHistory: history,
		...(last === undefined ? {} : { lastDecision: last }),
		...(normalizedTokenUsage(value.tokenUsage) === undefined ? {} : { tokenUsage: normalizedTokenUsage(value.tokenUsage) }),
		...(value.terminal === "COMPLETED" || value.terminal === "BLOCKED" || value.terminal === "AWAITING_USER" || value.terminal === "CANCELLED" || value.terminal === "SAFETY_STOP" ? { terminal: value.terminal } : {}),
		...(typeof value.terminalReason === "string" ? { terminalReason: value.terminalReason.slice(0, 240) } : {}),
		...(typeof value.terminalProvenance === "string" ? { terminalProvenance: value.terminalProvenance.slice(0, 64) } : {}),
	};
};

const planWithState = (mission: MissionRecord, state: BossMissionState): unknown => {
	const base = isRecord(mission.plan) ? structuredClone(mission.plan) : {};
	return { ...base, orchestration: state };
};

const persistState = (store: MissionStoreAdapter, mission: MissionRecord, state: BossMissionState, metadata: Record<string, unknown>): MissionRecord =>
	store.updateMission(mission.missionId, { plan: planWithState(mission, state) }, { actor: "boss", expectedRevision: mission.revision, metadata });

const normalizedDecision = (decision: BossDecision): BossDecision => {
	if (!decision || !["dispatch", "replan", "complete", "blocked", "awaiting_user"].includes(decision.action)) throw new BossProtocolError();
	const summary = text(decision.summary);
	if (!summary) throw new BossProtocolError("Boss decision summary is missing");
	if (!Array.isArray(decision.tasks) || decision.tasks.length > 32) throw new BossProtocolError("Boss task plan exceeds the safety bound");
	const tasks = decision.tasks.map((task) => {
		if (!isRecord(task)) throw new BossProtocolError("Boss task plan is invalid");
		const roleId = text(task.roleId, 128);
		const objective = text(task.objective, 8_000);
		const executionClass = task.executionClass as BossTaskSpec["executionClass"];
		if (!roleId || !objective || (executionClass !== "investigation" && executionClass !== "implementation" && executionClass !== "verification")) throw new BossProtocolError("Boss task plan is invalid");
		const poolId = (task.poolId === undefined ? executionClass : task.poolId) as BossTaskSpec["poolId"];
		if (poolId !== "investigation" && poolId !== "implementation" && poolId !== "verification") throw new BossProtocolError("Boss task pool is invalid");
		const acceptanceCriteria = task.acceptanceCriteria === undefined ? undefined : Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 2_000)] : []).slice(0, 32) : undefined;
		if (task.acceptanceCriteria !== undefined && acceptanceCriteria === undefined) throw new BossProtocolError("Boss task acceptance criteria is invalid");
		return {
			...(typeof task.taskId === "string" && task.taskId.trim() ? { taskId: task.taskId.trim().slice(0, 128) } : {}),
			roleId,
			executionClass,
			poolId,
			objective,
			...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }),
		};
	});
	return { action: decision.action, summary, tasks, ...(decision.acceptanceSatisfied === undefined ? {} : { acceptanceSatisfied: decision.acceptanceSatisfied === true }), ...(decision.requiredFixes === undefined ? {} : { requiredFixes: decision.requiredFixes.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 2_000)).slice(0, 32) }), ...(normalizedTokenUsage(decision.tokenUsage) === undefined ? {} : { tokenUsage: normalizedTokenUsage(decision.tokenUsage) }) };
};

const completedAndVerified = (store: MissionStoreAdapter, missionId: string): boolean => {
	const tasks = store.listTasks(missionId);
	return tasks.length > 0 && tasks.every((task) => task.status === "execution_completed" && store.getTaskQualityStatus(task.taskId)?.status === "passed");
};

const fallbackEntry = (entries: readonly BossRouteCandidate[], current: BossAssignment, history: BossMissionState["fallbackHistory"]): BossRouteCandidate | undefined => {
	const failedRoutes = new Set(history.flatMap((item) => [item.fromRouteId, item.toRouteId]));
	return entries.find((entry) => entry.routeId !== current.routeId && !failedRoutes.has(entry.routeId) && entry.enabled && (entry.weight ?? 1) > 0);
};

const recordBossAnalytics = (sink: MissionGoalLoopOptions["analytics"], event: AnalyticsEventV1): void => {
	try {
		const result = sink?.append(event);
		if (result && typeof (result as Promise<unknown>).then === "function") void (result as Promise<unknown>).catch(() => undefined);
	} catch { /* analytics is non-critical */ }
};

const recordBossFallback = (options: MissionGoalLoopOptions, missionId: string, from: BossAssignment, to: BossAssignment, reason: string, cycle: number, clock: () => Date): void => {
	recordBossAnalytics(options.analytics, {
		eventId: `boss-fallback-${missionId}-${cycle}-${to.routeId}`,
		occurredAt: nowIso(clock),
		eventType: "fallback",
		missionId,
		poolId: "boss",
		routeId: to.routeId,
		...(to.remoteModelId === undefined ? {} : { remoteModelId: to.remoteModelId }),
		fallbackFromRouteId: from.routeId,
		fallbackToRouteId: to.routeId,
		failureClass: "provider_unavailable",
		outcome: "fallback",
		dimensions: { bossFallback: true, ...(options.profileId === undefined ? {} : { bossProfileId: options.profileId }) },
	});
};

const terminal = (store: MissionStoreAdapter, mission: MissionRecord, state: BossMissionState, terminalState: BossTerminalState, reason: string, cycles: number, options: MissionGoalLoopOptions, clock: () => Date, provenance?: string): MissionGoalLoopResult => {
	const status = missionStatusForTerminal(terminalState);
	const withTerminal: BossMissionState = {
		...state,
		terminal: terminalState,
		terminalReason: reason.slice(0, 240),
		...(provenance === undefined ? {} : { terminalProvenance: provenance.slice(0, 64) }),
	};
	const recorded = persistState(store, mission, withTerminal, { kind: "boss-terminal", status: terminalState, reason: reason.slice(0, 240), cycles, ...(provenance === undefined ? {} : { provenance: provenance.slice(0, 64) }) });
	const assignment = withTerminal.bossAssignment;
	const elapsedMs = assignment === undefined ? undefined : Math.max(0, clock().getTime() - Date.parse(assignment.assignedAt));
	recordBossAnalytics(options.analytics, {
		eventId: `boss-run-${mission.missionId}`,
		occurredAt: nowIso(clock),
		eventType: "attempt",
		missionId: String(mission.missionId),
		poolId: "boss",
		...(assignment === undefined ? {} : { routeId: assignment.routeId, ...(assignment.remoteModelId === undefined ? {} : { remoteModelId: assignment.remoteModelId }), requestedThinkingEffort: assignment.thinkingEffort, configuredWeight: assignment.weight }),
		...(elapsedMs === undefined || !Number.isFinite(elapsedMs) ? {} : { durationMs: elapsedMs }),
		...(withTerminal.tokenUsage === undefined ? {} : { tokenUsage: withTerminal.tokenUsage }),
		selectionKind: "scheduled",
		schedulerPolicy: "weighted",
		outcome: analyticsOutcomeForTerminal(terminalState),
		dimensions: {
			bossAssigned: assignment !== undefined,
			bossTerminalState: terminalState,
			bossCycle: cycles,
			bossRepairCycles: withTerminal.repairCycles,
			...(options.profileId === undefined ? {} : { bossProfileId: options.profileId }),
			...(withTerminal.terminalProvenance === undefined ? {} : { bossTerminalProvenance: withTerminal.terminalProvenance }),
		},
	});
	const reviewed = status === "completed" && recorded.status === "running"
		? store.transitionMission(mission.missionId, "awaiting-review", { actor: "boss", expectedRevision: recorded.revision, metadata: { kind: "boss-review-ready", terminalState, cycles } })
		: recorded;
	const current = store.getMission(mission.missionId) ?? reviewed;
	const updated = current.status === status
		? current
		: store.transitionMission(mission.missionId, status, { actor: "boss", expectedRevision: reviewed.revision, metadata: { kind: "boss-terminal", terminalState, reason: reason.slice(0, 240), cycles, ...(provenance === undefined ? {} : { provenance: provenance.slice(0, 64) }) } });
	return { status, terminal: terminalState, cycles, mission: updated, ...(withTerminal.bossAssignment === undefined ? {} : { assignment: withTerminal.bossAssignment }) };
};

/** Shared bounded Mission goal loop; worker execution is injected and remains pool-owned. */
export async function runMissionGoalLoop(options: MissionGoalLoopOptions): Promise<MissionGoalLoopResult> {
	const missionId = String(options.missionId);
	const initialMission = options.store.getMission(missionId);
	if (!initialMission) throw new Error(`Mission '${missionId}' was not found`);
	let mission: MissionRecord = initialMission;
	const clock = options.clock ?? (() => new Date());
	const maxCycles = options.maxCycles ?? 4;
	const maxTasks = options.maxTasksPerCycle ?? 8;
	if (!Number.isSafeInteger(maxCycles) || maxCycles < 1 || maxCycles > 16 || !Number.isSafeInteger(maxTasks) || maxTasks < 1 || maxTasks > 32) throw new RangeError("Boss loop bound is outside the supported range");
	let state = readState(mission);
	let assignment = state.bossAssignment;
	const stopCancelled = (current: MissionRecord, reason: string, cycles: number): MissionGoalLoopResult =>
		terminal(options.store, current, state, "CANCELLED", reason, cycles, options, clock, "AbortSignal");
	const stopSafety = (current: MissionRecord, error: unknown, cycles: number): MissionGoalLoopResult =>
		terminal(options.store, current, state, "SAFETY_STOP", text(error instanceof Error ? error.message : "Safety policy stopped Mission orchestration", 240) || "Safety policy stopped Mission orchestration", cycles, options, clock, bossSafetyStopProvenance(error));
	if (mission.status === "completed" || mission.status === "cancelled") {
		const existingTerminal = state.terminal ?? (mission.status === "completed" ? "COMPLETED" : "CANCELLED");
		return { status: mission.status, terminal: existingTerminal, cycles: state.cycle, mission, ...(assignment === undefined ? {} : { assignment }) };
	}
	if (options.signal?.aborted) return stopCancelled(mission, "Mission cancelled by user or AbortSignal", state.cycle);
	const invokeBoss = async (request: BossInferenceRequest): Promise<BossDecision> => {
		throwIfCancelled(request.signal ?? options.signal);
		const decision = await options.invoke(request);
		throwIfCancelled(request.signal ?? options.signal);
		const tokenUsage = mergeTokenUsage(state.tokenUsage, decision.tokenUsage);
		if (tokenUsage !== undefined) state = { ...state, tokenUsage };
		return decision;
	};
	const invokeWithFallback = async (
		phase: BossInferenceRequest["phase"],
		cycle: number,
		extra: Pick<BossInferenceRequest, "feedback" | "taskOutcomes" | "signal">,
	): Promise<{ readonly decision?: BossDecision; readonly error?: unknown }> => {
		while (true) {
			const currentAssignment = assignment;
			if (currentAssignment === undefined) return { error: new BossRuntimeError("unconfigured", "Boss assignment is unavailable") };
			try {
				return {
					decision: normalizedDecision(await invokeBoss({
						mission,
						assignment: currentAssignment,
						cycle,
						phase,
						...(extra.feedback === undefined ? {} : { feedback: extra.feedback }),
						...(extra.taskOutcomes === undefined ? {} : { taskOutcomes: extra.taskOutcomes }),
						...(extra.signal === undefined ? {} : { signal: extra.signal }),
					})),
				};
			} catch (error) {
				if (isBossCancellationCause(error, extra.signal ?? options.signal) || isBossSafetyStopCause(error)) return { error };
				if (!(error instanceof BossRuntimeError) || error.kind !== "infrastructure") return { error };
				const replacement = fallbackEntry(options.entries, currentAssignment, state.fallbackHistory);
				if (!replacement) return { error };
				const reason = text(error.message, 240) || "infrastructure failure";
				const nextAssignment: BossAssignment = {
					routeId: replacement.routeId,
					...(replacement.remoteModelId === undefined ? {} : { remoteModelId: replacement.remoteModelId }),
					thinkingEffort: replacement.thinkingEffort ?? "auto",
					weight: replacement.weight ?? 1,
					assignedAt: currentAssignment.assignedAt,
					fallbackFromRouteId: currentAssignment.routeId,
					fallbackReason: reason,
				};
				state = { ...state, bossAssignment: nextAssignment, fallbackHistory: [...state.fallbackHistory, { fromRouteId: currentAssignment.routeId, toRouteId: replacement.routeId, reason }] };
				assignment = nextAssignment;
				mission = persistState(options.store, mission, state, { kind: "boss-fallback", fromRouteId: nextAssignment.fallbackFromRouteId, toRouteId: nextAssignment.routeId, reason });
				recordBossFallback(options, missionId, currentAssignment, nextAssignment, reason, cycle, clock);
			}
		}
	};
	if (assignment === undefined) {
		const selected = selectBossEntry(options.entries, options.schedulingKey ?? missionId);
		if (!selected) {
			if (mission.status !== "running") mission = options.store.transitionMission(missionId, "running", { actor: "boss", expectedRevision: mission.revision, metadata: { kind: "boss-start" } });
			return terminal(options.store, mission, state, "BLOCKED", "Boss profile is disabled, unconfigured, or has no eligible weighted route", 0, options, clock);
		}
		assignment = { routeId: selected.routeId, ...(selected.remoteModelId === undefined ? {} : { remoteModelId: selected.remoteModelId }), thinkingEffort: selected.thinkingEffort ?? "auto", weight: selected.weight ?? 1, assignedAt: nowIso(clock) };
	}
	if (mission.status !== "running") mission = options.store.transitionMission(missionId, "running", { actor: "boss", expectedRevision: mission.revision, metadata: { kind: "boss-start", routeId: assignment.routeId, remoteModelId: assignment.remoteModelId } });
	const persistedOrchestration = isRecord(mission.plan) && isRecord(mission.plan.orchestration) ? mission.plan.orchestration : undefined;
	const needsCanonicalAssignment = assignment !== undefined && !isRecord(persistedOrchestration?.bossAssignment);
	if (needsCanonicalAssignment || state.bossAssignment?.routeId !== assignment.routeId || state.bossAssignment?.fallbackFromRouteId !== assignment.fallbackFromRouteId) {
		state = { ...state, bossAssignment: assignment };
		mission = persistState(options.store, mission, state, { kind: "boss-assignment", routeId: assignment.routeId, remoteModelId: assignment.remoteModelId, weight: assignment.weight, thinkingEffort: assignment.thinkingEffort });
		recordBossAnalytics(options.analytics, {
			eventId: `boss-assignment-${missionId}`,
			occurredAt: assignment.assignedAt,
			eventType: "custom",
			missionId,
			poolId: "boss",
			routeId: assignment.routeId,
			...(assignment.remoteModelId === undefined ? {} : { remoteModelId: assignment.remoteModelId }),
			requestedThinkingEffort: assignment.thinkingEffort,
			configuredWeight: assignment.weight,
			selectionKind: "scheduled",
			schedulerPolicy: "weighted",
			outcome: "assigned",
			dimensions: { bossAssigned: true, ...(options.profileId === undefined ? {} : { bossProfileId: options.profileId }) },
		});
	}
	let feedback: unknown;
	for (let cycle = state.cycle; cycle < maxCycles; cycle += 1) {
		if (options.signal?.aborted) return stopCancelled(mission, "Mission cancelled before the next Boss cycle", cycle);
		state = { ...state, cycle };
		mission = persistState(options.store, mission, state, { kind: "boss-cycle-start", cycle, routeId: assignment.routeId });
		const planned = await invokeWithFallback("plan", cycle, { ...(feedback === undefined ? {} : { feedback }), ...(options.signal === undefined ? {} : { signal: options.signal }) });
		if (planned.decision === undefined) {
			if (isBossCancellationCause(planned.error, options.signal)) return stopCancelled(mission, "Mission cancelled during Boss planning", cycle);
			if (isBossSafetyStopCause(planned.error)) return stopSafety(mission, planned.error, cycle);
			if (planned.error instanceof BossRuntimeError && planned.error.kind === "infrastructure") return terminal(options.store, mission, state, "BLOCKED", "Boss infrastructure is unavailable and no configured fallback remains", cycle, options, clock);
			feedback = { kind: "boss-plan-failure", summary: planned.error instanceof Error ? planned.error.message.slice(0, 240) : "Boss planning failed" };
			if (cycle + 1 >= maxCycles) return terminal(options.store, mission, state, "AWAITING_USER", "Boss planning did not produce a valid decision within the safety bound", cycle + 1, options, clock);
			continue;
		}
		const plan = planned.decision;
		state = { ...state, lastDecision: { phase: "plan", action: plan.action, summary: plan.summary } };
		mission = persistState(options.store, mission, state, { kind: "boss-plan", cycle, routeId: assignment.routeId, action: plan.action });
		if (plan.action === "blocked") return terminal(options.store, mission, state, "BLOCKED", plan.summary, cycle + 1, options, clock);
		if (plan.action === "awaiting_user") return terminal(options.store, mission, state, "AWAITING_USER", plan.summary, cycle + 1, options, clock);
		if (plan.action === "complete" && plan.acceptanceSatisfied === true && completedAndVerified(options.store, missionId)) return terminal(options.store, mission, state, "COMPLETED", plan.summary, cycle + 1, options, clock);
		if (plan.action === "complete") feedback = { kind: "boss-completion-rejected", summary: "Completion was requested before all tasks and verification gates passed" };
		const taskOutcomes: BossTaskOutcome[] = [];
		const verificationOutcomes: BossVerificationOutcome[] = [];
		for (const spec of plan.tasks.slice(0, maxTasks)) {
			if (options.signal?.aborted) return stopCancelled(mission, "Mission cancelled before worker dispatch", cycle + 1);
			let task = spec.taskId ? options.store.getTask(spec.taskId) : undefined;
			if (task === undefined) {
				task = options.store.createTask({ missionId, roleId: spec.roleId, executionClass: spec.executionClass, poolId: spec.poolId ?? spec.executionClass, objective: spec.objective, ...(spec.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: spec.acceptanceCriteria }), status: "planned" });
			}
			const context: BossLoopContext = { cycle, assignment, ...(feedback === undefined ? {} : { feedback }) };
			let outcome: BossTaskOutcome;
			try {
				throwIfCancelled(options.signal);
				outcome = await options.dispatch(task, context);
			} catch (error) {
				if (isBossCancellationCause(error, options.signal)) return stopCancelled(mission, "Mission cancelled during worker progression", cycle + 1);
				if (isBossSafetyStopCause(error)) return stopSafety(mission, error, cycle + 1);
				outcome = { taskId: String(task.taskId), status: "failed", summary: error instanceof Error ? error.message.slice(0, 240) : "Worker execution failed" };
			}
			if (outcome.status === "cancelled" || options.signal?.aborted) return stopCancelled(mission, "Mission cancelled during worker progression", cycle + 1);
			taskOutcomes.push({ ...outcome, taskId: String(task.taskId), summary: text(outcome.summary, 2_000) || "Worker returned no summary" });
			try {
				throwIfCancelled(options.signal);
				const verification = await options.verify(options.store.getTask(String(task.taskId)) ?? task, taskOutcomes.at(-1)!, context);
				if (verification.verdict === "cancelled" || options.signal?.aborted) return stopCancelled(mission, "Mission cancelled during verification progression", cycle + 1);
				verificationOutcomes.push({ ...verification, ...(verification.taskId === undefined ? { taskId: String(task.taskId) } : {}) });
			} catch (error) {
				if (isBossCancellationCause(error, options.signal)) return stopCancelled(mission, "Mission cancelled during verification progression", cycle + 1);
				if (isBossSafetyStopCause(error)) return stopSafety(mission, error, cycle + 1);
				verificationOutcomes.push({ taskId: String(task.taskId), verdict: "blocked", summary: error instanceof Error ? error.message.slice(0, 240) : "M7 verification failed" });
			}
		}
		const rejected = verificationOutcomes.some((item) => item.verdict === "reject");
		if (rejected) state = { ...state, repairCycles: state.repairCycles + 1 };
		for (const verification of verificationOutcomes) {
			recordBossAnalytics(options.analytics, {
				eventId: `boss-quality-${missionId}-${cycle}-${verification.taskId ?? "task"}`,
				occurredAt: nowIso(clock),
				eventType: "quality",
				missionId,
				poolId: "boss",
				routeId: assignment.routeId,
				qualityRound: cycle,
				qualityOutcome: verification.verdict,
				outcome: verification.verdict,
				firstPass: verification.verdict === "pass" && cycle === 0,
				repairRound: state.repairCycles,
				dimensions: { bossVerificationOutcome: verification.verdict, ...(options.profileId === undefined ? {} : { bossProfileId: options.profileId }) },
			});
		}
		feedback = { kind: "boss-cycle-results", plan: { action: plan.action, summary: plan.summary }, taskOutcomes, verificationOutcomes };
		if (options.signal?.aborted) return stopCancelled(mission, "Mission cancelled before Boss evaluation", cycle + 1);
		const evaluated = await invokeWithFallback("evaluate", cycle, { feedback, taskOutcomes, ...(options.signal === undefined ? {} : { signal: options.signal }) });
		if (evaluated.decision === undefined) {
			if (isBossCancellationCause(evaluated.error, options.signal)) return stopCancelled(mission, "Mission cancelled during Boss evaluation", cycle + 1);
			if (isBossSafetyStopCause(evaluated.error)) return stopSafety(mission, evaluated.error, cycle + 1);
			if (evaluated.error instanceof BossRuntimeError && evaluated.error.kind === "infrastructure") return terminal(options.store, mission, state, "BLOCKED", "Boss infrastructure is unavailable during evaluation and no configured fallback remains", cycle + 1, options, clock);
			if (cycle + 1 >= maxCycles) return terminal(options.store, mission, state, "AWAITING_USER", "Boss evaluation did not complete within the safety bound", cycle + 1, options, clock);
			continue;
		}
		const evaluation = evaluated.decision;
		state = { ...state, lastDecision: { phase: "evaluate", action: evaluation.action, summary: evaluation.summary } };
		mission = persistState(options.store, mission, state, { kind: "boss-evaluation", cycle, routeId: assignment.routeId, action: evaluation.action, verification: verificationOutcomes.map((item) => item.verdict) });
		if (evaluation.action === "blocked") return terminal(options.store, mission, state, "BLOCKED", evaluation.summary, cycle + 1, options, clock);
		if (evaluation.action === "awaiting_user") return terminal(options.store, mission, state, "AWAITING_USER", evaluation.summary, cycle + 1, options, clock);
		if (evaluation.action === "complete" && evaluation.acceptanceSatisfied === true && completedAndVerified(options.store, missionId)) return terminal(options.store, mission, state, "COMPLETED", evaluation.summary, cycle + 1, options, clock);
		if (evaluation.action === "complete") feedback = { kind: "boss-completion-rejected", summary: "Evaluation did not meet the durable task and M7 gates" };
		if (cycle + 1 >= maxCycles) return terminal(options.store, mission, state, "AWAITING_USER", "Mission safety budget exhausted before the goal and acceptance criteria were proven", cycle + 1, options, clock);
	}
	return terminal(options.store, mission, state, "AWAITING_USER", "Mission loop ended without a terminal acceptance decision", maxCycles, options, clock);
}
