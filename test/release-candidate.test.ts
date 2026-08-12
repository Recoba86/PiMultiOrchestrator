import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const script = join(root, "scripts", "release-candidate.mjs");

test("release candidate metadata is a strict Pi package manifest", () => {
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, any>;
	assert.equal(manifest.version, "0.1.0-rc.2");
	assert.equal(manifest.private, undefined);
	assert.deepEqual(manifest.files, ["dist/**/*.js", "dist/**/*.d.ts", "README.md", "docs/OPERATOR_GUIDE.md"]);
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
		"directory-source",
		"privacy-report.json",
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
		directorySource: string;
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
	assert.equal(releaseManifest.directorySource, "directory-source");
});

test("release verification rejects synthetic secrets and ignores caller test claims", () => {
	const fixture = mkdtempSync(join(tmpdir(), "pi-multi-release-privacy-test-"));
	try {
		const syntheticAccessKey = ["AK", "IA1234567890ABCDEF"].join("");
		const syntheticPrivateKeyMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
		writeFileSync(join(fixture, "fixture.txt"), `${syntheticAccessKey}\n${syntheticPrivateKeyMarker}\n`, "utf8");
		const scan = execFileSync(process.execPath, ["--input-type=module", "-e", `import { scanPrivacy } from ${JSON.stringify(join(root, "scripts", "release-candidate.mjs"))}; console.log(JSON.stringify(await scanPrivacy(process.argv[1])));`, fixture], { cwd: root, encoding: "utf8" }).trim();
		assert.match(scan, /aws-access-key/u);
		assert.match(scan, /private-key/u);
		const output = mkdtempSync(join(tmpdir(), "pi-multi-release-provenance-test-"));
		try {
			const env = { ...process.env, PI_RELEASE_TEST_RESULT: "999/999 PASS" };
			execFileSync(process.execPath, [script, "--output", output], { cwd: root, env, stdio: "pipe" });
			const artifact = readdirSync(output).find((file) => file.endsWith(".tgz"));
			assert.ok(artifact);
			const manifest = JSON.parse(readFileSync(join(output, "release-manifest.json"), "utf8")) as { testResult: string };
			assert.equal(manifest.testResult, "not-run-by-release-script");
		} finally {
			rmSync(output, { recursive: true, force: true });
		}
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("release build replaces stale ignored dist output", () => {
	const marker = "R2_STALE_DIST_MARKER_SHOULD_NOT_SHIP";
	const stalePath = join(root, "dist", "host", "stale-r2.js");
	mkdirSync(join(root, "dist", "host"), { recursive: true });
	writeFileSync(stalePath, `export const stale = ${JSON.stringify(marker)};\n`, "utf8");
	const output = mkdtempSync(join(tmpdir(), "pi-multi-release-stale-dist-test-"));
	try {
		execFileSync(process.execPath, [script, "--output", output], { cwd: root, stdio: "pipe" });
		const manifest = JSON.parse(readFileSync(join(output, "release-manifest.json"), "utf8")) as { files: Array<{ path: string }> };
		assert.equal(manifest.files.some((file) => file.path.includes("stale-r2.js")), false);
	} finally {
		rmSync(output, { recursive: true, force: true });
		if (existsSync(stalePath)) rmSync(stalePath, { force: true });
	}
});
