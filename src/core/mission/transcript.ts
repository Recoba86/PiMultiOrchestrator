import type { MissionEventRecord, MissionRecord, MissionStoreAdapter } from "./types.js";
import type { SecretSanitizer } from "../security/index.js";
import type { WorkerProgressEvent } from "../workers/types.js";

export const MISSION_ACTIVITY_CUSTOM_TYPE = "pi-multi-orchestrator:activity";

export interface MissionTranscriptEntryData {
	readonly missionId: string;
	readonly eventId?: string;
	readonly revision?: number;
	readonly kind: string;
	readonly text: string;
	readonly timestamp: string;
	readonly status?: string;
}

export interface PiComponent {
	render(width: number): string[];
}

export function formatTranscriptEntry(kind: string, text: string): string {
	return text;
}

export function renderTranscriptComponent(data: MissionTranscriptEntryData): PiComponent {
	return {
		render(width: number): string[] {
			const rawLines = data.text.split("\n");
			return rawLines.map((line) => line.length > width ? line.slice(0, Math.max(0, width - 1)) + "…" : line);
		},
	};
}

const safeFormat = (text: string, sanitizer?: SecretSanitizer): string => {
	if (!sanitizer) return text;
	return sanitizer.sanitizeText(text);
};

export function projectMissionTranscriptEvent(
	event: MissionEventRecord,
	sanitizer?: SecretSanitizer,
): MissionTranscriptEntryData | undefined {
	const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>;
	const timestamp = event.createdAt ?? new Date().toISOString();
	const missionId = event.missionId;
	const eventId = event.eventId;
	const revision = event.revision;

	switch (event.kind) {
		case "mission_created": {
			const goal = typeof payload.goal === "string" ? payload.goal : "";
			return {
				missionId,
				eventId,
				revision,
				kind: "mission_created",
				text: `Mission started · ${missionId}\n  Goal: ${safeFormat(goal.slice(0, 120), sanitizer)}`,
				timestamp,
			};
		}
		case "mission_running": {
			const model = typeof payload.remoteModelId === "string" ? payload.remoteModelId : (typeof payload.routeId === "string" ? payload.routeId : undefined);
			return {
				missionId,
				eventId,
				revision,
				kind: "mission_running",
				text: model ? `Mission running · Boss ${safeFormat(model, sanitizer)}` : `Mission running`,
				timestamp,
			};
		}
		case "mission_updated": {
			const metadata = (payload.metadata && typeof payload.metadata === "object" ? payload.metadata : payload) as Record<string, unknown>;
			const kind = typeof metadata.kind === "string" ? metadata.kind : "";
			if (kind === "boss-assignment") {
				const model = typeof metadata.remoteModelId === "string" ? metadata.remoteModelId : String(metadata.routeId ?? "Boss");
				return {
					missionId,
					eventId,
					revision,
					kind: "boss_assignment",
					text: `Boss · ${safeFormat(model, sanitizer)}\n  ✓ Assigned`,
					timestamp,
				};
			}
			if (kind === "boss-plan") {
				const action = typeof metadata.action === "string" ? metadata.action : "plan";
				const actionLabel = action === "dispatch" ? "Dispatch" : action === "replan" ? "Targeted repair / replan" : action;
				return {
					missionId,
					eventId,
					revision,
					kind: "boss_plan",
					text: `Boss Plan created\n  → Planning\n  ✓ ${actionLabel}`,
					timestamp,
				};
			}
			if (kind === "boss-fallback") {
				return {
					missionId,
					eventId,
					revision,
					kind: "boss_fallback",
					text: `Boss route fallback · from ${metadata.fromRouteId} to ${metadata.toRouteId}`,
					timestamp,
				};
			}
			return undefined;
		}
		case "task_created": {
			const execClass = typeof payload.executionClass === "string" ? payload.executionClass : "task";
			const role = typeof payload.roleId === "string" ? payload.roleId : "";
			return {
				missionId,
				eventId,
				revision,
				kind: "task_created",
				text: `Task started · ${execClass}${role ? ` (${role})` : ""}`,
				timestamp,
			};
		}
		case "task_started": {
			const model = typeof payload.remoteModelId === "string" ? payload.remoteModelId : (typeof payload.routeId === "string" ? payload.routeId : "worker");
			return {
				missionId,
				eventId,
				revision,
				kind: "task_started",
				text: `Worker ${safeFormat(model, sanitizer)} started Attempt`,
				timestamp,
			};
		}
		case "attempt_started": {
			const model = typeof payload.remoteModelId === "string" ? payload.remoteModelId : (typeof payload.routeId === "string" ? payload.routeId : "worker");
			return {
				missionId,
				eventId,
				revision,
				kind: "attempt_started",
				text: `Worker ${safeFormat(model, sanitizer)} started Attempt`,
				timestamp,
			};
		}
		case "attempt_finished":
		case "attempt_succeeded":
		case "attempt_failed":
		case "attempt_interrupted":
		case "attempt_cancelled": {
			const status = typeof payload.status === "string" ? payload.status : event.kind.replace("attempt_", "");
			return {
				missionId,
				eventId,
				revision,
				kind: "attempt_finished",
				text: `Attempt ${status}`,
				timestamp,
			};
		}
		case "evidence_proposed": {
			const evKind = typeof payload.kind === "string" ? payload.kind : "evidence";
			return {
				missionId,
				eventId,
				revision,
				kind: "evidence_proposed",
				text: `Evidence proposed · ${evKind}`,
				timestamp,
			};
		}
		case "evidence_admitted":
		case "evidence_accepted": {
			const evKind = typeof payload.kind === "string" ? payload.kind : "evidence";
			return {
				missionId,
				eventId,
				revision,
				kind: "evidence_admitted",
				text: `Evidence accepted · ${evKind}`,
				timestamp,
			};
		}
		case "verification_started": {
			const model = typeof payload.reviewerRemoteModelId === "string" ? payload.reviewerRemoteModelId : (typeof payload.reviewerRouteId === "string" ? payload.reviewerRouteId : "M7");
			return {
				missionId,
				eventId,
				revision,
				kind: "verification_started",
				text: `M7 Quality Reviewer · ${safeFormat(model, sanitizer)} started`,
				timestamp,
			};
		}
		case "verification_decision":
		case "quality_decision":
		case "quality_pass":
		case "quality_blocked":
		case "quality_reject": {
			const gate = (payload.gate && typeof payload.gate === "object" ? payload.gate : {}) as Record<string, unknown>;
			const rawVerdict = gate.verdict ?? payload.verdict ?? (event.kind === "quality_pass" ? "pass" : "blocked");
			const verdict = String(rawVerdict).toUpperCase();
			const fixes = Array.isArray(gate.requiredFixes) ? gate.requiredFixes : (Array.isArray(payload.requiredFixes) ? payload.requiredFixes : []);
			const reasons = Array.isArray(gate.reasons) ? gate.reasons : (Array.isArray(payload.reasons) ? payload.reasons : []);
			const summary = typeof payload.reviewerSummary === "string" ? payload.reviewerSummary : reasons.join("; ");
			
			const lines = [`M7 Verification · ${verdict === "PASS" ? "✓ PASS" : verdict === "BLOCKED" ? "⚠ BLOCKED" : verdict}`];
			if (summary) lines.push(`  Summary: ${safeFormat(summary.slice(0, 150), sanitizer)}`);
			if (fixes.length > 0) lines.push(`  Required fixes: ${safeFormat(fixes.slice(0, 3).join("; "), sanitizer)}`);
			return {
				missionId,
				eventId,
				revision,
				kind: "quality_decision",
				text: lines.join("\n"),
				timestamp,
			};
		}
		case "mission_completed": {
			const summary = typeof payload.summary === "string" ? payload.summary : "";
			return {
				missionId,
				eventId,
				revision,
				kind: "mission_completed",
				text: `Mission COMPLETED${summary ? ` · ${safeFormat(summary.slice(0, 150), sanitizer)}` : ""}`,
				timestamp,
			};
		}
		case "mission_cancelled": {
			const reason = typeof payload.reason === "string" ? payload.reason : "";
			return {
				missionId,
				eventId,
				revision,
				kind: "mission_cancelled",
				text: `Mission CANCELLED${reason ? ` · ${safeFormat(reason.slice(0, 150), sanitizer)}` : ""}`,
				timestamp,
			};
		}
		case "mission_awaiting-review":
		case "mission_awaiting_user": {
			const reason = typeof payload.reason === "string" ? payload.reason : "";
			return {
				missionId,
				eventId,
				revision,
				kind: "mission_awaiting_user",
				text: `Mission AWAITING_USER${reason ? ` · ${safeFormat(reason.slice(0, 150), sanitizer)}` : ""}`,
				timestamp,
			};
		}
		default:
			return undefined;
	}
}

