import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJson {
	name?: unknown;
	version?: unknown;
	engines?: { node?: unknown };
}

function readNearestPackageJson(startDir: string): PackageJson {
	let dir = startDir;
	for (let depth = 0; depth < 8; depth += 1) {
		const candidate = join(dir, "package.json");
		if (existsSync(candidate)) {
			try {
				const parsed = JSON.parse(readFileSync(candidate, "utf8")) as PackageJson;
				if (parsed.name === "pi-multi-orchestrator") return parsed;
			} catch {
				/* keep walking toward the package root */
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return {};
}

const packageJson = readNearestPackageJson(dirname(fileURLToPath(import.meta.url)));
const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "unknown";

/** Development-line titles keyed by the authoritative package version. */
const DEVELOPMENT_LINE_BY_VERSION: Readonly<Record<string, string>> = Object.freeze({
	"0.1.0-rc.26": "RC26 — Goal Terminal Semantics & Runtime Metadata Correctness",
	"0.1.0-rc.27": "RC27 — Autonomous Mission Bootstrap & Zero-Task Boss Loop Repair",
});

export function developmentLineForVersion(version: string): string {
	return DEVELOPMENT_LINE_BY_VERSION[version] ?? `stale-development-line:${version}`;
}

export const PACKAGE_INFO = Object.freeze({
	name: typeof packageJson.name === "string" ? packageJson.name : "pi-multi-orchestrator",
	version: packageVersion,
	releaseStatus: "candidate" as const,
	latestAcceptedMilestone: "M10 — Safety and hardening",
	developmentMilestone: developmentLineForVersion(packageVersion),
	developmentStatus: "implemented-but-not-accepted" as const,
	productionReady: false,
	piCompatibility: "0.84.1",
	nodeEngine: typeof packageJson.engines?.node === "string" ? packageJson.engines.node : ">=22.19.0",
	configSchema: 2,
	missionSchema: 2,
	analyticsSchema: 1,
});

export type PackageInfo = typeof PACKAGE_INFO;
