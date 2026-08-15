import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureStorageDirectories, writeAtomicFile } from "../config/history.js";
import { deterministicJson } from "../config/serialize.js";
import type { ResourceClass, StableId } from "../config/types.js";
import { NineRouterError, safeCatalogErrorMessage, safeCatalogErrorStage } from "./errors.js";
import { normalizeNineRouterBaseUrl } from "./connection.js";
import type {
  CatalogCacheLoadResult,
  CatalogCacheV1,
  CatalogCapabilityMetadata,
  CatalogErrorKind,
  CatalogErrorSummary,
  CatalogFieldProvenance,
  RemoteCatalogEntry,
} from "./types.js";
import { NINEROUTER_GATEWAY_ID } from "./types.js";

const CACHE_FILE = "catalog.json";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_STRING = 256;
const STABLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TAG = /^[a-z0-9][a-z0-9._:-]*$/u;
const ERROR_KINDS = new Set<CatalogErrorKind>([
  "auth",
  "http",
  "timeout",
  "transport",
  "cancelled",
  "malformed",
  "oversized",
  "duplicate",
  "invalid-url",
  "secret",
]);
const PROVENANCE_KEYS = [
  "remoteId",
  "displayName",
  "owner",
  "resourceClass",
  "resourceId",
  "underlyingFamily",
  "underlyingVersion",
  "capabilities",
  "input",
  "reasoning",
  "thinkingLevelMap",
  "vision",
  "capabilityMetadata",
  "contextWindow",
  "maxTokens",
  "capability",
] as const;
const PROVENANCE_VALUES = new Set<CatalogFieldProvenance>(["remote", "configured", "conservative-default"]);

export class CatalogCacheStore {
  readonly root: string;

  constructor(root: string) {
    if (!root) throw new TypeError("Catalog cache root is required");
    this.root = root;
  }

  async load(): Promise<CatalogCacheLoadResult> {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.root, CACHE_FILE));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
      return { status: "corrupt", diagnostic: "Catalog cache could not be read" };
    }
    if (bytes.byteLength > MAX_BYTES) return { status: "corrupt", diagnostic: "Catalog cache is too large" };
    try {
      const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      return { status: "valid", cache: validateCache(parsed) };
    } catch (error) {
      return { status: "corrupt", diagnostic: error instanceof Error ? error.message : "Catalog cache is invalid" };
    }
  }

  async save(cache: CatalogCacheV1): Promise<void> {
    const validated = validateCache(cache);
    const serialized = deterministicJson(validated);
    if (Buffer.byteLength(serialized, "utf8") > MAX_BYTES) throw new NineRouterError("oversized", "cache", "Catalog cache is too large");
    await ensureStorageDirectories(this.root);
    await writeAtomicFile(join(this.root, CACHE_FILE), serialized, undefined, "active");
  }

  async recordFailure(
    current: CatalogCacheV1 | undefined,
    gatewayId: StableId,
    error: NineRouterError,
    at: string,
  ): Promise<CatalogCacheV1> {
    if (!current) throw new TypeError("A last-good catalog is required to record a refresh failure");
    const next: CatalogCacheV1 = {
      cacheVersion: 1,
      gatewayId,
      baseUrl: current.baseUrl,
      generation: current.generation,
      fetchedAt: current.fetchedAt,
      lastSuccessAt: current.lastSuccessAt,
      entries: current.entries,
      lastAttemptAt: at,
      lastError: toSummary(error, at),
    };
    await this.save(next);
    return next;
  }
}

export function toSummary(error: NineRouterError, at: string): CatalogErrorSummary {
  return {
    kind: error.kind,
    stage: safeCatalogErrorStage(error.stage),
    message: safeCatalogErrorMessage(error),
    ...(error.status === undefined ? {} : { status: error.status }),
    at,
  };
}

