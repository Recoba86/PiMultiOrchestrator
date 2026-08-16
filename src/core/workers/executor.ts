import { realpath, stat } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

import {
	classifyFailure,
	createAttemptChain,
	isInfrastructureHealthFailure,
	nextAfterFailure,
	recordAttempt,
	resultCapabilityFailure,
	selectRoute,
	type FailureClassification,
	type FailureInput,
	type RoutingRequest,
} from "../routing/index.js";
import { POOL_IDS } from "../pools/index.js";
import { createAgentResultProtocol, parseStructuredChildResult, readProtocolCapture } from "./result-tool.js";
import { parseVerificationResult } from "../quality/gate.js";
import { parseRecoveryAssessment } from "../recovery/assessment.js";
import { defaultChildSessionFactory } from "./session.js";
import { extractWorkerUsage } from "./usage.js";
import {
	installOneTurnStop,
	notRequiredFinalization,
	reportFromCapture,
	restrictSessionToResultTool,
	resultFinalizationPrompt,
	shouldRunResultFinalization,
	skippedSafetyFinalization,
} from "./finalization.js";
import { isPotentiallyMutatingTool, toolProfileForPool } from "./profiles.js";
import {
	WORKER_PROTOCOL_VERSION,
	WorkerError,
	type ChildSessionFactory,
	type RouteAttemptAdapter,
	type RouteRequestInput,
	type StructuredChildResult,
	type SubagentAttempt,
	type SubagentExecutionRequest,
	type SubagentRunResult,
	type SubagentTerminalStatus,
	type ToolObservation,
	type WorkerUsage,
	 type WorkerProgressEvent,
	 type SubagentExecutorOptions,
	 type ResolvedWorkerRoute,
	type ResultProtocolSpec,
	type ProtocolCaptureState,
	type WorkerFinalizationReport,
} from "./types.js";
import type { WorkerSafetyContext } from "./safety.js";
import type { StableId } from "../config/types.js";
import { THINKING_EFFORTS, type EffectiveThinkingEffort } from "../thinking.js";

let sequence = 0;
const testSessionFactories = new WeakMap<object, ChildSessionFactory>();

/** @internal Test-only seam; the public executor always uses the guarded Pi factory. */
export function createSubagentExecutorForTesting(options: SubagentExecutorOptions, sessionFactory: ChildSessionFactory): SubagentExecutor {
	testSessionFactories.set(options as object, sessionFactory);
	return new SubagentExecutor(options);
}

/**
 * Foreground child executor. Route selection and health remain M4 adapter
 * responsibilities; this layer only runs one exact route at a time.
 */
export class SubagentExecutor {
	private readonly routeAdapter: RouteAttemptAdapter;
	private readonly sessionFactory: ChildSessionFactory;
	private readonly clock: () => Date;
	private readonly onProgress: ((event: WorkerProgressEvent) => void) | undefined;
	private readonly resultProtocolFactory: ((request: SubagentExecutionRequest) => ResultProtocolSpec) | undefined;
	private readonly safety: WorkerSafetyContext | undefined;

	constructor(options: SubagentExecutorOptions) {
		this.routeAdapter = options.routeAdapter;
		this.sessionFactory = testSessionFactories.get(options as object) ?? defaultChildSessionFactory;
		testSessionFactories.delete(options as object);
		this.clock = options.clock ?? (() => new Date());
		this.onProgress = options.onProgress;
		this.resultProtocolFactory = options.resultProtocolFactory;
		this.safety = options.safety;
	}

	run(request: SubagentExecutionRequest, signal?: AbortSignal): Promise<SubagentRunResult> {
		return this.runValidated(request, signal);
	}

	private async runValidated(request: SubagentExecutionRequest, signal?: AbortSignal): Promise<SubagentRunResult> {
		const validated = await validateExecutionRequest(request, this.routeAdapter.policy.timeoutMs);
		const runId = nextId("run");
		if (signal?.aborted) return cancelledResult(runId, validated);
		if (validated.poolId === "implementation") {
			return withCwdLock(validated.cwd, () => this.execute(runId, validated, signal));
		}
		return this.execute(runId, validated, signal);
	}

