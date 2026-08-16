import type { ResultProtocolSpec } from "../workers/types.js";
import type { RecoveryAssessment } from "./types.js";

export const RECOVERY_ASSESSMENT_TOOL_NAME = "submit_recovery_assessment";
const MAX_ITEM = 2_000;
const MAX_ITEMS = 32;

export function createRecoveryAssessmentProtocol(): ResultProtocolSpec {
	return {
		toolName: RECOVERY_ASSESSMENT_TOOL_NAME,
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["whatChanged", "completeParts", "incompleteParts", "suspectedIncorrect", "recoverable", "humanRequired", "recommendedPlan", "continuationInstruction"],
			properties: {
				whatChanged: { type: "array", maxItems: MAX_ITEMS, items: { type: "string", maxLength: MAX_ITEM } },
				completeParts: { type: "array", maxItems: MAX_ITEMS, items: { type: "string", maxLength: MAX_ITEM } },
				incompleteParts: { type: "array", maxItems: MAX_ITEMS, items: { type: "string", maxLength: MAX_ITEM } },
				suspectedIncorrect: { type: "array", maxItems: MAX_ITEMS, items: { type: "string", maxLength: MAX_ITEM } },
				recoverable: { type: "boolean" },
				humanRequired: { type: "boolean" },
				recommendedPlan: { type: "string", minLength: 1, maxLength: MAX_ITEM },
				continuationInstruction: { type: "string", minLength: 1, maxLength: MAX_ITEM },
			},
		},
	};
}

export function parseRecoveryAssessment(value: unknown): RecoveryAssessment {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Recovery assessment must be an object");
	const raw = value as Record<string, unknown>;
	const keys = new Set(["whatChanged", "completeParts", "incompleteParts", "suspectedIncorrect", "recoverable", "humanRequired", "recommendedPlan", "continuationInstruction"]);
	for (const key of Object.keys(raw)) if (!keys.has(key)) throw new TypeError("Recovery assessment contains an unknown field");
	if (typeof raw.recoverable !== "boolean" || typeof raw.humanRequired !== "boolean") throw new TypeError("Recovery assessment flags are invalid");
	return {
		whatChanged: textList(raw.whatChanged, "whatChanged"),
		completeParts: textList(raw.completeParts, "completeParts"),
		incompleteParts: textList(raw.incompleteParts, "incompleteParts"),
		suspectedIncorrect: textList(raw.suspectedIncorrect, "suspectedIncorrect"),
		recoverable: raw.recoverable,
		humanRequired: raw.humanRequired,
		recommendedPlan: text(raw.recommendedPlan, "recommendedPlan"),
		continuationInstruction: text(raw.continuationInstruction, "continuationInstruction"),
	};
}

function text(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_ITEM) throw new TypeError(`${path} is invalid`);
	return value.trim();
}

function textList(value: unknown, path: string): readonly string[] {
	if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new TypeError(`${path} is invalid`);
	return value.map((item, index) => text(item, `${path}[${index}]`));
}
