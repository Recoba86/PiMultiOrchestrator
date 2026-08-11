import { join } from "node:path";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ProviderConfig,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type { SecretRefV1 } from "../core/config/types.js";

import {
	createNineRouterManager,
	NINEROUTER_PROVIDER_ID as DOMAIN_NINEROUTER_PROVIDER_ID,
	NineRouterError,
	NineRouterManagerError,
	SecretResolutionError,
	type CatalogRow,
	type ProviderProjection,
} from "../core/ninerouter/index.js";

export const NINEROUTER_PROVIDER_ID = DOMAIN_NINEROUTER_PROVIDER_ID;

type MaybePromise<T> = T | Promise<T>;

export interface ModelManagerEntry {
	readonly remoteModelId: string;
	readonly routeId?: string;
	readonly displayName?: string;
	readonly enabled?: boolean;
	readonly available?: boolean;
	readonly stale?: boolean;
	readonly missing?: boolean;
	readonly sourceLabel?: string;
	readonly capability?: string;
	readonly status?: string;
	readonly warning?: string;
}


/** The narrow manager surface consumed by the host. Keep domain details out of Pi callbacks. */
export interface PiManagerContract {
	list(filter?: string): MaybePromise<readonly (CatalogRow | ModelManagerEntry)[]>;
	loadStatus(): MaybePromise<unknown>;
	refresh(signal?: AbortSignal): MaybePromise<unknown>;
	configure(baseUrl: string, credentialRef?: SecretRefV1 | string): MaybePromise<unknown>;
	setEnabled(
		remoteModelId: string,
		enabled: boolean,
		options?: { readonly activeRemoteModelId?: string },
	): MaybePromise<unknown>;
	providerProjection(): MaybePromise<ProviderProjection | undefined>;
}

export interface PiHostOptions {
	readonly manager: PiManagerContract;
	readonly providerId?: string;
}

export interface ReconcileResult {
	readonly changed: boolean;
	readonly registered: boolean;
	readonly modelCount: number;
	readonly error?: Error;
}

export interface PiHost {
	readonly manager: PiManagerContract;
	reconcile(): Promise<ReconcileResult>;
	registerCommands(): void;
	dispose(): void;
}

const errorMessage = (error: unknown): string =>
	error instanceof NineRouterError
		? error.toJSON().message
		: error instanceof NineRouterManagerError || error instanceof SecretResolutionError
			? error.message
		: "operation unavailable";

const safeStatusLine = (status: unknown): string => {
	if (status === undefined || status === null) return "status: unknown";
	if (typeof status === "string" || typeof status === "number" || typeof status === "boolean") {
		return `status: ${String(status)}`;
	}
	if (typeof status !== "object") return "status: unknown";
	const candidate = status as Record<string, unknown>;
	const state = typeof candidate.state === "string" ? candidate.state : undefined;
	const configured = typeof candidate.configured === "boolean" ? candidate.configured : undefined;
	const gateway = typeof candidate.gateway === "string" ? candidate.gateway : undefined;
	const cache = typeof candidate.cache === "string" ? candidate.cache : undefined;
	const count = typeof candidate.catalogEntries === "number" ? candidate.catalogEntries : typeof candidate.catalogCount === "number" ? candidate.catalogCount : undefined;
	const enabled = typeof candidate.enabledRoutes === "number" ? candidate.enabledRoutes : typeof candidate.enabledCount === "number" ? candidate.enabledCount : undefined;
	const registered = typeof candidate.registeredModels === "number" ? candidate.registeredModels : undefined;
	const missing = typeof candidate.missingEnabledRoutes === "number" ? candidate.missingEnabledRoutes : undefined;
	const lastSuccess = typeof candidate.lastSuccessfulRefresh === "string" ? candidate.lastSuccessfulRefresh : undefined;
	const lastError = candidate.lastError && typeof candidate.lastError === "object" && typeof (candidate.lastError as Record<string, unknown>).kind === "string"
		? (candidate.lastError as Record<string, unknown>).kind as string
		: undefined;
	const pieces = [
		state ? `state=${state}` : undefined,
		configured === undefined ? undefined : `configured=${configured}`,
		gateway ? `gateway=${gateway}` : undefined,
		cache ? `cache=${cache}` : undefined,
		count === undefined ? undefined : `catalog=${count}`,
		enabled === undefined ? undefined : `enabled=${enabled}`,
		registered === undefined ? undefined : `registered=${registered}`,
		missing === undefined ? undefined : `missing=${missing}`,
		lastSuccess ? `last-success=${lastSuccess}` : undefined,
		lastError ? `last-error=${lastError}` : undefined,
	].filter(
		(value): value is string => value !== undefined,
	);
	return pieces.length > 0 ? pieces.join(" ") : "status: available";
};

