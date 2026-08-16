import { classifyMutationFromRun, shouldEnterAutonomousRecovery } from "./classify.js";
import { normalizeRecoveryDecision } from "./decision.js";
import { continuationRecoveryPrompt, recoveryAssessmentPrompt } from "./packet.js";
import { projectChangedWorktree } from "./projection.js";
import {
	MAX_AUTONOMOUS_RECOVERY_SEQUENCES_PER_TASK,
	type RecoverAfterMutationOptions,
	type RecoveryResult,
	type WorktreeProjection,
} from "./types.js";

export async function recoverAfterMutation(options: RecoverAfterMutationOptions): Promise<RecoveryResult> {
	const mutationClass = classifyMutationFromRun(options.failedRun);
	const eligible = shouldEnterAutonomousRecovery({
		terminalStatus: options.failedRun.terminalStatus,
		mutationObserved: options.failedRun.potentialMutationObserved,
		structuredResultPresent: options.failedRun.structuredResult !== undefined,
		mutationClass,
	});
	if (!eligible) {
		return {
			outcome: "human_required",
			action: "REQUEST_HUMAN",
			summary: mutationClass === "local_observable" ? "Autonomous recovery is not eligible for this terminal" : "Human review is required for this mutation class",
			mutationClass,
		};
	}
	if (recoverySequenceCount(options) >= MAX_AUTONOMOUS_RECOVERY_SEQUENCES_PER_TASK) {
		return { outcome: "budget_exhausted", action: "REQUEST_HUMAN", summary: "Autonomous mutation recovery budget is exhausted for this Task", mutationClass };
	}

	const projection = await (options.projectWorktree ?? projectChangedWorktree)(options.cwd);
	const task = options.store.getTask(options.taskId);
	const prompt = recoveryAssessmentPrompt({
		objective: task?.objective ?? "",
		acceptanceCriteria: task?.acceptanceCriteria ?? [],
		failedAttemptId: options.failedAttemptId,
		mutationClass,
		projection,
	});
	let assessment: Awaited<ReturnType<RecoverAfterMutationOptions["assess"]>>;
	try {
		assessment = await options.assess({ projection, prompt });
	} catch {
		assessment = undefined;
	}
	if (assessment === undefined) {
		try {
			options.store.admitEvidence({
				missionId: options.missionId,
				taskId: options.taskId,
				attemptId: options.failedAttemptId,
				kind: "recovery-assessment",
				content: {
					recoveryRequired: true,
					recoveryReason: "assessment_failed",
					failedAttemptId: options.failedAttemptId,
					taskId: options.taskId,
					mutationClass,
					changedFileCount: projection.changedFileCount,
				},
				actor: "system",
			});
		} catch {
			// Budget accounting is best-effort when the store rejects the stub.
		}
		return { outcome: "assessment_failed", action: "REQUEST_HUMAN", summary: "Recovery inspection did not return a structured assessment", mutationClass };
	}

	const assessmentRecord = options.store.admitEvidence({
		missionId: options.missionId,
		taskId: options.taskId,
		attemptId: options.failedAttemptId,
		kind: "recovery-assessment",
		content: {
			recoveryRequired: true,
			recoveryReason: "local_observable_result_missing",
			failedAttemptId: options.failedAttemptId,
			taskId: options.taskId,
			mutationClass,
			changedFileCount: projection.changedFileCount,
			assessment,
		},
		actor: "system",
	});

	if (assessment.humanRequired || !assessment.recoverable) {
		return { outcome: "human_required", action: "REQUEST_HUMAN", summary: assessment.recommendedPlan.slice(0, 2_000), mutationClass, recoveryAssessmentId: assessmentRecord.evidenceId };
	}

	let decision;
	try {
		decision = normalizeRecoveryDecision(await options.decide({ assessment, projection }), { rollbackProven: options.rollbackProven === true });
	} catch {
		return { outcome: "human_required", action: "REQUEST_HUMAN", summary: "Boss recovery decision was unavailable", mutationClass, recoveryAssessmentId: assessmentRecord.evidenceId };
	}
	if (decision.action === "REQUEST_HUMAN" || decision.action === "ROLLBACK_AND_RETRY") {
		return { outcome: "human_required", action: "REQUEST_HUMAN", summary: decision.summary, mutationClass, recoveryAssessmentId: assessmentRecord.evidenceId };
	}

	const recoveryPrompt = continuationRecoveryPrompt({
		action: decision.action,
		objective: task?.objective ?? "",
		acceptanceCriteria: task?.acceptanceCriteria ?? [],
		failedAttemptId: options.failedAttemptId,
		assessment,
		projection,
	});
	const continued = await options.continueWork({ recoveryPrompt, action: decision.action });
	try {
		options.store.admitEvidence({
			missionId: options.missionId,
			taskId: options.taskId,
			attemptId: continued.attempt.attemptId,
			kind: "other",
			content: {
				recoveryRequired: true,
				recoveryReason: "continued",
				failedAttemptId: options.failedAttemptId,
				taskId: options.taskId,
				mutationClass,
				changedFileCount: projection.changedFileCount,
				recoveryAssessmentId: assessmentRecord.evidenceId,
				bossRecoveryAction: decision.action,
				continuationAttemptId: continued.attempt.attemptId,
				recoveryOutcome: continued.run.terminalStatus,
			},
			actor: "system",
		});
	} catch {
		// Observability must not block a successful continuation.
	}
	return {
		outcome: "continued",
		action: decision.action,
		summary: continued.run.summary.slice(0, 2_000),
		mutationClass,
		recoveryAssessmentId: assessmentRecord.evidenceId,
		continuationAttemptId: continued.attempt.attemptId,
	};
}

function recoverySequenceCount(options: RecoverAfterMutationOptions): number {
	return options.store.listEvidence(options.missionId).filter((item) => item.kind === "recovery-assessment" && String(item.taskId ?? "") === options.taskId).length;
}

export function emptyProjection(): WorktreeProjection {
	return { changedFileCount: 0, files: [] };
}
