import type { ExecutionClass } from "../config/types.js";
import type { PoolId } from "../pools/index.js";
import type { SubagentExecutionRequest } from "../workers/types.js";

export const TASK_PACKET_VERSION = 1 as const;

/** JSON-like values are the only values that may cross the context boundary. */
export type ContextJson = null | boolean | number | string | ContextJson[] | { readonly [key: string]: ContextJson };

export type CanonicalItemStatus = "accepted" | "approved" | "proposed" | "rejected" | "stale";

export interface ContextCanonicalItem {
	readonly itemId: string;
	readonly kind: string;
	readonly value: unknown;
	readonly status?: CanonicalItemStatus | string;
	readonly accepted?: boolean;
	readonly tags?: readonly string[];
	readonly scopes?: readonly string[];
	readonly relevantFiles?: readonly string[];
	readonly artifactRefs?: readonly string[];
	readonly sourceEvidenceId?: string;
}

export interface ContextMissionRecord {
	readonly missionId: string;
	readonly revision: number;
	readonly goal?: string;
	readonly objective?: string;
	readonly constraints?: readonly unknown[];
	readonly acceptanceCriteria?: readonly string[];
	readonly repository?: {
		readonly cwd?: string;
		readonly revision?: string;
		readonly projectKey?: string;
	};
	/** Accepted plan projection; raw transcripts are never represented here. */
	readonly plan?: unknown;
	readonly validatedFindings?: readonly unknown[];
	readonly completedWork?: readonly unknown[];
	readonly testReviewEvidence?: readonly unknown[];
	readonly approvedDecisions?: readonly unknown[];
}

export interface ContextTaskRecord {
	readonly taskId: string;
	readonly missionId?: string;
	readonly revision?: number;
	readonly roleId?: string;
	readonly executionClass?: ExecutionClass;
	/** Kept string-shaped so MissionStore task rows can be consumed structurally; broker validates it. */
	readonly poolId?: PoolId | string;
	readonly objective?: string;
	readonly constraints?: readonly unknown[];
	readonly acceptanceCriteria?: readonly string[];
	readonly allowedTools?: readonly string[];
	readonly allowedActions?: readonly string[];
	readonly outputSchemaId?: string;
	readonly contextBudget?: number;
	readonly cwd?: string;
	readonly priorAttempts?: readonly unknown[];
}

/** Narrow read-only boundary; no SQLite or MissionStore implementation leaks in. */
export interface ContextRepository {
	readonly getMission: (missionId: string) => ContextMissionRecord | undefined;
	readonly getTask?: (taskId: string) => ContextTaskRecord | undefined;
	readonly listCanonicalItems?: (missionId: string) => readonly ContextCanonicalItem[];
	/** Common adapter aliases; all are read-only and return canonical projections. */
	readonly getCanonicalItems?: (missionId: string) => readonly ContextCanonicalItem[];
	readonly listAcceptedCanonicalItems?: (missionId: string) => readonly ContextCanonicalItem[];
	/** Alias accepted for simple adapters that already expose a canonical list. */
	readonly listItems?: (missionId: string) => readonly ContextCanonicalItem[];
}

export interface ContextBrokerLimits {
	/** Maximum accepted canonical items retained in one packet. */
	readonly maxItems?: number;
	/** Maximum serialized context characters, including task metadata. */
	readonly maxChars?: number;
	/** Maximum serialized size of one canonical item. */
	readonly maxItemChars?: number;
	/** Maximum length of one scalar task field. */
	readonly maxTextChars?: number;
}

export interface ContextBrokerOptions extends ContextBrokerLimits {
	readonly packetId?: (input: { readonly missionId: string; readonly taskId: string; readonly sourceMissionRevision: number; readonly digestSeed: string }) => string;
}

export interface BuildTaskPacketInput extends ContextBrokerLimits {
	readonly missionId: string;
	readonly taskId: string;
	readonly roleId?: string;
	readonly role?: string;
	readonly executionClass?: ExecutionClass;
	readonly poolId?: PoolId;
	readonly objective?: string;
	readonly constraints?: readonly unknown[];
	readonly acceptanceCriteria?: readonly string[];
	readonly allowedTools?: readonly string[];
	readonly allowedActions?: readonly string[];
	readonly outputSchemaId?: string;
	readonly contextBudget?: number;
	readonly cwd?: string;
	readonly scopes?: readonly string[];
	readonly tags?: readonly string[];
	readonly includeKinds?: readonly string[];
	readonly includeCanonicalItemIds?: readonly string[];
	readonly relevantFiles?: readonly string[];
	readonly relevantArtifactRefs?: readonly string[];
	readonly priorAttempts?: readonly unknown[];
	readonly parentPacketId?: string;
	/** Optional compare-and-swap expectation; the repository revision remains authoritative. */
	readonly sourceMissionRevision?: number;
}

export interface PacketCanonicalItem {
	readonly itemId: string;
	readonly kind: string;
	readonly value: ContextJson;
	readonly tags?: readonly string[];
	readonly scopes?: readonly string[];
	readonly relevantFiles?: readonly string[];
	readonly artifactRefs?: readonly string[];
	readonly sourceEvidenceId?: string;
	readonly validationStatus?: "accepted" | "approved";
}

export interface TaskPacketV1 {
	readonly packetVersion: typeof TASK_PACKET_VERSION;
	readonly packetId: string;
	readonly missionId: string;
	readonly taskId: string;
	readonly role: string;
	readonly roleId: string;
	readonly executionClass: ExecutionClass;
	readonly poolId: PoolId;
	readonly sourceMissionRevision: number;
	readonly sourceRevision: number;
	readonly canonicalGeneration: number;
	readonly repositoryRevision?: string;
	readonly repositoryCwd?: string;
	readonly objective: string;
	readonly constraints: readonly ContextJson[];
	readonly approvedFindings: readonly PacketCanonicalItem[];
	readonly relevantArtifactRefs: readonly string[];
	readonly relevantFiles: readonly string[];
	readonly acceptanceCriteria: readonly string[];
	readonly allowedTools: readonly string[];
	readonly allowedActions: readonly string[];
	readonly priorAttempts: readonly ContextJson[];
	readonly outputSchemaId: string;
	readonly contextBudget: number;
	readonly scopes: readonly string[];
	readonly tags: readonly string[];
	readonly includedCanonicalItemIds: readonly string[];
	readonly omittedCount: number;
	readonly omittedItemIds: readonly string[];
	readonly parentPacketId?: string;
	readonly digest: string;
}

export type TaskPacket = TaskPacketV1;

export interface PacketChildRequestOptions {
	readonly cwd?: string;
	readonly timeoutMs?: number;
}

export type PacketChildRequest = SubagentExecutionRequest;

export interface ContextBuildResult {
	readonly packet: TaskPacketV1;
	readonly includedCanonicalItemIds: readonly string[];
	readonly omittedCount: number;
}

export type ContextItem = ContextCanonicalItem;
