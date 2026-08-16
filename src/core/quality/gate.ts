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

const criterionKey = (value: string): string =>
	value.normalize("NFKC").toLowerCase().replace(/[\u200b\ufeff\u2060]/gu, "").replace(/[.:;!?]+$/gu, "").replace(/\s+/gu, " ").trim();

const isNoModificationCriterion = (value: string): boolean =>
	/\bno(?:\s+repository)?\s+files?\s+(?:are\s+)?modif|\bdo not\s+(?:modify|change|edit|write)|\bwithout modifying|\bno modifications?\b|\bensure no .*\bmodif/iu.test(value);

export function alignCriterionResults(acceptanceCriteria: readonly string[], results: readonly CriterionResult[]): readonly CriterionResult[] {
	const criteria = acceptanceCriteria.map((item) => item.trim()).filter(Boolean);
	if (criteria.length === 0) return results;
	const byKey = new Map<string, CriterionResult>();
	for (const result of results) {
		const key = criterionKey(result.criterion);
		if (key && !byKey.has(key)) byKey.set(key, result);
	}
	const named = criteria.map((criterion) => {
		const hit = byKey.get(criterionKey(criterion));
		return hit ? { ...hit, criterion } : undefined;
	});
	if (named.every((item) => item !== undefined)) return named;
	if (named.every((item) => item === undefined) && results.length === criteria.length) {
		return criteria.map((criterion, index) => ({ ...results[index]!, criterion }));
	}
	return criteria.map((criterion, index) => named[index] ?? { criterion, status: "not_verified" as const, evidenceSummary: "reviewer did not report this acceptance criterion" });
}

export function evaluateQualityGate(input: {
	readonly acceptanceCriteria: readonly string[];
	readonly mechanicalChecks: readonly MechanicalCheck[];
	readonly reviewerResult: VerificationResultV1;
	readonly policy?: Partial<QualityGatePolicy>;
	readonly executionClass?: string;
	readonly mutationObserved?: boolean;
}): QualityGateResult {
	const policy: QualityGatePolicy = { missingCriterion: input.policy?.missingCriterion ?? "blocked", requireMechanicalChecks: input.policy?.requireMechanicalChecks ?? false };
	const aligned = alignCriterionResults(input.acceptanceCriteria, input.reviewerResult.criterionResults);
	const criteria = aligned.map((result) => {
		if (
			result.status === "not_verified"
			&& input.executionClass === "investigation"
			&& input.mutationObserved === false
			&& isNoModificationCriterion(result.criterion)
		) {
			return { ...result, status: "satisfied" as const, evidenceSummary: `${result.evidenceSummary}; orchestrator observed no mutation on the worker Attempt` };
		}
		return result;
	});
	const byName = new Map(criteria.map((criterion) => [criterion.criterion, criterion]));
	const reasons: string[] = [];
	for (const criterion of input.acceptanceCriteria.map((item) => item.trim()).filter(Boolean)) {
		const result = byName.get(criterion);
		if (!result || result.status === "not_verified") reasons.push(`criterion not verified: ${criterion}`);
		else if (result.status === "failed") reasons.push(`criterion failed: ${criterion}`);
	}
	const mechanicalChecks = [...input.mechanicalChecks];
	if (input.reviewerResult.verdict === "pass" && criteria.length === 0 && mechanicalChecks.length === 0) reasons.push("verification evidence is missing");
	if (policy.requireMechanicalChecks && mechanicalChecks.length === 0) reasons.push("required mechanical checks are missing");
	if (mechanicalChecks.some((check) => check.outcome === "failed")) reasons.push("mechanical check failed");
	if (mechanicalChecks.some((check) => check.outcome === "timed_out")) reasons.push("mechanical check timed out");
	const failedCriterion = criteria.some((criterion) => criterion.mandatory === true && criterion.status === "failed") || reasons.some((reason) => reason.startsWith("criterion failed"));
	const missingCriterion = reasons.some((reason) => reason.startsWith("criterion not verified"));
	let verdict: QualityVerdict = input.reviewerResult.verdict;
	if (failedCriterion || mechanicalChecks.some((check) => check.outcome === "failed")) verdict = "reject";
	else if (missingCriterion || reasons.includes("verification evidence is missing") || mechanicalChecks.some((check) => check.outcome === "timed_out") || (policy.requireMechanicalChecks && mechanicalChecks.length === 0)) verdict = policy.missingCriterion === "reject" && missingCriterion ? "reject" : "blocked";
	else if (verdict === "pass" && criteria.some((criterion) => criterion.mandatory === true && criterion.status !== "satisfied")) verdict = "blocked";
	else if (reasons.length === 0 && verdict === "blocked" && criteria.length > 0 && criteria.every((criterion) => criterion.status === "satisfied")) verdict = "pass";
	const requiredFixes = input.reviewerResult.requiredFixes.length > 0
		? input.reviewerResult.requiredFixes
		: reasons.filter((reason) => reason.startsWith("criterion not verified") || reason.startsWith("criterion failed")).map((reason) => `Use the exact acceptance-criterion text and supply admissible evidence for: ${reason.replace(/^criterion (?:not verified|failed): /u, "")}`);
	return {
		verdict,
		reasons,
		criterionResults: criteria,
		mechanicalChecks,
		findings: input.reviewerResult.findings,
		requiredFixes,
		risks: input.reviewerResult.risks,
		reviewerSummary: input.reviewerResult.summary,
	};
}