	private async execute(runId: string, request: SubagentExecutionRequest, signal?: AbortSignal): Promise<SubagentRunResult> {
		let chain = createAttemptChain(request.poolId, this.clock());
		const attempts: SubagentAttempt[] = [];
		let currentRouteId: StableId | undefined;
		let retryIndex = 0;
		let fallbackCount = 0;

		while (true) {
			if (signal?.aborted) return cancelledResult(runId, request, attempts, fallbackCount);
			const routingInput: RouteRequestInput = {
				request,
				attemptedRouteIds: chain.attemptedRouteIds,
				excludedRouteIds: request.excludedRouteIds ?? [],
			};
			let supplied: RoutingRequest;
			try {
				supplied = await this.routeAdapter.routingRequest(routingInput);
			} catch {
				return resultBase(runId, request, "child_runtime_error", attempts, fallbackCount, "Route selection could not be prepared");
			}
			const routingRequest: RoutingRequest = {
				...supplied,
				poolId: request.poolId,
				now: this.clock(),
				schedulingKey: runId,
				attemptedRouteIds: chain.attemptedRouteIds,
				excludedRouteIds: request.excludedRouteIds ?? [],
				...(request.diversity === undefined ? {} : { diversity: request.diversity }),
			};
			let decision: import("../routing/index.js").RoutingDecision;
			try {
				decision = currentRouteId === undefined
					? selectRoute(routingRequest)
					: retrySelection(currentRouteId, routingRequest);
			} catch {
				return resultBase(runId, request, "child_runtime_error", attempts, fallbackCount, "Route selection failed");
			}
			if (decision.kind !== "SELECTED") {
				return resultBase(runId, request, "no_eligible_route", attempts, fallbackCount, "No eligible route is available");
			}

			const selected = decision;
				const routeId = selected.routeId;
				const selectedCandidate = routingRequest.candidates.find((item) => item.routeId === routeId);
				const selectionKind = currentRouteId === undefined ? (fallbackCount > 0 ? "fallback" : "scheduled") : "retry";
				const schedulerPolicy = routingRequest.schedulingPolicy ?? "priority";
			const attemptRequest: SubagentExecutionRequest = {
				...request,
				thinkingEffort: selectedCandidate?.thinkingEffort ?? request.thinkingEffort ?? "auto",
			};
			let route: ResolvedWorkerRoute;
			try {
				route = await this.resolveExactRoute(routeId, selected, routingRequest);
			} catch (error) {
				if (signal?.aborted) return cancelledResult(runId, request, attempts, fallbackCount);
				const attemptId = nextId("attempt");
				const candidate = routingRequest.candidates.find((item) => item.routeId === routeId);
				const now = this.clock().toISOString();
				attempts.push({
					attemptId,
					routeId,
					remoteModelId: candidate?.remoteModelId ?? "unknown",
					retryIndex,
					startedAt: now,
					endedAt: now,
					outcome: "child_runtime_error",
					toolNamesUsed: [],
					toolObservations: [],
					potentialMutationObserved: false,
					sessionTerminalState: "error",
					errorMessage: "Route resolution failed",
					requestedThinkingEffort: attemptRequest.thinkingEffort ?? "auto",
						effectiveThinkingEffort: "unknown",
						selectionKind,
						schedulerPolicy,
						configuredWeight: candidate?.weight ?? 1,
						...(candidate?.poolPosition === undefined ? {} : { poolPosition: candidate.poolPosition }),
					});
				return resultBase(runId, request, "child_runtime_error", attempts, fallbackCount, "Child route could not be resolved");
			}
			const attemptId = nextId("attempt");
			this.emit({ type: "attempt_started", runId, attemptId, routeId, remoteModelId: route.remoteModelId });
			const single = await this.executeAttempt({
				runId,
				attemptId,
				route,
				selected,
				request: attemptRequest,
					retryIndex,
					selectionKind,
					schedulerPolicy,
					configuredWeight: selectedCandidate?.weight ?? 1,
					poolPosition: selected.poolPosition,
					...(signal === undefined ? {} : { signal }),
			});
			let attempt = single.attempt;
			attempts.push(attempt);
			const capabilityEligible = isResultCapabilityEligible(single);
			if (capabilityEligible) single.failure = resultCapabilityFailure();
			chain = recordAttempt(chain, routeId, single.failure);

			try {
				if (single.providerSucceeded) await this.routeAdapter.recordSuccess?.(routeId, new Date(this.clock().getTime()));
				if (single.failure !== undefined && isInfrastructureHealthFailure(single.failure.class)) await this.routeAdapter.recordFailure?.(routeId, single.failure, new Date(this.clock().getTime()));
			} catch {
				// Health persistence is operational feedback; it must not replay a child.
			}

			if (single.outcome === "cancelled") {
				return resultBase(
					runId,
					request,
					single.potentialMutation ? "partial_mutation_requires_review" : "cancelled",
					attempts,
					fallbackCount,
					single.potentialMutation ? "Child execution was cancelled after a potential mutation" : "Child execution was cancelled",
					route,
				);
			}
			if (single.outcome === "timed_out" && single.potentialMutation) return resultBase(runId, request, "partial_mutation_requires_review", attempts, fallbackCount, "Child timed out after a potential mutation", route);
			if (single.outcome === "timed_out") {
				// Executor timeout is an M4 infrastructure timeout when no mutation occurred.
				const timeout = classifyFailure({ timeout: true });
				attempt = { ...attempt, infrastructureFailure: timeout };
				attempts[attempts.length - 1] = attempt;
				single.failure = timeout;
			}
			if (single.outcome === "completed" && single.result !== undefined && !single.protocolViolation) {
				return resultBase(runId, request, "completed", attempts, fallbackCount, "Child execution completed; quality acceptance remains with the parent", route, single.result);
			}
			if (single.outcome === "invalid_child_result" || single.outcome === "protocol_violation") {
				if (single.potentialMutation || !capabilityEligible) {
					return resultBase(
						runId,
						request,
						single.potentialMutation ? "partial_mutation_requires_review" : "invalid_child_result",
						attempts,
						fallbackCount,
						single.potentialMutation ? "Child result protocol failed after a potential mutation" : "Child did not provide one valid structured result",
						route,
					);
				}
			} else if (single.potentialMutation) {
				return resultBase(runId, request, "partial_mutation_requires_review", attempts, fallbackCount, "Infrastructure failure followed a potential mutation", route);
			}
			if (single.outcome === "child_runtime_error") {
				return resultBase(runId, request, "child_runtime_error", attempts, fallbackCount, "Child runtime failed", route);
			}
			if (single.failure === undefined) {
				return resultBase(runId, request, "infrastructure_stopped", attempts, fallbackCount, "Infrastructure execution stopped", route);
			}

			const action = nextAfterFailure(chain, single.failure, routingRequest.policy);
			attempt = { ...attempt, failureAction: action };
			attempts[attempts.length - 1] = attempt;
			this.emit({ type: "fallback", runId, attemptId, routeId, remoteModelId: route.remoteModelId, failureAction: action, failure: single.failure });
			if (action === "STOP") {
				const terminalStatus: SubagentTerminalStatus = single.failure.class === "result_capability" || single.outcome === "invalid_child_result" || single.outcome === "protocol_violation"
					? "invalid_child_result"
					: single.outcome === "timed_out" ? "timed_out" : "infrastructure_stopped";
				return resultBase(runId, request, terminalStatus, attempts, fallbackCount, single.failure.safeMessage, route);
			}
			if (action === "RETRY_SAME_ROUTE") {
				currentRouteId = routeId;
				retryIndex += 1;
				continue;
			}
			fallbackCount += 1;
			currentRouteId = undefined;
			retryIndex = 0;
		}
	}

