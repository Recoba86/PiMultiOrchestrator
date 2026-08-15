import { selectBossEntry, type BossRouteCandidate } from "./boss.js";
import type { StableId } from "../config/types.js";

export const UNCONFIGURED_BOSS_DISPLAY_NAME = "Unconfigured Boss";
export const CONFIGURED_DEFAULT_BOSS_DISPLAY_NAME = "Default Boss";

export interface BossProfileViewRoute {
	readonly routeId: string;
	readonly label: string;
	readonly thinkingLabel: string;
	readonly enabled: boolean;
	readonly available: boolean;
	readonly weight: number;
	readonly unavailableReason?: string;
}

export function bossProfilePublicName(displayName: string, configuredCount: number): string {
	if (configuredCount > 0 && displayName.trim() === UNCONFIGURED_BOSS_DISPLAY_NAME) return CONFIGURED_DEFAULT_BOSS_DISPLAY_NAME;
	return displayName;
}

export function formatBossProfileOverview(input: {
	readonly displayName: string;
	readonly enabled: boolean;
	readonly profileId: string;
	readonly routes: readonly BossProfileViewRoute[];
	readonly editorRouteId?: string;
}): { readonly lines: readonly string[]; readonly summary: string } {
	const routes = input.routes;
	const positiveTotal = routes.reduce((sum, route) => sum + (route.enabled && route.weight > 0 ? route.weight : 0), 0);
	const share = (weight: number): number => positiveTotal > 0 && weight > 0 ? Math.round((weight / positiveTotal) * 1000) / 10 : 0;
	const schedulingCandidates: BossRouteCandidate[] = routes.flatMap((route) => route.enabled && route.available && route.weight > 0
		? [{ routeId: route.routeId as StableId, enabled: true, weight: route.weight, thinkingEffort: "auto" as const, remoteModelId: route.label }]
		: []);
	const scheduled = selectBossEntry(schedulingCandidates, input.profileId);
	const scheduledRoute = scheduled === undefined ? undefined : routes.find((route) => route.routeId === scheduled.routeId);
	const editorRoute = routes.find((route) => route.routeId === input.editorRouteId) ?? routes[0];
	const routeLine = (route: BossProfileViewRoute): string => {
		const eligibility = [
			route.enabled && route.available && route.weight > 0 ? "scheduling-eligible" : undefined,
			route.enabled && route.available ? "fallback-eligible" : undefined,
			route.enabled ? undefined : "disabled",
			route.available ? undefined : route.unavailableReason ?? "unavailable",
		].filter((item): item is string => item !== undefined);
		return `${route.label} — ${route.thinkingLabel} — weight ${route.weight} — share ${share(route.weight)}% — ${eligibility.join(" — ")}`;
	};
	const describe = (route: BossProfileViewRoute | undefined, empty: string): string => {
		if (route === undefined) return empty;
		return `${route.label} (weight ${route.weight}, share ${share(route.weight)}%)`;
	};
	const status = [
		input.enabled ? "Enabled" : "Disabled",
		routes.length === 0 ? "Unconfigured" : scheduledRoute === undefined ? "No scheduled Boss" : undefined,
		routes.length > 0 && routes.every((route) => !route.available) ? "Unavailable" : undefined,
	].filter((item): item is string => item !== undefined);
	const lines = [
		`profile: ${bossProfilePublicName(input.displayName, routes.length)}`,
		`scheduled Boss: ${describe(scheduledRoute, "none (no positive-weight eligible route)")}`,
		`editor selection: ${editorRoute === undefined ? "none" : `${editorRoute.label}${scheduledRoute !== undefined && editorRoute.routeId === scheduledRoute.routeId ? "" : " (not the scheduled Boss)"}`}`,
		`status: ${status.join(" / ")}`,
		...(routes.length > 0 ? ["routes:", ...routes.map(routeLine)] : ["routes: none"]),
	];
	return { lines, summary: lines.join("\n") };
}
