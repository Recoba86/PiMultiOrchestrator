import assert from "node:assert/strict";
import test from "node:test";
import { createSubmitVerificationResultTool, createVerificationResultToolState } from "../src/core/quality/index.js";

test("verification result tool is bounded, one-shot, and terminating", async () => {
	const state = createVerificationResultToolState();
	const tool = createSubmitVerificationResultTool(state);
	const accepted = await tool.execute("call-1", {
		verdict: "pass", criterionResults: [{ criterion: "tests", status: "satisfied", evidenceSummary: "observed" }],
		mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "verified",
	} as never, undefined as never, undefined as never, undefined as never);
	assert.equal(accepted.terminate, true);
	assert.equal(state.submitted?.verdict, "pass");
	const duplicate = await tool.execute("call-2", {
		verdict: "pass", criterionResults: [], mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "again",
	} as never, undefined as never, undefined as never, undefined as never);
	assert.equal(duplicate.terminate, undefined);
	assert.equal(state.protocolViolation, true);
});
