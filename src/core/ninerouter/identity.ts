import { createHash } from "node:crypto";

import type { StableId } from "../config/types.js";

function slug(value: string, max: number): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, max)
    .replace(/-+$/u, "");
  return normalized || "model";
}

/** Stable local identity based only on gateway and exact remote model ID. */
export function stableRouteId(gatewayId: string, remoteModelId: string): StableId {
  const digest = createHash("sha256")
    .update(gatewayId, "utf8")
    .update("\0", "utf8")
    .update(remoteModelId, "utf8")
    .digest("hex")
    .slice(0, 20);
  // Config stable IDs must start with a letter; keep the full digest within
  // the 64-character bound so truncation cannot erase collision resistance.
  const result = `r9-${slug(gatewayId, 10)}-${slug(remoteModelId, 24)}-${digest}`;
  return result.replace(/-+$/u, "") as StableId;
}
