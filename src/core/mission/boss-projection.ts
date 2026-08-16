import type { MissionRecord, MissionStoreAdapter, TaskRecord } from "./types.js";
import { supersededBy } from "./task-identity.js";

export interface BossTaskProjection {
	readonly taskId: string;
	readonly objective: string;
	readonly executionClass: TaskRecord["executionClass"];
	readonly lifecycleStatus: TaskRecord["status"];
	readonly latestAttemptOutcome?: string;
	readonly qualityStatus?: string;
	readonly acceptedEvidenceSummary?: string;
	readonly requiredFixes?: readonly string[];
	readonly supersededByTaskId?: string;
}

export interface BossCanonicalProjection {
	readonly missionStatus: MissionRecord["status"];
	readonly outstandingGoalCriteria: readonly string[];
	readonly tasks: readonly BossTaskProjection[];
}

const bounded = (value: string, max: number): string => value.trim().slice(0, max);

export function projectBossCanonicalState(store: MissionStoreAdapter, mission: MissionRecord): BossCanonicalProjection {
	const tasks = store.listTasks(String(mission.missionId)).slice(0, 32).map((task) => {
		const attempt = task.lastRunId === undefined ? undefined : store.getAttempt(task.lastRunId);
		const quality = store.getTaskQualityStatus(task.taskId);
		const accepted = store.listEvidence(String(mission.missionId), "accepted")
			.filter((item) => item.taskId !== undefined && String(item.taskId) === String(task.taskId))
			.slice(-3)
			.map((item) => bounded(typeof item.content === "string" ? item.content : JSON.stringify(item.content ?? {}), 240));
		const decisionId = quality?.latestDecisionId;
		const requiredFixes = store.listQualityDecisions(String(mission.missionId), task.taskId)
			.filter((item) => decisionId === undefined || item.decisionId === decisionId)
			.at(-1)?.requiredFixes;
		const replaced = supersededBy(store, task);
		return {
			taskId: String(task.taskId),
			objective: bounded(task.objective, 500),
			executionClass: task.executionClass,
			lifecycleStatus: task.status,
			...(attempt?.status === undefined ? {} : { latestAttemptOutcome: attempt.status }),
			...(quality?.status === undefined ? {} : { qualityStatus: quality.status }),
			...(accepted.length === 0 ? {} : { acceptedEvidenceSummary: accepted.join("; ").slice(0, 720) }),
			...(requiredFixes === undefined || requiredFixes.length === 0 ? {} : { requiredFixes: requiredFixes.slice(0, 8) }),
			...(replaced === undefined ? {} : { supersededByTaskId: replaced }),
		};
	});
	return {
		missionStatus: mission.status,
		outstandingGoalCriteria: mission.acceptanceCriteria.slice(0, 32).map((item) => bounded(item, 500)),
		tasks,
	};
}