	private async resolveExactRoute(routeId: StableId, selected: import("../routing/index.js").SelectedRoute, request: RoutingRequest): Promise<ResolvedWorkerRoute> {
		const route = await this.routeAdapter.resolveRoute(routeId);
		if (route.routeId !== routeId) throw new WorkerError("route-resolution", "Route resolver returned a different route identity");
		const candidate = request.candidates.find((item) => item.routeId === routeId);
		if (!candidate || candidate.remoteModelId !== route.remoteModelId || selected.routeId !== routeId) {
			throw new WorkerError("route-model-mismatch", "Selected route does not match its exact remote model ID");
		}
		if (route.model.id !== route.remoteModelId) throw new WorkerError("route-model-mismatch", "Resolved child model is not the selected remote model");
		if (route.model.provider !== "9router") throw new WorkerError("route-model-mismatch", "Resolved child model belongs to a different provider");
		return route;
	}

	private async executeAttempt(options: {
		readonly runId: string;
		readonly attemptId: string;
		readonly route: ResolvedWorkerRoute;
		readonly selected: import("../routing/index.js").SelectedRoute;
		readonly request: SubagentExecutionRequest;
			readonly retryIndex: number;
			readonly selectionKind: "scheduled" | "retry" | "fallback";
			readonly schedulerPolicy: import("../config/types.js").PoolSchedulingPolicy;
			readonly configuredWeight: number;
			readonly poolPosition: number;
			readonly signal?: AbortSignal;
	}): Promise<SingleAttempt> {
		const startedAt = this.clock().toISOString();
		const resultProtocol = this.resultProtocolFactory?.(options.request) ?? createAgentResultProtocol();
		const observations: ToolObservation[] = [];
		const observationByCall = new Map<string, ToolObservationMutable>();
		let providerSucceeded = false;
		let outcome: import("./types.js").AttemptTerminalOutcome = "child_runtime_error";
		let failure: FailureClassification | undefined;
		let terminalState: SubagentAttempt["sessionTerminalState"] = "error";
		let protocolViolation = false;
		let result: unknown;
		let resultFinalization: WorkerFinalizationReport = notRequiredFinalization();
		let observedUsage: WorkerUsage | undefined;
		let effectiveThinkingEffort: EffectiveThinkingEffort = "unknown";
		let handle: Awaited<ReturnType<ChildSessionFactory["create"]>> | undefined;
		let unsubscribe: (() => void) | undefined;
		try {
			handle = await this.sessionFactory.create({
				cwd: options.request.cwd,
				route: options.route,
				request: options.request,
				toolNames: toolProfileForPool(options.request.poolId),
				resultProtocol,
				...(this.safety === undefined ? {} : { safety: this.safety }),
				...(options.signal === undefined ? {} : { signal: options.signal }),
			});
			effectiveThinkingEffort = observedThinkingEffort(handle.session);
			unsubscribe = handle.session.subscribe((event) => {
				if (event.type === "message_end") {
					const usage = extractWorkerUsage(event.message);
					if (usage) observedUsage = mergeWorkerUsage(observedUsage, usage);
				} else if (event.type === "tool_execution_start") {
					if (handle?.protocolState.submissionCount !== 0 && event.toolName !== resultProtocol.toolName) protocolViolation = true;
					const observation: ToolObservationMutable = {
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						potentialMutation: isPotentiallyMutatingTool(event.toolName),
						startedAt: this.clock().toISOString(),
						completed: false,
					};
					observationByCall.set(event.toolCallId, observation);
					this.emit({ type: "tool_started", runId: options.runId, attemptId: options.attemptId, routeId: options.route.routeId, remoteModelId: options.route.remoteModelId, toolName: event.toolName });
				} else if (event.type === "tool_execution_end") {
					const endedAt = this.clock().toISOString();
					const observation = observationByCall.get(event.toolCallId) ?? {
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						potentialMutation: isPotentiallyMutatingTool(event.toolName),
						startedAt: endedAt,
						completed: true,
					};
					observation.endedAt = endedAt;
					observation.completed = true;
					observation.isError = event.isError;
					observationByCall.set(event.toolCallId, observation);
					observations.push(observation);
					this.emit({ type: "tool_finished", runId: options.runId, attemptId: options.attemptId, routeId: options.route.routeId, remoteModelId: options.route.remoteModelId, toolName: event.toolName });
				}
			});
			const promptResult = await this.promptWithControl(handle.session, childPrompt(options.request, resultProtocol.toolName), options.request.timeoutMs ?? this.routeAdapter.policy.timeoutMs, options.signal);
			if (promptResult.kind === "cancelled") {
				outcome = "cancelled";
				terminalState = "aborted";
			} else if (promptResult.kind === "timed_out") {
				outcome = "timed_out";
				failure = classifyFailure({ timeout: true });
				terminalState = "aborted";
			} else if (promptResult.kind === "error") {
				failure = classifyFailure(failureInputFromError(promptResult.error));
				outcome = failure.class === "cancelled" ? "cancelled" : failure.class === "timeout" ? "timed_out" : "infrastructure_failure";
				terminalState = "error";
			} else {
				const messages = Array.isArray(handle.session.messages) ? handle.session.messages : [];
				const lastMessage = [...messages].reverse().find((message) => (message as { role?: string }).role === "assistant") as { stopReason?: string; errorMessage?: string; rawStopReason?: string } | undefined;
				if (observedUsage === undefined) observedUsage = extractWorkerUsage(lastMessage);
				if (lastMessage?.stopReason === "error") {
					failure = classifyFailure(failureInputFromProviderText(lastMessage.errorMessage ?? lastMessage.rawStopReason));
					outcome = failure.class === "timeout" ? "timed_out" : "infrastructure_failure";
					terminalState = "error";
				} else if (lastMessage?.stopReason === "aborted") {
					outcome = options.signal?.aborted ? "cancelled" : "timed_out";
					failure = options.signal?.aborted ? classifyFailure({ cancelled: true }) : classifyFailure({ timeout: true });
					terminalState = "aborted";
				} else {
					providerSucceeded = true;
					result = readProtocolResult(resultProtocol, handle.protocolState);
					protocolViolation ||= handle.protocolState.protocolViolation;
					terminalState = "idle";
					if (handle.safetyTerminated === true) {
						resultFinalization = skippedSafetyFinalization();
						outcome = result === undefined ? "invalid_child_result" : "completed";
					} else if (shouldRunResultFinalization({
						captured: result !== undefined,
						cancelled: options.signal?.aborted === true,
						safetyTerminated: false,
						providerSucceeded: true,
						protocolViolation,
					})) {
						const finalized = await this.runResultFinalization(handle.session, resultProtocol, handle.protocolState, options.request.timeoutMs ?? this.routeAdapter.policy.timeoutMs, options.signal);
						resultFinalization = finalized.report;
						if (finalized.prompt.kind === "cancelled") {
							outcome = "cancelled";
							terminalState = "aborted";
							resultFinalization = { required: true, attempted: true, succeeded: false, outcome: "cancelled", ...(finalized.report.toolsExposed === undefined ? {} : { toolsExposed: finalized.report.toolsExposed }) };
						} else if (finalized.prompt.kind === "timed_out") {
							outcome = "timed_out";
							failure = classifyFailure({ timeout: true });
							terminalState = "aborted";
							resultFinalization = { required: true, attempted: true, succeeded: false, outcome: "infrastructure_failure", ...(finalized.report.toolsExposed === undefined ? {} : { toolsExposed: finalized.report.toolsExposed }) };
						} else if (finalized.prompt.kind === "error") {
							failure = classifyFailure(failureInputFromError(finalized.prompt.error));
							outcome = failure.class === "cancelled" ? "cancelled" : failure.class === "timeout" ? "timed_out" : "infrastructure_failure";
							terminalState = "error";
							resultFinalization = {
								required: true,
								attempted: true,
								succeeded: false,
								outcome: failure.class === "cancelled" ? "cancelled" : "infrastructure_failure",
								...(finalized.report.toolsExposed === undefined ? {} : { toolsExposed: finalized.report.toolsExposed }),
							};
						} else {
							result = readProtocolResult(resultProtocol, handle.protocolState);
							protocolViolation = handle.protocolState.protocolViolation && result === undefined;
							resultFinalization = reportFromCapture(handle.protocolState, finalized.report.toolsExposed ?? [], result);
							outcome = result === undefined ? (protocolViolation ? "protocol_violation" : "invalid_child_result") : "completed";
						}
					} else {
						outcome = protocolViolation ? "protocol_violation" : result === undefined ? "invalid_child_result" : "completed";
					}
				}
			}
		} catch (error) {
			if (options.signal?.aborted) {
				outcome = "cancelled";
				terminalState = "aborted";
			} else if (error instanceof WorkerError) {
				outcome = "child_runtime_error";
				terminalState = "error";
			} else {
				failure = classifyFailure(failureInputFromError(error));
				outcome = failure.class === "cancelled" ? "cancelled" : failure.class === "timeout" ? "timed_out" : "infrastructure_failure";
				terminalState = "error";
			}
		} finally {
			// Let an in-flight abort publish its final tool event before detaching
			// observation. The bounded wait prevents a broken child implementation
			// from holding the route lock forever.
			try { if (handle) await boundedAbort(handle.session); } catch { /* abort cleanup is best effort */ }
			try { unsubscribe?.(); } catch { /* listener cleanup is best effort */ }
			try { handle?.dispose(); } catch { /* session cleanup is best effort */ }
			terminalState = terminalState === "error" ? "error" : "disposed";
		}
		const endedAt = this.clock().toISOString();
		const latencyMs = elapsedMilliseconds(startedAt, endedAt);
		const potentialMutationObserved = observations.some((observation) => observation.potentialMutation) || [...observationByCall.values()].some((observation) => observation.potentialMutation);
		const toolNamesUsed = [...new Set([...observations, ...observationByCall.values()].map((observation) => observation.toolName))];
		const attempt: SubagentAttempt = {
			attemptId: options.attemptId,
			routeId: options.route.routeId,
			remoteModelId: options.route.remoteModelId,
			retryIndex: options.retryIndex,
			startedAt,
			endedAt,
			outcome,
			...(failure === undefined ? {} : { infrastructureFailure: failure }),
			toolNamesUsed,
			toolObservations: observations,
			potentialMutationObserved,
			...(observedUsage === undefined ? {} : { usage: observedUsage }),
			...(latencyMs === undefined ? {} : { latencyMs }),
					...(isStructuredChildResult(result) ? { structuredResult: result } : {}),
					...(result === undefined ? {} : { protocolResult: result }),
			sessionTerminalState: terminalState,
			requestedThinkingEffort: options.request.thinkingEffort ?? "auto",
			effectiveThinkingEffort,
			selectionKind: options.selectionKind,
			schedulerPolicy: options.schedulerPolicy,
			configuredWeight: options.configuredWeight,
			poolPosition: options.poolPosition,
			resultFinalization,
			...(handle?.lastSafetyBlock?.toolName === undefined ? {} : { safetyBlockTool: handle.lastSafetyBlock.toolName }),
			...(handle?.lastSafetyBlock?.code === undefined ? {} : { safetyBlockCode: handle.lastSafetyBlock.code }),
		};
		this.emit({ type: "attempt_finished", runId: options.runId, attemptId: options.attemptId, routeId: options.route.routeId, remoteModelId: options.route.remoteModelId });
		return { attempt, outcome, failure, result, providerSucceeded, potentialMutation: potentialMutationObserved, protocolViolation };
	}

