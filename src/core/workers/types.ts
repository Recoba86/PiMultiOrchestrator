import type {
	AgentSession,
	AgentSessionEvent,
	ModelRuntime,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import type { StableId } from "../config/types.js";
import type {
	FailureAction,
	FailureClassification,
	FailureInput,
	RoutingPolicy,
	RoutingRequest,
	SelectedRoute,
	AttemptChain,
} from "../routing/index.js";
import type { PoolId } from "../pools/index.js";
import type { WorkerSafetyContext } from "./safety.js";
import type { EffectiveThinkingEffort, ThinkingEffort } from "../thinking.js";

export const WORKER_PROTOCOL_VERSION = 1 as const;

export type WorkerModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

export type WorkerToolName = "read" | "grep" | "find" | "ls" | "bash" | "edit" | "write";
export type WorkerRoleId = string & { readonly __workerRoleId: unique symbol };

export interface WorkerTimeoutPolicy {
	readonly timeoutMs?: number;
}

/** Explicit child input. M5 does not infer a pool from role text. */
export interface SubagentExecutionRequest extends WorkerTimeoutPolicy {
	readonly roleId: string;
	readonly poolId: PoolId;
	readonly task: string;
	readonly cwd: string;
	readonly acceptanceCriteria?: readonly string[];
	readonly diversity?: RoutingRequest["diversity"];
	readonly excludedRouteIds?: readonly StableId[];
	/** Pool-entry policy; absence is the legacy/Auto semantic. */
	readonly thinkingEffort?: ThinkingEffort;
}

export interface ProtocolCaptureState {
	readonly captured?: unknown;
	readonly submissionCount: number;
	readonly protocolViolation: boolean;
}

/** Data-only child result protocol. M5 owns state and tool construction. */
export interface ResultProtocolSpec {
	readonly toolName: string;
	readonly parameters: ToolDefinition["parameters"];
}

export type ChildResultProtocol = ResultProtocolSpec;

export type StructuredChildStatus = "completed" | "blocked";

export interface ChildTestResult {
	readonly command: string;
	readonly outcome: string;
}

export interface StructuredChildResult {
	readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
	readonly status: StructuredChildStatus;
	readonly summary: string;
	readonly evidence: readonly string[];
	readonly filesChanged: readonly string[];
	readonly tests: readonly ChildTestResult[];
	readonly risks: readonly string[];
	readonly questions: readonly string[];
}

export interface ToolObservation {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly potentialMutation: boolean;
	readonly startedAt: string;
	readonly endedAt?: string;
	readonly completed: boolean;
	readonly isError?: boolean;
}

/**
 * Numeric usage reported by Pi's 0.84.1 AssistantMessage.  Fields remain
 * optional because providers may omit cache/reasoning/cost details; unknown
 * values are not replaced with zero.
 */
export interface WorkerUsageCost {
	readonly input?: number;
	readonly output?: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
	readonly total?: number;
}

export interface WorkerUsage {
	readonly input?: number;
	readonly output?: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
	readonly cacheWrite1h?: number;
	readonly reasoning?: number;
	readonly totalTokens?: number;
	readonly cost?: WorkerUsageCost;
}

export type AttemptTerminalOutcome =
	| "completed"
	| "invalid_child_result"
	| "protocol_violation"
	| "cancelled"
	| "timed_out"
	| "infrastructure_failure"
	| "child_runtime_error";

export interface SubagentAttempt {
	readonly attemptId: string;
	readonly routeId: StableId;
	readonly remoteModelId: string;
	readonly retryIndex: number;
	readonly startedAt: string;
	readonly endedAt: string;
	readonly outcome: AttemptTerminalOutcome;
	readonly infrastructureFailure?: import("../routing/index.js").FailureClassification;
	readonly failureAction?: FailureAction;
	readonly toolNamesUsed: readonly string[];
	readonly toolObservations: readonly ToolObservation[];
	readonly potentialMutationObserved: boolean;
	readonly usage?: WorkerUsage;
	/** Wall-clock duration of this route attempt, when timestamps are valid. */
	readonly latencyMs?: number;
	readonly structuredResult?: StructuredChildResult;
	/** Result emitted by a non-default bounded protocol (kept separate for M7). */
	readonly protocolResult?: unknown;
	readonly sessionTerminalState: "idle" | "aborted" | "disposed" | "error";
	readonly errorMessage?: string;
	readonly requestedThinkingEffort?: ThinkingEffort;
	readonly effectiveThinkingEffort?: EffectiveThinkingEffort;
}

export type SubagentTerminalStatus =
	| "completed"
	| "cancelled"
	| "timed_out"
	| "no_eligible_route"
	| "infrastructure_stopped"
	| "partial_mutation_requires_review"
	| "invalid_child_result"
	| "child_runtime_error";

export interface SubagentRunResult {
	readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
	readonly runId: string;
	readonly roleId: string;
	readonly poolId: PoolId;
	readonly terminalStatus: SubagentTerminalStatus;
	readonly finalRouteId?: StableId;
	readonly finalRemoteModelId?: string;
	readonly attempts: readonly SubagentAttempt[];
	readonly structuredResult?: StructuredChildResult;
	readonly protocolResult?: unknown;
	readonly potentialMutationObserved: boolean;
	readonly fallbackCount: number;
	readonly summary: string;
	readonly requestedThinkingEffort?: ThinkingEffort;
	readonly effectiveThinkingEffort?: EffectiveThinkingEffort;
}

export interface ResolvedWorkerRoute {
	readonly routeId: StableId;
	/** Exact remote model ID; display names are never used for lookup. */
	readonly remoteModelId: string;
	readonly model: WorkerModel;
	readonly modelRuntime: ModelRuntime;
}

export interface RouteRequestInput {
	readonly request: SubagentExecutionRequest;
	readonly attemptedRouteIds: readonly StableId[];
	readonly excludedRouteIds: readonly StableId[];
}

/** Adapter boundary for M4. It supplies candidates/policy and exact route models. */
export interface RouteAttemptAdapter {
	readonly policy: RoutingPolicy;
	routingRequest(input: RouteRequestInput): RoutingRequest | Promise<RoutingRequest>;
	resolveRoute(routeId: StableId): ResolvedWorkerRoute | Promise<ResolvedWorkerRoute>;
	readonly recordSuccess?: (routeId: StableId, at: Date) => unknown | Promise<unknown>;
	readonly recordFailure?: (routeId: StableId, failure: FailureClassification, at: Date) => unknown | Promise<unknown>;
}

export interface ChildSessionOptions {
	readonly cwd: string;
	readonly route: ResolvedWorkerRoute;
	readonly request: SubagentExecutionRequest;
	readonly toolNames: readonly WorkerToolName[];
	readonly resultProtocol: ResultProtocolSpec;
	readonly safety?: WorkerSafetyContext;
	readonly signal?: AbortSignal;
}

export interface ChildSessionHandle {
	readonly session: AgentSession;
	readonly toolNames: readonly string[];
	readonly protocolState: ProtocolCaptureState;
	readonly dispose: () => void;
}

export interface ChildSessionFactory {
	create(options: ChildSessionOptions): Promise<ChildSessionHandle>;
}

export interface WorkerProgressEvent {
	readonly type: "attempt_started" | "tool_started" | "tool_finished" | "attempt_finished" | "fallback";
	readonly runId: string;
	readonly attemptId?: string;
	readonly routeId?: StableId;
	readonly remoteModelId?: string;
	readonly toolName?: string;
	readonly failureAction?: FailureAction;
	readonly failure?: FailureClassification;
}

export interface SubagentExecutorOptions {
	readonly routeAdapter: RouteAttemptAdapter;
	readonly safety?: WorkerSafetyContext;
	readonly clock?: () => Date;
	readonly onProgress?: (event: WorkerProgressEvent) => void;
	readonly resultProtocolFactory?: (request: SubagentExecutionRequest) => ResultProtocolSpec;
}

export interface ResultToolState {
	readonly submitted: StructuredChildResult | undefined;
	readonly submissionCount: number;
	readonly protocolViolation: boolean;
}

export type WorkerSessionEvent = AgentSessionEvent;

/** Error with a privacy-safe machine-readable worker code. */
export type WorkerErrorCode =
	| "invalid-request"
	| "invalid-cwd"
	| "route-resolution"
	| "route-model-mismatch"
	| "session-create"
	| "protocol";

export class WorkerError extends Error {
	readonly code: WorkerErrorCode;

	constructor(code: WorkerErrorCode, message: string) {
		super(message);
		this.name = "WorkerError";
		this.code = code;
	}
}

export interface AttemptContext {
	readonly attemptId: string;
	readonly runId: string;
	readonly route: ResolvedWorkerRoute;
	readonly selected: SelectedRoute;
	readonly chain: AttemptChain;
}

export interface WorkerFailureContext {
	readonly routeId: StableId;
	readonly failure: FailureClassification;
	readonly attempt: SubagentAttempt;
}

export type SafeFailureInput = FailureInput;