export function projectWorkerProgressToTranscript(
	missionId: string,
	event: WorkerProgressEvent,
	sanitizer?: SecretSanitizer,
): MissionTranscriptEntryData | undefined {
	const timestamp = new Date().toISOString();
	if (event.type === "tool_started") {
		const target = event.target ? ` ${safeFormat(event.target.slice(0, 60), sanitizer)}` : "";
		return {
			missionId,
			kind: "tool_started",
			text: `  → ${event.toolName}${target}`,
			timestamp,
		};
	}
	if (event.type === "tool_finished") {
		if (event.toolName === "submit_agent_result") {
			return {
				missionId,
				kind: "result_submitted",
				text: `  ✓ Result submitted`,
				timestamp,
			};
		}
		const target = event.target ? ` ${safeFormat(event.target.slice(0, 60), sanitizer)}` : "";
		if (event.toolStatus === "blocked") {
			return {
				missionId,
				kind: "tool_blocked",
				text: `  ⚠ ${event.toolName}${target} (safety-blocked${event.safetyBlockCode ? `: ${event.safetyBlockCode}` : ""})`,
				timestamp,
			};
		}
		if (event.toolStatus === "fail") {
			return {
				missionId,
				kind: "tool_failed",
				text: `  ✗ ${event.toolName}${target}`,
				timestamp,
			};
		}
		return {
			missionId,
			kind: "tool_finished",
			text: `  ✓ ${event.toolName}${target}`,
			timestamp,
		};
	}
	return undefined;
}

