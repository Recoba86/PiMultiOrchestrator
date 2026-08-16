import type { ExecutionClass, MissionStoreAdapter, TaskRecord } from "./types.js";

export interface TaskIdentitySpec {
	readonly taskId?: string;
	readonly roleId: string;
	readonly executionClass: ExecutionClass;
	readonly poolId?: "investigation" | "implementation" | "verification";
	readonly objective: string;
	readonly acceptanceCriteria?: readonly string[];
}

const REPAIRABLE = new Set<TaskRecord["status"]>([
	"pending", "planned", "ready", "interrupted", "failed", "blocked", "execution_completed", "succeeded",
]);

export function taskIdentityKey(input: { readonly executionClass: ExecutionClass; readonly objective: string }): string {
	const objective = input.objective.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ").slice(0, 500);
	return `${input.executionClass}:${objective}`;
}

export function resolveOrCreateMissionTask(store: MissionStoreAdapter, missionId: string, spec: TaskIdentitySpec): TaskRecord {
	if (spec.taskId) {
		const existing = store.getTask(spec.taskId);
		if (existing && String(existing.missionId) === missionId && existing.status !== "cancelled") return existing;
	}
	const key = taskIdentityKey(spec);
	const matches = store.listTasks(missionId).filter((task) => task.status !== "cancelled" && taskIdentityKey(task) === key);
	const reusable = [...matches].reverse().find((task) => REPAIRABLE.has(task.status));
	if (reusable) return reusable;
	return store.createTask({
		missionId,
		roleId: spec.roleId,
		executionClass: spec.executionClass,
		poolId: spec.poolId ?? spec.executionClass,
		objective: spec.objective,
		...(spec.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: spec.acceptanceCriteria }),
		status: "planned",
	});
}

/** Latest non-cancelled Task per identity key; historical rows remain durable. */
export function activeMissionTasks(store: MissionStoreAdapter, missionId: string): readonly TaskRecord[] {
	const latest = new Map<string, TaskRecord>();
	for (const task of store.listTasks(missionId)) {
		if (task.status === "cancelled") continue;
		latest.set(taskIdentityKey(task), task);
	}
	return [...latest.values()];
}

export function completedAndVerified(store: MissionStoreAdapter, missionId: string): boolean {
	const active = activeMissionTasks(store, missionId);
	return active.length > 0 && active.every((task) => task.status === "execution_completed" && store.getTaskQualityStatus(task.taskId)?.status === "passed");
}

export function supersededBy(store: MissionStoreAdapter, task: TaskRecord): string | undefined {
	const active = activeMissionTasks(store, String(task.missionId)).find((item) => taskIdentityKey(item) === taskIdentityKey(task));
	if (!active || String(active.taskId) === String(task.taskId)) return undefined;
	return String(active.taskId);
}
