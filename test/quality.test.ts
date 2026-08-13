import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQualityGate, parseVerificationResult } from "../src/core/quality/index.js";

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

test("M7 QualityGate matches reviewer criteria after bounded normalization", () => {
	const reviewer = parseVerificationResult({
		verdict: "pass",
		criterionResults: [{ criterion: "tests pass", status: "satisfied", evidenceSummary: "observed" }],
		mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "pass",
	});
	assert.equal(evaluateQualityGate({ acceptanceCriteria: ["  tests pass  "], mechanicalChecks: [], reviewerResult: reviewer }).verdict, "pass");
});

test("M7 structured verification results reject malformed and oversized payloads", () => {
	assert.throws(() => parseVerificationResult({ verdict: "pass", criterionResults: [], mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "" }));
	const contradictory = parseVerificationResult({ verdict: "pass", criterionResults: [{ criterion: "x", status: "failed", evidenceSummary: "x", mandatory: true }], mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "valid" });
	assert.equal(evaluateQualityGate({ acceptanceCriteria: ["x"], mechanicalChecks: [], reviewerResult: contradictory }).verdict, "reject");
	assert.throws(() => parseVerificationResult({ verdict: "pass", criterionResults: [], mechanicalChecks: [], findings: ["x".repeat(4_001)], requiredFixes: [], risks: [], summary: "valid" }));
});
