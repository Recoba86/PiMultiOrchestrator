import type { MissionStoreAdapter, MissionRecord, TaskRecord } from "./types.js";

export interface TerminalInputHandlerOptions {
	readonly hasActiveMission: () => boolean;
	readonly abort: () => void;
}

export function handleTerminalInputForMission(options: TerminalInputHandlerOptions): (data: string) => { consume?: boolean; data?: string } | undefined {
	return (data: string) => {
		if (data === "\u0003") { // Ctrl+C
			if (options.hasActiveMission()) {
				try {
					options.abort();
				} catch {
					// abort invocation is best-effort
				}
				return { consume: true };
			}
		}
		return undefined;
	};
}

export interface MissionCancelRequest {
	readonly store: MissionStoreAdapter;
	readonly missionId?: string | undefined;
	readonly activeOwnedMissionId?: string | undefined;
	readonly reason?: string | undefined;
}

export type MissionCancelStatus =
	| "cancelled"
	| "already_terminal"
	| "not_found"
	| "no_active_mission"
	| "ambiguous";

export interface MissionCancelResult {
	readonly status: MissionCancelStatus;
	readonly missionId?: string | undefined;
	readonly message?: string | undefined;
}

export function cancelActiveMission(request: MissionCancelRequest): MissionCancelResult {
	const { store } = request;
	let targetId = request.missionId;

	if (!targetId) {
		if (request.activeOwnedMissionId) {
			targetId = request.activeOwnedMissionId;
		} else {
			// Find active missions
			const activeMissions = store.listMissions().filter((m) =>
				m.status === "running" || m.status === "active" || m.status === "planned" || m.status === "draft",
			);
			if (activeMissions.length === 0) {
				return { status: "no_active_mission", message: "No active Mission is currently running in this session." };
			}
			if (activeMissions.length > 1) {
				return {
					status: "ambiguous",
					message: `Multiple active Missions found (${activeMissions.map((m) => m.missionId).join(", ")}). Please specify the missionId: /mission-cancel <id>`,
				};
			}
			targetId = activeMissions[0]!.missionId;
		}
	}

	const mission = store.getMission(targetId);
	if (!mission) {
		return { status: "not_found", missionId: targetId, message: `Mission '${targetId}' was not found.` };
	}

	const isTerminal = ["completed", "cancelled", "awaiting-review", "blocked", "failed"].includes(mission.status);
	if (isTerminal) {
		return { status: "already_terminal", missionId: targetId, message: `Mission '${targetId}' is already terminal (${mission.status}).` };
	}

	const reason = request.reason ?? "Mission cancelled by operator command /mission-cancel";

	// Perform durable cancellation
	store.transitionMission(mission.missionId, "cancelled", {
		actor: "user",
		metadata: { kind: "operator-cancel", reason },
	});

	// Terminalize any running tasks
	const tasks = store.listTasks(mission.missionId);
	for (const task of tasks) {
		if (task.status === "running" || task.status === "pending") {
			store.finishTask(task.taskId, "cancelled");
		}
	}

	// Terminalize any running verifications
	const verifications = store.listVerificationRuns(mission.missionId);
	for (const ver of verifications) {
		if (ver.status !== "completed" && ver.status !== "blocked" && ver.status !== "interrupted") {
			store.finalizeQualityFailure({
				verificationId: ver.verificationId,
				status: "blocked",
				failureSummary: "Mission cancelled",
			});
		}
	}

	return {
		status: "cancelled",
		missionId: targetId,
		message: `Mission '${targetId}' was successfully cancelled.`,
	};
}
