import type { WorkerUsage } from "./types.js";

const MAX_OBSERVED_NUMBER = Number.MAX_SAFE_INTEGER;

/**
 * Extract only the bounded numeric fields Pi exposes on an assistant message.
 * Pi's own compaction helper ignores error/aborted and all-zero usage; M8 uses
 * the same rule so failed turns do not masquerade as measured consumption.
 *
 * Lives outside executor/session so mission-store imports (Boss usage on
 * submit_boss_decision) do not require the Pi peer at module-load time.
 */
export function extractWorkerUsage(message: unknown): WorkerUsage | undefined {
	if (!isRecord(message) || message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") return undefined;
	const raw = message.usage;
	if (!isRecord(raw)) return undefined;
	const input = boundedObservedNumber(raw.input);
	const output = boundedObservedNumber(raw.output);
	const cacheRead = boundedObservedNumber(raw.cacheRead);
	const cacheWrite = boundedObservedNumber(raw.cacheWrite);
	const cacheWrite1h = boundedObservedNumber(raw.cacheWrite1h);
	const reasoning = boundedObservedNumber(raw.reasoning);
	const totalTokens = boundedObservedNumber(raw.totalTokens);
	const cost = extractWorkerUsageCost(raw.cost);
	const tokenValues = [input, output, cacheRead, cacheWrite, cacheWrite1h, reasoning, totalTokens].filter((value): value is number => value !== undefined);
	if (!tokenValues.some((value) => value > 0)) return undefined;
	return {
		...(input === undefined ? {} : { input }),
		...(output === undefined ? {} : { output }),
		...(cacheRead === undefined ? {} : { cacheRead }),
		...(cacheWrite === undefined ? {} : { cacheWrite }),
		...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
		...(reasoning === undefined ? {} : { reasoning }),
		...(totalTokens === undefined ? {} : { totalTokens }),
		...(cost === undefined ? {} : { cost }),
	};
}

function extractWorkerUsageCost(value: unknown): WorkerUsage["cost"] {
	if (!isRecord(value)) return undefined;
	const input = boundedObservedNumber(value.input);
	const output = boundedObservedNumber(value.output);
	const cacheRead = boundedObservedNumber(value.cacheRead);
	const cacheWrite = boundedObservedNumber(value.cacheWrite);
	const total = boundedObservedNumber(value.total);
	if ([input, output, cacheRead, cacheWrite, total].every((item) => item === undefined)) return undefined;
	return {
		...(input === undefined ? {} : { input }),
		...(output === undefined ? {} : { output }),
		...(cacheRead === undefined ? {} : { cacheRead }),
		...(cacheWrite === undefined ? {} : { cacheWrite }),
		...(total === undefined ? {} : { total }),
	};
}

function boundedObservedNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_OBSERVED_NUMBER ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
