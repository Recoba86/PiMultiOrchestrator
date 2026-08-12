import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ResultProtocolSpec } from "../workers/types.js";
import { parseVerificationResult } from "./gate.js";
import type { VerificationResultV1 } from "./types.js";

const PARAMETERS = {
	type: "object",
	additionalProperties: false,
	properties: {
		verdict: { type: "string", enum: ["pass", "reject", "blocked"] },
		criterionResults: { type: "array", maxItems: 64 },
		mechanicalChecks: { type: "array", maxItems: 64 },
		findings: { type: "array", maxItems: 64 },
		requiredFixes: { type: "array", maxItems: 64 },
		risks: { type: "array", maxItems: 64 },
		summary: { type: "string", maxLength: 4_000 },
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
