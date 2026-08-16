import type { PoolId } from "../pools/index.js";
import type { WorkerToolName } from "./types.js";

/** Hard tool visibility boundary for M5 child sessions. */
export const WORKER_TOOL_PROFILES: Readonly<Record<PoolId, readonly WorkerToolName[]>> = {
	investigation: ["read", "grep", "find", "ls"],
	implementation: ["read", "grep", "find", "ls", "bash", "edit", "write"],
	verification: ["read", "grep", "find", "ls"],
};

export type WorkerProfileId = PoolId | "recommendation-analyst" | "recovery-assessor";

export const WORKER_RESULT_TOOL_NAMES = [
	"submit_agent_result",
	"submit_verification_result",
	"submit_recommendation_analysis",
	"submit_recovery_assessment",
] as const;

export type WorkerResultToolName = (typeof WORKER_RESULT_TOOL_NAMES)[number];

export function isWorkerResultToolName(toolName: string): toolName is WorkerResultToolName {
	return (WORKER_RESULT_TOOL_NAMES as readonly string[]).includes(toolName);
}

const READ_ONLY_TOOLS: readonly WorkerToolName[] = ["read", "grep", "find", "ls"];
const RECOVERY_ASSESSOR_TOOLS: readonly WorkerToolName[] = ["read", "ls"];

export function workerProfileFor(poolId: PoolId, resultToolName?: string): WorkerProfileId {
	if (resultToolName === "submit_recommendation_analysis") return "recommendation-analyst";
	if (resultToolName === "submit_recovery_assessment") return "recovery-assessor";
	return poolId;
}

export function toolProfileForWorker(profile: WorkerProfileId): readonly WorkerToolName[] {
	if (profile === "recommendation-analyst") return READ_ONLY_TOOLS;
	if (profile === "recovery-assessor") return RECOVERY_ASSESSOR_TOOLS;
	return WORKER_TOOL_PROFILES[profile];
}

export function toolProfileForPool(poolId: PoolId): readonly WorkerToolName[] {
	return WORKER_TOOL_PROFILES[poolId];
}

export function isPotentiallyMutatingTool(toolName: string): boolean {
	return toolName !== "read" && toolName !== "grep" && toolName !== "find" && toolName !== "ls" && !isWorkerResultToolName(toolName);
}
