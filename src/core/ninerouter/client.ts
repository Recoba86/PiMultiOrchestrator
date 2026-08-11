import { EnvSecretResolver } from "./secrets.js";
import { NineRouterError, safeCatalogErrorMessage, safeCatalogErrorStage } from "./errors.js";
import { nineRouterModelsUrl, normalizeNineRouterBaseUrl } from "./connection.js";
import type { CatalogCapability, CatalogFieldProvenance, RemoteCatalogEntry } from "./types.js";
import type { ResourceClass, SecretRefV1, StableId } from "../config/types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const MAX_ENTRIES = 512;
const MAX_STRING = 256;
const TAG = /^[a-z0-9][a-z0-9._:-]*$/u;
const STABLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export interface NineRouterClientOptions {
  readonly baseUrl?: string;
  readonly credentialRef?: SecretRefV1;
  readonly resolver?: EnvSecretResolver;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface ListModelsOptions {
  readonly signal?: AbortSignal;
  readonly baseUrl?: string;
  readonly credentialRef?: SecretRefV1;
  readonly timeoutMs?: number;
}

export class NineRouterClient {
  private readonly configuredBaseUrl: string | undefined;
  private readonly configuredCredentialRef: SecretRefV1 | undefined;
  private readonly resolver: EnvSecretResolver;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NineRouterClientOptions = {}) {
    this.configuredBaseUrl = options.baseUrl ? normalizeNineRouterBaseUrl(options.baseUrl) : undefined;
    this.configuredCredentialRef = options.credentialRef;
    this.resolver = options.resolver ?? new EnvSecretResolver();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listModels(options: ListModelsOptions = {}): Promise<RemoteCatalogEntry[]> {
    const baseUrl = options.baseUrl ? normalizeNineRouterBaseUrl(options.baseUrl) : this.configuredBaseUrl;
    if (!baseUrl) throw new NineRouterError("invalid-url", "connection", "The 9Router base URL is not configured");
    const credentialRef = options.credentialRef ?? this.configuredCredentialRef;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (credentialRef) {
      let secret: string;
      try {
        secret = await this.resolver.resolve(credentialRef, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw new NineRouterError("cancelled", "auth", "The catalog request was cancelled");
        if (error instanceof NineRouterError) throw error;
        throw new NineRouterError("secret", "auth", "The 9Router credential is unavailable");
      }
      headers.Authorization = `Bearer ${secret}`;
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let callerAborted = false;
    const abortCaller = (): void => {
      callerAborted = true;
      controller.abort(options.signal?.reason);
    };
    if (options.signal) {
      if (options.signal.aborted) abortCaller();
      else options.signal.addEventListener("abort", abortCaller, { once: true });
    }

    let response: Response;
    try {
      response = await this.fetchImpl(nineRouterModelsUrl(baseUrl), {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        const kind = response.status === 401 || response.status === 403 ? "auth" : "http";
        throw new NineRouterError(kind, "response", kind === "auth" ? "9Router authentication failed" : `9Router returned HTTP ${response.status}`, response.status);
      }

      // Keep the same deadline active while consuming and decoding the body.
      const body = await readBoundedBody(response, this.maxBytes, controller.signal);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body) as unknown;
      } catch {
        throw new NineRouterError("malformed", "decode", "The 9Router catalog was not valid JSON");
      }
      return parseCatalog(parsed);
    } catch (error) {
      if (callerAborted) throw new NineRouterError("cancelled", "request", "The catalog request was cancelled");
      if (controller.signal.aborted) throw new NineRouterError("timeout", "request", "The catalog request timed out");
      if (error instanceof NineRouterError) {
        throw new NineRouterError(error.kind, safeCatalogErrorStage(error.stage), safeCatalogErrorMessage(error), error.status);
      }
      throw new NineRouterError("transport", "request", "The catalog request failed");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortCaller);
    }
  }
}

async function readBoundedBody(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      throw new NineRouterError("oversized", "body", "The 9Router catalog is too large");
    }
  }
  if (!response.body) {
    const text = await readTextWithAbort(response, signal);
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new NineRouterError("oversized", "body", "The 9Router catalog is too large");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let aborted = signal?.aborted === true;
  const abortReader = (): void => {
    aborted = true;
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abortReader, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      if (aborted) throw new Error("aborted");
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new NineRouterError("oversized", "body", "The 9Router catalog is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    signal?.removeEventListener("abort", abortReader);
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function readTextWithAbort(response: Response, signal?: AbortSignal): Promise<string> {
  if (!signal) return response.text();
  if (signal.aborted) throw new Error("aborted");
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => rejectAbort?.(new Error("aborted"));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([response.text(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function parseCatalog(value: unknown): RemoteCatalogEntry[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new NineRouterError("malformed", "schema", "The 9Router catalog is missing data");
  }
  if (value.data.length > MAX_ENTRIES) throw new NineRouterError("oversized", "schema", "The 9Router catalog has too many entries");
  const ids = new Set<string>();
  return value.data.map((row, index) => {
    const entry = parseEntry(row, index);
    if (ids.has(entry.remoteId)) throw new NineRouterError("duplicate", "schema", "The 9Router catalog contains duplicate model IDs");
    ids.add(entry.remoteId);
    return entry;
  });
}

function parseEntry(value: unknown, index: number): RemoteCatalogEntry {
  if (!isRecord(value)) throw new NineRouterError("malformed", `schema.data[${index}]`, "The 9Router catalog entry is invalid");
  const remoteId = boundedString(value.id, `schema.data[${index}].id`, MAX_STRING);
  const remoteName = optionalString(value.name, MAX_STRING);
  const displayName = remoteName ?? remoteId;
  const owner = optionalString(value.owned_by ?? value.owner ?? value.provider, MAX_STRING);
  const rawResource = value.resource ?? value.account ?? value.subscription;
  const resource = parseResource(rawResource);
  const capabilities = parseTags(value.capabilities);
  const rawInput = value.input ?? value.modalities;
  const input = parseInput(rawInput);
  const contextWindow = boundedNumber(value.context_window ?? value.contextWindow, 1, 10_000_000);
  const maxTokens = boundedNumber(value.max_tokens ?? value.maxTokens, 1, 10_000_000);
  const rawCapability = value.type ?? value.model_type ?? value.modelType;
  const capability = parseCapability(rawCapability, capabilities);
  const underlyingFamily = optionalString(value.underlying_family ?? value.underlyingFamily, MAX_STRING);
  const underlyingVersion = optionalString(value.underlying_version ?? value.underlyingVersion, MAX_STRING);
  const provenance: Record<string, CatalogFieldProvenance> = {
    remoteId: "remote",
    displayName: remoteName ? "remote" : "conservative-default",
    resourceClass: resourceClassIsRemote(rawResource) ? "remote" : "conservative-default",
    capabilities: Array.isArray(value.capabilities) ? "remote" : "conservative-default",
    input: hasRemoteInput(rawInput) ? "remote" : "conservative-default",
    capability: hasExplicitCapability(rawCapability, capabilities) ? "remote" : "conservative-default",
  };
  if (owner) provenance.owner = "remote";
  if (resource?.id) provenance.resourceId = "remote";
  if (underlyingFamily) provenance.underlyingFamily = "remote";
  if (underlyingVersion) provenance.underlyingVersion = "remote";
  if (contextWindow) provenance.contextWindow = "remote";
  if (maxTokens) provenance.maxTokens = "remote";
  return {
    remoteId,
    displayName,
    ...(owner ? { owner } : {}),
    resourceClass: resource?.class ?? "unknown",
    ...(resource?.id ? { resourceId: resource.id } : {}),
    ...(underlyingFamily ? { underlyingFamily } : {}),
    ...(underlyingVersion ? { underlyingVersion } : {}),
    capabilities,
    input,
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    capability,
    provenance,
  };
}

function parseResource(value: unknown): { class: ResourceClass; id?: StableId } | undefined {
  if (typeof value === "string") return { class: "unknown", ...(STABLE_ID.test(value) ? { id: value as StableId } : {}) };
  if (!isRecord(value)) return undefined;
  const classValue = value.class ?? value.type;
  const resourceClass: ResourceClass = classValue === "subscription" || classValue === "metered-api" || classValue === "other" ? classValue : "unknown";
  const id = optionalString(value.id, 64);
  return { class: resourceClass, ...(id && STABLE_ID.test(id) ? { id: id as StableId } : {}) };
}

function parseCapability(value: unknown, capabilities: readonly string[]): CatalogCapability {
  if (value === "chat" || value === "non-chat" || value === "unknown") return value;
  if (typeof value === "string" && ["embedding", "embeddings", "image", "audio", "speech", "tts", "moderation", "rerank"].includes(value.toLowerCase())) return "non-chat";
  if (capabilities.includes("non-chat")) return "non-chat";
  if (capabilities.includes("chat")) return "chat";
  if (capabilities.some((item) => ["embedding", "embeddings", "image", "audio", "speech", "tts", "moderation", "rerank"].includes(item))) return "non-chat";
  return "unknown";
}

function hasExplicitCapability(value: unknown, capabilities: readonly string[]): boolean {
  return value !== undefined || capabilities.some((item) => item === "chat" || item === "non-chat" || ["embedding", "embeddings", "image", "audio", "speech", "tts", "moderation", "rerank"].includes(item));
}

function hasRemoteInput(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => item === "text" || item === "image");
}

function resourceClassIsRemote(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const candidate = value.class ?? value.type;
  return candidate === "subscription" || candidate === "metered-api" || candidate === "other" || candidate === "unknown";
}

function parseInput(value: unknown): ("text" | "image")[] {
  if (!Array.isArray(value)) return ["text"];
  const result: ("text" | "image")[] = [];
  for (const item of value) {
    if (item === "text" || item === "image") {
      if (!result.includes(item)) result.push(item);
    }
  }
  return result.length > 0 ? result : ["text"];
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 64 && TAG.test(item)).filter((item, index, all) => all.indexOf(item) === index);
}

function boundedString(value: unknown, stage: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /\p{Cc}/u.test(value)) {
    throw new NineRouterError("malformed", stage, "The 9Router catalog entry is invalid");
  }
  return value;
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/\p{Cc}/u.test(value) ? value : undefined;
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