const modelLabel = (entry: ModelManagerEntry): string => {
	const enabled = entry.enabled ? "[x]" : "[ ]";
	const state = entry.missing ? " ! missing" : entry.stale ? " ! stale" : entry.available === false ? " ! unavailable" : "";
	const ambiguity = entry.status === "ambiguous" ? " ! ambiguous" : "";
	const display = entry.displayName && entry.displayName !== entry.remoteModelId ? ` — ${entry.displayName}` : "";
	const route = entry.routeId ? ` (${entry.routeId})` : "";
	return `${enabled} ${entry.remoteModelId}${display}${route}${state}${ambiguity}`;
};

/** Normalize the domain CatalogRow shape while allowing focused host fakes to use the compact shape. */
const normalizeModelEntry = (value: unknown): ModelManagerEntry | undefined => {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.remoteModelId === "string") {
		if (candidate.entry && typeof candidate.entry === "object") {
			const nested = candidate.entry as Record<string, unknown>;
			if (typeof candidate.capability !== "string" && typeof nested.capability === "string") {
				return { ...candidate, capability: nested.capability } as unknown as ModelManagerEntry;
			}
		}
		return candidate as unknown as ModelManagerEntry;
	}
	if (!candidate.entry || typeof candidate.entry !== "object") return undefined;
	const remote = candidate.entry as Record<string, unknown>;
	if (typeof remote.remoteId !== "string") return undefined;
	const status = typeof candidate.status === "string" ? candidate.status : undefined;
	return {
		remoteModelId: remote.remoteId,
		enabled: candidate.enabled === true,
		available: typeof candidate.available === "boolean" ? candidate.available : status !== "missing" && status !== "stale",
		stale: candidate.stale === true || status === "stale",
		missing: candidate.missing === true || status === "missing",
		...(typeof remote.displayName === "string" ? { displayName: remote.displayName } : {}),
		...(typeof candidate.routeId === "string" ? { routeId: candidate.routeId } : {}),
		...(typeof candidate.sourceLabel === "string" ? { sourceLabel: candidate.sourceLabel } : typeof remote.owner === "string" ? { sourceLabel: remote.owner } : {}),
		...(typeof remote.capability === "string" ? { capability: remote.capability } : {}),
		...(status ? { status } : {}),
		...(typeof candidate.warning === "string" ? { warning: candidate.warning } : {}),
	};
};

const parseCredentialReference = (value: string): SecretRefV1 | undefined => {
	const match = /^env:([A-Z_][A-Z0-9_]*)$/u.exec(value.trim());
	return match ? { store: "env", key: match[1]! } : undefined;
};

const projectionFingerprint = (projection: ProviderProjection): string => JSON.stringify({
	baseUrl: projection.baseUrl,
	apiKeyReference: projection.apiKeyReference,
	authHeader: projection.authHeader,
	api: projection.api,
	models: projection.models,
});

