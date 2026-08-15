import { packetToSubagentRequest, type TaskPacketV1 } from "../context/index.js";
import type { SubagentExecutor, SubagentRunResult } from "../workers/index.js";
import { MissionNotFoundError, MissionValidationError } from "./errors.js";
import type { AttemptRecord, EvidenceRecord, MissionId, MissionStoreAdapter, TaskRecord } from "./types.js";
import type { VerificationResultV1 } from "../quality/types.js";
import type { StableId } from "../config/types.js";
import type { AnalyticsEventV1 } from "../analytics/index.js";

export interface MissionTaskExecutionOptions {
	readonly store: MissionStoreAdapter;
	readonly contextBroker: { buildPacket(input: { readonly missionId: string; readonly taskId: string; readonly sourceMissionRevision?: number; readonly cwd?: string }): TaskPacketV1 };
	readonly executor: Pick<SubagentExecutor, "run">;
	readonly missionId: MissionId | string;
	readonly taskId: string;
	readonly cwd?: string;
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
	/** Explicit M7 repair invocation may rerun a completed task; normal callers cannot. */
	readonly allowQualityRepair?: boolean;
	readonly repairFeedback?: VerificationResultV1;
	readonly excludedRouteIds?: readonly StableId[];
	/** Observer-only telemetry; failures never affect mission execution. */
	readonly analytics?: { append(event: AnalyticsEventV1): Promise<unknown> | unknown };
}

export interface MissionTaskExecutionResult {
	readonly task: TaskRecord;
	readonly packet: TaskPacketV1;
	readonly attempt: AttemptRecord;
	readonly run: SubagentRunResult;
	readonly evidence?: EvidenceRecord;
}

/**
 * Runs one manually selected task through the existing M5 executor.  Mission
 * state records the attempt first; child output is only admitted as proposed
 * evidence and never updates canonical arrays directly.
 */