	private async runResultFinalization(
		session: import("@earendil-works/pi-coding-agent").AgentSession,
		protocol: ResultProtocolSpec,
		state: ProtocolCaptureState,
		timeoutMs: number,
		signal?: AbortSignal,
	): Promise<{ readonly report: WorkerFinalizationReport; readonly prompt: PromptOutcome }> {
		const toolsExposed = restrictSessionToResultTool(session, protocol.toolName);
		const restoreStop = installOneTurnStop(session);
		try {
			const prompt = await this.promptWithControl(session, resultFinalizationPrompt(protocol.toolName), timeoutMs, signal);
			if (prompt.kind !== "done") return { report: { required: true, attempted: true, succeeded: false, outcome: "missing", toolsExposed }, prompt };
			return { report: reportFromCapture(state, toolsExposed), prompt };
		} finally {
			restoreStop();
		}
	}

	private async promptWithControl(session: import("@earendil-works/pi-coding-agent").AgentSession, promptText: string, timeoutMs: number, signal?: AbortSignal): Promise<PromptOutcome> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let abortListener: (() => void) | undefined;
		const promptPromise = session.prompt(promptText).then(() => ({ kind: "done" as const }), (error: unknown) => ({ kind: "error" as const, error }));
		const control = new Promise<PromptOutcome>((resolve) => {
			if (signal?.aborted) {
				resolve({ kind: "cancelled" });
				return;
			}
			abortListener = () => {
				void session.abort().catch(() => undefined);
				resolve({ kind: "cancelled" });
			};
			signal?.addEventListener("abort", abortListener, { once: true });
			if (timeoutMs > 0) timer = setTimeout(() => {
				void session.abort().catch(() => undefined);
				resolve({ kind: "timed_out" });
			}, timeoutMs);
		});
		const outcome = await Promise.race([promptPromise, control]);
		if (timer) clearTimeout(timer);
		if (signal && abortListener) signal.removeEventListener("abort", abortListener);
		return outcome;
	}

	private emit(event: WorkerProgressEvent): void {
		try {
			this.onProgress?.(event);
		} catch {
			// Progress observers are diagnostics only and cannot affect execution.
		}
	}
}

