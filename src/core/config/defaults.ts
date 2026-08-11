import type {
  BossProfileV1,
  ConfigV1,
  ExecutionClass,
  OperationalProfileV1,
  RoleConfigV1,
  StableId,
} from "./types.js";

const id = (value: string): StableId => value as StableId;

const role = (
  roleId: string,
  displayName: string,
  executionClass: ExecutionClass,
  resultSchemaId: string,
): RoleConfigV1 => ({
  id: id(roleId),
  displayName,
  executionClass,
  allowedTools: [],
  allowedActions: [],
  resultSchemaId: id(resultSchemaId),
});

const defaultBossProfile = (): BossProfileV1 => ({
  id: id("default-boss"),
  displayName: "Unconfigured Boss",
  enabled: true,
  routeIds: [],
});

const defaultOperationalProfile = (): OperationalProfileV1 => ({
  id: id("default-policy"),
  displayName: "Default",
  enabled: true,
  maxAgents: 1,
  maxConcurrency: 1,
  investigatorCount: 0,
  reviewerCount: 0,
  costPreference: "low",
  diversityPreference: "none",
  escalationLimit: 0,
  contextBudgetClass: "small",
});

/**
 * Returns a fresh, unconfigured and safe semantic configuration.  There are
 * no gateway, route, credential, or runtime-state defaults to accidentally
 * activate.
 */
export function createDefaultConfig(): ConfigV1 {
  const bossProfile = defaultBossProfile();
  const operationalProfile = defaultOperationalProfile();

  return {
    schemaVersion: 1,
    gateways: {},
    routes: {},
    pools: {
      investigation: { entries: [] },
      implementation: { entries: [] },
      verification: { entries: [] },
    },
    roles: {
      researcher: role("researcher", "Researcher", "investigation", "investigator-v1"),
      scout: role("scout", "Scout", "investigation", "investigator-v1"),
      debugger: role("debugger", "Debugger", "implementation", "implementer-v1"),
      implementer: role("implementer", "Implementer", "implementation", "implementer-v1"),
      reviewer: role("reviewer", "Reviewer", "verification", "reviewer-v1"),
      verifier: role("verifier", "Verifier", "verification", "reviewer-v1"),
    },
    bossProfiles: {
      [bossProfile.id]: bossProfile,
    },
    activeBossProfileId: bossProfile.id,
    operationalProfiles: {
      [operationalProfile.id]: operationalProfile,
    },
    activeOperationalProfileId: operationalProfile.id,
    routing: {
      maxAttempts: 1,
      timeoutMs: 60_000,
      rateLimitCooldownMs: 30_000,
      quotaCooldownMs: 300_000,
      fallback: { enabled: false },
      diversityPreference: "none",
    },
    safety: {
      maxAgents: 4,
      maxConcurrency: 2,
      maxAttempts: 4,
      timeoutMs: 120_000,
      maxOutputBytes: 1_048_576,
      maxTaskPacketBytes: 262_144,
      protectedPathPrefixes: [],
    },
    quality: {
      requiredGates: ["diff", "tests"],
    },
    analytics: {
      enabled: false,
      mode: "metadata-only",
    },
  };
}
