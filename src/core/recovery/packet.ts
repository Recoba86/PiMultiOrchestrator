import { RECOVERY_ASSESSMENT_TOOL_NAME } from "./assessment.js";
import type { AssessmentPromptInput, ContinuationPacketInput } from "./types.js";

export function recoveryAssessmentPrompt(input: AssessmentPromptInput): string {
	const files = input.projection.files.map((file) => `${file.status} ${file.path}`).join("\n") || "(no changed files listed)";
	return [
		"READ-ONLY recovery assessment. Do not modify files, run mutating commands, or restart the Task.",
		`Original objective: ${input.objective.slice(0, 4_000)}`,
		`Acceptance criteria: ${input.acceptanceCriteria.join("; ").slice(0, 2_000)}`,
		`Failed attempt: ${input.failedAttemptId}`,
		`Mutation class: ${input.mutationClass}`,
		`Changed file count: ${input.projection.changedFileCount}`,
		`Changed files:\n${files.slice(0, 4_000)}`,
		input.projection.diffStat ? `Diff stat:\n${input.projection.diffStat.slice(0, 2_000)}` : "",
		`Call ${RECOVERY_ASSESSMENT_TOOL_NAME} exactly once with the structured assessment.`,
	].filter(Boolean).join("\n");
}

export function continuationRecoveryPrompt(input: ContinuationPacketInput): string {
	const files = input.projection.files.map((file) => `${file.status} ${file.path}`).join("\n") || "(no changed files listed)";
	return [
		"THE CURRENT WORKTREE IS THE STARTING STATE.",
		"Do not perform the Task from zero.",
		"First inspect existing changes. Preserve correct work. Complete or repair only what remains.",
		`Boss recovery action: ${input.action}`,
		`Original objective: ${input.objective.slice(0, 4_000)}`,
		`Acceptance criteria: ${input.acceptanceCriteria.join("; ").slice(0, 2_000)}`,
		`Previous failed attempt: ${input.failedAttemptId}`,
		`Changed files:\n${files.slice(0, 4_000)}`,
		`Recovery assessment: ${input.assessment.recommendedPlan.slice(0, 2_000)}`,
		`Continuation instruction: ${input.assessment.continuationInstruction.slice(0, 2_000)}`,
	].join("\n");
}
