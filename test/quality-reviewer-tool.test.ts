import assert from "node:assert/strict";
import test from "node:test";
import { createProtocolCaptureState, createProtocolOnlyCaptureTool, readProtocolCapture } from "../src/core/workers/result-tool.js";
import { createSubmitVerificationResultTool, createVerificationResultProtocol, createVerificationResultToolState } from "../src/core/quality/index.js";
import { parseVerificationResult } from "../src/core/quality/index.js";

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

test("verification protocol advertises parser-compatible nested schemas", () => {
	const parameters = createVerificationResultProtocol().parameters as { readonly properties: Record<string, { readonly items?: { readonly required?: readonly string[] } }> };
	assert.deepEqual(parameters.properties.criterionResults?.items?.required, ["criterion", "status", "evidenceSummary"]);
	assert.deepEqual(parameters.properties.mechanicalChecks?.items?.required, ["command", "outcome", "provenance"]);
	assert.deepEqual(parameters.properties.findings?.items, { type: "string", minLength: 1, maxLength: 4_000 });
});

test("verification protocol captures payloads without executing path or shell-shaped data", async () => {
	const protocol = createVerificationResultProtocol();
	const state = createProtocolCaptureState();
	const tool = createProtocolOnlyCaptureTool(protocol, state);
	const accepted = await tool.execute("call-1", {
		verdict: "pass", criterionResults: [], mechanicalChecks: [], findings: [], requiredFixes: [],
		risks: [{ path: "/tmp/should-not-exist", command: "rm -rf ../outside", protectedPath: ".env" }],
		summary: "capture only",
	} as never, undefined as never, undefined as never, undefined as never);
	assert.equal((accepted.details as { accepted?: boolean }).accepted, true);
	assert.equal(state.submissionCount, 1);
	assert.equal(readProtocolCapture(state, parseVerificationResult), undefined);
	assert.equal(state.protocolViolation, true);
	const duplicate = await tool.execute("call-2", { verdict: "pass" } as never, undefined as never, undefined as never, undefined as never);
	assert.equal((duplicate.details as { accepted?: boolean }).accepted, false);
});
