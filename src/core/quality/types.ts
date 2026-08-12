import type { MissionId, TaskId } from "../mission/types.js";

export type QualityStatus = "unverified" | "verification_running" | "passed" | "rejected" | "blocked" | "review_required";
export type QualityVerdict = "pass" | "reject" | "blocked";
export type CriterionStatus = "satisfied" | "failed" | "not_verified";
export type VerificationStatus = "running" | "completed" | "interrupted" | "blocked";
export type DiversityPreference = "none" | "prefer" | "require";

export interface CriterionResult {
	readonly criterion: string;
	readonly status: CriterionStatus;
	readonly evidenceSummary: string;
	readonly mandatory?: boolean;
}

export interface MechanicalCheck {
	readonly command: string;
	readonly exitStatus?: number;
	readonly outcome: "passed" | "failed" | "timed_out" | "not_run";
	readonly summary?: string;
	readonly durationMs?: number;
	readonly provenance: "orchestrator" | "reviewer" | "worker_claim";
}

export interface VerificationResultV1 {
	readonly verdict: QualityVerdict;
	readonly criterionResults: readonly CriterionResult[];
	readonly mechanicalChecks: readonly MechanicalCheck[];
	readonly findings: readonly string[];
	readonly requiredFixes: readonly string[];
	readonly risks: readonly string[];
	readonly summary: string;
}

export interface QualityGatePolicy {
	readonly missingCriterion: "blocked" | "reject";
	readonly requireMechanicalChecks?: boolean;
}

export interface QualityGateResult {
	readonly verdict: QualityVerdict;
	readonly reasons: readonly string[];
	readonly criterionResults: readonly CriterionResult[];
	readonly mechanicalChecks: readonly MechanicalCheck[];
	readonly findings?: readonly string[];
	readonly requiredFixes?: readonly string[];
	readonly risks?: readonly string[];
	readonly reviewerSummary?: string;
}

export interface VerificationRunRecord {
	readonly verificationId: string;
	readonly missionId: MissionId;
	readonly taskId: TaskId;
	readonly targetRunId: string;
	readonly targetPacketId?: string;
	readonly round: number;
	readonly reviewerRunId?: string;
	readonly reviewerRouteId?: string;
	readonly reviewerRemoteModelId?: string;
	readonly implementationRouteId?: string;
	readonly status: VerificationStatus;
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly qualityDecisionId?: string;
	readonly potentialMutationObserved: boolean;
	readonly failureSummary?: string;
}

export interface QualityDecisionRecord {
	readonly decisionId: string;
	readonly missionId: MissionId;
	readonly taskId: TaskId;
	readonly verificationId: string;
	readonly targetRunId: string;
	readonly targetPacketId?: string;
	readonly round: number;
	readonly verdict: QualityVerdict;
	readonly criterionResults: readonly CriterionResult[];
	readonly mechanicalChecks: readonly MechanicalCheck[];
	readonly reviewerSummary: string;
	readonly findings: readonly string[];
	readonly requiredFixes: readonly string[];
	readonly risks: readonly string[];
	readonly reviewerRouteId?: string;
	readonly createdAt: string;
}

export interface QualityEscalationRequest {
	readonly escalationId: string;
	readonly missionId: MissionId;
	readonly taskId: TaskId;
	readonly rejectedRunId: string;
	readonly verificationId: string;
	readonly qualityRound: number;
	readonly failedCriteria: readonly string[];
	readonly requiredFixes: readonly string[];
	readonly reviewerFindings: readonly string[];
	readonly priorImplementationRouteIds: readonly string[];
	readonly reviewerRouteId?: string;
	readonly preferredPool: "implementation";
	readonly routeExclusions: readonly string[];
	readonly diversity: DiversityPreference;
	readonly status: "ready" | "exhausted" | "blocked";
	readonly createdAt: string;
}

export interface TaskQualityStatus {
	readonly taskId: TaskId;
	readonly missionId: MissionId;
	readonly status: QualityStatus;
	readonly qualityRound: number;
	readonly latestVerificationId?: string;
	readonly latestDecisionId?: string;
	readonly updatedAt: string;
}

export interface VerificationRunInput {
	readonly verificationId?: string;
	readonly missionId: MissionId | string;
	readonly taskId: TaskId | string;
	readonly targetRunId: string;
	readonly targetPacketId?: string;
	readonly round?: number;
	readonly reviewerRunId?: string;
	readonly reviewerRouteId?: string;
	readonly reviewerRemoteModelId?: string;
	readonly implementationRouteId?: string;
	readonly potentialMutationObserved?: boolean;
}

export interface QualityDecisionInput {
	readonly decisionId?: string;
	readonly missionId: MissionId | string;
	readonly taskId: TaskId | string;
	readonly verificationId: string;
	readonly targetRunId: string;
	readonly targetPacketId?: string;
	readonly round: number;
	readonly gate: QualityGateResult;
	readonly reviewerSummary: string;
	readonly findings?: readonly string[];
	readonly requiredFixes?: readonly string[];
	readonly risks?: readonly string[];
	readonly reviewerRouteId?: string;
}

export interface QualityEscalationInput {
	readonly escalationId?: string;
	readonly missionId: MissionId | string;
	readonly taskId: TaskId | string;
	readonly rejectedRunId: string;
	readonly verificationId: string;
	readonly qualityRound: number;
	readonly failedCriteria: readonly string[];
	readonly requiredFixes: readonly string[];
	readonly reviewerFindings: readonly string[];
	readonly priorImplementationRouteIds: readonly string[];
	readonly reviewerRouteId?: string;
	readonly routeExclusions?: readonly string[];
	readonly diversity?: DiversityPreference;
	readonly status?: "ready" | "exhausted" | "blocked";
}

export interface QualityPersistence {
	createVerificationRun(input: VerificationRunInput): VerificationRunRecord;
	getVerificationRun(verificationId: string): VerificationRunRecord | undefined;
	updateVerificationRun(verificationId: string, patch: Partial<VerificationRunRecord>): VerificationRunRecord;
	recordQualityDecision(input: QualityDecisionInput): QualityDecisionRecord;
	createQualityEscalation(input: QualityEscalationInput): QualityEscalationRequest;
	getTaskQualityStatus(taskId: TaskId | string): TaskQualityStatus | undefined;
	setTaskQualityStatus(input: TaskQualityStatus): TaskQualityStatus;
	listVerificationRuns(missionId: MissionId | string, taskId?: TaskId | string): readonly VerificationRunRecord[];
	listQualityDecisions(missionId: MissionId | string, taskId?: TaskId | string): readonly QualityDecisionRecord[];
	listQualityEscalations(missionId: MissionId | string, taskId?: TaskId | string): readonly QualityEscalationRequest[];
	readonly recordCheckpoint?: (missionId: MissionId | string, kind?: "gate-evaluated" | "escalation") => unknown;
}

export interface ReviewerRouteCandidate {
	readonly routeId: string;
	readonly remoteModelId?: string;
	readonly resourceId?: string;
}

export interface QualityLoopOptions {
	readonly maxRounds?: number;
	readonly diversity?: DiversityPreference;
	readonly authorizedForMutation: boolean;
	readonly acceptanceCriteria?: readonly string[];
}
