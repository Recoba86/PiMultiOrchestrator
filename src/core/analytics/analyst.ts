import { createHash } from "node:crypto";

import type { AnalyticsStoreAdapter } from "./index.js";

export type RecommendationAnalystMode = "deterministic" | "ai-assisted";
export type AnalystVerdict = "support" | "oppose" | "insufficient_evidence";

export interface AnalystRoute {
	readonly routeId: string;
	readonly displayName?: string;
	readonly remoteModelId?: string;
	readonly enabled?: boolean;
	readonly available?: boolean;
}

export interface AnalystPacket {
	readonly recommendationId: string;
	readonly poolId: string;
	readonly candidateRouteId: string;
	readonly currentOrder: readonly string[];
	readonly window?: { readonly from?: string; readonly to?: string };
	readonly metrics: Readonly<Record<string, unknown>>;
	readonly scoreComponents: readonly Readonly<Record<string, unknown>>[];
	readonly basis: readonly string[];
}

export interface AnalystResult {
	readonly recommendationId: string;
	readonly routeId: string;
	readonly analyzedAt: string;
	readonly inputFingerprint: string;
	readonly verdict: AnalystVerdict;
	readonly suggestedMove?: string;
	readonly reasoningFactors: readonly string[];
	readonly caveats: readonly string[];
	readonly explanation: string;
}

export interface AnalystAnalysisRecord extends AnalystResult {
	readonly stale?: boolean;
}

export interface RecommendationAnalystSettings {
	readonly mode: RecommendationAnalystMode;
	readonly routeId?: string;
}

export interface RecommendationAnalystStatus {
	readonly state: "idle" | "running" | "completed" | "failed";
	readonly mode: RecommendationAnalystMode;
	readonly routeId?: string;
	readonly lastAnalysisAt?: string;
	readonly latest?: AnalystAnalysisRecord;
	readonly message?: string;
}

export interface AnalystExecutionRequest {
	readonly routeId: string;
	readonly packet: AnalystPacket;
}

export interface RecommendationAnalystOptions {
	readonly store?: AnalyticsStoreAdapter;
	readonly routeProvider?: () => readonly AnalystRoute[] | Promise<readonly AnalystRoute[]>;
	readonly packetProvider?: (recommendationId?: string) => AnalystPacket | Promise<AnalystPacket>;
	readonly execute?: (request: AnalystExecutionRequest) => unknown | Promise<unknown>;
	readonly now?: () => string;
	readonly maxPacketBytes?: number;
}

const MAX_TEXT = 512;
const MAX_ITEMS = 16;
const MAX_PACKET_BYTES = 24_000;
const MAX_SECRET = /(?:bearer\s+|api[_-]?key|authorization|secret|token|password|private\s+key|transcript|prompt|tool[_-]?output)/iu;
const text = (value: unknown, max = MAX_TEXT): string | undefined => typeof value === "string" && value.trim().length > 0 && value.length <= max && !MAX_SECRET.test(value) ? value.trim() : undefined;
const list = (value: unknown, max = MAX_ITEMS): readonly string[] => Array.isArray(value) ? value.slice(0, max).map((item) => text(item, MAX_TEXT)).filter((item): item is string => item !== undefined) : [];
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function analystInputFingerprint(packet: AnalystPacket): string {
	return createHash("sha256").update(canonical(packet)).digest("hex");
}

export function validateAnalystPacket(value: unknown, maxBytes = MAX_PACKET_BYTES): AnalystPacket {
	if (!value || typeof value !== "object") throw new Error("invalid analyst packet");
	const input = value as Record<string, unknown>;
	const recommendationId = text(input.recommendationId, 160);
	const poolId = text(input.poolId, 64);
	const candidateRouteId = text(input.candidateRouteId, 160);
	if (!recommendationId || !poolId || !candidateRouteId) throw new Error("analyst packet identity is required");
	const packetBase = {
		recommendationId,
		poolId,
		candidateRouteId,
		currentOrder: list(input.currentOrder, 32),
		metrics: sanitizeObject(input.metrics),
		scoreComponents: Array.isArray(input.scoreComponents) ? input.scoreComponents.slice(0, MAX_ITEMS).map((item) => sanitizeObject(item)) : [],
		basis: list(input.basis),
	};
	const packet: AnalystPacket = input.window && typeof input.window === "object" ? { ...packetBase, window: input.window as { readonly from?: string; readonly to?: string } } : packetBase;
	if (Buffer.byteLength(canonical(packet), "utf8") > maxBytes) throw new Error("analyst packet exceeds bound");
	return packet;
}

