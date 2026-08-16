import type { RecoveryAction, RecoveryDecision } from "./types.js";

export const RECOVERY_DECISION_TOOL_NAME = "submit_recovery_decision";

const ACTIONS = new Set<RecoveryAction>(["CONTINUE_EXISTING_WORK", "REPAIR_EXISTING_WORK", "ROLLBACK_AND_RETRY", "REQUEST_HUMAN"]);

export function normalizeRecoveryDecision(value: unknown, options: { readonly rollbackProven?: boolean } = {}): RecoveryDecision {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Recovery decision must be an object");
	const raw = value as Record<string, unknown>;
	if (typeof raw.action !== "string" || !ACTIONS.has(raw.action as RecoveryAction)) throw new TypeError("Recovery decision action is invalid");
	if (typeof raw.summary !== "string" || raw.summary.trim().length === 0) throw new TypeError("Recovery decision summary is invalid");
	const action = raw.action as RecoveryAction;
	if (action === "ROLLBACK_AND_RETRY" && options.rollbackProven !== true) {
		return { action: "REQUEST_HUMAN", summary: "Rollback is not proven safe; human review is required" };
	}
	return { action, summary: raw.summary.trim().slice(0, 2_000) };
}

export function createRecoveryDecisionTool(): { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown>; readonly constrainedSampling: { readonly type: "json_schema"; readonly strict: "prefer" } } {
	return {
		name: RECOVERY_DECISION_TOOL_NAME,
		description: "Submit the Boss mutation-recovery decision. Capture-only; performs no filesystem, network, or Mission mutation.",
		parameters: RECOVERY_DECISION_TOOL_SCHEMA as unknown as Record<string, unknown>,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
	};
}

export function parseRecoveryAssistantResponse(response: unknown): RecoveryDecision {
	if (!response || typeof response !== "object") throw new TypeError("Recovery decision response is invalid");
	const content = (response as { content?: unknown }).content;
	if (Array.isArray(content)) {
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const item = block as Record<string, unknown>;
			if (item.type === "toolCall" && item.name === RECOVERY_DECISION_TOOL_NAME && item.arguments && typeof item.arguments === "object") {
				return normalizeRecoveryDecision(item.arguments);
			}
		}
	}
	throw new TypeError("Recovery decision tool was not submitted");
}

export const RECOVERY_BOSS_PROMPT = [
	"You are the PMO Boss deciding how to recover local Implementation work that mutated the worktree but missed submit_agent_result.",
	"The current worktree is preserved. Do not ask for a human unless the mutation is unsafe, unknown, or unrecoverable.",
	"Prefer CONTINUE_EXISTING_WORK or REPAIR_EXISTING_WORK for local file edits.",
	"ROLLBACK_AND_RETRY is only valid when a safe local rollback boundary is proven; otherwise REQUEST_HUMAN.",
	"Call submit_recovery_decision exactly once.",
].join("\n");

export const RECOVERY_DECISION_TOOL_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["action", "summary"],
	properties: {
		action: { type: "string", enum: [...ACTIONS] },
		summary: { type: "string", minLength: 1, maxLength: 2_000 },
	},
} as const;
