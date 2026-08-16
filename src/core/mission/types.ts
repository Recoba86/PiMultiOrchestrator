import type { StableId } from "../config/types.js";
import type { QualityPersistence } from "../quality/types.js";

/** Version of the durable mission database schema. */
export const MISSION_STORE_SCHEMA_VERSION = 2 as const;
export type MissionStoreSchemaVersion = typeof MISSION_STORE_SCHEMA_VERSION;

export type MissionStatus =
  | "draft"
  | "planned"
  | "active"
  | "paused"
  | "running"
  | "awaiting-review"
  | "blocked"
  | "failed"
  | "cancelled"
  | "completed";

export type TaskStatus =
  | "pending"
  | "planned"
  | "ready"
  | "running"
  | "interrupted"
  | "succeeded"
  | "execution_completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type AttemptStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "timed-out"
  | "unknown";

export type EvidenceStatus = "proposed" | "accepted" | "approved" | "rejected" | "stale";
export type EvidenceKind =
  | "finding"
  | "implementation-result"
  | "review-result"
  | "test-result"
  | "artifact"
  | "command-result"
  | "recovery-assessment"
  | "other";

export type CheckpointKind =
  | "created"
  | "plan-accepted"
  | "task-started"
  | "task-ended"
  | "evidence-promoted"
  | "fallback"
  | "escalation"
  | "gate-evaluated"
  | "status-changed"
  | "lease-recovered"
  | "manual";

export type MissionActor = "boss" | "worker" | "reviewer" | "system" | "user";
export type ExecutionClass = "investigation" | "implementation" | "verification";

export type MissionId = string & { readonly __missionId: unique symbol };
export type TaskId = string & { readonly __taskId: unique symbol };
export type AttemptId = string & { readonly __attemptId: unique symbol };
export type EvidenceId = string & { readonly __evidenceId: unique symbol };
export type CheckpointId = string & { readonly __checkpointId: unique symbol };
export type EventId = string & { readonly __missionEventId: unique symbol };
export type LeaseOwner = string & { readonly __leaseOwner: unique symbol };

/** Repository identity is deliberately metadata-only; no source is copied here. */
export interface RepositoryRef {
  readonly cwd?: string;
  readonly revision?: string;
  readonly projectKey?: string;
}

export interface MissionCreateInput {
  readonly missionId?: MissionId | string;
  readonly goal: string;
  readonly title?: string;
  readonly objective?: string;
  readonly constraints?: readonly unknown[];
  readonly acceptanceCriteria?: readonly string[];
  readonly repository?: RepositoryRef;
  readonly plan?: unknown;
  readonly approvedDecisions?: readonly unknown[];
  readonly nextSteps?: readonly unknown[];
  readonly status?: Extract<MissionStatus, "draft" | "planned">;
  readonly actor?: MissionActor;
}