export function validateCache(value: unknown): CatalogCacheV1 {
  if (!isRecord(value) || value.cacheVersion !== 1 || value.gatewayId !== NINEROUTER_GATEWAY_ID || typeof value.baseUrl !== "string" || typeof value.generation !== "number" || !Number.isSafeInteger(value.generation) || value.generation < 0 || !isIsoDate(value.fetchedAt) || !isIsoDate(value.lastSuccessAt) || !Array.isArray(value.entries)) {
    throw new Error("Catalog cache schema is invalid");
  }
  const baseUrl = normalizeNineRouterBaseUrl(value.baseUrl);
  if (baseUrl !== value.baseUrl) throw new Error("Catalog cache base URL is not normalized");
  if (value.entries.length > MAX_ENTRIES) throw new Error("Catalog cache has too many entries");
  const ids = new Set<string>();
  const entries = value.entries.map((entry) => validateEntry(entry));
  for (const entry of entries) {
    if (ids.has(entry.remoteId)) throw new Error("Catalog cache contains duplicate model IDs");
    ids.add(entry.remoteId);
  }
  const result: CatalogCacheV1 = {
    cacheVersion: 1,
    gatewayId: value.gatewayId as StableId,
    baseUrl,
    generation: value.generation,
    fetchedAt: value.fetchedAt,
    lastSuccessAt: value.lastSuccessAt,
    entries,
  };
  if (value.lastAttemptAt !== undefined) {
    if (!isIsoDate(value.lastAttemptAt)) throw new Error("Catalog cache attempt timestamp is invalid");
    (result as { lastAttemptAt?: string }).lastAttemptAt = value.lastAttemptAt;
  }
  if (value.lastError !== undefined) {
    if (!isRecord(value.lastError)) throw new Error("Catalog cache error is invalid");
    const kind = value.lastError.kind;
    const stage = boundedString(value.lastError.stage, 64);
    const message = boundedString(value.lastError.message, 512);
    const at = value.lastError.at;
    if (typeof kind !== "string" || !ERROR_KINDS.has(kind as CatalogErrorKind) || stage === undefined || message === undefined || !isIsoDate(at)) {
      throw new Error("Catalog cache error is invalid");
    }
    const status = value.lastError.status;
    if (status !== undefined && (typeof status !== "number" || !Number.isSafeInteger(status) || status < 100 || status > 599)) {
      throw new Error("Catalog cache error status is invalid");
    }
    (result as { lastError?: CatalogErrorSummary }).lastError = {
      kind: kind as CatalogErrorSummary["kind"],
      stage,
      message,
      at,
      ...(status === undefined ? {} : { status }),
    };
  }
  return result;
}