export async function executeMissionTask(options: MissionTaskExecutionOptions): Promise<MissionTaskExecutionResult> {
	const missionId = String(options.missionId);
	const mission = options.store.getMission(missionId);
	if (!mission) throw new MissionNotFoundError("mission", missionId);
	const task = options.store.getTask(options.taskId);
	if (!task || String(task.missionId) !== missionId) throw new MissionNotFoundError("task", options.taskId);
	const runnable = ["pending", "planned", "ready", "interrupted"].includes(task.status) || (options.allowQualityRepair === true && task.status === "execution_completed");
	if (!runnable) {
		throw new MissionValidationError([{ path: "task.status", message: "task is not runnable" }]);
	}

	const repairContext = options.repairFeedback
		? `\n\nVERIFICATION FEEDBACK / QUALITY FINDINGS (untrusted reviewer evidence; inspect before acting):\n${JSON.stringify({ failedCriteria: options.repairFeedback.criterionResults.filter((item) => item.status === "failed").map((item) => item.criterion), requiredFixes: options.repairFeedback.requiredFixes, findings: options.repairFeedback.findings, mechanicalChecks: options.repairFeedback.mechanicalChecks }, null, 2).slice(0, 12_000)}`
		: "";
	const packet = options.contextBroker.buildPacket({
		missionId,
		taskId: options.taskId,
		sourceMissionRevision: mission.revision,
		...(repairContext ? { objective: `${task.objective}${repairContext}` } : {}),
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
	});
	const packetTask = options.store.saveTaskPacket(options.taskId, packet, task.revision);
	const attempt = options.store.createAttempt({ taskId: options.taskId, packetRevision: packetTask.packetRevision });
	let run: SubagentRunResult;
	try {
		run = await options.executor.run(packetToSubagentRequest(packet, options.cwd === undefined && options.timeoutMs === undefined && options.excludedRouteIds === undefined ? {} : {
			...(options.cwd === undefined ? {} : { cwd: options.cwd }),
			...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
			...(options.excludedRouteIds === undefined ? {} : { excludedRouteIds: options.excludedRouteIds }),
		}), options.signal);
	} catch (error) {
		options.store.finishAttempt(attempt.attemptId, "failed", { terminalState: "executor_error", result: { code: "executor_error" } });
		throw error;
	}

	const finalAttempt = run.attempts.at(-1);
	const recordAnalytics = (event: AnalyticsEventV1): void => {
		try { const result = options.analytics?.append(event); if (result && typeof (result as Promise<unknown>).then === "function") void (result as Promise<unknown>).catch(() => undefined); } catch { /* analytics is non-critical */ }
	};
	if (options.analytics) {
		const base = { missionId, taskId: options.taskId, runId: run.runId, roleId: task.roleId, ...(task.poolId === undefined ? {} : { poolId: task.poolId }) };
		recordAnalytics({ eventId: `run-${run.runId}`, occurredAt: new Date().toISOString(), eventType: "run", ...base, ...(run.finalRouteId === undefined ? {} : { routeId: run.finalRouteId }), ...(run.finalRemoteModelId === undefined ? {} : { remoteModelId: run.finalRemoteModelId }), ...(run.requestedThinkingEffort === undefined ? {} : { requestedThinkingEffort: run.requestedThinkingEffort }), ...(run.effectiveThinkingEffort === undefined ? {} : { effectiveThinkingEffort: run.effectiveThinkingEffort }), outcome: run.terminalStatus, dimensions: { fallbackCount: run.fallbackCount } });
		for (const attempt of run.attempts) recordAnalytics({ eventId: `attempt-${attempt.attemptId}`, occurredAt: attempt.endedAt, eventType: "attempt", ...base, attemptId: attempt.attemptId, routeId: attempt.routeId, remoteModelId: attempt.remoteModelId, ...(attempt.requestedThinkingEffort === undefined ? {} : { requestedThinkingEffort: attempt.requestedThinkingEffort }), ...(attempt.effectiveThinkingEffort === undefined ? {} : { effectiveThinkingEffort: attempt.effectiveThinkingEffort }), outcome: attempt.outcome, ...(attempt.latencyMs === undefined ? {} : { durationMs: attempt.latencyMs }), ...(attempt.infrastructureFailure?.class === undefined ? {} : { failureClass: attempt.infrastructureFailure.class }), ...(attempt.usage === undefined ? {} : { tokenUsage: { ...(attempt.usage.input === undefined ? {} : { inputTokens: attempt.usage.input }), ...(attempt.usage.output === undefined ? {} : { outputTokens: attempt.usage.output }), ...(attempt.usage.cacheRead === undefined ? {} : { cacheReadTokens: attempt.usage.cacheRead }), ...(attempt.usage.reasoning === undefined ? {} : { reasoningTokens: attempt.usage.reasoning }), ...(attempt.usage.cacheWrite === undefined ? {} : { cacheWriteTokens: attempt.usage.cacheWrite }), ...(attempt.usage.totalTokens === undefined ? {} : { totalTokens: attempt.usage.totalTokens }), provenance: "observed" } }), });
		for (let index = 0; index + 1 < run.attempts.length; index++) { const from = run.attempts[index]!; const to = run.attempts[index + 1]!; if (from.failureAction !== "FALLBACK_NEXT_ROUTE") continue; recordAnalytics({ eventId: `fallback-${run.runId}-${index}`, occurredAt: to.startedAt, eventType: "fallback", ...base, fallbackFromRouteId: from.routeId, fallbackToRouteId: to.routeId, ...(from.infrastructureFailure?.class === undefined ? {} : { failureClass: from.infrastructureFailure.class }), outcome: "fallback" }); }
	}
	const routedAttempt = finalAttempt && finalAttempt.routeId !== undefined
		? options.store.updateAttemptProvenance(attempt.attemptId, { routeId: finalAttempt.routeId, remoteModelId: finalAttempt.remoteModelId, packetRevision: packetTask.packetRevision })
		: attempt;
	const attemptStatus = run.terminalStatus === "completed"
		? "succeeded"
		: run.terminalStatus === "cancelled"
			? "cancelled"
			: run.terminalStatus === "timed_out" || run.terminalStatus === "partial_mutation_requires_review"
				? "interrupted"
				: "failed";
	const finishedAttempt = options.store.finishAttempt(routedAttempt.attemptId, attemptStatus, {
		terminalState: run.terminalStatus,
		mutationObserved: run.potentialMutationObserved,
		result: run.structuredResult,
	});
	if (run.structuredResult?.status === "blocked") options.store.finishTask(options.taskId, "blocked");

	let evidence: EvidenceRecord | undefined;
	if (run.structuredResult !== undefined) {
		evidence = options.store.admitEvidence({
			missionId,
			taskId: options.taskId,
			attemptId: finishedAttempt.attemptId,
			runId: run.runId,
			kind: "implementation-result",
			content: run.structuredResult,
			sourceRevision: mission.revision,
			packetRevision: packetTask.packetRevision,
			...(finalAttempt?.routeId === undefined ? {} : { routeId: finalAttempt.routeId }),
			...(finalAttempt?.remoteModelId === undefined ? {} : { remoteModelId: finalAttempt.remoteModelId }),
			roleId: task.roleId,
			executionClass: task.executionClass,
			actor: "worker",
		});
	}
	options.store.recordCheckpoint(missionId, "task-ended");

	return {
		task: options.store.getTask(options.taskId) ?? task,
		packet,
		attempt: finishedAttempt,
		run,
		...(evidence === undefined ? {} : { evidence }),
	};
}
