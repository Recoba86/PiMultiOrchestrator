import { realpath, stat } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

import {
	classifyFailure,
	createAttemptChain,
	nextAfterFailure,
	recordAttempt,
	selectRoute,
	type FailureClassification,
	type FailureInput,
	type RoutingRequest,
} from "../routing/index.js";
import { POOL_IDS } from "../pools/index.js";
import { createSubmitAgentResultTool, createResultToolState } from "./result-tool.js";
import { defaultChildSessionFactory } from "./session.js";
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
	type WorkerProgressEvent,
	type SubagentExecutorOptions,
	type ResolvedWorkerRoute,
} from "./types.js";
import type { StableId } from "../config/types.js";

let sequence = 0;

/**
 * Foreground child executor. Route selection and health remain M4 adapter
 * responsibilities; this layer only runs one exact route at a time.
 */
export class SubagentExecutor {
	private readonly routeAdapter: RouteAttemptAdapter;
	private readonly sessionFactory: ChildSessionFactory;
	private readonly clock: () => Date;
	private readonly onProgress: ((event: WorkerProgressEvent) => void) | undefined;

	constructor(options: SubagentExecutorOptions) {
		this.routeAdapter = options.routeAdapter;
		this.sessionFactory = options.sessionFactory ?? defaultChildSessionFactory;
		this.clock = options.clock ?? (() => new Date());
		this.onProgress = options.onProgress;
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
				request,
				retryIndex,
				...(signal === undefined ? {} : { signal }),
			});
			let attempt = single.attempt;
			attempts.push(attempt);
			chain = recordAttempt(chain, routeId, single.failure);

			try {
				if (single.providerSucceeded) await this.routeAdapter.recordSuccess?.(routeId, new Date(this.clock().getTime()));
				if (single.failure !== undefined && single.failure.class !== "cancelled") await this.routeAdapter.recordFailure?.(routeId, single.failure, new Date(this.clock().getTime()));
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
			if (single.potentialMutation) {
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
				const terminalStatus: SubagentTerminalStatus = single.outcome === "timed_out" ? "timed_out" : "infrastructure_stopped";
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
		readonly signal?: AbortSignal;
	}): Promise<SingleAttempt> {
		const startedAt = this.clock().toISOString();
		const resultState = createResultToolState();
		const submitTool = createSubmitAgentResultTool(resultState);
		const observations: ToolObservation[] = [];
		const observationByCall = new Map<string, ToolObservationMutable>();
		let providerSucceeded = false;
		let outcome: import("./types.js").AttemptTerminalOutcome = "child_runtime_error";
		let failure: FailureClassification | undefined;
		let terminalState: SubagentAttempt["sessionTerminalState"] = "error";
		let protocolViolation = false;
		let result: StructuredChildResult | undefined;
		let handle: Awaited<ReturnType<ChildSessionFactory["create"]>> | undefined;
		let unsubscribe: (() => void) | undefined;
		try {
			handle = await this.sessionFactory.create({
				cwd: options.request.cwd,
				route: options.route,
				request: options.request,
				toolNames: toolProfileForPool(options.request.poolId),
				submitTool,
				...(options.signal === undefined ? {} : { signal: options.signal }),
			});
			unsubscribe = handle.session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					const observation: ToolObservationMutable = {
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						potentialMutation: isPotentiallyMutatingTool(event.toolName),
						startedAt: this.clock().toISOString(),
						completed: false,
					};
					observationByCall.set(event.toolCallId, observation);
					this.emit({ type: "tool_started", runId: options.runId, attemptId: options.attemptId, routeId: options.route.routeId, remoteModelId: options.route.remoteModelId, toolName: event.toolName });
					if (resultState.submitted !== undefined) protocolViolation = true;
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
			const promptResult = await this.promptWithControl(handle.session, childPrompt(options.request), options.request.timeoutMs ?? this.routeAdapter.policy.timeoutMs, options.signal);
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
					result = resultState.submitted;
					protocolViolation ||= resultState.protocolViolation;
					outcome = protocolViolation ? "protocol_violation" : result === undefined ? "invalid_child_result" : "completed";
					terminalState = "idle";
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
			...(result === undefined ? {} : { structuredResult: result }),
			sessionTerminalState: terminalState,
		};
		this.emit({ type: "attempt_finished", runId: options.runId, attemptId: options.attemptId, routeId: options.route.routeId, remoteModelId: options.route.remoteModelId });
		return { attempt, outcome, failure, result, providerSucceeded, potentialMutation: potentialMutationObserved, protocolViolation };
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
	readonly result: StructuredChildResult | undefined;
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
	if (typeof request.cwd !== "string" || !isAbsolute(request.cwd)) throw new WorkerError("invalid-cwd", "Execution cwd must be absolute");
	const cwd = normalize(await realpath(request.cwd).catch(() => { throw new WorkerError("invalid-cwd", "Execution cwd could not be resolved"); }));
	if (!(await stat(cwd).catch(() => undefined))?.isDirectory()) throw new WorkerError("invalid-cwd", "Execution cwd is not a directory");
	const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 86_400_000) throw new WorkerError("invalid-request", "Execution timeout is outside bounds");
	return { ...request, roleId: request.roleId.trim(), task: request.task.trim(), cwd, timeoutMs };
}

function isStableId(value: unknown): value is StableId {
	return typeof value === "string" && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value) && value.length <= 64;
}

function childPrompt(request: SubagentExecutionRequest): string {
	return `Perform the assigned task in ${request.cwd}. When finished, call submit_agent_result exactly once with bounded evidence. Do not write a general final answer instead of the tool.`;
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

function retrySelection(routeId: StableId, request: RoutingRequest): import("../routing/index.js").RoutingDecision {
	const candidate = request.candidates.find((item) => item.routeId === routeId);
	if (!candidate || candidate.poolId !== request.poolId || !candidate.globalEnabled || !candidate.poolEnabled || candidate.available === false || candidate.availability === "missing" || candidate.availability === "unavailable" || candidate.availability === "unknown") {
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
	structuredResult?: StructuredChildResult,
): SubagentRunResult {
	return {
		protocolVersion: WORKER_PROTOCOL_VERSION,
		runId,
		roleId: request.roleId,
		poolId: request.poolId,
		terminalStatus,
		...(route ? { finalRouteId: route.routeId, finalRemoteModelId: route.remoteModelId } : {}),
		attempts,
		...(structuredResult ? { structuredResult } : {}),
		potentialMutationObserved: attempts.some((attempt) => attempt.potentialMutationObserved),
		fallbackCount,
		summary: summary.slice(0, 1_000),
	};
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
