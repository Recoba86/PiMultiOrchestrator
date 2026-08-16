import type { ToolObservation } from "../workers/types.js";
import type { ClassifyMutationInput, MutationClass, RecoveryEligibilityInput } from "./types.js";

const UNSAFE_SAFETY = new Set(["NETWORK_OR_PUBLICATION", "DEVICE_OPERATION", "PRIVILEGE_ESCALATION"]);

export function classifyMutation(input: ClassifyMutationInput): MutationClass {
	if (!input.mutationObserved) return "none";
	const observations = input.observations ?? [];
	if (observations.some((item) => item.effectClass === "unsafe_external") || (input.safetyBlockCode !== undefined && UNSAFE_SAFETY.has(input.safetyBlockCode))) {
		return "unsafe_external";
	}
	const local = observations.some((item) => item.completed && (item.toolName === "edit" || item.toolName === "write" || item.toolName === "bash") && item.effectClass !== "unsafe_external");
	if (local) return "local_observable";
	return "unknown";
}

export function classifyMutationFromRun(run: { readonly potentialMutationObserved: boolean; readonly structuredResult?: unknown; readonly attempts: readonly { readonly toolObservations: readonly ToolObservation[]; readonly safetyBlockCode?: string }[] }): MutationClass {
	const last = run.attempts.at(-1);
	return classifyMutation({
		mutationObserved: run.potentialMutationObserved,
		observations: last?.toolObservations ?? [],
		structuredResultPresent: run.structuredResult !== undefined,
		...(last?.safetyBlockCode === undefined ? {} : { safetyBlockCode: last.safetyBlockCode }),
	});
}

export function shouldEnterAutonomousRecovery(input: RecoveryEligibilityInput): boolean {
	if (input.safetyStop === true) return false;
	if (input.terminalStatus === "cancelled" || input.terminalStatus === "SAFETY_STOP") return false;
	if (input.structuredResultPresent) return false;
	if (!input.mutationObserved) return false;
	if (input.mutationClass !== "local_observable") return false;
	return input.terminalStatus === "partial_mutation_requires_review";
}
