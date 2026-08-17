import { classifyFailure, selectWeightedRoute } from "../routing/index.js";
import type { BossRouteV1, StableId } from "../config/types.js";
import { PathSafetyError, ProjectTrustRequiredError } from "../security/index.js";
import type { ThinkingEffort, ThinkingLevelMap } from "../thinking.js";
import type { AnalyticsEventV1 } from "../analytics/index.js";
import { inferAcceptanceCriteriaProvenance, resolveMissionAcceptanceCriteria } from "./acceptance-criteria.js";
import { bossInvocationDiagnostic, sanitizeBossInvocationDiagnostic, type BossInvocationDiagnostic } from "./boss-response.js";
import { projectBossCanonicalState } from "./boss-projection.js";
import { capabilityMismatchReason, evaluateMissionCapability } from "./capability-preflight.js";
import { completedAndVerified, resolveOrCreateMissionTask, activeMissionTasks } from "./task-identity.js";
import { qualityRejectionFingerprint } from "./repair-fingerprint.js";
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
	readonly canonicalProjection?: unknown;
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
	readonly protocolFailures: number;
	readonly actionablePlanFailures: number;
	readonly bossAssignment?: BossAssignment;
	readonly fallbackHistory: readonly { readonly fromRouteId: StableId; readonly toRouteId: StableId; readonly reason: string }[];
	readonly tokenUsage?: AnalyticsEventV1["tokenUsage"];
	readonly lastDecision?: { readonly phase: "plan" | "evaluate"; readonly action: BossDecisionAction; readonly summary: string };
	readonly lastProtocolError?: string;
	readonly lastInvocation?: BossInvocationDiagnostic;
	readonly lastFeedback?: unknown;
	readonly lastRejectionFingerprint?: string;
	readonly repeatedRejectionCount?: number;
	readonly productiveCycles?: number;
	readonly acceptanceCriteriaProvenance?: "explicit" | "labelled-goal" | "derived-from-goal";
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

/** Infrastructure fallback eligibility is independent of weighted scheduling. Weight 0 may still fallback. */
export function selectBossFallbackEntry(entries: readonly BossRouteCandidate[], current: BossAssignment, history: BossMissionState["fallbackHistory"]): BossRouteCandidate | undefined {
	const failedRoutes = new Set(history.flatMap((item) => [item.fromRouteId, item.toRouteId]));
	return entries.find((entry) => entry.routeId !== current.routeId && !failedRoutes.has(entry.routeId) && entry.enabled);
}

