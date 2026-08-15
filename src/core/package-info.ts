import { createRequire } from "node:module";

interface PackageJson {
	name?: unknown;
	version?: unknown;
	engines?: { node?: unknown };
}

const requirePackage = createRequire(import.meta.url);

function readPackageJson(): PackageJson {
	try {
		return requirePackage("../../package.json") as PackageJson;
	} catch {
		return {};
	}
}

const packageJson = readPackageJson();

export const PACKAGE_INFO = Object.freeze({
	name: typeof packageJson.name === "string" ? packageJson.name : "pi-multi-orchestrator",
	version: typeof packageJson.version === "string" ? packageJson.version : "unknown",
	releaseStatus: "candidate" as const,
	latestAcceptedMilestone: "M10 — Safety and hardening",
	developmentMilestone: "RC23 — Weighted Pool Scheduling and Data-Driven Weight Recommendations",
	developmentStatus: "implemented-but-not-accepted" as const,
	productionReady: false,
	piCompatibility: "0.84.1",
	nodeEngine: typeof packageJson.engines?.node === "string" ? packageJson.engines.node : ">=22.19.0",
	configSchema: 2,
	missionSchema: 2,
	analyticsSchema: 1,
});

export type PackageInfo = typeof PACKAGE_INFO;
