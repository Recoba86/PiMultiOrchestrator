import type { StableId } from "../core/config/types.js";
import {
	bossRouteProbeFromError,
	evaluateBossVisibleTextProbe,
	type BossRouteProbeResult,
} from "../core/mission/boss-response.js";
import type { PiManagerContract, PiProviderRegistry } from "./pi-extension.js";
import { resolveHostRoute } from "./pi-extension.js";

export const PREFERRED_BOSS_PROBE_REMOTE = "ag/gemini-3.7-flash-high";
export const HISTORICAL_BOSS_INCOMPATIBLE_REMOTES = [
	"Tabi/claude-opus-5-thinking",
	"cu/cursor-grok-4.6-high",
] as const;

const PROBE_SYSTEM_PROMPT = "You are a connectivity probe. Reply with one short visible assistant text word. Do not call tools. Do not hide the answer in thinking.";
const PROBE_USER_PROMPT = "Reply with exactly the word PONG and nothing else.";
const PROBE_TIMEOUT_MS = 60_000;

export interface BossRouteProbeCandidate {
	readonly routeId: string;
	readonly remoteModelId: string;
	readonly reason: "preferred" | "extra";
}

export function selectBossRouteProbeCandidates(input: {
	readonly enabledRoutes: readonly { readonly routeId: string; readonly remoteModelId: string }[];
	readonly preferredRemoteModelId?: string;
	readonly preferRouteIds?: readonly string[];
	readonly historicalIncompatibleRemotes?: readonly string[];
	readonly maxExtra?: number;
}): readonly BossRouteProbeCandidate[] {
	const preferredRemote = input.preferredRemoteModelId ?? PREFERRED_BOSS_PROBE_REMOTE;
	const historical = new Set(input.historicalIncompatibleRemotes ?? HISTORICAL_BOSS_INCOMPATIBLE_REMOTES);
	const maxExtra = input.maxExtra ?? 2;
	const byId = new Map(input.enabledRoutes.map((route) => [route.routeId, route]));
	const selected: BossRouteProbeCandidate[] = [];
	const seen = new Set<string>();
	const push = (route: { readonly routeId: string; readonly remoteModelId: string }, reason: BossRouteProbeCandidate["reason"]): void => {
		if (seen.has(route.routeId)) return;
		seen.add(route.routeId);
		selected.push({ routeId: route.routeId, remoteModelId: route.remoteModelId, reason });
	};
	const preferred = input.enabledRoutes.find((route) => route.remoteModelId === preferredRemote);
	if (preferred) push(preferred, "preferred");
	const extras = [
		...(input.preferRouteIds ?? []).map((routeId) => byId.get(routeId)).filter((route): route is NonNullable<typeof route> => route !== undefined),
		...input.enabledRoutes,
	].filter((route) => route.remoteModelId !== preferredRemote && !historical.has(route.remoteModelId));
	for (const route of extras) {
		if (selected.filter((item) => item.reason === "extra").length >= maxExtra) break;
		push(route, "extra");
	}
	return selected;
}

/** One bounded completeSimple call on the same host route runtime used by invokeBossInference. Does not touch MissionStore. */
export async function probeBossRouteVisibleText(
	manager: PiManagerContract,
	providerRegistry: PiProviderRegistry | undefined,
	routeId: StableId,
): Promise<BossRouteProbeResult> {
	const started = Date.now();
	const identity = { routeId };
	let route: Awaited<ReturnType<typeof resolveHostRoute>>;
	try {
		route = await resolveHostRoute(manager, routeId, providerRegistry);
	} catch {
		return {
			routeId,
			success: false,
			failureClass: "model_unavailable",
			code: "route_unavailable",
			hasText: false,
			textLength: 0,
			elapsedMs: Date.now() - started,
		};
	}
	const resolved = { routeId, remoteModelId: route.remoteModelId };
	const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
	try {
		const response = await route.modelRuntime.completeSimple(route.model, {
			systemPrompt: PROBE_SYSTEM_PROMPT,
			messages: [{ role: "user", content: PROBE_USER_PROMPT, timestamp: Date.now() }],
		}, { signal });
		return evaluateBossVisibleTextProbe(response, resolved, Date.now() - started);
	} catch (error) {
		return bossRouteProbeFromError(error, resolved, Date.now() - started);
	}
}
