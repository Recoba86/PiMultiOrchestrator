import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const script = join(root, "scripts", "release-candidate.mjs");

test("release candidate metadata is a strict Pi package manifest", () => {
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, any>;
	assert.equal(manifest.version, "0.1.0-rc.1");
	assert.equal(manifest.private, undefined);
	assert.deepEqual(manifest.files, ["dist/**/*.js", "dist/**/*.d.ts", "README.md"]);
	assert.ok(manifest.keywords.includes("pi-package"));
	assert.deepEqual(manifest.pi, { extensions: ["./dist/host/pi-extension.js"] });
	assert.equal(manifest.exports["./pi"].import, "./dist/host/pi-extension.js");
	assert.equal(manifest.dependencies, undefined);
	assert.equal(manifest.engines.node, ">=22.19.0");
	assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], ">=0.84.1 <0.85.0");
});

test("release script emits a verified artifact outside the checkout", () => {
	const output = mkdtempSync(join(tmpdir(), "pi-multi-release-test-"));
	execFileSync(process.execPath, [script, "--output", output], { cwd: root, stdio: "pipe" });
	const files = readdirSync(output).sort();
	const artifact = files.find((file) => file.endsWith(".tgz"));
	assert.ok(artifact);
	assert.deepEqual(files, [
		"artifact-files.txt",
		artifact,
		artifact + ".sha256",
		"release-manifest.json",
		"verification.json",
	].sort());
	const verification = JSON.parse(readFileSync(join(output, "verification.json"), "utf8")) as { verified: boolean; checks: Record<string, boolean> };
	assert.equal(verification.verified, true);
	assert.ok(Object.values(verification.checks).every(Boolean));
	const checksum = readFileSync(join(output, artifact + ".sha256"), "utf8").trim().split(/\s+/u);
	assert.equal(checksum[1], artifact);
	assert.equal(checksum[0], createHash("sha256").update(readFileSync(join(output, artifact))).digest("hex"));
	const releaseManifest = JSON.parse(readFileSync(join(output, "release-manifest.json"), "utf8")) as {
		artifact: { file: string; sha256: string };
		files: Array<{ path: string }>;
		releaseStatus: string;
		gitCommit: string;
		dirty: boolean;
		buildTimestamp: string;
		nodeVersion: string;
		piVersion: string;
		testResult: string;
		configSchema: number;
		missionSchema: number;
		analyticsSchema: number;
		liveCalls: number;
		fileCount: number;
	};
	assert.equal(releaseManifest.artifact.file, artifact);
	assert.equal(releaseManifest.files.some((file) => file.path === "dist/host/pi-extension.js"), true);
	assert.equal(releaseManifest.files.some((file) => file.path.startsWith("src/")), false);
	assert.equal(releaseManifest.releaseStatus, "candidate");
	assert.match(releaseManifest.gitCommit, /^[0-9a-f]{40}$/u);
	assert.equal(typeof releaseManifest.dirty, "boolean");
	assert.match(releaseManifest.buildTimestamp, /^\d{4}-\d{2}-\d{2}T/u);
	assert.equal(releaseManifest.nodeVersion, process.version);
	assert.equal(releaseManifest.piVersion, "0.84.1");
	assert.equal(releaseManifest.testResult, "not-run-by-release-script");
	assert.deepEqual(
		[releaseManifest.configSchema, releaseManifest.missionSchema, releaseManifest.analyticsSchema],
		[2, 2, 1],
	);
	assert.equal(releaseManifest.liveCalls, 0);
	assert.equal(releaseManifest.fileCount, releaseManifest.files.length);
});