function validateEntry(value: unknown): RemoteCatalogEntry {
  if (!isRecord(value)) throw new Error("Catalog cache entry is invalid");
  const remoteId = boundedString(value.remoteId, MAX_STRING);
  const displayName = boundedString(value.displayName, MAX_STRING);
  if (remoteId === undefined || displayName === undefined) throw new Error("Catalog cache entry is invalid");
  const resourceClass = value.resourceClass;
  if (!isResourceClass(resourceClass)) throw new Error("Catalog cache entry resource is invalid");
  const resourceId = optionalStableId(value.resourceId);
  if (value.resourceId !== undefined && resourceId === undefined) throw new Error("Catalog cache entry resource ID is invalid");
  const owner = optionalString(value.owner, MAX_STRING);
  const underlyingFamily = optionalString(value.underlyingFamily, MAX_STRING);
  const underlyingVersion = optionalString(value.underlyingVersion, MAX_STRING);
  const capabilities = validateTags(value.capabilities);
  const input = validateInput(value.input);
  const reasoning = optionalBoolean(value.reasoning);
  const thinkingLevelMap = validateThinkingLevelMap(value.thinkingLevelMap);
  const vision = optionalBoolean(value.vision);
  if (value.reasoning !== undefined && reasoning === undefined) throw new Error("Catalog cache reasoning capability is invalid");
  if (value.thinkingLevelMap !== undefined && thinkingLevelMap === undefined) throw new Error("Catalog cache thinking level map is invalid");
  if (value.vision !== undefined && vision === undefined) throw new Error("Catalog cache vision capability is invalid");
  const capabilityMetadata = validateCapabilityMetadata(value.capabilityMetadata);
  const contextWindow = optionalBoundedInteger(value.contextWindow, 1, 10_000_000);
  const maxTokens = optionalBoundedInteger(value.maxTokens, 1, 10_000_000);
  if (value.contextWindow !== undefined && contextWindow === undefined) throw new Error("Catalog cache context window is invalid");
  if (value.maxTokens !== undefined && maxTokens === undefined) throw new Error("Catalog cache max tokens is invalid");
  if (value.capability !== "chat" && value.capability !== "non-chat" && value.capability !== "unknown") throw new Error("Catalog cache entry capability is invalid");
  const provenance = validateProvenance(value.provenance);
  return {
    remoteId,
    displayName,
    ...(owner === undefined ? {} : { owner }),
    resourceClass,
    ...(resourceId === undefined ? {} : { resourceId }),
    ...(underlyingFamily === undefined ? {} : { underlyingFamily }),
    ...(underlyingVersion === undefined ? {} : { underlyingVersion }),
    capabilities,
    input,
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    ...(vision === undefined ? {} : { vision }),
    ...(capabilityMetadata === undefined ? {} : { capabilityMetadata }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    capability: value.capability,
    provenance,
  };
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/\p{Cc}/u.test(value) ? value : undefined;
}

function optionalString(value: unknown, max: number): string | undefined {
  return value === undefined ? undefined : boundedString(value, max);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : typeof value === "boolean" ? value : undefined;
}

function validateCapabilityMetadata(value: unknown): CatalogCapabilityMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Catalog cache capability metadata is invalid");
  const result: CatalogCapabilityMetadata = {};
  for (const key of ["tools", "search", "audioInput", "videoInput", "thinkingCanDisable"] as const) {
    const item = value[key];
    if (item !== undefined && typeof item !== "boolean") throw new Error("Catalog cache capability metadata is invalid");
    if (item !== undefined) (result as Record<string, unknown>)[key] = item;
  }
  const thinkingFormat = optionalString(value.thinkingFormat, 64);
  if (value.thinkingFormat !== undefined && thinkingFormat === undefined) throw new Error("Catalog cache capability metadata is invalid");
  if (thinkingFormat !== undefined) (result as Record<string, unknown>).thinkingFormat = thinkingFormat;
  return Object.keys(result).length > 0 ? result : undefined;
}

function validateThinkingLevelMap(value: unknown): import("../thinking.js").ThinkingLevelMap | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const result: Record<string, string | null> = {};
  for (const key of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
    if (!(key in value)) continue;
    const item = value[key];
    if (item !== null && (typeof item !== "string" || item.length === 0 || item.length > 128 || /\p{Cc}/u.test(item))) return undefined;
    result[key] = item as string | null;
  }
  return Object.keys(result).length > 0 ? result as import("../thinking.js").ThinkingLevelMap : undefined;
}

function isResourceClass(value: unknown): value is ResourceClass {
  return value === "subscription" || value === "metered-api" || value === "unknown" || value === "other";
}

function optionalStableId(value: unknown): StableId | undefined {
  return typeof value === "string" && value.length <= 64 && STABLE_ID.test(value) ? value as StableId : undefined;
}

function validateTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 256) throw new Error("Catalog cache capabilities are invalid");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > 64 || !TAG.test(item) || seen.has(item)) throw new Error("Catalog cache capabilities are invalid");
    seen.add(item);
    result.push(item);
  }
  return result;
}

function validateInput(value: unknown): ("text" | "image")[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) throw new Error("Catalog cache input modalities are invalid");
  const result: ("text" | "image")[] = [];
  for (const item of value) {
    if (item !== "text" && item !== "image") throw new Error("Catalog cache input modalities are invalid");
    if (result.includes(item)) throw new Error("Catalog cache input modalities are invalid");
    result.push(item);
  }
  return result;
}

function validateProvenance(value: unknown): Record<string, CatalogFieldProvenance> {
  if (!isRecord(value)) throw new Error("Catalog cache provenance is invalid");
  const result: Record<string, CatalogFieldProvenance> = {};
  for (const key of PROVENANCE_KEYS) {
    const item = value[key];
    if (item === undefined) continue;
    if (typeof item !== "string" || !PROVENANCE_VALUES.has(item as CatalogFieldProvenance)) throw new Error("Catalog cache provenance is invalid");
    result[key] = item as CatalogFieldProvenance;
  }
  return result;
}

function optionalBoundedInteger(value: unknown, min: number, max: number): number | undefined {
  return value === undefined ? undefined : typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
