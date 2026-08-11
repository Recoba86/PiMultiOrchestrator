import type { ConfigV1 } from "./types.js";
import { validateConfig } from "./schema.js";

/**
 * Return a JSON-compatible value with object keys in a stable order.
 * Arrays deliberately keep their original order because order is semantic for
 * pools, routes, tags, and other priority-bearing configuration fields.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key]);
    }
    return sorted;
  }

  return value;
}

/** Serialize any JSON-compatible value deterministically. */
export function deterministicJson(value: unknown): string {
  const serialized = JSON.stringify(sortJsonValue(value), null, 2);
  if (serialized === undefined) throw new TypeError("Value is not JSON serializable");
  return `${serialized}\n`;
}

/** Serialize a validated semantic configuration without reordering arrays. */
export function serializeConfig(config: ConfigV1): string {
  validateConfig(config);
  return deterministicJson(config);
}
