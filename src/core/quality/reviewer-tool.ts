import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ResultProtocolSpec } from "../workers/types.js";
import { parseVerificationResult } from "./gate.js";
import type { VerificationResultV1 } from "./types.js";

const TEXT = { type: "string", minLength: 1, maxLength: 4_000 };
const TEXT_LIST = { type: "array", maxItems: 64, items: TEXT };
const CRITERION_RESULT = {
	type: "object",
	additionalProperties: false,
	properties: {
		criterion: TEXT,
		status: { type: "string", enum: ["satisfied", "failed", "not_verified"] },
		evidenceSummary: TEXT,
		mandatory: { type: "boolean" },
	},
	required: ["criterion", "status", "evidenceSummary"],
};
const MECHANICAL_CHECK = {
	type: "object",
	additionalProperties: false,
	properties: {
		command: TEXT,
		exitStatus: { type: "integer", minimum: 0 },
		outcome: { type: "string", enum: ["passed", "failed", "timed_out", "not_run"] },
		summary: TEXT,
		durationMs: { type: "integer", minimum: 0, maximum: 86_400_000 },
		provenance: { type: "string", enum: ["orchestrator", "reviewer", "worker_claim"] },
	},
	required: ["command", "outcome", "provenance"],
};
const PARAMETERS = {
	type: "object",
	additionalProperties: false,
	properties: {
		verdict: { type: "string", enum: ["pass", "reject", "blocked"] },
		criterionResults: { type: "array", maxItems: 64, items: CRITERION_RESULT },
		mechanicalChecks: { type: "array", maxItems: 64, items: MECHANICAL_CHECK },
		findings: TEXT_LIST,
		requiredFixes: TEXT_LIST,
		risks: TEXT_LIST,
		summary: TEXT,
	},
	required: ["verdict", "criterionResults", "mechanicalChecks", "findings", "requiredFixes", "risks", "summary"],
} as unknown as ToolDefinition["parameters"];

export interface VerificationResultToolState {
	readonly submitted?: VerificationResultV1;
	readonly captured?: unknown;
	readonly submissionCount: number;
	readonly protocolViolation: boolean;
}

export function createVerificationResultToolState(): VerificationResultToolState {
	return { submissionCount: 0, protocolViolation: false };
}

/** M5 executor adapter used by the Verification Pool. */
export function createVerificationResultProtocol(): ResultProtocolSpec {
	return {
		toolName: "submit_verification_result",
		parameters: PARAMETERS,
	};
}

/** One-shot bounded reviewer handoff. A rejected/blocked judgment is still a valid submission. */
export function createSubmitVerificationResultTool(state: VerificationResultToolState = createVerificationResultToolState()): ToolDefinition {
	return {
		name: "submit_verification_result",
		label: "Submit verification result",
		description: "Submit one bounded verification result. Do not include secrets or raw transcripts.",
		parameters: PARAMETERS,
		execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
			const mutable = state as { submitted?: VerificationResultV1; submissionCount: number; protocolViolation: boolean };
			mutable.submissionCount += 1;
			if (mutable.submissionCount !== 1) {
				mutable.protocolViolation = true;
				return rejected("Only one submit_verification_result call is allowed");
			}
			try {
				mutable.submitted = parseVerificationResult(params);
				return { content: [{ type: "text", text: "Verification result accepted. Stop now." }], details: { accepted: true }, terminate: true };
			} catch {
				mutable.protocolViolation = true;
				return rejected("Verification result is invalid");
			}
		},
	};
}

export function submitVerificationResultParameters(): ToolDefinition["parameters"] { return PARAMETERS; }

function rejected(text: string): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details: { accepted: false } };
}