export interface MissionRecord {
  readonly missionId: MissionId;
  readonly revision: number;
  readonly status: MissionStatus;
  readonly goal: string;
  readonly title: string;
  readonly objective: string;
  readonly constraints: readonly unknown[];
  readonly acceptanceCriteria: readonly string[];
  readonly repository: RepositoryRef;
  readonly plan: unknown;
  readonly approvedDecisions: readonly unknown[];
  readonly validatedFindings: readonly CanonicalItem[];
  readonly completedWork: readonly CanonicalItem[];
  readonly currentChangeState: unknown;
  readonly testReviewEvidence: readonly CanonicalItem[];
  readonly unresolvedIssues: readonly unknown[];
  readonly nextSteps: readonly unknown[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MissionPatch {
  readonly goal?: string;
  readonly constraints?: readonly unknown[];
  readonly acceptanceCriteria?: readonly string[];
  readonly repository?: RepositoryRef;
  readonly plan?: unknown;
  readonly approvedDecisions?: readonly unknown[];
  readonly currentChangeState?: unknown;
  readonly unresolvedIssues?: readonly unknown[];
  readonly nextSteps?: readonly unknown[];
}

export interface MissionTransitionOptions {
  readonly expectedRevision?: number;
  readonly actor?: MissionActor;
  readonly reason?: string;
  readonly metadata?: unknown;
  readonly checkpoint?: boolean;
}

export interface MissionEventRecord {
  readonly eventId: EventId;
  readonly missionId: MissionId;
  readonly revision: number;
  readonly kind: string;
  readonly actor: MissionActor;
  readonly taskId?: TaskId;
  readonly attemptId?: AttemptId;
  readonly payload?: unknown;
  readonly createdAt: string;
}

export interface TaskPacket {
  readonly missionId: MissionId;
  readonly taskId: TaskId;
  readonly canonicalGeneration: number;
  readonly repositoryRevision?: string;
  readonly roleId: string;
  readonly executionClass: ExecutionClass;
  readonly objective: string;
  readonly constraints: readonly unknown[];
  readonly approvedFindings: readonly unknown[];
  readonly relevantArtifactRefs: readonly string[];
  readonly relevantFiles: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly allowedTools: readonly string[];
  readonly allowedActions: readonly string[];
  readonly priorAttempts: readonly unknown[];
  readonly outputSchemaId: string;
  readonly contextBudget: number;
}

export interface TaskCreateInput {
  readonly taskId?: TaskId | string;
  readonly missionId: MissionId | string;
  readonly roleId: string;
  readonly executionClass: ExecutionClass;
  readonly poolId?: string;
  readonly objective: string;
  readonly constraints?: readonly unknown[];
  readonly acceptanceCriteria?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly allowedActions?: readonly string[];
  readonly outputSchemaId?: string;
  readonly contextBudget?: number;
  readonly packet?: TaskPacket | unknown;
  readonly status?: Extract<TaskStatus, "planned" | "ready">;
}

export interface TaskRecord {
  readonly taskId: TaskId;
  readonly missionId: MissionId;
  readonly revision: number;
  readonly roleId: string;
  readonly executionClass: ExecutionClass;
  readonly poolId?: string;
  readonly lastRunId?: AttemptId;
  readonly packetRevision: number;
  readonly objective: string;
  readonly constraints: readonly unknown[];
  readonly acceptanceCriteria: readonly string[];
  readonly allowedTools: readonly string[];
  readonly allowedActions: readonly string[];
  readonly outputSchemaId?: string;
  readonly contextBudget?: number;
  readonly packet?: TaskPacket | unknown;
  readonly status: TaskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskStatusOptions {
  readonly expectedRevision?: number;
  readonly actor?: MissionActor;
  readonly reason?: string;
}

export interface AttemptCreateInput {
  readonly attemptId?: AttemptId | string;
  readonly taskId: TaskId | string;
  readonly routeId?: StableId | string;
  readonly remoteModelId?: string;
	readonly leaseOwner?: LeaseOwner | string;
	readonly leaseTtlMs?: number;
	readonly packetRevision?: number;
}

export interface AttemptRecord {
  readonly attemptId: AttemptId;
  readonly taskId: TaskId;
  readonly missionId: MissionId;
  readonly revision: number;
  readonly routeId?: StableId;
  readonly remoteModelId?: string;
  readonly status: AttemptStatus;
  readonly leaseOwner?: LeaseOwner;
  readonly leaseExpiresAt?: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly terminalState?: string;
  readonly mutationObserved: boolean;
  readonly result?: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly packetRevision?: number;
}

export interface LeaseRecord {
  readonly missionId: MissionId;
  readonly owner: LeaseOwner;
  /** The caller-supplied owner token; retained as an explicit alias for API clarity. */
  readonly ownerToken: LeaseOwner;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
  readonly recoveredFrom?: LeaseOwner;
}

export interface EvidenceInput {
  readonly evidenceId?: EvidenceId | string;
  readonly missionId: MissionId | string;
  readonly taskId?: TaskId | string;
  readonly attemptId?: AttemptId | string;
  readonly kind: EvidenceKind | string;
  readonly content: unknown;
  readonly artifactRefs?: readonly string[];
  readonly sourceRevision?: number;
  readonly actor?: MissionActor;
  readonly packetRevision?: number;
  readonly runId?: AttemptId | string;
  readonly routeId?: string;
  readonly remoteModelId?: string;
  readonly roleId?: string;
  readonly executionClass?: ExecutionClass;
}

export interface EvidenceRecord {
  readonly evidenceId: EvidenceId;
  readonly missionId: MissionId;
  readonly taskId?: TaskId;
  readonly attemptId?: AttemptId;
  readonly kind: string;
  readonly status: EvidenceStatus;
  readonly content: unknown;
  readonly artifactRefs: readonly string[];
  readonly sourceRevision?: number;
  readonly admittedAt: string;
  readonly reviewedAt?: string;
  readonly rejectionReason?: string;
  readonly packetRevision?: number;
  readonly runId?: AttemptId;
  readonly routeId?: string;
  readonly remoteModelId?: string;
  readonly roleId?: string;
  readonly executionClass?: ExecutionClass;
}

export interface CanonicalItem {
  readonly itemId: string;
  readonly kind: string;
  readonly value: unknown;
  readonly sourceEvidenceId?: EvidenceId;
  readonly promotedAt?: string;
}

export interface PromoteEvidenceOptions {
  readonly expectedRevision?: number;
  readonly actor?: MissionActor;
  readonly canonicalKind?: string;
  readonly itemId?: string;
  readonly target?: "validatedFindings" | "completedWork" | "testReviewEvidence" | "approvedDecisions";
  readonly checkpoint?: boolean;
}

export interface CheckpointRecord {
  readonly checkpointId: CheckpointId;
  readonly missionId: MissionId;
  readonly revision: number;
  readonly kind: CheckpointKind;
  readonly status: MissionStatus;
  readonly snapshot: MissionRecord;
  readonly createdAt: string;
}

export interface MissionStoreOptions {
  /** Injected runtime root; no live Pi path is inferred by this module. */
  readonly root: string;
  /** Optional exact database path, useful for tests and host adapters. */
  readonly databasePath?: string;
  readonly clock?: () => Date;
  readonly id?: () => string;
  readonly maxJsonBytes?: number;
  readonly maxTextLength?: number;
  readonly leaseTtlMs?: number;
  /** Test-only transaction fault boundary; never receives domain content. */
  readonly hooks?: {
    readonly fault?: (point: "before-transaction" | "after-snapshot" | "after-event") => void;
    readonly onEvent?: (event: MissionEventRecord) => void;
  };
}

export interface MissionStoreAdapter extends QualityPersistence {
  close(): void;
  getMission(missionId: MissionId | string): MissionRecord | undefined;
  listMissions(): readonly MissionRecord[];
  createMission(input: MissionCreateInput): MissionRecord;
  updateMission(missionId: MissionId | string, patch: MissionPatch, options?: MissionTransitionOptions): MissionRecord;
  transitionMission(missionId: MissionId | string, status: MissionStatus, options?: MissionTransitionOptions): MissionRecord;
  getTask(taskId: TaskId | string): TaskRecord | undefined;
  listTasks(missionId: MissionId | string): readonly TaskRecord[];
  listCanonicalItems(missionId: MissionId | string): readonly CanonicalItem[];
  saveTaskPacket(taskId: TaskId | string, packet: unknown, expectedRevision?: number): TaskRecord;
  createTask(input: TaskCreateInput): TaskRecord;
  startTask(taskId: TaskId | string, options?: TaskStatusOptions): TaskRecord;
  finishTask(taskId: TaskId | string, status?: Extract<TaskStatus, "succeeded" | "execution_completed" | "failed" | "cancelled" | "blocked">, options?: TaskStatusOptions): TaskRecord;
	createAttempt(input: AttemptCreateInput): AttemptRecord;
	getAttempt(attemptId: AttemptId | string): AttemptRecord | undefined;
	updateAttemptProvenance(attemptId: AttemptId | string, options: { readonly routeId?: StableId | string; readonly remoteModelId?: string; readonly packetRevision?: number }): AttemptRecord;
  finishAttempt(attemptId: AttemptId | string, status: Exclude<AttemptStatus, "running">, options?: { readonly terminalState?: string; readonly mutationObserved?: boolean; readonly result?: unknown; readonly routeDiagnostics?: readonly Record<string, unknown>[] }): AttemptRecord;
  admitEvidence(input: EvidenceInput): EvidenceRecord;
  promoteEvidence(evidenceId: EvidenceId | string, options?: PromoteEvidenceOptions): EvidenceRecord;
  rejectEvidence(evidenceId: EvidenceId | string, reason: string, actor?: MissionActor): EvidenceRecord;
  listEvidence(missionId: MissionId | string, status?: EvidenceStatus): readonly EvidenceRecord[];
  acquireLease(missionId: MissionId | string, owner: LeaseOwner | string, options?: { readonly ttlMs?: number; readonly forceRecover?: boolean }): LeaseRecord;
  heartbeatLease(missionId: MissionId | string, owner: LeaseOwner | string, ttlMs?: number): LeaseRecord;
  releaseLease(missionId: MissionId | string, owner: LeaseOwner | string): void;
  recordCheckpoint(missionId: MissionId | string, kind?: CheckpointKind): CheckpointRecord;
  listCheckpoints(missionId: MissionId | string): readonly CheckpointRecord[];
  listEvents(missionId: MissionId | string): readonly MissionEventRecord[];
  recoverInterrupted(options?: { readonly now?: Date; readonly owner?: string }): readonly AttemptRecord[];
  integrityCheck(): void;
  integrityDiagnostics?(): readonly string[];
  backup?(destinationPath?: string): Promise<string>;
}

export type MissionStore = MissionStoreAdapter;
