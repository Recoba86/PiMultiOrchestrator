import type { CriterionResult, MechanicalCheck, QualityGatePolicy, QualityGateResult, QualityVerdict, VerificationResultV1 } from "./types.js";

const MAX_TEXT = 4_000;
const boundedText = (value: unknown, name: string): string => {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT) throw new TypeError(`${name} is invalid`);
	return value.trim()
		.replace(/bearer\s+[a-z0-9._~+/=-]+/giu, "Bearer [redacted]")
		.replace(/(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/giu, "[redacted]")
		.replace(/\bsk-[a-z0-9_-]{8,}\b/giu, "[redacted]");
};
const list = (value: unknown, name: string, max = 64): readonly string[] => {
	if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || item.length > MAX_TEXT)) throw new TypeError(`${name} is invalid`);
	return value.map((item) => String(item).trim()).filter(Boolean);
};

export function parseVerificationResult(input: unknown): VerificationResultV1 {
	if (!input || typeof input !== "object") throw new TypeError("verification result is invalid");
	const value = input as Record<string, unknown>;
	const allowed = new Set(["verdict", "criterionResults", "mechanicalChecks", "findings", "requiredFixes", "risks", "summary"]);
	if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError("verification result contains an unknown field");
	if (value.verdict !== "pass" && value.verdict !== "reject" && value.verdict !== "blocked") throw new TypeError("verification verdict is invalid");
	if (!Array.isArray(value.criterionResults) || value.criterionResults.length > 64) throw new TypeError("criterionResults is invalid");
	const criterionResults: CriterionResult[] = value.criterionResults.map((item, index) => {
		if (!item || typeof item !== "object") throw new TypeError(`criterionResults[${index}] is invalid`);
		const row = item as Record<string, unknown>;
		if (Object.keys(row).some((key) => !["criterion", "status", "evidenceSummary", "mandatory"].includes(key))) throw new TypeError(`criterionResults[${index}] contains an unknown field`);
		if (row.status !== "satisfied" && row.status !== "failed" && row.status !== "not_verified") throw new TypeError(`criterionResults[${index}].status is invalid`);
		return { criterion: boundedText(row.criterion, `criterionResults[${index}].criterion`), status: row.status, evidenceSummary: boundedText(row.evidenceSummary, `criterionResults[${index}].evidenceSummary`), ...(row.mandatory === undefined ? {} : { mandatory: row.mandatory === true }) };
	});
	if (!Array.isArray(value.mechanicalChecks) || value.mechanicalChecks.length > 64) throw new TypeError("mechanicalChecks is invalid");
	const mechanicalChecks: MechanicalCheck[] = value.mechanicalChecks.map((item, index) => {
		if (!item || typeof item !== "object") throw new TypeError(`mechanicalChecks[${index}] is invalid`);
		const row = item as Record<string, unknown>;
		if (Object.keys(row).some((key) => !["command", "exitStatus", "outcome", "summary", "durationMs", "provenance"].includes(key))) throw new TypeError(`mechanicalChecks[${index}] contains an unknown field`);
		if (row.outcome !== "passed" && row.outcome !== "failed" && row.outcome !== "timed_out" && row.outcome !== "not_run") throw new TypeError(`mechanicalChecks[${index}].outcome is invalid`);
		if (row.provenance !== "orchestrator" && row.provenance !== "reviewer" && row.provenance !== "worker_claim") throw new TypeError(`mechanicalChecks[${index}].provenance is invalid`);
		if (row.exitStatus !== undefined && (!Number.isInteger(row.exitStatus) || Number(row.exitStatus) < 0)) throw new TypeError(`mechanicalChecks[${index}].exitStatus is invalid`);
		if (row.durationMs !== undefined && (!Number.isSafeInteger(row.durationMs) || Number(row.durationMs) < 0 || Number(row.durationMs) > 86_400_000)) throw new TypeError(`mechanicalChecks[${index}].durationMs is invalid`);
		return { command: boundedText(row.command, `mechanicalChecks[${index}].command`), outcome: row.outcome, provenance: row.provenance, ...(row.exitStatus === undefined ? {} : { exitStatus: Number(row.exitStatus) }), ...(row.summary === undefined ? {} : { summary: boundedText(row.summary, `mechanicalChecks[${index}].summary`) }), ...(row.durationMs === undefined ? {} : { durationMs: Number(row.durationMs) }) };
	});
	if (new Set(criterionResults.map((criterion) => criterion.criterion)).size !== criterionResults.length) throw new TypeError("criterionResults contains duplicate criteria");
	return { verdict: value.verdict, criterionResults, mechanicalChecks, findings: list(value.findings, "findings"), requiredFixes: list(value.requiredFixes, "requiredFixes"), risks: list(value.risks, "risks"), summary: boundedText(value.summary, "summary") };
}

export function evaluateQualityGate(input: { readonly acceptanceCriteria: readonly string[]; readonly mechanicalChecks: readonly MechanicalCheck[]; readonly reviewerResult: VerificationResultV1; readonly policy?: Partial<QualityGatePolicy> }): QualityGateResult {
	const policy: QualityGatePolicy = { missingCriterion: input.policy?.missingCriterion ?? "blocked", requireMechanicalChecks: input.policy?.requireMechanicalChecks ?? false };
	const criteria = [...input.reviewerResult.criterionResults];
	const byName = new Map(criteria.map((criterion) => [criterion.criterion, criterion]));
	const reasons: string[] = [];
	for (const criterion of input.acceptanceCriteria) {
		const result = byName.get(criterion);
		if (!result || result.status === "not_verified") reasons.push(`criterion not verified: ${criterion}`);
		else if (result.status === "failed") reasons.push(`criterion failed: ${criterion}`);
	}
	const mechanicalChecks = [...input.mechanicalChecks];
	if (policy.requireMechanicalChecks && mechanicalChecks.length === 0) reasons.push("required mechanical checks are missing");
	if (mechanicalChecks.some((check) => check.outcome === "failed")) reasons.push("mechanical check failed");
	if (mechanicalChecks.some((check) => check.outcome === "timed_out")) reasons.push("mechanical check timed out");
	const failedCriterion = criteria.some((criterion) => criterion.mandatory === true && criterion.status === "failed") || reasons.some((reason) => reason.startsWith("criterion failed"));
	const missingCriterion = reasons.some((reason) => reason.startsWith("criterion not verified"));
	let verdict: QualityVerdict = input.reviewerResult.verdict;
	if (failedCriterion || mechanicalChecks.some((check) => check.outcome === "failed")) verdict = "reject";
	else if (missingCriterion || mechanicalChecks.some((check) => check.outcome === "timed_out") || (policy.requireMechanicalChecks && mechanicalChecks.length === 0)) verdict = policy.missingCriterion === "reject" && missingCriterion ? "reject" : "blocked";
	else if (verdict === "pass" && criteria.some((criterion) => criterion.mandatory === true && criterion.status !== "satisfied")) verdict = "blocked";
	return {
		verdict,
		reasons,
		criterionResults: criteria,
		mechanicalChecks,
		findings: input.reviewerResult.findings,
		requiredFixes: input.reviewerResult.requiredFixes,
		risks: input.reviewerResult.risks,
		reviewerSummary: input.reviewerResult.summary,
	};
}
