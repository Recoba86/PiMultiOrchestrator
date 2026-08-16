import { executeMissionTask, type MissionTaskExecutionOptions } from "../mission/execution.js";
import { classifyMutationFromRun, shouldEnterAutonomousRecovery } from "./classify.js";
import { recoverAfterMutation } from "./orchestrate.js";
import type { RecoveryAssessment, RecoveryDecision, WorktreeProjection } from "./types.js";
import type { BossTaskOutcome } from "../mission/boss.js";

export async function dispatchImplementationWithRecovery(options: {
	readonly execution: MissionTaskExecutionOptions;
	readonly assess: (input: { readonly projection: WorktreeProjection; readonly prompt: string }) => Promise<RecoveryAssessment | undefined>;
	readonly decide: (input: { readonly assessment: RecoveryAssessment; readonly projection: WorktreeProjection }) => Promise<RecoveryDecision>;
}): Promise<BossTaskOutcome> {
	const executed = await executeMissionTask(options.execution);
	const taskId = String(options.execution.taskId);
	if (executed.run.terminalStatus === "cancelled" || options.execution.signal?.aborted) {
		return { taskId, status: "cancelled", summary: executed.run.summary.slice(0, 2_000) };
	}
	if (executed.task.executionClass !== "implementation") {
		const updated = options.execution.store.getTask(taskId) ?? executed.task;
		return {
			taskId,
			status: executed.run.terminalStatus === "completed" && updated.status === "execution_completed" ? "succeeded" : "failed",
			summary: executed.run.summary.slice(0, 2_000),
		};
	}
	const mutationClass = classifyMutationFromRun(executed.run);
	if (!shouldEnterAutonomousRecovery({
		terminalStatus: executed.run.terminalStatus,
		mutationObserved: executed.run.potentialMutationObserved,
		structuredResultPresent: executed.run.structuredResult !== undefined,
		mutationClass,
	})) {
		const updated = options.execution.store.getTask(taskId) ?? executed.task;
		return {
			taskId,
			status: executed.run.terminalStatus === "completed" && updated.status === "execution_completed" ? "succeeded" : "failed",
			summary: executed.run.summary.slice(0, 2_000),
		};
	}
	const recovered = await recoverAfterMutation({
		store: options.execution.store,
		missionId: String(options.execution.missionId),
		taskId,
		cwd: options.execution.cwd ?? executed.packet.repositoryCwd ?? "",
		failedAttemptId: String(executed.attempt.attemptId),
		failedRun: executed.run,
		assess: options.assess,
		decide: options.decide,
		continueWork: ({ recoveryPrompt }) => executeMissionTask({ ...options.execution, recoveryPrompt }),
	});
	const updated = options.execution.store.getTask(taskId);
	return {
		taskId,
		status: recovered.outcome === "continued" && updated?.status === "execution_completed" ? "succeeded" : "failed",
		summary: recovered.summary,
	};
}
