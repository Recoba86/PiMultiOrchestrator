import type { MissionStoreAdapter } from "../mission/types.js";
import type { SubagentRunResult, SubagentTerminalStatus, ToolObservation } from "../workers/types.js";

export const MAX_AUTONOMOUS_RECOVERY_SEQUENCES_PER_TASK = 1;

export type MutationClass = "none" | "local_observable" | "unsafe_external" | "unknown";
export type ToolEffectClass = "local_write" | "unsafe_external" | "unknown";

export type RecoveryAction =
	| "CONTINUE_EXISTING_WORK"
	| "REPAIR_EXISTING_WORK"
	| "ROLLBACK_AND_RETRY"
	| "REQUEST_HUMAN";

export type RecoveryOutcomeKind =
	| "continued"
	| "human_required"
	| "assessment_failed"
	| "budget_exhausted";

export interface ChangedFileProjection {
	readonly path: string;
	readonly status: string;
}

export interface WorktreeProjection {
	readonly changedFileCount: number;
	readonly files: readonly ChangedFileProjection[];
	readonly diffStat?: string;
}

export interface RecoveryAssessment {
	readonly whatChanged: readonly string[];
	readonly completeParts: readonly string[];
	readonly incompleteParts: readonly string[];
	readonly suspectedIncorrect: readonly string[];
	readonly recoverable: boolean;
	readonly humanRequired: boolean;
	readonly recommendedPlan: string;
	readonly continuationInstruction: string;
}

export interface RecoveryDecision {
	readonly action: RecoveryAction;
	readonly summary: string;
}

export interface ClassifyMutationInput {
	readonly mutationObserved: boolean;
	readonly observations?: readonly ToolObservation[];
	readonly structuredResultPresent?: boolean;
	readonly safetyBlockCode?: string;
}

export interface RecoveryEligibilityInput {
	readonly terminalStatus: SubagentTerminalStatus | string;
	readonly mutationObserved: boolean;
	readonly structuredResultPresent: boolean;
	readonly mutationClass: MutationClass;
	readonly safetyStop?: boolean;
}

export interface ContinuationPacketInput {
	readonly action: RecoveryAction;
	readonly objective: string;
	readonly acceptanceCriteria: readonly string[];
	readonly failedAttemptId: string;
	readonly assessment: RecoveryAssessment;
	readonly projection: WorktreeProjection;
}

export interface AssessmentPromptInput {
	readonly objective: string;
	readonly acceptanceCriteria: readonly string[];
	readonly failedAttemptId: string;
	readonly mutationClass: MutationClass;
	readonly projection: WorktreeProjection;
}

export interface RecoverAfterMutationOptions {
	readonly store: MissionStoreAdapter;
	readonly missionId: string;
	readonly taskId: string;
	readonly cwd: string;
	readonly failedAttemptId: string;
	readonly failedRun: SubagentRunResult;
	readonly assess: (input: { readonly projection: WorktreeProjection; readonly prompt: string }) => Promise<RecoveryAssessment | undefined>;
	readonly decide: (input: { readonly assessment: RecoveryAssessment; readonly projection: WorktreeProjection }) => Promise<RecoveryDecision>;
	readonly continueWork: (input: { readonly recoveryPrompt: string; readonly action: RecoveryAction }) => Promise<{ readonly attempt: { readonly attemptId: string }; readonly run: SubagentRunResult }>;
	readonly projectWorktree?: (cwd: string) => Promise<WorktreeProjection>;
	readonly rollbackProven?: boolean;
}

export interface RecoveryResult {
	readonly outcome: RecoveryOutcomeKind;
	readonly action: RecoveryAction;
	readonly summary: string;
	readonly mutationClass: MutationClass;
	readonly recoveryAssessmentId?: string;
	readonly continuationAttemptId?: string;
}
