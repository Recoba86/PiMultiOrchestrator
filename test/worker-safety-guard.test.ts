import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorkerSafetyGuard } from "../src/core/workers/safety.js";

test("worker safety guard blocks untrusted and escaping filesystem mutations before execution", async () => {
	const root = await mkdtemp(join(tmpdir(), "pmo-worker-guard-"));
	const outside = await mkdtemp(join(tmpdir(), "pmo-worker-guard-outside-"));
	try {
		await writeFile(join(root, "inside.txt"), "before", "utf8");
		await writeFile(join(outside, "outside.txt"), "outside", "utf8");
		const trusted = new WorkerSafetyGuard({ projectRoot: root, profile: "implementation", trusted: true, requestedTools: ["read", "write", "edit", "bash"] });
		assert.equal(trusted.authorize("write", { path: "inside.txt" }).decision, "ALLOW");
		for (const args of [{ path: "../outside.txt" }, { path: join(outside, "outside.txt") }, { path: ".env" }]) {
			const decision = trusted.authorize("write", args);
			assert.equal(decision.decision, "BLOCK");
			assert.equal(await readFile(join(outside, "outside.txt"), "utf8"), "outside");
		}
		try {
			await symlink(outside, join(root, "outside-link"));
			assert.equal(trusted.authorize("write", { path: "outside-link/new.txt" }).decision, "BLOCK");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EACCES" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
		}
		const untrusted = new WorkerSafetyGuard({ projectRoot: root, profile: "implementation", trusted: false, requestedTools: ["write"] });
		assert.equal(untrusted.authorize("write", { path: "inside.txt" }).code, "PROJECT_TRUST_REQUIRED");
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});

test("worker profiles cannot expand into mutation or unsafe shell execution", async () => {
	const root = await mkdtemp(join(tmpdir(), "pmo-worker-profile-"));
	try {
		const verification = new WorkerSafetyGuard({ projectRoot: root, profile: "verification", trusted: true, requestedTools: ["read", "bash", "edit", "write"] });
		assert.equal(verification.authorize("edit", { path: "file.txt" }).code, "TOOL_NOT_ACTIVE");
		assert.equal(verification.authorize("bash", { command: "rm -rf ." }).code, "PROFILE_MUTATION_DENIED");
		assert.equal(verification.authorize("bash", { command: "npm test" }).code, "PROFILE_MUTATION_DENIED");
		const analyst = new WorkerSafetyGuard({ projectRoot: root, profile: "recommendation-analyst", trusted: true, requestedTools: ["read", "edit", "write", "bash"], resultToolName: "submit_recommendation_analysis" });
		assert.equal(analyst.authorize("edit", { path: "file.txt" }).code, "TOOL_NOT_ACTIVE");
		assert.equal(analyst.authorize("bash", { command: "git status" }).code, "TOOL_NOT_ACTIVE");
		assert.equal(analyst.authorize("submit_recommendation_analysis", {}).decision, "ALLOW");
		const unknownProtocol = new WorkerSafetyGuard({ projectRoot: root, profile: "implementation", trusted: true, requestedTools: ["read"], resultToolName: "submit_evil" });
		assert.equal(unknownProtocol.authorize("submit_evil", {}).decision, "BLOCK");
		assert.equal(unknownProtocol.authorize("submit_evil", {}).code, "TOOL_NOT_ACTIVE");
		const implementation = new WorkerSafetyGuard({ projectRoot: root, profile: "implementation", trusted: true, requestedTools: ["bash"] });
		assert.equal(implementation.authorize("bash", { command: "git reset --hard HEAD" }).code, "DESTRUCTIVE_GIT");
		assert.equal(implementation.authorize("bash", { command: "npm test" }).decision, "ALLOW");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