const defaultState = (): BossMissionState => ({ version: 1, cycle: 0, repairCycles: 0, protocolFailures: 0, actionablePlanFailures: 0, productiveCycles: 0, fallbackHistory: [] });

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
	const lastInvocation = sanitizeBossInvocationDiagnostic(value.lastInvocation);
	const lastFeedback = value.lastFeedback;
	const boundedFeedback = lastFeedback === undefined ? undefined : (() => {
		try {
			const serialized = JSON.stringify(lastFeedback);
			return serialized.length <= 8_192 ? lastFeedback : { kind: "truncated-feedback" };
		} catch {
			return undefined;
		}
	})();
	return {
		version: 1,
		cycle: typeof value.cycle === "number" && Number.isSafeInteger(value.cycle) && value.cycle >= 0 ? value.cycle : 0,
		repairCycles: typeof value.repairCycles === "number" && Number.isSafeInteger(value.repairCycles) && value.repairCycles >= 0 ? value.repairCycles : 0,
		protocolFailures: typeof value.protocolFailures === "number" && Number.isSafeInteger(value.protocolFailures) && value.protocolFailures >= 0 ? value.protocolFailures : 0,
		actionablePlanFailures: typeof value.actionablePlanFailures === "number" && Number.isSafeInteger(value.actionablePlanFailures) && value.actionablePlanFailures >= 0 ? value.actionablePlanFailures : 0,
		productiveCycles: typeof value.productiveCycles === "number" && Number.isSafeInteger(value.productiveCycles) && value.productiveCycles >= 0 ? value.productiveCycles : 0,
		...(assignment === undefined ? {} : { bossAssignment: assignment }),
		fallbackHistory: history,
		...(last === undefined ? {} : { lastDecision: last }),
		...(typeof value.lastProtocolError === "string" && value.lastProtocolError.trim() ? { lastProtocolError: value.lastProtocolError.trim().slice(0, 240) } : {}),
		...(lastInvocation === undefined ? {} : { lastInvocation }),
		...(boundedFeedback === undefined ? {} : { lastFeedback: boundedFeedback }),
		...(typeof value.lastRejectionFingerprint === "string" && value.lastRejectionFingerprint.trim() ? { lastRejectionFingerprint: value.lastRejectionFingerprint.trim().slice(0, 64) } : {}),
		...(typeof value.repeatedRejectionCount === "number" && Number.isSafeInteger(value.repeatedRejectionCount) && value.repeatedRejectionCount >= 0 ? { repeatedRejectionCount: value.repeatedRejectionCount } : {}),
		...(value.acceptanceCriteriaProvenance === "explicit" || value.acceptanceCriteriaProvenance === "labelled-goal" || value.acceptanceCriteriaProvenance === "derived-from-goal" ? { acceptanceCriteriaProvenance: value.acceptanceCriteriaProvenance } : {}),
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

const latestDecisionFor = (store: MissionStoreAdapter, missionId: string, taskId: string) =>
	store.listQualityDecisions(missionId, taskId).at(-1);

const rejectionFingerprintFor = (store: MissionStoreAdapter, missionId: string, taskId: string, repairInstruction?: string): string | undefined => {
	const decision = latestDecisionFor(store, missionId, taskId);
	if (!decision || decision.verdict === "pass") {
		const task = store.getTask(taskId);
		const attempt = task?.lastRunId ? store.getAttempt(task.lastRunId) : undefined;
		if (!attempt || attempt.status === "succeeded") return undefined;
		return qualityRejectionFingerprint({
			taskId,
			verdict: "worker-incomplete",
			requiredFixes: [attempt.terminalState ?? attempt.status],
			evidenceKind: attempt.status,
		});
	}
	const evidence = store.listEvidence(missionId).filter((item) => item.taskId !== undefined && String(item.taskId) === taskId).at(-1);
	return qualityRejectionFingerprint({
		taskId,
		verdict: decision.verdict,
		requiredFixes: decision.requiredFixes,
		notVerified: decision.criterionResults.filter((item) => item.status === "not_verified").map((item) => item.criterion),
		...(evidence?.kind === undefined ? {} : { evidenceKind: evidence.kind }),
		...(repairInstruction === undefined ? {} : { repairInstruction }),
	});
};

const repeatRejectedReason = (decision: ReturnType<typeof latestDecisionFor>, fallback: string): string => {
	const fix = decision?.requiredFixes[0] ?? decision?.reviewerSummary ?? fallback;
	if (!decision || decision.verdict === "pass") {
		return `Identical worker-incomplete strategy was not re-dispatched. Last outcome: ${fix}`.slice(0, 240);
	}
	return `Identical M7 rejection and repair strategy repeated. Last required fix: ${fix}`.slice(0, 240);
};

const incompleteRepeatThreshold = (store: MissionStoreAdapter, taskId: string): number => {
	const task = store.getTask(taskId);
	const attempt = task?.lastRunId ? store.getAttempt(task.lastRunId) : undefined;
	return attempt?.terminalState === "no_eligible_route" ? 1 : 2;
};

export function qualityPrecludesComplete(store: MissionStoreAdapter, missionId: string): { readonly summary: string; readonly requiredFixes: readonly string[]; readonly fingerprint?: string } | undefined {
	const active = activeMissionTasks(store, missionId);
	if (active.length === 0) return { summary: "Completion is impossible because no durable verified tasks exist", requiredFixes: [] };
	for (const task of active) {
		const quality = store.getTaskQualityStatus(task.taskId);
		if (task.status === "execution_completed" && quality?.status === "passed") continue;
		const decision = latestDecisionFor(store, missionId, String(task.taskId));
		const requiredFixes = decision?.requiredFixes ?? [];
		const summary = quality?.status === "blocked"
			? `Completion is impossible while task ${task.taskId} quality is blocked and M7 has not passed`
			: `Completion is impossible until task ${task.taskId} is executed and M7-verified`;
		const fingerprint = rejectionFingerprintFor(store, missionId, String(task.taskId), task.objective);
		return {
			summary,
			requiredFixes,
			...(fingerprint === undefined ? {} : { fingerprint }),
		};
	}
	return undefined;
}

export function formatBossLoopDiagnostics(mission: MissionRecord, taskCount: number): readonly string[] {
	const state = readState(mission);
	if (!state.bossAssignment && !state.lastDecision && !state.terminal && state.protocolFailures === 0 && state.actionablePlanFailures === 0 && state.lastInvocation === undefined) return [];
	const pin = state.bossAssignment?.remoteModelId ?? state.bossAssignment?.routeId;
	const fallback = state.fallbackHistory.length === 0
		? "none"
		: state.fallbackHistory.map((item) => `${item.fromRouteId} -> ${item.toRouteId}`).join("; ").slice(0, 240);
	return [
		...(pin === undefined ? [] : [`pinned Boss route: ${pin}`]),
		...(state.lastDecision === undefined ? [] : [`last Boss action: ${state.lastDecision.phase}/${state.lastDecision.action}`]),
		`protocol failures: ${state.protocolFailures}`,
		`actionable-plan failures: ${state.actionablePlanFailures}`,
		`tasks generated: ${taskCount}`,
		...(state.lastProtocolError === undefined ? [] : [`last protocol error: ${state.lastProtocolError}`]),
		...(state.lastInvocation === undefined ? [] : [
			`boss invocation stage: ${state.lastInvocation.stage}`,
			`boss invocation class: ${state.lastInvocation.failureClass}`,
			...(state.lastInvocation.stopReason === undefined ? [] : [`boss invocation stopReason: ${state.lastInvocation.stopReason}`]),
			`boss invocation hasText: ${state.lastInvocation.hasText ? "yes" : "no"}`,
			`boss invocation normalized: ${state.lastInvocation.normalized ? "yes" : "no"}`,
			...(state.lastInvocation.textBlocks === undefined ? [] : [`boss invocation textBlocks: ${state.lastInvocation.textBlocks}`]),
			...(state.lastInvocation.thinkingBlocks === undefined ? [] : [`boss invocation thinkingBlocks: ${state.lastInvocation.thinkingBlocks}`]),
			...(state.lastInvocation.fallbackAttempted === undefined ? [] : [`boss fallback attempted: ${state.lastInvocation.fallbackAttempted ? "yes" : "no"}`]),
			...(state.lastInvocation.fallbackSelectedRouteId === undefined ? [] : [`boss fallback selected: ${state.lastInvocation.fallbackSelectedRouteId}`]),
		]),
		...(state.acceptanceCriteriaProvenance === undefined ? [] : [`acceptance criteria provenance: ${state.acceptanceCriteriaProvenance}`]),
		...(state.terminal === undefined ? [] : [`boss terminal: ${state.terminal}`]),
		...(state.terminalReason === undefined ? [] : [`why execution stopped: ${state.terminalReason}`]),
		...(pin === undefined && state.fallbackHistory.length === 0 ? [] : [`boss fallback: ${fallback}`]),
	];
}

export function normalizeBossDecision(value: unknown, options?: { readonly phase?: "plan" | "evaluate" }): BossDecision {
	if (!isRecord(value)) throw new BossProtocolError("Boss decision is not an object");
	if (!["dispatch", "replan", "complete", "blocked", "awaiting_user"].includes(value.action as string)) throw new BossProtocolError("Boss decision action is invalid");
	const action = value.action as BossDecisionAction;
	const summary = text(value.summary);
	if (!summary) throw new BossProtocolError("Boss decision summary is missing");
	if (!Array.isArray(value.tasks)) throw new BossProtocolError("Boss tasks must be an array");
	if (value.tasks.length > 32) throw new BossProtocolError("Boss task plan exceeds the safety bound");
	if (value.acceptanceSatisfied !== undefined && typeof value.acceptanceSatisfied !== "boolean") throw new BossProtocolError("Boss acceptanceSatisfied must be a boolean");
	if (value.requiredFixes !== undefined && !Array.isArray(value.requiredFixes)) throw new BossProtocolError("Boss requiredFixes must be an array of strings");
	const tasks = value.tasks.map((task) => {
		if (!isRecord(task)) throw new BossProtocolError("Boss task plan is invalid");
		const roleId = text(task.roleId, 128);
		const objective = text(task.objective, 8_000);
		const executionClass = task.executionClass;
		if (!roleId || !objective || (executionClass !== "investigation" && executionClass !== "implementation" && executionClass !== "verification")) throw new BossProtocolError("Boss task plan is invalid");
		const poolId = task.poolId === undefined ? executionClass : task.poolId;
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
		} satisfies BossTaskSpec;
	});
	const requiresActionableTasks = action === "dispatch" || (action === "replan" && options?.phase !== "evaluate");
	if (requiresActionableTasks && tasks.length === 0) {
		throw new BossProtocolError(action === "dispatch" ? "dispatch requires at least one actionable task" : "replan requires at least one actionable task");
	}
	const requiredFixes = Array.isArray(value.requiredFixes) ? value.requiredFixes.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 2_000)).slice(0, 32) : undefined;
	return {
		action,
		summary,
		tasks,
		...(value.acceptanceSatisfied === undefined ? {} : { acceptanceSatisfied: value.acceptanceSatisfied === true }),
		...(requiredFixes === undefined ? {} : { requiredFixes }),
		...(normalizedTokenUsage(value.tokenUsage) === undefined ? {} : { tokenUsage: normalizedTokenUsage(value.tokenUsage) }),
	};
}

