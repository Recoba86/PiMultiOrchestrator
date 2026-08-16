import { join } from "node:path";

import { ModelRuntime as RuntimeModelRuntime } from "@earendil-works/pi-coding-agent";

import type { StableId } from "../core/config/types.js";
import { ConfigStore } from "../core/config/store.js";
import { createNineRouterManager, EnvSecretResolver } from "../core/ninerouter/index.js";
import {
	PREFERRED_BOSS_PROBE_REMOTE,
	probeBossRouteVisibleText,
	selectBossRouteProbeCandidates,
} from "./boss-route-probe.js";
import type { PiProviderRegistry } from "./pi-extension.js";

const dummyCredentials = {
	read: async () => undefined,
	list: async () => [],
	modify: async (_provider: string, fn: (current: undefined) => Promise<undefined>) => fn(undefined),
	delete: async () => undefined,
} as never;

const createCatalogRegistry = async (agentDir: string): Promise<PiProviderRegistry> => {
	const providerProbe = await RuntimeModelRuntime.create({
		modelsPath: join(agentDir, "models.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
		credentials: dummyCredentials,
	});
	return {
		getProvider: (providerId) => providerProbe.getProvider(providerId),
		getAvailableModels: (providerId) => providerProbe.getModels(providerId),
		refresh: (options) => providerProbe.refresh(options),
	};
};

const main = async (): Promise<void> => {
	const runtime = await import("@earendil-works/pi-coding-agent");
	const root = process.env.PI_MULTI_ORCH_CONFIG_ROOT ?? join(runtime.getAgentDir(), "pi-multi-orchestrator");
	const configStore = new ConfigStore({ root });
	const manager = createNineRouterManager(root, configStore, new EnvSecretResolver());
	const loaded = await configStore.load();
	const config = loaded.snapshot?.config;
	if (!config) {
		console.log(JSON.stringify({ blocked: true, reason: "config_unavailable", results: [] }));
		process.exitCode = 2;
		return;
	}
	const projection = await manager.providerProjection();
	const projected = new Set((projection?.models ?? []).map((model) => model.routeId));
	const enabledRoutes = Object.values(config.routes)
		.filter((route) => route.enabled && projected.has(route.id))
		.map((route) => ({ routeId: route.id, remoteModelId: route.remoteModelId }));
	const investigation = config.pools.investigation?.entries?.filter((entry) => entry.enabled).map((entry) => entry.routeId) ?? [];
	const candidates = selectBossRouteProbeCandidates({
		enabledRoutes,
		preferredRemoteModelId: PREFERRED_BOSS_PROBE_REMOTE,
		preferRouteIds: investigation,
	});
	const providerRegistry = await createCatalogRegistry(runtime.getAgentDir()).catch(() => undefined);
	const results = [];
	for (const candidate of candidates) {
		const result = await probeBossRouteVisibleText(manager, providerRegistry, candidate.routeId as StableId);
		results.push({ ...result, reason: candidate.reason });
		if (result.success) break;
		if (candidate.reason === "preferred") continue;
		if (results.filter((item) => item.reason === "extra").length >= 2) break;
	}
	const passed = results.find((item) => item.success);
	const payload = {
		blocked: passed === undefined,
		preferredRemoteModelId: PREFERRED_BOSS_PROBE_REMOTE,
		selectedRouteId: passed?.routeId,
		selectedRemoteModelId: passed?.remoteModelId,
		results,
	};
	console.log(JSON.stringify(payload));
	if (passed === undefined) process.exitCode = 2;
};

await main();