function sanitizeObject(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const pairs: Array<[string, unknown]> = [];
	for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
		if (MAX_SECRET.test(key)) continue;
		if (typeof item === "number" && Number.isFinite(item)) { pairs.push([key.slice(0, 64), item]); continue; }
		if (typeof item === "boolean") { pairs.push([key.slice(0, 64), item]); continue; }
		const safe = text(item, 256);
		if (safe !== undefined) pairs.push([key.slice(0, 64), safe]);
	}
	return Object.fromEntries(pairs);
}

export function validateAnalystResult(value: unknown, request: AnalystExecutionRequest, now: string): AnalystResult {
	if (!value || typeof value !== "object") throw new Error("invalid analyst result");
	const input = value as Record<string, unknown>;
	const verdict = input.verdict;
	if (verdict !== "support" && verdict !== "oppose" && verdict !== "insufficient_evidence") throw new Error("invalid analyst verdict");
	const explanation = text(input.explanation ?? input.summary, 1_000);
	if (!explanation) throw new Error("analyst explanation is required");
	const resultBase = {
		recommendationId: request.packet.recommendationId,
		routeId: request.routeId,
		analyzedAt: now,
		inputFingerprint: analystInputFingerprint(request.packet),
		verdict: verdict as AnalystVerdict,
		reasoningFactors: list(input.reasoningFactors ?? input.factors),
		caveats: list(input.caveats ?? input.limitations),
		explanation,
	};
	const suggestedMove = text(input.suggestedMove, 160);
	const result: AnalystResult = suggestedMove ? { ...resultBase, suggestedMove } : resultBase;
	if (Buffer.byteLength(canonical(result), "utf8") > 8_000) throw new Error("analyst result exceeds bound");
	return result;
}

export class RecommendationAnalystService {
	private settings: RecommendationAnalystSettings = { mode: "deterministic" };
	private status: RecommendationAnalystStatus = { state: "idle", mode: "deterministic" };
	private readonly now: () => string;

	constructor(private readonly options: RecommendationAnalystOptions = {}) {
		this.now = options.now ?? (() => new Date().toISOString());
	}

	getSettings(): RecommendationAnalystSettings { return this.settings; }
	setSettings(settings: RecommendationAnalystSettings): RecommendationAnalystSettings {
		this.settings = { mode: settings.mode === "ai-assisted" ? "ai-assisted" : "deterministic", ...(settings.routeId ? { routeId: settings.routeId } : {}) };
		this.status = { ...this.status, mode: this.settings.mode, ...(this.settings.routeId ? { routeId: this.settings.routeId } : {}) };
		return this.settings;
	}
	getStatus(): RecommendationAnalystStatus { return this.status; }
	async listVerificationRoutes(): Promise<readonly AnalystRoute[]> { return (await this.options.routeProvider?.()) ?? []; }
	listAnalyses(): readonly AnalystAnalysisRecord[] { return this.options.store?.listAnalystAnalyses?.() ?? []; }
	isStale(record: AnalystAnalysisRecord, packet: AnalystPacket): boolean { return record.inputFingerprint !== analystInputFingerprint(packet); }

	async analyze(request: { readonly mode: RecommendationAnalystMode; readonly routeId: string; readonly packet?: AnalystPacket; readonly recommendationId?: string }): Promise<RecommendationAnalystStatus> {
		this.setSettings({ mode: request.mode, routeId: request.routeId });
		if (request.mode === "deterministic") return this.status = { ...this.status, state: "idle", message: "deterministic recommendation remains authoritative" };
		const packet = validateAnalystPacket(request.packet ?? await this.options.packetProvider?.(request.recommendationId));
		const route = (await this.listVerificationRoutes()).find((candidate) => candidate.routeId === request.routeId);
		if (!route || route.enabled === false || route.available === false) return this.status = { ...this.status, state: "failed", message: "verification analyst route unavailable" };
		if (!this.options.execute) return this.status = { ...this.status, state: "failed", message: "analyst execution is not configured" };
		this.status = { ...this.status, state: "running" };
		try {
			const result = validateAnalystResult(await this.options.execute({ routeId: request.routeId, packet }), { routeId: request.routeId, packet }, this.now());
			await this.options.store?.saveAnalystAnalysis?.(result);
			return this.status = { state: "completed", mode: request.mode, routeId: request.routeId, lastAnalysisAt: result.analyzedAt, latest: result };
		} catch {
			return this.status = { ...this.status, state: "failed", message: "analyst execution failed" };
		}
	}
}

export const createRecommendationAnalyst = (options?: RecommendationAnalystOptions): RecommendationAnalystService => new RecommendationAnalystService(options);