const invocationFromError = (error: unknown, extra: Partial<BossInvocationDiagnostic> = {}): BossInvocationDiagnostic | undefined => {
	const diagnostic = bossInvocationDiagnostic(error);
	return sanitizeBossInvocationDiagnostic({
		stage: extra.stage ?? "request",
		failureClass: extra.failureClass ?? "unknown",
		hasText: extra.hasText ?? false,
		normalized: extra.normalized ?? false,
		...extra,
		...(diagnostic ?? {}),
		...(extra.fallbackAttempted === undefined ? {} : { fallbackAttempted: extra.fallbackAttempted }),
		...(extra.fallbackSelectedRouteId === undefined ? {} : { fallbackSelectedRouteId: extra.fallbackSelectedRouteId }),
	});
};

const infrastructureTerminalReason = (error: unknown, phase: "plan" | "evaluate"): string => {
	const message = error instanceof Error && error.message.trim() ? error.message.trim().slice(0, 180) : "Boss infrastructure is unavailable";
	const prefix = phase === "evaluate" && !/during evaluation/iu.test(message) ? `${message} during evaluation` : message;
	return `${prefix}; no configured fallback remains`.slice(0, 240);
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
			bossProtocolFailures: withTerminal.protocolFailures,
			bossActionablePlanFailures: withTerminal.actionablePlanFailures,
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
	if (mission.status === "completed" || mission.status === "cancelled" || mission.status === "blocked" || mission.status === "awaiting-review") {
		const existingTerminal = state.terminal
			?? (mission.status === "completed" ? "COMPLETED" : mission.status === "cancelled" ? "CANCELLED" : mission.status === "awaiting-review" ? "AWAITING_USER" : "BLOCKED");
		const status = mission.status === "completed" || mission.status === "cancelled" || mission.status === "blocked" || mission.status === "awaiting-review"
			? mission.status
			: missionStatusForTerminal(existingTerminal);
		return { status, terminal: existingTerminal, cycles: state.cycle, mission, ...(assignment === undefined ? {} : { assignment }) };
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
				const canonicalProjection = projectBossCanonicalState(options.store, mission);
				return {
					decision: normalizeBossDecision(await invokeBoss({
						mission,
						assignment: currentAssignment,
						cycle,
						phase,
						canonicalProjection,
						...(extra.feedback === undefined ? {} : { feedback: extra.feedback }),
						...(extra.taskOutcomes === undefined ? {} : { taskOutcomes: extra.taskOutcomes }),
						...(extra.signal === undefined ? {} : { signal: extra.signal }),
					}), { phase }),
				};
			} catch (error) {
				if (isBossCancellationCause(error, extra.signal ?? options.signal) || isBossSafetyStopCause(error)) return { error };
				if (!(error instanceof BossRuntimeError) || error.kind !== "infrastructure") {
					const diagnostic = invocationFromError(error, { stage: "decision-protocol", failureClass: "decision_protocol", fallbackAttempted: false });
					if (diagnostic !== undefined) state = { ...state, lastInvocation: diagnostic };
					return { error };
				}
				const failed = invocationFromError(error, { stage: "request", failureClass: "provider_unavailable", fallbackAttempted: false });
				if (failed !== undefined) state = { ...state, lastInvocation: failed };
				const replacement = selectBossFallbackEntry(options.entries, currentAssignment, state.fallbackHistory);
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
				const invocation = invocationFromError(error, { fallbackAttempted: true, fallbackSelectedRouteId: replacement.routeId }) ?? failed;
				state = {
					...state,
					bossAssignment: nextAssignment,
					fallbackHistory: [...state.fallbackHistory, { fromRouteId: currentAssignment.routeId, toRouteId: replacement.routeId, reason }],
					...(invocation === undefined ? {} : { lastInvocation: invocation }),
				};
				assignment = nextAssignment;
				mission = persistState(options.store, mission, state, { kind: "boss-fallback", fromRouteId: nextAssignment.fallbackFromRouteId, toRouteId: nextAssignment.routeId, reason, stage: invocation?.stage, failureClass: invocation?.failureClass });
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
	if (mission.acceptanceCriteria.length === 0) {
		const resolved = resolveMissionAcceptanceCriteria(mission.goal);
		if (resolved.criteria.length > 0) {
			mission = options.store.updateMission(mission.missionId, { acceptanceCriteria: resolved.criteria }, { actor: "boss", expectedRevision: mission.revision, metadata: { kind: "boss-acceptance-criteria", provenance: resolved.provenance } });
			state = { ...state, acceptanceCriteriaProvenance: resolved.provenance };
			mission = persistState(options.store, mission, state, { kind: "boss-acceptance-criteria", provenance: resolved.provenance });
		}
	} else if (state.acceptanceCriteriaProvenance === undefined) {
		state = { ...state, acceptanceCriteriaProvenance: inferAcceptanceCriteriaProvenance(mission.goal, mission.acceptanceCriteria) };
		mission = persistState(options.store, mission, state, { kind: "boss-acceptance-criteria", provenance: state.acceptanceCriteriaProvenance });
	}
	const capability = evaluateMissionCapability(mission.goal, mission.acceptanceCriteria);
	if (!capability.allowed) {
		if (mission.status !== "running") mission = options.store.transitionMission(missionId, "running", { actor: "boss", expectedRevision: mission.revision, metadata: { kind: "boss-capability-preflight" } });
		return terminal(options.store, mission, state, "AWAITING_USER", capabilityMismatchReason(capability), state.cycle, options, clock, "CAPABILITY_MISMATCH");
	}
	const budgetExhaustedReason = (cycles: number, detail: string): string => {
		const tasks = options.store.listTasks(missionId).length;
		const pin = state.bossAssignment?.remoteModelId ?? state.bossAssignment?.routeId ?? "none";
		const last = state.lastDecision ? `${state.lastDecision.phase}/${state.lastDecision.action}` : "none";
		return `${detail}; cycles=${cycles}; tasks=${tasks}; protocolFailures=${state.protocolFailures}; actionablePlanFailures=${state.actionablePlanFailures}; lastAction=${last}; pin=${String(pin).slice(0, 64)}; fallback=${state.fallbackHistory.length === 0 ? "none" : "yes"}`.slice(0, 240);
	};
	let repeatedProtocolErrorCount = 0;
	const recordProtocolFailure = (error: unknown): { readonly repeated: boolean } => {
		const summary = error instanceof Error ? error.message.slice(0, 240) : "Boss planning failed";
		const actionable = error instanceof BossProtocolError && /requires at least one actionable task/u.test(error.message);
		const invocation = invocationFromError(error, { stage: "decision-protocol", failureClass: "decision_protocol", fallbackAttempted: false });
		if (state.lastProtocolError === summary) {
			repeatedProtocolErrorCount += 1;
		} else {
			repeatedProtocolErrorCount = 1;
		}
		state = {
			...state,
			protocolFailures: state.protocolFailures + 1,
			...(actionable ? { actionablePlanFailures: state.actionablePlanFailures + 1 } : {}),
			lastProtocolError: summary,
			...(invocation === undefined ? {} : { lastInvocation: invocation }),
		};
		mission = persistState(options.store, mission, state, { kind: "boss-protocol-failure", summary, actionable, stage: invocation?.stage, failureClass: invocation?.failureClass });
		return { repeated: repeatedProtocolErrorCount >= Math.min(maxCycles, 4) };
	};
	let feedback: unknown = state.lastFeedback;
	for (let cycle = state.cycle; cycle < maxCycles; cycle += 1) {
		if (options.signal?.aborted) return stopCancelled(mission, "Mission cancelled before the next Boss cycle", cycle);
		state = { ...state, cycle };
		mission = persistState(options.store, mission, state, { kind: "boss-cycle-start", cycle, routeId: assignment.routeId });
		const planned = await invokeWithFallback("plan", cycle, { ...(feedback === undefined ? {} : { feedback }), ...(options.signal === undefined ? {} : { signal: options.signal }) });
		if (planned.decision === undefined) {
			if (isBossCancellationCause(planned.error, options.signal)) return stopCancelled(mission, "Mission cancelled during Boss planning", cycle);
			if (isBossSafetyStopCause(planned.error)) return stopSafety(mission, planned.error, cycle);
			if (planned.error instanceof BossRuntimeError && planned.error.kind === "infrastructure") return terminal(options.store, mission, state, "BLOCKED", infrastructureTerminalReason(planned.error, "plan"), cycle, options, clock);
			const failureOutcome = recordProtocolFailure(planned.error);
			const errorSummary = planned.error instanceof Error ? planned.error.message.slice(0, 240) : "Boss planning failed";
			feedback = {
				kind: "boss-plan-failure",
				summary: errorSummary,
				violation: errorSummary,
				contract: "submit_boss_decision",
				reminder: "Call the submit_boss_decision tool with action, summary, and tasks.",
				protocolFailures: state.protocolFailures,
				actionablePlanFailures: state.actionablePlanFailures,
			};
			state = { ...state, lastFeedback: feedback };
			mission = persistState(options.store, mission, state, { kind: "boss-plan-failure-feedback" });
			if (failureOutcome.repeated) {
				return terminal(options.store, mission, state, "AWAITING_USER", budgetExhaustedReason(cycle + 1, `Boss planning repeated identical protocol failure: ${errorSummary}`), cycle + 1, options, clock);
			}
			if (cycle + 1 >= maxCycles) return terminal(options.store, mission, state, "AWAITING_USER", budgetExhaustedReason(cycle + 1, "Boss planning did not produce a valid actionable plan"), cycle + 1, options, clock);
			continue;
		}
		const plan = planned.decision;
		state = { ...state, lastDecision: { phase: "plan", action: plan.action, summary: plan.summary } };
		mission = persistState(options.store, mission, state, { kind: "boss-plan", cycle, routeId: assignment.routeId, action: plan.action });
		if (plan.action === "blocked") return terminal(options.store, mission, state, "BLOCKED", plan.summary, cycle + 1, options, clock);
		if (plan.action === "awaiting_user") return terminal(options.store, mission, state, "AWAITING_USER", plan.summary, cycle + 1, options, clock);
		if (plan.action === "complete") {
			const precluded = qualityPrecludesComplete(options.store, missionId);
			if (!precluded && plan.acceptanceSatisfied === true && completedAndVerified(options.store, missionId)) return terminal(options.store, mission, state, "COMPLETED", plan.summary, cycle + 1, options, clock);
			feedback = {
				kind: "boss-completion-rejected",
				summary: precluded?.summary ?? "Completion was requested before all tasks and verification gates passed",
				requiredFixes: precluded?.requiredFixes ?? [],
				...(precluded?.fingerprint === undefined ? {} : { rejectionFingerprint: precluded.fingerprint }),
			};
			mission = persistState(options.store, mission, state, { kind: "boss-completion-rejected", summary: String((feedback as { summary: string }).summary), requiredFixes: precluded?.requiredFixes ?? [] });
		}
		const taskOutcomes: BossTaskOutcome[] = [];
		const verificationOutcomes: BossVerificationOutcome[] = [];
		for (const spec of plan.tasks.slice(0, maxTasks)) {
			if (options.signal?.aborted) return stopCancelled(mission, "Mission cancelled before worker dispatch", cycle + 1);
			const task = resolveOrCreateMissionTask(options.store, missionId, spec);
			const alreadyVerified = task.status === "execution_completed" && options.store.getTaskQualityStatus(task.taskId)?.status === "passed";
			if (alreadyVerified) {
				taskOutcomes.push({ taskId: String(task.taskId), status: "succeeded", summary: "already completed and verified" });
				verificationOutcomes.push({ taskId: String(task.taskId), verdict: "pass", summary: "already verified" });
				continue;
			}
			const plannedFingerprint = rejectionFingerprintFor(options.store, missionId, String(task.taskId), spec.objective);
			if (plannedFingerprint && state.lastRejectionFingerprint === plannedFingerprint && (state.repeatedRejectionCount ?? 0) >= incompleteRepeatThreshold(options.store, String(task.taskId))) {
				const decision = latestDecisionFor(options.store, missionId, String(task.taskId));
				mission = persistState(options.store, mission, state, { kind: "boss-repeat-rejected", fingerprint: plannedFingerprint, repeatedRejectionCount: state.repeatedRejectionCount, taskId: String(task.taskId) });
				return terminal(options.store, mission, state, "AWAITING_USER", repeatRejectedReason(decision, "worker did not complete"), cycle + 1, options, clock);
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
				if (verification.verdict === "pass") {
					for (const evidence of options.store.listEvidence(missionId, "proposed")) {
						if (evidence.taskId === undefined || String(evidence.taskId) !== String(task.taskId)) continue;
						try { options.store.promoteEvidence(evidence.evidenceId, { actor: "boss", target: "completedWork" }); } catch { /* stale evidence remains proposed */ }
					}
					mission = options.store.getMission(missionId) ?? mission;
				} else if (verification.verdict === "blocked" || verification.verdict === "reject") {
					const fp = rejectionFingerprintFor(options.store, missionId, String(task.taskId), spec.objective);
					if (fp) {
						const count = state.lastRejectionFingerprint === fp ? (state.repeatedRejectionCount ?? 1) + 1 : 1;
						state = { ...state, lastRejectionFingerprint: fp, repeatedRejectionCount: count };
						if (count >= incompleteRepeatThreshold(options.store, String(task.taskId))) {
							mission = persistState(options.store, mission, state, { kind: "boss-repeat-rejected", fingerprint: fp, repeatedRejectionCount: count, taskId: String(task.taskId) });
							const decision = latestDecisionFor(options.store, missionId, String(task.taskId));
							return terminal(options.store, mission, state, "AWAITING_USER", repeatRejectedReason(decision, verification.summary), cycle + 1, options, clock);
						}
					}
				}
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
		feedback = {
			kind: "boss-cycle-results",
			plan: { action: plan.action, summary: plan.summary },
			taskOutcomes,
			verificationOutcomes,
			...(isRecord(feedback) && feedback.kind === "boss-completion-rejected" ? { completionRejected: feedback } : {}),
		};
		if (options.signal?.aborted) return stopCancelled(mission, "Mission cancelled before Boss evaluation", cycle + 1);
		const evaluated = await invokeWithFallback("evaluate", cycle, { feedback, taskOutcomes, ...(options.signal === undefined ? {} : { signal: options.signal }) });
		if (evaluated.decision === undefined) {
			if (isBossCancellationCause(evaluated.error, options.signal)) return stopCancelled(mission, "Mission cancelled during Boss evaluation", cycle + 1);
			if (isBossSafetyStopCause(evaluated.error)) return stopSafety(mission, evaluated.error, cycle + 1);
			if (evaluated.error instanceof BossRuntimeError && evaluated.error.kind === "infrastructure") return terminal(options.store, mission, state, "BLOCKED", infrastructureTerminalReason(evaluated.error, "evaluate"), cycle + 1, options, clock);
			recordProtocolFailure(evaluated.error);
			state = { ...state, lastFeedback: feedback };
			mission = persistState(options.store, mission, state, { kind: "boss-evaluation-failure-feedback" });
			if (cycle + 1 >= maxCycles) return terminal(options.store, mission, state, "AWAITING_USER", budgetExhaustedReason(cycle + 1, "Boss evaluation did not complete within the safety bound"), cycle + 1, options, clock);
			continue;
		}
		const evaluation = evaluated.decision;
		state = { ...state, lastDecision: { phase: "evaluate", action: evaluation.action, summary: evaluation.summary } };
		mission = persistState(options.store, mission, state, { kind: "boss-evaluation", cycle, routeId: assignment.routeId, action: evaluation.action, verification: verificationOutcomes.map((item) => item.verdict) });
		if (evaluation.action === "blocked") return terminal(options.store, mission, state, "BLOCKED", evaluation.summary, cycle + 1, options, clock);
		if (evaluation.action === "awaiting_user") return terminal(options.store, mission, state, "AWAITING_USER", evaluation.summary, cycle + 1, options, clock);
		if (evaluation.action === "complete") {
			const precluded = qualityPrecludesComplete(options.store, missionId);
			if (!precluded && evaluation.acceptanceSatisfied === true && completedAndVerified(options.store, missionId)) return terminal(options.store, mission, state, "COMPLETED", evaluation.summary, cycle + 1, options, clock);
			feedback = {
				kind: "boss-completion-rejected",
				summary: precluded?.summary ?? "Evaluation did not meet the durable task and M7 gates",
				requiredFixes: precluded?.requiredFixes ?? [],
				...(precluded?.fingerprint === undefined ? {} : { rejectionFingerprint: precluded.fingerprint }),
			};
			mission = persistState(options.store, mission, state, { kind: "boss-completion-rejected", summary: String((feedback as { summary: string }).summary), requiredFixes: precluded?.requiredFixes ?? [] });
		}
		state = {
			...state,
			cycle: cycle + 1,
			lastFeedback: feedback,
			productiveCycles: (state.productiveCycles ?? 0) + (taskOutcomes.length > 0 ? 1 : 0),
		};
		mission = persistState(options.store, mission, state, { kind: "boss-cycle-progress", cycle: cycle + 1 });
		if (cycle + 1 >= maxCycles) return terminal(options.store, mission, state, "AWAITING_USER", budgetExhaustedReason(cycle + 1, "Mission safety budget exhausted before the goal and acceptance criteria were proven"), cycle + 1, options, clock);
	}
	return terminal(options.store, mission, state, "AWAITING_USER", budgetExhaustedReason(maxCycles, "Mission loop ended without a terminal acceptance decision"), maxCycles, options, clock);
}
