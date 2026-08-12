import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	CommandSafetyPolicy,
	PathSafetyPolicy,
	SecretSanitizer,
	TrustStore,
	getCapabilityMatrix,
} from "../src/core/security/index.js";

const fixture = (): { readonly root: string; readonly state: string; readonly outside: string } => {
	const root = mkdtempSync(join(tmpdir(), "pi-m10-security-"));
	const state = join(root, "state");
	const outside = mkdtempSync(join(tmpdir(), "pi-m10-outside-"));
	mkdirSync(state, { recursive: true });
	writeFileSync(join(root, "inside.txt"), "safe", "utf8");
	return { root, state, outside };
};

test("M10 TrustStore defaults to untrusted, persists explicit trust, and revokes locally", () => {
	const { root, state } = fixture();
	const store = new TrustStore({ root: state });
	assert.equal(store.get(root).state, "untrusted");
	assert.equal(store.isTrusted(root), false);
	store.trust(root, "fixture");
	assert.equal(new TrustStore({ root: state }).get(root).state, "trusted");
	assert.equal(new TrustStore({ root: state }).get(root).label, "fixture");
	new TrustStore({ root: state }).revoke(root);
	assert.equal(new TrustStore({ root: state }).get(root).state, "untrusted");
});

test("M10 PathSafetyPolicy blocks untrusted, escapes, symlinks, protected paths, and credential reads", () => {
	const { root, state, outside } = fixture();
	const policy = new PathSafetyPolicy({ projectRoot: root, internalRoots: [state] });
	assert.equal(policy.authorizeRead("inside.txt").decision, "ALLOW");
	assert.equal(policy.authorizeWrite("inside.txt").code, "PROJECT_TRUST_REQUIRED");
	const trusted = new PathSafetyPolicy({ projectRoot: root, trusted: true, internalRoots: [state] });
	assert.equal(trusted.authorizeWrite("inside.txt").decision, "ALLOW");
	assert.equal(trusted.authorizeWrite("../outside.txt").code, "OUTSIDE_WORKSPACE");
	assert.equal(trusted.authorizeWrite(join(outside, "outside.txt")).code, "OUTSIDE_WORKSPACE");
	assert.equal(trusted.authorizeRead(join(root, ".env")).code, "CREDENTIAL_PATH");
	assert.equal(trusted.authorizeWrite(state).code, "PROTECTED_PATH");
	try {
		symlinkSync(outside, join(root, "link"), "dir");
		assert.equal(trusted.authorizeWrite(join(root, "link", "file.txt")).code, "OUTSIDE_WORKSPACE");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EACCES") throw error;
	}
});

test("M10 CommandSafetyPolicy distinguishes safe, destructive, and ambiguous shell commands", () => {
	const { root } = fixture();
	const policy = new CommandSafetyPolicy();
	assert.equal(policy.evaluate("git status", { projectRoot: root, trusted: true }).decision, "ALLOW");
	assert.equal(policy.evaluate("git diff -- src/index.ts", { projectRoot: root, trusted: true }).decision, "ALLOW");
	assert.equal(policy.evaluate("rm -rf .", { projectRoot: root, trusted: true }).code, "DESTRUCTIVE_DELETE");
	assert.equal(policy.evaluate("git reset --hard HEAD", { projectRoot: root, trusted: true }).code, "DESTRUCTIVE_GIT");
	assert.equal(policy.evaluate("rm -rf $(pwd)", { projectRoot: root, trusted: true }).code, "DESTRUCTIVE_DELETE");
	assert.equal(policy.evaluate("echo $TARGET", { projectRoot: root, trusted: true }).decision, "REVIEW_REQUIRED");
	assert.equal(policy.evaluate("touch file.txt", { projectRoot: root, trusted: false }).code, "PROJECT_TRUST_REQUIRED");
});

test("M10 sanitizer redacts values and sensitive structures without exposing its dictionary", () => {
	const sanitizer = new SecretSanitizer();
	const secret = "fixture-secret-token-123";
	sanitizer.register(secret);
	assert.equal(sanitizer.sanitizeText(`provider failed with ${secret}`), "provider failed with [REDACTED]");
	const safe = sanitizer.sanitize({ authorization: `Bearer ${secret}`, nested: { note: secret }, visible: "ordinary diagnostic" });
	assert.deepEqual(safe, { authorization: "[REDACTED]", nested: { note: "[REDACTED]" }, visible: "ordinary diagnostic" });
	assert.equal(JSON.stringify(sanitizer).includes(secret), false);
});

test("M10 capability matrix preserves read-only Verification and Analyst profiles", () => {
	const rows = getCapabilityMatrix();
	const verification = rows.find((row) => row.profile === "verification")!;
	const analyst = rows.find((row) => row.profile === "recommendation-analyst")!;
	const implementation = rows.find((row) => row.profile === "implementation")!;
	assert.equal(verification.mutation, false);
	assert.equal(verification.bash, false);
	assert.equal(analyst.mutation, false);
	assert.equal(analyst.bash, false);
	assert.equal(implementation.mutation, true);
	assert.equal(implementation.trustRequired, true);
});
