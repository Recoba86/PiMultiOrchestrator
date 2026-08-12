import type { PoolId } from "../pools/index.js";
import type { WorkerToolName } from "./types.js";

/** Hard tool visibility boundary for M5 child sessions. */
export const WORKER_TOOL_PROFILES: Readonly<Record<PoolId, readonly WorkerToolName[]>> = {
	investigation: ["read", "grep", "find", "ls"],
	implementation: ["read", "grep", "find", "ls", "bash", "edit", "write"],
	verification: ["read", "grep", "find", "ls", "bash"],
};

export function toolProfileForPool(poolId: PoolId): readonly WorkerToolName[] {
	return WORKER_TOOL_PROFILES[poolId];
}

export function isPotentiallyMutatingTool(toolName: string): boolean {
	return toolName !== "read" && toolName !== "grep" && toolName !== "find" && toolName !== "ls" && toolName !== "submit_agent_result";
}