const asProviderConfig = (projection: ProviderProjection): ProviderConfig | undefined => {
	if (!projection.baseUrl || !projection.apiKeyReference || projection.models.length === 0) return undefined;
	const config: ProviderConfig = {
		name: "9Router",
		baseUrl: projection.baseUrl,
		api: "openai-completions",
		apiKey: projection.apiKeyReference,
		authHeader: projection.authHeader,
		models: projection.models.map((model): ProviderModelConfig => ({
			id: model.id,
			name: model.name,
			reasoning: model.reasoning,
			input: [...model.input],
			cost: { ...model.cost },
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
		})),
	};
	return config;
};

/**
 * Build the Pi-facing adapter around a domain manager.  The adapter owns no
 * catalog/configuration state; it only projects the manager's current enabled
 * routes into Pi's dynamic provider registry and forwards user intents.
 */
export function createPiHost(pi: ExtensionAPI, options: PiHostOptions): PiHost {
	const providerId = options.providerId ?? NINEROUTER_PROVIDER_ID;
	const manager = options.manager;
	let registeredFingerprint: string | undefined;
	let reconciled = false;
	const lifetime = new AbortController();

	const notifyError = (ctx: ExtensionContext | ExtensionCommandContext, prefix: string, error: unknown): void => {
		ctx.ui.notify(`${prefix}: ${errorMessage(error)}`, "error");
	};

	const requireIdle = (ctx: ExtensionContext | ExtensionCommandContext): boolean => {
		if (ctx.isIdle()) return true;
		ctx.ui.notify("Wait for the current Pi turn to finish before changing 9Router state", "warning");
		return false;
	};

	const reconcile = async (): Promise<ReconcileResult> => {
		const projection = await manager.providerProjection();
		const config = projection ? asProviderConfig(projection) : undefined;
		if (!config || !projection) {
			// Pi keeps extension provider state across /reload while recreating the
			// extension factory. Clear our owned namespace on the first empty
			// projection so a prior run cannot leave stale 9Router models behind.
			if (!reconciled || registeredFingerprint !== undefined) {
				pi.unregisterProvider(providerId);
				registeredFingerprint = undefined;
				reconciled = true;
				return { changed: true, registered: false, modelCount: 0 };
			}
			return { changed: false, registered: false, modelCount: 0 };
		}

		const fingerprint = projectionFingerprint(projection);
		if (registeredFingerprint === fingerprint) {
			return { changed: false, registered: true, modelCount: projection.models.length };
		}

		const previousFingerprint = registeredFingerprint;
		try {
			// Pi 0.84.1 replaces the provider's model list when `models` is
			// supplied, so registration can update an existing projection in place.
			// This also preserves the previous safe registry if validation fails.
			pi.registerProvider(providerId, config);
			registeredFingerprint = fingerprint;
			reconciled = true;
			return { changed: true, registered: true, modelCount: projection.models.length };
		} catch (error) {
			registeredFingerprint = previousFingerprint;
			return {
				changed: true,
				registered: previousFingerprint !== undefined,
				modelCount: projection.models.length,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	};

	const refreshAndReconcile = async (ctx: ExtensionContext | ExtensionCommandContext): Promise<void> => {
		if (!requireIdle(ctx)) return;
		try {
			await manager.refresh(AbortSignal.any(ctx.signal ? [ctx.signal, lifetime.signal] : [lifetime.signal]));
			const result = await reconcile();
			if (result.error) {
				notifyError(ctx, "9Router provider activation failed", result.error);
				return;
			}
			ctx.ui.notify(`9Router refreshed (${result.modelCount} enabled model${result.modelCount === 1 ? "" : "s"})`, "info");
		} catch (error) {
			notifyError(ctx, "9Router refresh failed", error);
		}
	};

	const modelEntries = async (filter?: string): Promise<readonly ModelManagerEntry[]> => {
		const raw = await manager.list(filter);
		return raw.map(normalizeModelEntry).filter((entry): entry is ModelManagerEntry => entry !== undefined);
	};

	const toggleEntry = async (ctx: ExtensionCommandContext, entry: ModelManagerEntry): Promise<void> => {
		if (!requireIdle(ctx)) return;
		const enabled = entry.enabled === true;
		const activeRemoteModelId = ctx.model?.provider === providerId ? ctx.model.id : undefined;
		if (enabled && activeRemoteModelId === entry.remoteModelId) {
			ctx.ui.notify("Disable the active 9Router model only after switching to another model", "warning");
			return;
		}
		const action = enabled ? "Disable" : "Enable";
		const confirmed = await ctx.ui.confirm(`${action} 9Router model?`, entry.remoteModelId);
		if (!confirmed) return;
		try {
			const options = activeRemoteModelId === undefined ? undefined : { activeRemoteModelId };
			await manager.setEnabled(entry.remoteModelId, !enabled, options);
			const result = await reconcile();
			if (result.error) {
				notifyError(ctx, "9Router provider activation failed", result.error);
				return;
			}
			ctx.ui.notify(`${action}d ${entry.remoteModelId}`, "info");
		} catch (error) {
			notifyError(ctx, `${action} failed`, error);
		}
	};

	const inspectEntry = (ctx: ExtensionCommandContext, entry: ModelManagerEntry): void => {
		const details = [
			`remote: ${entry.remoteModelId}`,
			`local route: ${entry.routeId ?? "not enabled"}`,
			`source: ${entry.sourceLabel ?? "unknown"}`,
			`capability: ${entry.capability ?? "unknown"}`,
			`state: ${entry.missing ? "missing" : entry.stale ? "stale" : entry.available === false ? "unavailable" : "available"}`,
			...(entry.warning ? [`warning: ${entry.warning}`] : []),
		].join("\n");
		ctx.ui.notify(details, "info");
	};

	const openModels = async (ctx: ExtensionCommandContext, initialFilter?: string): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/9router-models requires TUI mode", "error");
			return;
		}
		const filter = initialFilter?.trim() || undefined;
		let entries: readonly ModelManagerEntry[];
		try {
			entries = await modelEntries(filter);
		} catch (error) {
			notifyError(ctx, "9Router model list failed", error);
			return;
		}
		if (entries.length === 0) {
			ctx.ui.notify(filter ? `No 9Router models match '${filter}'` : "No 9Router models discovered", "warning");
			return;
		}
		while (true) {
			const selected = await ctx.ui.select("9Router Models — select a model", entries.map(modelLabel));
			if (!selected) return;
			const index = entries.map(modelLabel).indexOf(selected);
			const entry = index >= 0 ? entries[index] : undefined;
			if (!entry) return;
			const action = await ctx.ui.select(`9Router model: ${entry.remoteModelId}`, ["Inspect", entry.enabled ? "Disable" : "Enable", "Back"]);
			switch (action) {
				case "Inspect":
					inspectEntry(ctx, entry);
					break;
				case "Enable":
				case "Disable":
					await toggleEntry(ctx, entry);
					break;
				default:
					return;
			}
			try {
				entries = await modelEntries(filter);
			} catch (error) {
				notifyError(ctx, "9Router model list failed", error);
				return;
			}
			if (entries.length === 0) return;
		}
	};

	const showStatus = async (ctx: ExtensionContext | ExtensionCommandContext): Promise<void> => {
		try {
			const [status, entries, projection] = await Promise.all([
				manager.loadStatus(),
				modelEntries(),
				manager.providerProjection(),
			]);
			const enabled = entries.filter((entry) => entry.enabled).length;
			const projected = projection?.models.length ?? 0;
			const available = ctx.modelRegistry.getAvailable().filter((model) => model.provider === providerId).length;
			ctx.ui.notify(`${safeStatusLine(status)} catalog=${entries.length} enabled=${enabled} projected=${projected} available=${available}`, "info");
		} catch (error) {
			notifyError(ctx, "9Router status failed", error);
		}
	};

	const configureConnection = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Connection setup requires TUI mode", "error");
			return;
		}
		if (!requireIdle(ctx)) return;
		let projection: ProviderProjection | undefined;
		try {
			projection = await manager.providerProjection();
		} catch (error) {
			notifyError(ctx, "9Router connection status failed", error);
			return;
		}
		const baseUrl = await ctx.ui.input("9Router base URL", projection?.baseUrl ?? "");
		if (!baseUrl?.trim()) return;
		const defaultCredential = projection?.apiKeyReference?.startsWith("$")
			? `env:${projection.apiKeyReference.slice(1)}`
			: "env:NINEROUTER_API_KEY";
		const credentialRef = await ctx.ui.input("Credential reference (not the secret)", defaultCredential);
		if (!credentialRef?.trim()) return;
		const parsedCredentialRef = parseCredentialReference(credentialRef);
		if (!parsedCredentialRef) {
			ctx.ui.notify("Use an environment reference such as env:VARIABLE (not the secret)", "error");
			return;
		}
		try {
			await manager.configure(baseUrl.trim(), parsedCredentialRef);
			const result = await reconcile();
			if (result.error) {
				notifyError(ctx, "9Router provider activation failed", result.error);
				return;
			}
			ctx.ui.notify(
				result.registered
					? "9Router connection saved and provider activated"
					: "9Router connection saved; refresh the catalog and enable a model to activate the provider",
				result.registered ? "info" : "warning",
			);
		} catch (error) {
			notifyError(ctx, "9Router connection failed", error);
		}
	};

	const openControlCenter = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/orchestrator requires TUI mode", "error");
			return;
		}
		const choice = await ctx.ui.select("Pi Multi-Orchestrator (M2)", ["Models & 9Router", "Refresh 9Router catalog", "9Router status", "Connection setup", "Close"]);
		switch (choice) {
			case "Models & 9Router":
				await openModels(ctx);
				return;
			case "Refresh 9Router catalog":
				await refreshAndReconcile(ctx);
				return;
			case "9Router status":
				await showStatus(ctx);
				return;
			case "Connection setup":
				await configureConnection(ctx);
				return;
			default:
				return;
		}
	};

	const registerCommands = (): void => {
		pi.registerCommand("orchestrator", {
			description: "Open Pi Multi-Orchestrator control center",
			handler: async (_args, ctx) => openControlCenter(ctx),
		});
		pi.registerCommand("9router-models", {
			description: "Manage enabled 9Router models (optional filter)",
			handler: async (args, ctx) => openModels(ctx, args),
		});
		pi.registerCommand("9router-refresh", {
			description: "Refresh the 9Router model catalog",
			handler: async (_args, ctx) => refreshAndReconcile(ctx),
		});
		pi.registerCommand("9router-status", {
			description: "Show 9Router catalog/provider status",
			handler: async (_args, ctx) => showStatus(ctx),
		});
	};

	const dispose = (): void => {
		lifetime.abort();
		pi.unregisterProvider(providerId);
		registeredFingerprint = undefined;
		reconciled = true;
	};

	return { manager, reconcile, registerCommands, dispose };
}

export default async function piMultiOrchestratorExtension(pi: ExtensionAPI): Promise<void> {
	const runtime = await import("@earendil-works/pi-coding-agent");
	const root = process.env.PI_MULTI_ORCH_CONFIG_ROOT ?? join(runtime.getAgentDir(), "pi-multi-orchestrator");
	const manager = createNineRouterManager(root) as PiManagerContract;
	const host = createPiHost(pi, { manager });
	try {
		await manager.loadStatus();
		const result = await host.reconcile();
		if (result.error) {
			pi.events.emit("pi-multi-orchestrator:error", { stage: "provider-reconcile", error: "9Router provider activation unavailable" });
		}
	} catch {
		// Keep commands available for repair/status even when startup storage or
		// catalog state is unavailable. No exception text can contain secrets.
		pi.events.emit("pi-multi-orchestrator:error", { stage: "provider-reconcile", error: "9Router provider activation unavailable" });
		host.dispose();
	}
	host.registerCommands();
	pi.on("session_shutdown", () => host.dispose());
}
