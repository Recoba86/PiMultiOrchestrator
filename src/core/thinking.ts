/** PMO's safe, user-facing thinking policy. `auto` deliberately omits the
 * Pi override and lets Pi/model/provider defaults apply. */
export const THINKING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ExplicitThinkingEffort = (typeof THINKING_EFFORTS)[number];
export type ThinkingEffort = "auto" | ExplicitThinkingEffort;
export type EffectiveThinkingEffort = ThinkingEffort | "unknown";
export type ThinkingSupport = "supported" | "not-supported" | "unknown";

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingLevelMap = Partial<Record<PiThinkingLevel, string | null>>;

export interface ThinkingModelMetadata {
	readonly reasoning?: boolean;
	readonly thinkingLevelMap?: ThinkingLevelMap;
}

export function thinkingSupport(model: ThinkingModelMetadata): ThinkingSupport {
	return model.reasoning === true ? "supported" : model.reasoning === false ? "not-supported" : "unknown";
}

/** Match Pi's supported-level rules for the PMO levels we expose. */
export function supportedThinkingEfforts(model: ThinkingModelMetadata): readonly ExplicitThinkingEffort[] {
	if (model.reasoning !== true) return [];
	return THINKING_EFFORTS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		return level === "xhigh" || level === "max" ? mapped !== undefined : true;
	});
}

export function isSupportedThinkingEffort(model: ThinkingModelMetadata, effort: ThinkingEffort): boolean {
	return effort === "auto" || supportedThinkingEfforts(model).includes(effort as ExplicitThinkingEffort);
}

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
	return value === "auto" || THINKING_EFFORTS.includes(value as ExplicitThinkingEffort);
}

export function normalizeThinkingEffort(value: unknown): ThinkingEffort {
	return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" ? value : "auto";
}

export function thinkingEffortLabel(effort: ThinkingEffort | "unknown"): string {
	if (effort === "unknown") return "Unknown/provider default";
	if (effort === "auto") return "Auto";
	return effort === "xhigh" ? "XHigh" : effort[0]!.toUpperCase() + effort.slice(1);
}
