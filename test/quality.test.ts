import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQualityGate, parseVerificationResult, reviewerPromptForExecutionClass } from "../src/core/quality/index.js";

test("M7 QualityGate is conservative and separates observed mechanical failures", () => {
	const reviewer = parseVerificationResult({
		verdict: "pass",
		criterionResults: [{ criterion: "tests pass", status: "satisfied", evidenceSummary: "reviewer observed the claim" }],
		mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "looks good",
	});
	const missing = evaluateQualityGate({ acceptanceCriteria: ["tests pass", "diff reviewed"], mechanicalChecks: [], reviewerResult: reviewer });
	assert.equal(missing.verdict, "blocked");
	const failed = evaluateQualityGate({ acceptanceCriteria: ["tests pass"], mechanicalChecks: [{ command: "npm test", exitStatus: 1, outcome: "failed", provenance: "orchestrator" }], reviewerResult: reviewer });
	assert.equal(failed.verdict, "reject");
});

test("M7 QualityGate aligns slug or punctuated criterion names to exact acceptance criteria", () => {
	const reviewer = parseVerificationResult({
		verdict: "blocked",
		criterionResults: [
			{ criterion: "current_public_version", status: "satisfied", evidenceSummary: "package.json is 0.1.0-rc.30", mandatory: true },
			{ criterion: "no_repository_modifications", status: "satisfied", evidenceSummary: "read-only ls/read", mandatory: true },
		],
		mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "version found; no files changed",
	});
	const result = evaluateQualityGate({
		acceptanceCriteria: [
			"Read project metadata (e.g., package.json, changelog, or docs) to determine the current public version of Pi Multi-Orchestrator.",
			"Ensure no repository files are modified.",
		],
		mechanicalChecks: [],
		reviewerResult: reviewer,
	});
	assert.equal(result.verdict, "pass");
	assert.equal(result.criterionResults[0]?.criterion.startsWith("Read project metadata"), true);
});

test("M7 investigation contract accepts mutationObserved=false for a no-modification criterion", () => {
	const reviewer = parseVerificationResult({
		verdict: "blocked",
		criterionResults: [
			{ criterion: "Read project metadata (e.g., package.json, changelog, or docs) to determine the current public version of Pi Multi-Orchestrator.", status: "satisfied", evidenceSummary: "0.1.0-rc.30", mandatory: true },
			{ criterion: "Ensure no repository files are modified", status: "not_verified", evidenceSummary: "no git tool", mandatory: true },
		],
		mechanicalChecks: [{ command: "git status --porcelain", outcome: "not_run", provenance: "reviewer", summary: "no shell" }],
		findings: [], requiredFixes: [], risks: [], summary: "version found; git unavailable",
	});
	const result = evaluateQualityGate({
		acceptanceCriteria: [
			"Read project metadata (e.g., package.json, changelog, or docs) to determine the current public version of Pi Multi-Orchestrator.",
			"Ensure no repository files are modified.",
		],
		mechanicalChecks: reviewer.mechanicalChecks,
		reviewerResult: reviewer,
		executionClass: "investigation",
		mutationObserved: false,
	});
	assert.equal(result.verdict, "pass");
});

test("M7 QualityGate synthesizes requiredFixes from unmatched criteria", () => {
	const reviewer = parseVerificationResult({
		verdict: "blocked",
		criterionResults: [{ criterion: "tests pass", status: "satisfied", evidenceSummary: "ok" }],
		mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "incomplete",
	});
	const result = evaluateQualityGate({ acceptanceCriteria: ["tests pass", "diff reviewed"], mechanicalChecks: [], reviewerResult: reviewer });
	assert.equal(result.verdict, "blocked");
	assert.ok(result.requiredFixes?.some((item) => /diff reviewed/u.test(item)));
});


test("M7 QualityGate blocks a pass with no verification evidence", () => {
	const result = evaluateQualityGate({ acceptanceCriteria: [], mechanicalChecks: [], reviewerResult: { verdict: "pass", criterionResults: [], mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "pass" } });
	assert.equal(result.verdict, "blocked");
	assert.ok(result.reasons.includes("verification evidence is missing"));
});

test("M7 reviewer prompt explicitly commands full criterion coverage for every acceptance criterion", () => {
	const prompt = reviewerPromptForExecutionClass(
		"investigation",
		"mission-1",
		"task-1",
		"run-1",
		["Read README.md", "Identify main title"],
	);
	assert.match(prompt, /You MUST include exactly one entry in criterionResults for every single acceptance criterion/);
	assert.match(prompt, /- Read README\.md/);
	assert.match(prompt, /- Identify main title/);
});

test("M7 structured verification results reject malformed and oversized payloads", () => {
	assert.throws(() => parseVerificationResult({ verdict: "pass", criterionResults: [], mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "" }));
	const contradictory = parseVerificationResult({ verdict: "pass", criterionResults: [{ criterion: "x", status: "failed", evidenceSummary: "x", mandatory: true }], mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "valid" });
	assert.equal(evaluateQualityGate({ acceptanceCriteria: ["x"], mechanicalChecks: [], reviewerResult: contradictory }).verdict, "reject");
	assert.throws(() => parseVerificationResult({ verdict: "pass", criterionResults: [], mechanicalChecks: [], findings: ["x".repeat(4_001)], requiredFixes: [], risks: [], summary: "valid" }));
});