interface ToolObservationMutable {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly potentialMutation: boolean;
	readonly startedAt: string;
	endedAt?: string;
	completed: boolean;
	isError?: boolean;
}

interface SingleAttempt {
	readonly attempt: SubagentAttempt;
	readonly outcome: SubagentAttempt["outcome"];
	failure: FailureClassification | undefined;
		readonly result: unknown;
	readonly providerSucceeded: boolean;
	readonly potentialMutation: boolean;
	readonly protocolViolation: boolean;
}

type PromptOutcome =
	| { readonly kind: "done" }
	| { readonly kind: "error"; readonly error: unknown }
	| { readonly kind: "cancelled" }
	| { readonly kind: "timed_out" };

async function boundedAbort(session: import("@earendil-works/pi-coding-agent").AgentSession): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.resolve(session.abort()).then(() => undefined, () => undefined),
			new Promise<void>((resolve) => { timer = setTimeout(resolve, 250); }),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function validateExecutionRequest(request: SubagentExecutionRequest, defaultTimeoutMs: number): Promise<SubagentExecutionRequest> {
	if (!request || typeof request !== "object") throw new WorkerError("invalid-request", "Execution request is required");
	if (typeof request.roleId !== "string" || request.roleId.trim().length === 0 || request.roleId.length > 160) throw new WorkerError("invalid-request", "Role ID is invalid");
	if (!POOL_IDS.includes(request.poolId)) throw new WorkerError("invalid-request", "Execution pool is invalid");
	if (typeof request.task !== "string" || request.task.trim().length === 0 || request.task.length > 32_000) throw new WorkerError("invalid-request", "Task is invalid or too large");
	if (request.acceptanceCriteria !== undefined && (!Array.isArray(request.acceptanceCriteria) || request.acceptanceCriteria.length > 16 || request.acceptanceCriteria.some((item) => typeof item !== "string" || item.trim().length === 0 || item.length > 1_000))) throw new WorkerError("invalid-request", "Acceptance criteria are invalid or too large");
	if (request.excludedRouteIds !== undefined && (!Array.isArray(request.excludedRouteIds) || request.excludedRouteIds.length > 64 || request.excludedRouteIds.some((item) => !isStableId(item)))) throw new WorkerError("invalid-request", "Excluded route IDs are invalid");
	const thinkingEffort = request.thinkingEffort ?? "auto";
	if (thinkingEffort !== "auto" && !THINKING_EFFORTS.includes(thinkingEffort as never)) throw new WorkerError("invalid-request", "Thinking effort is invalid");
	if (typeof request.cwd !== "string" || !isAbsolute(request.cwd)) throw new WorkerError("invalid-cwd", "Execution cwd must be absolute");
	const cwd = normalize(await realpath(request.cwd).catch(() => { throw new WorkerError("invalid-cwd", "Execution cwd could not be resolved"); }));
	if (!(await stat(cwd).catch(() => undefined))?.isDirectory()) throw new WorkerError("invalid-cwd", "Execution cwd is not a directory");
	const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 86_400_000 || timeoutMs > defaultTimeoutMs) throw new WorkerError("invalid-request", "Execution timeout exceeds the configured safety ceiling");
	return { ...request, roleId: request.roleId.trim(), task: request.task.trim(), cwd, timeoutMs, thinkingEffort };
}

