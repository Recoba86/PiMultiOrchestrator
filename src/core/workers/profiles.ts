import type { PoolId } from "../pools/index.js";
import type { WorkerToolName } from "./types.js";

/** Hard tool visibility boundary for M5 child sessions. */
export const WORKER_TOOL_PROFILES: Readonly<Record<PoolId, readonly WorkerToolName[]>> = {
	investigation: ["read", "grep", "find", "ls"],
	implementation: ["read", "grep", "find", "ls", "bash", "edit", "write"],
	verification: ["read", "grep", "find", "ls", "bash"],
};

export type WorkerProfileId = PoolId | "recommendation-analyst";

export const WORKER_RESULT_TOOL_NAMES = [
	"submit_agent_result",
	"submit_verification_result",
	"submit_recommendation_analysis",
] as const;

export type WorkerResultToolName = (typeof WORKER_RESULT_TOOL_NAMES)[number];

export function isWorkerResultToolName(toolName: string): toolName is WorkerResultToolName {
	return (WORKER_RESULT_TOOL_NAMES as readonly string[]).includes(toolName);
}

const READ_ONLY_TOOLS: readonly WorkerToolName[] = ["read", "grep", "find", "ls"];

export function workerProfileFor(poolId: PoolId, resultToolName?: string): WorkerProfileId {
	return resultToolName === "submit_recommendation_analysis" ? "recommendation-analyst" : poolId;
}

export function toolProfileForWorker(profile: WorkerProfileId): readonly WorkerToolName[] {
	return profile === "recommendation-analyst" ? READ_ONLY_TOOLS : WORKER_TOOL_PROFILES[profile];
}

export function toolProfileForPool(poolId: PoolId): readonly WorkerToolName[] {
	return WORKER_TOOL_PROFILES[poolId];
}

export function isPotentiallyMutatingTool(toolName: string): boolean {
	return toolName !== "read" && toolName !== "grep" && toolName !== "find" && toolName !== "ls" && !isWorkerResultToolName(toolName);
}
