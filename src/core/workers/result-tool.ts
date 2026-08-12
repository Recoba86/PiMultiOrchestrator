import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";

import {
	WORKER_PROTOCOL_VERSION,
	type ChildResultProtocol,
	type ChildTestResult,
	type ResultToolState,
	type StructuredChildResult,
} from "./types.js";

const MAX_SUMMARY = 4_000;
const MAX_ITEM = 2_000;
const MAX_ITEMS = 32;
const MAX_TEST_COMMAND = 1_000;
const MAX_TEST_OUTCOME = 1_000;

const SUBMIT_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: { type: "string", enum: ["completed", "blocked"] },
		summary: { type: "string", maxLength: MAX_SUMMARY },
		evidence: { type: "array", maxItems: MAX_ITEMS, items: { type: "string", maxLength: MAX_ITEM } },
		filesChanged: { type: "array", maxItems: MAX_ITEMS, items: { type: "string", maxLength: MAX_ITEM } },
		tests: {
			type: "array",
			maxItems: MAX_ITEMS,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					command: { type: "string", maxLength: MAX_TEST_COMMAND },
					outcome: { type: "string", maxLength: MAX_TEST_OUTCOME },
				},
				required: ["command", "outcome"],
			},
		},
		risks: { type: "array", maxItems: MAX_ITEMS, items: { type: "string", maxLength: MAX_ITEM } },
		questions: { type: "array", maxItems: MAX_ITEMS, items: { type: "string", maxLength: MAX_ITEM } },
	},
	required: ["status", "summary"],
} as unknown as ToolDefinition["parameters"];

export function createResultToolState(): ResultToolState {
	return { submitted: undefined, submissionCount: 0, protocolViolation: false };
}

export function submitAgentResultParameters(): ToolDefinition["parameters"] {
	return SUBMIT_PARAMETERS;
}

/**
 * Child-only structured handoff. The tool state is in-memory and one-shot;
 * duplicate submissions are protocol violations rather than arbitrary wins.
 */
export function createSubmitAgentResultTool(state: ResultToolState = createResultToolState()): ToolDefinition {
	return {
		name: "submit_agent_result",
		label: "Submit agent result",
		description: "Submit one bounded structured handoff to the parent, then stop. Do not include secrets or raw tool output.",
		promptSnippet: "submit_agent_result: return one bounded structured handoff",
		parameters: SUBMIT_PARAMETERS,
		execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
			const mutable = state as MutableResultToolState;
			mutable.submissionCount += 1;
			if (mutable.submissionCount !== 1) {
				mutable.protocolViolation = true;
				return failure("Only one submit_agent_result call is allowed");
			}
			try {
				mutable.submitted = parseStructuredChildResult(params);
				return {
					content: [{ type: "text", text: "Structured result accepted. Stop now." }],
					details: { accepted: true },
					terminate: true,
				};
			} catch (error) {
				mutable.protocolViolation = true;
				return failure(error instanceof Error ? error.message : "Structured result is invalid");
			}
		},
	};
}

/** Adapt the legacy worker handoff to the caller-supplied M5 protocol seam. */
export function createAgentResultProtocol(): ChildResultProtocol {
	const state = createResultToolState();
	return {
		toolName: "submit_agent_result",
		tool: createSubmitAgentResultTool(state),
		getResult: () => state.submitted,
		hasProtocolViolation: () => state.protocolViolation,
	};
}

export function parseStructuredChildResult(value: unknown): StructuredChildResult {
	if (!isRecord(value)) throw new TypeError("Structured result must be an object");
	const keys = new Set(["status", "summary", "evidence", "filesChanged", "tests", "risks", "questions"]);
	for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError("Structured result contains an unknown field");
	const status = value.status;
	if (status !== "completed" && status !== "blocked") throw new TypeError("Structured result status is invalid");
	const summary = boundedText(value.summary, MAX_SUMMARY, "summary");
	const evidence = boundedTextArray(value.evidence, "evidence");
	const filesChanged = boundedTextArray(value.filesChanged, "filesChanged");
	const tests = boundedTests(value.tests);
	const risks = boundedTextArray(value.risks, "risks");
	const questions = boundedTextArray(value.questions, "questions");
	return {
		protocolVersion: WORKER_PROTOCOL_VERSION,
		status,
		summary,
		evidence,
		filesChanged,
		tests,
		risks,
		questions,
	};
}

interface MutableResultToolState {
	submitted: StructuredChildResult | undefined;
	submissionCount: number;
	protocolViolation: boolean;
}

function boundedText(value: unknown, max: number, field: string): string {
	if (typeof value !== "string") throw new TypeError(`Structured result ${field} must be text`);
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > max) throw new TypeError(`Structured result ${field} is outside bounds`);
	const text = redactSecrets(trimmed);
	if (text.length === 0 || text.length > max) throw new TypeError(`Structured result ${field} is outside bounds`);
	return text;
}

function boundedTextArray(value: unknown, field: string): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new TypeError(`Structured result ${field} is outside bounds`);
	return value.map((item) => boundedText(item, MAX_ITEM, field));
}

function boundedTests(value: unknown): readonly ChildTestResult[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new TypeError("Structured result tests are outside bounds");
	return value.map((item) => {
		if (!isRecord(item) || Object.keys(item).some((key) => key !== "command" && key !== "outcome")) throw new TypeError("Structured result test is invalid");
		return {
			command: boundedText(item.command, MAX_TEST_COMMAND, "test command"),
			outcome: boundedText(item.outcome, MAX_TEST_OUTCOME, "test outcome"),
		};
	});
}

function redactSecrets(value: string): string {
	return value
		.replace(/bearer\s+[a-z0-9._~+/=-]+/giu, "Bearer [redacted]")
		.replace(/(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/giu, "[redacted]")
		.replace(/\bsk-[a-z0-9_-]{8,}\b/giu, "[redacted]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(message: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: message.slice(0, 160) }],
		details: { accepted: false },
	};
}