function mergeWorkerUsage(previous: WorkerUsage | undefined, next: WorkerUsage): WorkerUsage {
	if (!previous) return next;
	const add = (a: number | undefined, b: number | undefined): number | undefined => a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
	const output: Record<string, unknown> = {};
	const set = (key: string, value: number | undefined): void => { if (value !== undefined) output[key] = value; };
	set("input", add(previous.input, next.input)); set("output", add(previous.output, next.output)); set("cacheRead", add(previous.cacheRead, next.cacheRead)); set("cacheWrite", add(previous.cacheWrite, next.cacheWrite)); set("cacheWrite1h", add(previous.cacheWrite1h, next.cacheWrite1h)); set("reasoning", add(previous.reasoning, next.reasoning)); set("totalTokens", add(previous.totalTokens, next.totalTokens));
	if (previous.cost || next.cost) {
		const cost: Record<string, unknown> = {};
		const setCost = (key: string, value: number | undefined): void => { if (value !== undefined) cost[key] = value; };
		setCost("input", add(previous.cost?.input, next.cost?.input)); setCost("output", add(previous.cost?.output, next.cost?.output)); setCost("cacheRead", add(previous.cost?.cacheRead, next.cost?.cacheRead)); setCost("cacheWrite", add(previous.cost?.cacheWrite, next.cost?.cacheWrite)); setCost("total", add(previous.cost?.total, next.cost?.total));
		output.cost = cost;
	}
	return output as WorkerUsage;
}

