import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { developmentLineForVersion, PACKAGE_INFO } from "../src/core/package-info.js";

function readRepoManifest(startDir: string): { readonly name: string; readonly version: string } {
	let dir = startDir;
	for (let depth = 0; depth < 8; depth += 1) {
		const candidate = join(dir, "package.json");
		if (existsSync(candidate)) {
			const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: unknown; version?: unknown };
			if (parsed.name === "pi-multi-orchestrator" && typeof parsed.version === "string") {
				return { name: parsed.name, version: parsed.version };
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("pi-multi-orchestrator package.json was not found");
}

const manifest = readRepoManifest(dirname(fileURLToPath(import.meta.url)));

describe("RC30 runtime package metadata", () => {
	it("derives package version from package.json and reports the RC30 development line", () => {
		assert.equal(manifest.version, "0.1.0-rc.30");
		assert.equal(PACKAGE_INFO.name, manifest.name);
		assert.equal(PACKAGE_INFO.version, manifest.version);
		assert.equal(PACKAGE_INFO.developmentMilestone, "RC30 — Autonomous Boss-Led Mutation Recovery");
		assert.match(PACKAGE_INFO.developmentMilestone, /^RC30\b/u);
		assert.doesNotMatch(PACKAGE_INFO.developmentMilestone, /RC23/u);
		assert.doesNotMatch(PACKAGE_INFO.version, /rc\.23/u);
	});

	it("keeps accepted-milestone and production-ready flags truthful", () => {
		assert.equal(PACKAGE_INFO.latestAcceptedMilestone, "M10 — Safety and hardening");
		assert.equal(PACKAGE_INFO.productionReady, false);
		assert.equal(PACKAGE_INFO.developmentStatus, "implemented-but-not-accepted");
		assert.equal(PACKAGE_INFO.releaseStatus, "candidate");
	});

	it("rejects obviously stale development-line metadata for the current package version", () => {
		const rc = /^0\.1\.0-rc\.(\d+)$/u.exec(PACKAGE_INFO.version);
		assert.ok(rc, "package version must remain an RC identifier");
		assert.equal(PACKAGE_INFO.developmentMilestone.startsWith(`RC${rc[1]} — `), true);
		assert.equal(PACKAGE_INFO.developmentMilestone.startsWith("stale-development-line:"), false);
		assert.notEqual(PACKAGE_INFO.developmentMilestone, "RC23 — Weighted Pool Scheduling and Data-Driven Weight Recommendations");
		assert.equal(developmentLineForVersion("0.1.0-rc.23"), "stale-development-line:0.1.0-rc.23");
		assert.doesNotMatch(developmentLineForVersion("0.1.0-rc.23"), /RC23 — Weighted/u);
		assert.equal(developmentLineForVersion("0.1.0-rc.26"), "RC26 — Goal Terminal Semantics & Runtime Metadata Correctness");
		assert.equal(developmentLineForVersion("0.1.0-rc.30"), PACKAGE_INFO.developmentMilestone);
		assert.equal(developmentLineForVersion("0.1.0-rc.29"), "RC29 — Mission Runtime Convergence");
		assert.equal(developmentLineForVersion("0.1.0-rc.28"), "RC28 — Real Boss Invocation Compatibility, Failure Diagnostics & Fallback Semantics");
		assert.equal(developmentLineForVersion("0.1.0-rc.27"), "RC27 — Autonomous Mission Bootstrap & Zero-Task Boss Loop Repair");
	});
});
