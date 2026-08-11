import { createDefaultConfig } from "../config/defaults.js";
import { ConfigStore } from "../config/store.js";
import type { ConfigMutationResult } from "../config/store.js";
import type { RouteConfigV1, SecretRefV1, StableId } from "../config/types.js";
import { CatalogCacheStore } from "./cache.js";
import { NineRouterError, NineRouterManagerError, safeCatalogErrorMessage, safeCatalogErrorStage } from "./errors.js";
import { normalizeNineRouterBaseUrl, validateNineRouterGateway } from "./connection.js";
import { NineRouterClient } from "./client.js";
import { stableRouteId } from "./identity.js";
import { isEnvironmentReference } from "./secrets.js";
import {
  NINEROUTER_GATEWAY_ID,
  NINEROUTER_PROVIDER_ID,
  type CatalogCacheV1,
  type CatalogRow,
  type ConfigureResult,
  type ListOptions,
  type NineRouterManagerOptions,
  type NineRouterStatus,
  type ProviderModelProjection,
  type ProviderProjection,
  type RefreshResult,
  type RemoteCatalogEntry,
  type SetEnabledOptions,
  type SetEnabledResult,
} from "./types.js";

const DEFAULT_GATEWAY_TIMEOUT = 60_000;
const DEFAULT_CONTEXT_WINDOW = 16_384;
const DEFAULT_MAX_TOKENS = 4_096;
const DEFAULT_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
const MAX_CONFIG_LABEL = 160;

export class NineRouterManager {
  private readonly configStore: ConfigStore;
  private readonly cacheStore: CatalogCacheStore;
  private readonly client: NineRouterClient;
  private readonly now: () => Date;
  private lastGatewayState: "reachable" | "unreachable" | "not-checked" = "not-checked";
  private refreshQueue: Promise<unknown> = Promise.resolve();

  constructor(options: NineRouterManagerOptions);
  constructor(configStore: ConfigStore, cacheStore: CatalogCacheStore, client: NineRouterClient, now?: () => Date);
  constructor(
    optionsOrConfig: NineRouterManagerOptions | ConfigStore,
    cacheStore?: CatalogCacheStore,
    client?: NineRouterClient,
    now?: () => Date,
  ) {
    if (optionsOrConfig instanceof ConfigStore) {
      this.configStore = optionsOrConfig;
      if (!cacheStore || !client) throw new TypeError("NineRouterManager requires cache and client");
      this.cacheStore = cacheStore;
      this.client = client;
      this.now = now ?? (() => new Date());
    } else {
      this.configStore = optionsOrConfig.configStore;
      this.cacheStore = optionsOrConfig.cacheStore;
      this.client = optionsOrConfig.client;
      this.now = optionsOrConfig.now ?? (() => new Date());
    }
  }

  async loadStatus(): Promise<NineRouterStatus> {
    const config = await this.loadConfig();
    const gateway = config.gateways[NINEROUTER_GATEWAY_ID];
    const cacheResult = await this.cacheStore.load();
    const cache = cacheForGateway(cacheResult.cache, gateway?.baseUrl);
    const routes = Object.values(config.routes).filter((route) => route.gatewayId === NINEROUTER_GATEWAY_ID && route.enabled);
    const projection = this.buildProjection(config, cacheResult);
    const missing = cache
      ? routes.filter((route) => !cache.entries.some((entry) => entry.remoteId === route.remoteModelId)).length
      : 0;
    return {
      configured: gateway !== undefined,
      gatewayId: NINEROUTER_GATEWAY_ID,
      ...(gateway ? { baseUrl: gateway.baseUrl } : {}),
      gateway: gateway?.enabled && (cache || this.lastGatewayState === "unreachable") ? this.lastGatewayState : "not-checked",
      cache: cacheResult.status === "corrupt" ? "corrupt" : !cache ? "empty" : this.cacheFreshness(cache),
      catalogEntries: cache?.entries.length ?? 0,
      enabledRoutes: routes.length,
      registeredModels: projection.models.length,
      missingEnabledRoutes: missing,
      ...(cache?.lastSuccessAt ? { lastSuccessfulRefresh: cache.lastSuccessAt } : {}),
      ...(cache?.lastError ? { lastError: cache.lastError } : {}),
    };
  }

