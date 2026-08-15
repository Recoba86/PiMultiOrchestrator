import { createDefaultConfig } from "../config/defaults.js";
import { ConfigStore } from "../config/store.js";
import type { ConfigMutationResult } from "../config/store.js";
import type { RouteConfigV1, SecretRefV1, StableId } from "../config/types.js";
import { CatalogCacheStore } from "./cache.js";
import { NineRouterError, NineRouterManagerError, safeCatalogErrorMessage, safeCatalogErrorStage } from "./errors.js";
import { normalizeNineRouterBaseUrl, validateNineRouterGateway } from "./connection.js";
import { NineRouterClient } from "./client.js";
import { routeIdentityMatches, stableRouteId } from "./identity.js";
import { InlineSecretResolver, isEnvironmentReference, type SecretResolver } from "./secrets.js";
import {
  NINEROUTER_GATEWAY_ID,
  NINEROUTER_PI_AUTH_REFERENCE,
  NINEROUTER_PROVIDER_ID,
  type CatalogCacheV1,
  type CatalogRow,
  type ConfigureResult,
  type ListOptions,
  type NineRouterManagerOptions,
  type NineRouterStatus,
  type ProviderModelProjection,
  type ProviderProjection,
  type PiProviderCatalog,
  type PiProviderCatalogModel,
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
  private piCatalog: PiProviderCatalog | undefined;

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
    const catalogEntries = mergeCatalogEntries(cache?.entries ?? [], this.piCatalog);
    const projection = this.buildProjection(config, cacheResult);
    const missing = catalogEntries.length > 0
      ? routes.filter((route) => !catalogEntries.some((entry) => entry.remoteId === route.remoteModelId)).length
      : 0;
    const state = this.statusState(gateway !== undefined, catalogEntries.length, cacheResult.status === "corrupt", cache?.lastError !== undefined);
    return {
      configured: gateway !== undefined,
      gatewayId: NINEROUTER_GATEWAY_ID,
      ...(gateway ? { baseUrl: gateway.baseUrl } : {}),
      gateway: gateway?.enabled && (cache || this.lastGatewayState === "unreachable") ? this.lastGatewayState : "not-checked",
      cache: cacheResult.status === "corrupt" ? "corrupt" : !cache ? "empty" : this.cacheFreshness(cache),
      catalogEntries: catalogEntries.length,
      enabledRoutes: routes.length,
      registeredModels: projection.models.length,
      missingEnabledRoutes: missing,
      ...(cache?.lastSuccessAt ? { lastSuccessfulRefresh: cache.lastSuccessAt } : {}),
      ...(cache?.lastError ? { lastError: cache.lastError } : {}),
      state,
      ...(this.piCatalog ? { piProviderAvailable: this.piCatalog.available, piProviderModels: this.piCatalog.models.length } : {}),
    };
  }

  async list(filter?: string | ListOptions): Promise<readonly CatalogRow[]> {
    const query = typeof filter === "string" ? filter : filter?.filter;
    const config = await this.loadConfig();
    const cacheResult = await this.cacheStore.load();
    const gateway = config.gateways[NINEROUTER_GATEWAY_ID];
    const cache = cacheForGateway(cacheResult.cache, gateway?.baseUrl);
    const entries = mergeCatalogEntries(cache?.entries ?? [], this.piCatalog);
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
      if (entries.length === 0) throw new NineRouterError("malformed", "schema", "The 9Router catalog was empty; the last-known-good catalog was preserved");
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
      const priorById = new Map((prior?.entries ?? []).map((entry) => [entry.remoteId, JSON.stringify(entry)]));
      return {
        generation: cache.generation,
        entries,
        addedRemoteIds: entries.filter((entry) => !priorIds.has(entry.remoteId)).map((entry) => entry.remoteId),
        removedRemoteIds: (prior?.entries ?? []).filter((entry) => !nextIds.has(entry.remoteId)).map((entry) => entry.remoteId),
        changedRemoteIds: entries.filter((entry) => priorById.has(entry.remoteId) && priorById.get(entry.remoteId) !== JSON.stringify(entry)).map((entry) => entry.remoteId),
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

  async testConnection(baseUrl: string, secret: string, signal?: AbortSignal): Promise<readonly RemoteCatalogEntry[]> {
		const normalized = normalizeNineRouterBaseUrl(baseUrl);
		const client = new NineRouterClient({ resolver: new InlineSecretResolver(secret) });
		return client.listModels({
			baseUrl: normalized,
			credentialRef: { store: "env", key: "PMO_TRANSIENT" },
			...(signal ? { signal } : {}),
		});
	}

	async adoptPiProviderCatalog(catalog: PiProviderCatalog): Promise<void> {
		if (catalog.providerId !== NINEROUTER_PROVIDER_ID) return;
		if (catalog.available && catalog.models.length === 0 && this.piCatalog?.available && this.piCatalog.models.length > 0) return;
		this.piCatalog = {
			...catalog,
			models: catalog.models.filter((model) => typeof model.id === "string" && model.id.length > 0).slice(0, 512),
		};
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
		entry = this.externalEntry(remoteId) ?? cache?.entries.find((candidate) => candidate.remoteId === remoteId);
      if (!entry) throw new NineRouterManagerError("model-not-found", "The model is not present in the last successful catalog");
      if (entry.capability === "non-chat") throw new NineRouterManagerError("model-not-found", "The selected catalog entry is not chat-compatible");
    }
    if (enabled && existing && entry && !routeIdentityMatches(
      { gatewayId: NINEROUTER_GATEWAY_ID, remoteModelId: existing.remoteModelId, ...(existing.resource.id ? { resourceId: existing.resource.id } : {}), ...(existing.metadata?.sourceLabel ? { sourceLabel: existing.metadata.sourceLabel } : {}) },
      { gatewayId: NINEROUTER_GATEWAY_ID, remoteModelId: entry.remoteId, ...(entry.resourceId ? { resourceId: entry.resourceId } : {}), ...(entry.owner ? { sourceLabel: entry.owner } : {}) },
    )) throw new NineRouterManagerError("model-ambiguous", "The discovered model identity does not exactly match the configured route");
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
      if (!draft.gateways[NINEROUTER_GATEWAY_ID] && this.piCatalog?.baseUrl) {
			draft.gateways[NINEROUTER_GATEWAY_ID] = {
				id: NINEROUTER_GATEWAY_ID,
				kind: "9router",
				baseUrl: normalizeNineRouterBaseUrl(this.piCatalog.baseUrl),
				enabled: true,
				timeoutMs: DEFAULT_GATEWAY_TIMEOUT,
			};
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
                ...(candidate.thinkingLevelMap ? { thinkingLevelMap: { ...candidate.thinkingLevelMap } } : {}),
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
    const catalogEntries = mergeCatalogEntries(cache?.entries ?? [], this.piCatalog);
    if (gateway?.enabled && catalogEntries.length > 0) {
      const enabledGroups = groupRoutes(Object.values(config.routes).filter(
        (route) => route.enabled && route.gatewayId === NINEROUTER_GATEWAY_ID,
      ));
      for (const [remoteModelId, routes] of enabledGroups) {
        if (routes.length > 1) {
          warnings.push(`${remoteModelId}: duplicate configured route identity`);
          continue;
        }
        const route = routes[0]!;
        const entry = catalogEntries.find((candidate) => candidate.remoteId === route.remoteModelId);
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
    const apiKeyReference = isEnvironmentReference(gateway?.credentialRef)
		? `$${gateway!.credentialRef!.key}`
		: gateway?.credentialRef?.store === "pi-auth" ? NINEROUTER_PI_AUTH_REFERENCE : undefined;
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

	private externalEntry(remoteId: string): RemoteCatalogEntry | undefined {
		const model = this.piCatalog?.models.find((candidate) => candidate.id === remoteId);
		return model ? piModelToCatalogEntry(model) : undefined;
	}

	private statusState(configured: boolean, entries: number, corrupt: boolean, stale: boolean): Exclude<NineRouterStatus["state"], undefined> {
		if (corrupt) return "error";
		if (this.piCatalog?.available && this.piCatalog.models.length > 0 && !configured) return "pi-provider-ready";
		if (stale) return "stale";
		if (!configured) return "unconfigured";
		if (entries === 0) return "empty";
		return "ready";
	}

  private rowFor(routes: readonly RouteConfigV1[], entry: RemoteCatalogEntry, cache?: CatalogCacheV1): CatalogRow {
    const route = routes[0];
	const ambiguous = routes.length > 1;
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
    if (value.store === "env" && /^[A-Z_][A-Z0-9_]*$/u.test(value.key)) return { store: "env", key: value.key };
	    if ((value.store === "pi-auth" || value.store === "keychain") && /^[A-Za-z0-9_.:-]+$/u.test(value.key)) return { store: value.store, key: value.key };
	    throw new NineRouterError("secret", "config", "The credential reference is invalid");
  }
  if (value.length === 0) throw new NineRouterError("secret", "config", "The credential reference is invalid");
  const normalized = value.startsWith("$") ? `env:${value.slice(1)}` : value;
  const match = /^(env|pi-auth|keychain):([A-Za-z0-9_.:-]+)$/u.exec(normalized);
  if (!match) throw new NineRouterError("secret", "config", "Use env:NAME, pi-auth:PROVIDER, or keychain:NAME");
  if (match[1] === "env" && !/^[A-Z_][A-Z0-9_]*$/u.test(match[2]!)) throw new NineRouterError("secret", "config", "Use env:NAME with an uppercase environment name");
  return { store: match[1] as SecretRefV1["store"], key: match[2]! };
}

function cacheForGateway(cache: CatalogCacheV1 | undefined, baseUrl: string | undefined): CatalogCacheV1 | undefined {
  if (!cache || !baseUrl) return undefined;
  try {
    return cache.baseUrl === normalizeNineRouterBaseUrl(baseUrl) ? cache : undefined;
  } catch {
    return undefined;
  }
}

function mergeCatalogEntries(entries: readonly RemoteCatalogEntry[], catalog: PiProviderCatalog | undefined): RemoteCatalogEntry[] {
	const external = new Map((catalog?.models ?? []).map((model) => [model.id, piModelToCatalogEntry(model)]));
	const merged = entries.map((entry) => external.get(entry.remoteId) ?? entry);
	const seen = new Set(merged.map((entry) => entry.remoteId));
	for (const entry of external.values()) {
		if (seen.has(entry.remoteId)) continue;
		merged.push(entry);
		seen.add(entry.remoteId);
	}
	return merged;
}

function piModelToCatalogEntry(model: PiProviderCatalogModel): RemoteCatalogEntry {
	return {
		remoteId: model.id,
		displayName: (model.name ?? model.id).slice(0, MAX_CONFIG_LABEL),
		owner: "Pi 9Router",
		resourceClass: "other",
		capabilities: ["chat"],
		input: model.input && model.input.length > 0 ? [...model.input] : ["text"],
		...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
		...(model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: { ...model.thinkingLevelMap } }),
		...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
		...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
		capability: "chat",
		provenance: { remoteId: "configured", displayName: "configured", resourceClass: "configured", capabilities: "configured", input: "configured", capability: "configured" },
	};
}

function toProviderModel(route: RouteConfigV1, entry: RemoteCatalogEntry, warning?: string): ProviderModelProjection {
  return {
    routeId: route.id,
    id: entry.remoteId,
    name: entry.displayName,
    reasoning: entry.reasoning ?? false,
    ...(entry.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: { ...entry.thinkingLevelMap } }),
    input: entry.input.length > 0 ? [...entry.input] : ["text"],
    cost: DEFAULT_COST,
    contextWindow: entry.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: entry.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(warning ? { warning } : {}),
  };
}

export function createNineRouterManager(root: string, configStore = new ConfigStore({ root }), resolver?: SecretResolver): NineRouterManager {
  const cacheStore = new CatalogCacheStore(root);
  const client = new NineRouterClient(resolver ? { resolver } : {});
  return new NineRouterManager(configStore, cacheStore, client);
}