export interface MissionTranscriptSession {
	drain(missionId: string): readonly MissionTranscriptEntryData[];
	projectWorkerEvent(missionId: string, event: WorkerProgressEvent): MissionTranscriptEntryData | undefined;
	setCursor(cursor: number): void;
	getCursor(): number;
}

export function createMissionTranscriptSession(options: {
	readonly store?: MissionStoreAdapter;
	readonly sanitizer?: SecretSanitizer;
	readonly initialCursor?: number;
}): MissionTranscriptSession {
	const emittedEventIds = new Set<string>();

	return {
		drain(missionId: string): readonly MissionTranscriptEntryData[] {
			if (!options.store) return [];
			const events = options.store.listEvents(missionId);
			const result: MissionTranscriptEntryData[] = [];
			for (const event of events) {
				const id = String(event.eventId);
				if (emittedEventIds.has(id)) continue;
				emittedEventIds.add(id);
				const projected = projectMissionTranscriptEvent(event, options.sanitizer);
				if (projected) result.push(projected);
			}
			return result;
		},
		projectWorkerEvent(missionId: string, event: WorkerProgressEvent): MissionTranscriptEntryData | undefined {
			return projectWorkerProgressToTranscript(missionId, event, options.sanitizer);
		},
		setCursor(_newCursor: number): void {
			// retained for interface compatibility
		},
		getCursor(): number {
			return emittedEventIds.size;
		},
	};
}