  async list(filter?: string | ListOptions): Promise<readonly CatalogRow[]> {
    const query = typeof filter === "string" ? filter : filter?.filter;
    const config = await this.loadConfig();
    const cacheResult = await this.cacheStore.load();
    const gateway = config.gateways[NINEROUTER_GATEWAY_ID];
    const cache = cacheForGateway(cacheResult.cache, gateway?.baseUrl);
    const entries = cache?.entries ?? [];
    const configured = Object.values(config.routes).filter((route) => route.gatewayId === NINEROUTER_GATEWAY_ID);
    const routeGroups = groupRoutes(configured);
    const rows: CatalogRow[] = entries.map((entry) => this.rowFor(routeGroups.get(entry.remoteId) ?? [], entry, cache));
    const discoveredIds = new Set(entries.map((entry) => entry.remoteId));
    // Keep configured routes visible after a successful refresh removes them;
    // this is what prevents a disappearing remote model from being silently
    // retargeted to another model or forgotten by the operator.
    for (const [remoteModelId, routes] of routeGroups) {
      if (discoveredIds.has(remoteModelId)) continue;
      const route = routes[0]!;
      const duplicate = routes.length > 1;
      const hasCatalog = cache !== undefined;
      const entry: RemoteCatalogEntry = {
        remoteId: route.remoteModelId,
        displayName: route.displayName,
        resourceClass: route.resource.class,
        ...(route.resource.id ? { resourceId: route.resource.id } : {}),
        capabilities: [...route.capabilities],
        input: ["text"],
        capability: "unknown",
        provenance: {
          remoteId: "configured",
          displayName: "configured",
          resourceClass: "configured",
          capabilities: "configured",
          input: "conservative-default",
          capability: "configured",
        },
      };
      rows.push({
        entry,
        remoteModelId: route.remoteModelId,
        displayName: route.displayName,
        ...(duplicate ? {} : { routeId: route.id }),
        enabled: routes.some((candidate) => candidate.enabled),
        available: false,
        ...(hasCatalog ? { missing: true } : { stale: true }),
        ...(route.metadata?.sourceLabel ? { sourceLabel: route.metadata.sourceLabel } : {}),
        status: duplicate ? "ambiguous" : hasCatalog ? "missing" : "stale",
        warning: duplicate
          ? "Multiple configured routes use the same gateway and remote model ID"
          : hasCatalog
            ? "The configured model is absent from the last successful catalog"
            : "No valid catalog is available to confirm this configured model",
      });
    }
    if (!query) return rows;
    const needle = query.toLocaleLowerCase();
    return rows.filter((row) => `${row.entry.remoteId} ${row.entry.displayName} ${row.entry.owner ?? ""} ${row.sourceLabel ?? ""} ${row.routeId ?? ""} ${row.status}`.toLocaleLowerCase().includes(needle));
  }