function elapsedMilliseconds(startedAt: string, endedAt: string): number | undefined {
	const start = Date.parse(startedAt);
	const end = Date.parse(endedAt);
	const elapsed = end - start;
	return Number.isSafeInteger(elapsed) && elapsed >= 0 ? elapsed : undefined;
}

function isStableId(value: unknown): value is StableId {
	return typeof value === "string" && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value) && value.length <= 64;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childPrompt(request: SubagentExecutionRequest, resultToolName: string): string {
	return `Perform the assigned task in ${request.cwd}. When finished, call ${resultToolName} exactly once with bounded evidence. Do not write a general final answer instead of the tool.`;
}

function failureInputFromError(error: unknown): FailureInput {
	if (typeof error === "string") return failureInputFromProviderText(error, false);
	if (!error || typeof error !== "object") return {};
	const candidate = error as Record<string, unknown>;
	const textInput = error instanceof Error ? failureInputFromProviderText(error.message, false) : {};
	const status = typeof candidate.status === "number" && Number.isSafeInteger(candidate.status) ? candidate.status : undefined;
	const code = typeof candidate.code === "string" && candidate.code.length <= 80 ? candidate.code : undefined;
	const category = typeof candidate.category === "string" && candidate.category.length <= 80 ? candidate.category : undefined;
	const retryAfterMs = typeof candidate.retryAfterMs === "number" && Number.isFinite(candidate.retryAfterMs) ? candidate.retryAfterMs : undefined;
	const retryAfterAt = typeof candidate.retryAfterAt === "string" && candidate.retryAfterAt.length <= 64 ? candidate.retryAfterAt : undefined;
	const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
	return {
		...textInput,
		...(status === undefined ? {} : { status }),
		...(code === undefined ? {} : { code }),
		...(category === undefined ? {} : { category }),
		...(retryAfterMs === undefined ? {} : { retryAfterMs }),
		...(retryAfterAt === undefined ? {} : { retryAfterAt }),
		...(name === "aborterror" || name === "cancellationerror" ? { cancelled: true } : {}),
		...(name.includes("timeout") ? { timeout: true } : {}),
	};
}

/**
 * Pi turns provider failures into an assistant `stopReason: "error"` and a
 * short errorMessage. Only bounded status/code tokens are extracted here; the
 * text itself is never copied into a worker result or health record.
 */
function failureInputFromProviderText(value: unknown, fallbackToTransport = true): FailureInput {
	if (typeof value !== "string") return fallbackToTransport ? { code: "transport_error" } : {};
	const text = value.slice(0, 512).toLocaleLowerCase();
	const statusMatch = text.match(/\b(400|401|403|408|422|429|500|502|503|504)\b/u);
	const status = statusMatch ? Number(statusMatch[1]) : undefined;
	if (status === 408 || /(?:timeout|timed\s+out|deadline[_\s-]*exceeded)/u.test(text)) return { ...(status === undefined ? {} : { status }), code: "timeout", timeout: true };
	if (status === 429 || /(?:rate[_\s-]*limit|too\s+many\s+requests|rate_limited)/u.test(text)) return { ...(status === undefined ? {} : { status }), code: "rate_limited" };
	if (status === 401 || status === 403 || /(?:unauthori[sz]ed|forbidden|authentication[_\s-]*failed)/u.test(text)) return { ...(status === undefined ? {} : { status }), code: "authentication_failed" };
	if (/\b(?:quota|insufficient[_\s-]*quota|usage[_\s-]*limit|quota[_\s-]*exhausted)\b/u.test(text)) return { ...(status === undefined ? {} : { status }), code: "quota_exhausted" };
	if (status === 400 || status === 422 || /(?:invalid[_\s-]*request|bad\s+request)/u.test(text)) return { ...(status === undefined ? {} : { status }), code: "invalid_request" };
	if (status === 500 || status === 502 || status === 503 || status === 504 || /(?:provider[_\s-]*unavailable|service[_\s-]*unavailable|bad\s+gateway)/u.test(text)) return { ...(status === undefined ? {} : { status }), code: "provider_unavailable" };
	if (/(?:model[_\s-]*not[_\s-]*found|model[_\s-]*unavailable)/u.test(text)) return { ...(status === undefined ? {} : { status }), code: "model_unavailable" };
	if (/(?:protocol|malformed|decode[_\s-]*error)/u.test(text)) return { ...(status === undefined ? {} : { status }), code: "protocol_error" };
	if (/(?:network|transport|connection|econn|socket)/u.test(text)) return { ...(status === undefined ? {} : { status }), code: "transport_error" };
	return fallbackToTransport ? { code: "transport_error" } : {};
}

