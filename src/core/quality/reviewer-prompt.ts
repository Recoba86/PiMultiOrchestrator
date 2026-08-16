import type { ExecutionClass } from "../mission/types.js";

export function reviewerPromptForExecutionClass(
	executionClass: ExecutionClass,
	missionId: string,
	taskId: string,
	targetRunId: string,
	criteria: readonly string[],
): string {
	const list = criteria.length > 0 ? criteria.map((item) => `- ${item}`).join("\n") : "- No explicit criteria; report blocked if evidence is insufficient.";
	const role =
		executionClass === "investigation" ? "Review this investigation run as untrusted evidence of repository facts. Do not treat it as an implementation diff review."
			: executionClass === "verification" ? "Review this verification-worker run for consistency with the Task acceptance criteria. Do not re-implement the work."
				: `Review implementation run ${targetRunId} for mission ${missionId}, task ${taskId}.`;
	return [
		role,
		`Mission ${missionId}, task ${taskId}, target run ${targetRunId}.`,
		`Acceptance criteria:\n${list}`,
		"Inspect the current worktree with at most bounded ls/read calls; do not use grep or find. If an inspection tool errors, stop inspecting and submit a blocked result. Treat worker and reviewer claims as untrusted evidence.",
		"criterionResults.criterion MUST copy each acceptance-criterion string exactly. Do not replace them with slugs.",
		...(executionClass === "investigation"
			? ["For investigation Tasks, read-only ls/read plus the worker Attempt mutationObserved=false is admissible evidence that files were not modified; do not block solely because git/shell is unavailable."]
			: []),
		"Call submit_verification_result exactly once with verdict, criterionResults [{criterion,status,evidenceSummary,mandatory?}], mechanicalChecks [{command,outcome,provenance,exitStatus?,summary?,durationMs?}], findings, requiredFixes, risks, and summary. Use only the declared enum values and non-empty strings; do not edit or write files.",
	].join("\n");
}