  refresh(signal?: AbortSignal): Promise<RefreshResult> {
    const operation = (): Promise<RefreshResult> => this.refreshUnlocked(signal);
    const run = this.refreshQueue.then(operation, operation);
    this.refreshQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async refreshUnlocked(signal?: AbortSignal): Promise<RefreshResult> {
    const config = await this.loadConfig();
    const gateway = config.gateways[NINEROUTER_GATEWAY_ID];
    if (!gateway) throw new NineRouterManagerError("not-configured", "Configure the 9Router connection first");
    if (!gateway.enabled) throw new NineRouterManagerError("gateway-disabled", "The 9Router connection is disabled");
    let prior: CatalogCacheV1 | undefined;
    try {
      const baseUrl = validateNineRouterGateway(gateway);
      prior = cacheForGateway((await this.cacheStore.load()).cache, baseUrl);
      const requestOptions: Parameters<NineRouterClient["listModels"]>[0] = {
        baseUrl,
        timeoutMs: gateway.timeoutMs,
        ...(signal ? { signal } : {}),
        ...(gateway.credentialRef ? { credentialRef: gateway.credentialRef } : {}),
      };
      const entries = await this.client.listModels(requestOptions);
      const at = this.now().toISOString();
      const cache: CatalogCacheV1 = {
        cacheVersion: 1,
        gatewayId: NINEROUTER_GATEWAY_ID,
        baseUrl,
        generation: (prior?.generation ?? 0) + 1,
        fetchedAt: at,
        lastSuccessAt: at,
        entries,
        lastAttemptAt: at,
      };
      await this.cacheStore.save(cache);
      this.lastGatewayState = "reachable";
      const priorIds = new Set(prior?.entries.map((entry) => entry.remoteId) ?? []);
      const nextIds = new Set(entries.map((entry) => entry.remoteId));
      return {
        generation: cache.generation,
        entries,
        addedRemoteIds: entries.filter((entry) => !priorIds.has(entry.remoteId)).map((entry) => entry.remoteId),
        removedRemoteIds: (prior?.entries ?? []).filter((entry) => !nextIds.has(entry.remoteId)).map((entry) => entry.remoteId),
        stale: false,
      };
    } catch (error) {
      const safe = error instanceof NineRouterError
        ? new NineRouterError(error.kind, safeCatalogErrorStage(error.stage), safeCatalogErrorMessage(error), error.status)
        : new NineRouterError("transport", "request", "The 9Router catalog request failed");
      this.lastGatewayState = "unreachable";
      const at = this.now().toISOString();
      try {
        // A failed first refresh has no last-good snapshot to preserve.  Do not
        // write a synthetic cache with a fabricated lastSuccessAt timestamp.
        if (prior) await this.cacheStore.recordFailure(prior, NINEROUTER_GATEWAY_ID, safe, at);
      } catch {
        // Keep the last-good in memory semantics even when cache diagnostics cannot be written.
      }
      throw safe;
    }
  }

  async configure(baseUrl: string, credentialRef?: SecretRefV1 | string): Promise<ConfigureResult> {
    const normalized = normalizeNineRouterBaseUrl(baseUrl);
    const parsedCredentialRef = parseCredentialReference(credentialRef);
    let mutation: ConfigMutationResult | undefined;
    mutation = await this.configStore.update((draft) => {
      const existing = draft.gateways[NINEROUTER_GATEWAY_ID];
      draft.gateways[NINEROUTER_GATEWAY_ID] = {
        id: NINEROUTER_GATEWAY_ID,
        kind: "9router",
        baseUrl: normalized,
        enabled: true,
        timeoutMs: existing?.timeoutMs ?? DEFAULT_GATEWAY_TIMEOUT,
        ...(parsedCredentialRef ? { credentialRef: parsedCredentialRef } : existing?.credentialRef ? { credentialRef: existing.credentialRef } : {}),
      };
    });
    return { generation: mutation.generation, gatewayId: NINEROUTER_GATEWAY_ID, baseUrl: normalized };
  }

  async setEnabled(remoteId: string, enabled: boolean, options: SetEnabledOptions = {}): Promise<SetEnabledResult> {
    const config = await this.loadConfig();
    const matchingRoutes = Object.values(config.routes).filter((route) => route.gatewayId === NINEROUTER_GATEWAY_ID && route.remoteModelId === remoteId);
    if (matchingRoutes.length > 1) {
      throw new NineRouterManagerError("model-ambiguous", "Multiple configured routes use this gateway and remote model ID");
    }
    const existing = matchingRoutes[0];
    if (!enabled && options.activeRemoteModelId === remoteId) throw new NineRouterManagerError("active-route", "Switch away from the active 9Router model before disabling it");
    let entry: RemoteCatalogEntry | undefined;
    if (enabled) {
      const cache = (await this.cacheStore.load()).cache;
      entry = cache?.entries.find((candidate) => candidate.remoteId === remoteId);
      if (!entry) throw new NineRouterManagerError("model-not-found", "The model is not present in the last successful catalog");
      if (entry.capability === "non-chat") throw new NineRouterManagerError("model-not-found", "The selected catalog entry is not chat-compatible");
    }
    if (!existing && !entry) throw new NineRouterManagerError("model-not-found", "The configured route was not found");
    const routeId = existing?.id ?? stableRouteId(NINEROUTER_GATEWAY_ID, remoteId);
    const mutation = await this.configStore.update((draft) => {
      const current = draft.routes[routeId];
      if (!enabled) {
        if (current) current.enabled = false;
        return;
      }
      if (current && (current.gatewayId !== NINEROUTER_GATEWAY_ID || current.remoteModelId !== remoteId)) {
        throw new NineRouterManagerError("route-id-collision", "The stable route ID is already assigned to another remote model");
      }
      if (current) {
        // Existing config may contain user-authored resource identity, labels,
        // tags, or capability overrides. Re-enable it without replacing those
        // authoritative choices with discovery metadata.
        current.enabled = true;
        return;
      }
      const candidate = entry!;
      const route: RouteConfigV1 = {
        id: routeId,
        displayName: candidate.displayName.slice(0, MAX_CONFIG_LABEL),
        enabled: true,
        gatewayId: NINEROUTER_GATEWAY_ID,
        remoteModelId: candidate.remoteId,
        resource: {
          class: candidate.resourceClass,
          ...(candidate.resourceId ? { id: candidate.resourceId } : {}),
        },
        tags: [...candidate.capabilities],
        capabilities: [...candidate.capabilities],
        ...(candidate.underlyingFamily || candidate.underlyingVersion || candidate.owner
          ? {
              metadata: {
                ...(candidate.underlyingFamily ? { underlyingFamily: candidate.underlyingFamily.slice(0, MAX_CONFIG_LABEL) } : {}),
                ...(candidate.underlyingVersion ? { underlyingVersion: candidate.underlyingVersion.slice(0, MAX_CONFIG_LABEL) } : {}),
                ...(candidate.owner ? { sourceLabel: candidate.owner.slice(0, MAX_CONFIG_LABEL) } : {}),
              },
            }
          : {}),
      };
      draft.routes[routeId] = route;
    });
    return { changed: mutation.changed, enabled, remoteId, routeId, generation: mutation.generation };
  }

  async providerProjection(): Promise<ProviderProjection> {
    const config = await this.loadConfig();
    const cache = await this.cacheStore.load();
    return this.buildProjection(config, cache);
  }

  private async loadConfig() {
    const loaded = await this.configStore.load();
    return loaded.snapshot?.config ?? createDefaultConfig();
  }

  private buildProjection(config: import("../config/types.js").ConfigV1, cacheResult: Awaited<ReturnType<CatalogCacheStore["load"]>>): ProviderProjection {
    const gateway = config.gateways[NINEROUTER_GATEWAY_ID];
    const cache = cacheForGateway(cacheResult.cache, gateway?.baseUrl);
    const warnings: string[] = [];
    if (cacheResult.status === "corrupt") warnings.push("Catalog cache is corrupt; refresh is required");
    if (cacheResult.cache && !cache) warnings.push("Catalog cache belongs to a different 9Router endpoint; refresh is required");
    if (cache?.lastError) warnings.push(cache.lastError.message);
    const models: ProviderModelProjection[] = [];
    if (gateway?.enabled && cache) {
      const enabledGroups = groupRoutes(Object.values(config.routes).filter(
        (route) => route.enabled && route.gatewayId === NINEROUTER_GATEWAY_ID,
      ));
      for (const [remoteModelId, routes] of enabledGroups) {
        if (routes.length > 1) {
          warnings.push(`${remoteModelId}: duplicate configured route identity`);
          continue;
        }
        const route = routes[0]!;
        const entry = cache.entries.find((candidate) => candidate.remoteId === route.remoteModelId);
        if (!entry) continue;
        if (entry.capability === "non-chat") continue;
        const warning = [
          entry.capability === "unknown" ? "Catalog did not identify this model as chat-compatible" : undefined,
          entry.resourceClass === "unknown" && entry.resourceId === undefined ? "Resource identity is unknown" : undefined,
        ].filter((item): item is string => item !== undefined).join("; ") || undefined;
        if (warning) warnings.push(`${entry.remoteId}: ${warning}`);
        models.push(toProviderModel(route, entry, warning));
      }
    }
    const apiKeyReference = isEnvironmentReference(gateway?.credentialRef) ? `$${gateway!.credentialRef!.key}` : undefined;
    if (gateway?.credentialRef && !apiKeyReference) warnings.push("Configured credential store is unavailable for Pi provider registration");
    return {
      providerId: NINEROUTER_PROVIDER_ID,
      gatewayId: NINEROUTER_GATEWAY_ID,
      ...(gateway ? { baseUrl: gateway.baseUrl } : {}),
      ...(apiKeyReference ? { apiKeyReference } : {}),
      authHeader: apiKeyReference !== undefined,
      api: "openai-completions",
      models,
      stale: cache !== undefined && cache.lastError !== undefined,
      warnings: [...new Set(warnings)],
    };
  }

  private rowFor(routes: readonly RouteConfigV1[], entry: RemoteCatalogEntry, cache?: CatalogCacheV1): CatalogRow {
    const route = routes[0];
    const ambiguous = routes.length > 1 || (entry.resourceClass === "unknown" && entry.resourceId === undefined);
    return {
      entry,
      remoteModelId: entry.remoteId,
      displayName: entry.displayName,
      ...(route && routes.length === 1 ? { routeId: route.id } : {}),
      enabled: routes.some((candidate) => candidate.enabled),
      available: true,
      ...(cache?.lastError ? { stale: true } : {}),
      ...(route && !cache?.entries.some((candidate) => candidate.remoteId === route.remoteModelId) ? { missing: true } : {}),
      ...(entry.owner ? { sourceLabel: entry.owner } : {}),
      status: ambiguous ? "ambiguous" : cache?.lastError ? "stale" : route ? "present" : "new",
      ...(routes.length > 1
        ? { warning: "Multiple configured routes use the same gateway and remote model ID" }
        : entry.resourceClass === "unknown" && entry.resourceId === undefined
          ? { warning: "Resource identity is unknown; this entry will not be merged with another ID" }
          : entry.capability === "unknown"
            ? { warning: "Capability is unknown" }
            : {}),
    };
  }

  private cacheFreshness(cache: CatalogCacheV1): "fresh" | "stale" {
    return cache.lastError ? "stale" : "fresh";
  }
}

function groupRoutes(routes: readonly RouteConfigV1[]): Map<string, RouteConfigV1[]> {
  const groups = new Map<string, RouteConfigV1[]>();
  for (const route of routes) {
    const group = groups.get(route.remoteModelId);
    if (group) group.push(route);
    else groups.set(route.remoteModelId, [route]);
  }
  return groups;
}

function parseCredentialReference(value: SecretRefV1 | string | undefined): SecretRefV1 | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    if (value === null || typeof value !== "object") {
      throw new NineRouterError("secret", "config", "The credential reference is invalid");
    }
    if (value.store !== "env" || !/^[A-Z_][A-Z0-9_]*$/u.test(value.key)) {
      throw new NineRouterError("secret", "config", "Only a valid environment credential reference is supported");
    }
    return { store: "env", key: value.key };
  }
  if (value.length === 0) throw new NineRouterError("secret", "config", "The credential reference is invalid");
  const normalized = value.startsWith("$") ? `env:${value.slice(1)}` : value;
  const match = /^env:([A-Z_][A-Z0-9_]*)$/u.exec(normalized);
  if (!match) throw new NineRouterError("secret", "config", "Only env:NAME or $NAME credential references are supported");
  return { store: "env", key: match[1]! };
}

function cacheForGateway(cache: CatalogCacheV1 | undefined, baseUrl: string | undefined): CatalogCacheV1 | undefined {
  if (!cache || !baseUrl) return undefined;
  try {
    return cache.baseUrl === normalizeNineRouterBaseUrl(baseUrl) ? cache : undefined;
  } catch {
    return undefined;
  }
}

function toProviderModel(route: RouteConfigV1, entry: RemoteCatalogEntry, warning?: string): ProviderModelProjection {
  return {
    routeId: route.id,
    id: entry.remoteId,
    name: entry.displayName,
    reasoning: false,
    input: entry.input.length > 0 ? [...entry.input] : ["text"],
    cost: DEFAULT_COST,
    contextWindow: entry.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: entry.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(warning ? { warning } : {}),
  };
}

export function createNineRouterManager(root: string, configStore = new ConfigStore({ root })): NineRouterManager {
  const cacheStore = new CatalogCacheStore(root);
  const client = new NineRouterClient();
  return new NineRouterManager(configStore, cacheStore, client);
}