function isResultCapabilityEligible(single: SingleAttempt): boolean {
	return (single.outcome === "invalid_child_result" || single.outcome === "protocol_violation")
		&& !single.potentialMutation
		&& single.attempt.resultFinalization?.attempted === true
		&& single.result === undefined;
}

function retrySelection(routeId: StableId, request: RoutingRequest): import("../routing/index.js").RoutingDecision {
	const candidate = request.candidates.find((item) => item.routeId === routeId);
	const weighted = request.schedulingPolicy === "weighted";
	if (!candidate || candidate.poolId !== request.poolId || !candidate.globalEnabled || !candidate.poolEnabled || candidate.available === false || candidate.availability === "missing" || (weighted && candidate.availability === "stale") || candidate.availability === "unavailable" || candidate.availability === "unknown" || (weighted && (candidate.health?.circuit === "open" || candidate.health?.circuit === "probing")) || candidate.health?.probeInFlight) {
		return { kind: "NO_ELIGIBLE_ROUTE", poolId: request.poolId, reasons: [] };
	}
	return {
		kind: "SELECTED",
		routeId,
		poolId: request.poolId,
		poolPosition: candidate.poolPosition,
		reason: "Retrying the same route under the M4 attempt policy",
		health: candidate.health,
		diversityStatus: "clear",
		evaluations: [],
	};
}

function resultBase(
	runId: string,
	request: SubagentExecutionRequest,
	terminalStatus: SubagentTerminalStatus,
	attempts: readonly SubagentAttempt[],
	fallbackCount: number,
	summary: string,
	route?: ResolvedWorkerRoute,
	protocolResult?: unknown,
): SubagentRunResult {
	const structuredResult = isStructuredChildResult(protocolResult) ? protocolResult : undefined;
	const lastAttempt = attempts.at(-1);
	return {
		protocolVersion: WORKER_PROTOCOL_VERSION,
		runId,
		roleId: request.roleId,
		poolId: request.poolId,
		terminalStatus,
		...(route ? { finalRouteId: route.routeId, finalRemoteModelId: route.remoteModelId } : {}),
		attempts,
		...(structuredResult ? { structuredResult } : {}),
		...(protocolResult === undefined ? {} : { protocolResult }),
		potentialMutationObserved: attempts.some((attempt) => attempt.potentialMutationObserved),
		fallbackCount,
		summary: summary.slice(0, 1_000),
		requestedThinkingEffort: request.thinkingEffort ?? "auto",
		effectiveThinkingEffort: lastAttempt?.effectiveThinkingEffort ?? "unknown",
		...(lastAttempt?.resultFinalization ? { resultFinalization: lastAttempt.resultFinalization } : {}),
	};
}

function observedThinkingEffort(session: { readonly thinkingLevel?: unknown }): EffectiveThinkingEffort {
	const level = session.thinkingLevel;
	return level === "low" || level === "medium" || level === "high" || level === "xhigh" || level === "max" ? level : "unknown";
}

function isStructuredChildResult(value: unknown): value is StructuredChildResult {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { protocolVersion?: unknown; status?: unknown };
	return candidate.protocolVersion === WORKER_PROTOCOL_VERSION && (candidate.status === "completed" || candidate.status === "blocked");
}

function readProtocolResult(protocol: ResultProtocolSpec, state: ProtocolCaptureState): unknown {
	switch (protocol.toolName) {
		case "submit_agent_result":
			return readProtocolCapture(state, parseStructuredChildResult);
		case "submit_verification_result":
			return readProtocolCapture(state, parseVerificationResult);
		case "submit_recommendation_analysis":
			return state.captured;
		case "submit_recovery_assessment":
			return readProtocolCapture(state, parseRecoveryAssessment);
		default:
			return undefined;
	}
}

function cancelledResult(runId: string, request: SubagentExecutionRequest, attempts: readonly SubagentAttempt[] = [], fallbackCount = 0): SubagentRunResult {
	return resultBase(runId, request, "cancelled", attempts, fallbackCount, "Child execution was cancelled");
}

function nextId(prefix: string): string {
	sequence += 1;
	return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

const cwdLocks = new Map<string, Promise<void>>();

async function withCwdLock<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
	const previous = cwdLocks.get(cwd) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => { release = resolve; });
	cwdLocks.set(cwd, current);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (cwdLocks.get(cwd) === current) cwdLocks.delete(cwd);
	}
}

export { toolProfileForPool, isPotentiallyMutatingTool } from "./profiles.js";

export function createSubagentExecutor(options: SubagentExecutorOptions): SubagentExecutor {
	return new SubagentExecutor(options);
}
