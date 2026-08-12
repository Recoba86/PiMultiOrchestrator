import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const ANALYTICS_SCHEMA_VERSION = 1 as const;
export const ANALYTICS_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS analytics_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS analytics_events_time_idx ON analytics_events(occurred_at,event_type);
CREATE TABLE IF NOT EXISTS analytics_recommendations (
  recommendation_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS analytics_analyst_results (
  analysis_id TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  route_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL
) STRICT;
`;
export const AnalyticsSchemaV1 = ANALYTICS_SCHEMA_V1;

export type AnalyticsClassification = "observed" | "provider_reported" | "pi_runtime_reported" | "configured" | "estimated" | "unavailable" | "unknown";
export type AnalyticsEventType =
  | "run"
  | "attempt"
  | "fallback"
  | "quality"
  | "route"
  | "config"
  | "recommendation"
  | "custom";

export interface AnalyticsTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
  readonly provenance?: AnalyticsClassification;
}

export interface AnalyticsCost {
  readonly amountMicros?: number;
  readonly currency?: string;
  readonly provenance: AnalyticsClassification;
  readonly formulaVersion?: string;
  readonly kind?: "actual" | "equivalent" | "avoided";
  readonly billingMode?: "metered_api" | "subscription" | "free" | "unknown";
}

export interface ReferencePricingV1 {
  readonly currency: string;
  readonly inputMicrosPerMillion?: number;
  readonly outputMicrosPerMillion?: number;
  readonly cacheReadMicrosPerMillion?: number;
  readonly cacheWriteMicrosPerMillion?: number;
  readonly label?: string;
}

export interface ReferenceCostEstimate {
  readonly equivalent?: AnalyticsCost;
  readonly avoided?: AnalyticsCost;
}

export interface AnalyticsEventV1 {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly eventType: AnalyticsEventType;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly attemptId?: string;
  readonly verificationId?: string;
  readonly qualityRound?: number;
  readonly roleId?: string;
  readonly poolId?: string;
  readonly routeId?: string;
  readonly remoteModelId?: string;
  readonly gatewayId?: string;
  readonly sourceLabel?: string;
  readonly resourceClass?: string;
  readonly resourceId?: string;
  readonly durationMs?: number;
  readonly outcome?: string;
  readonly failureClass?: string;
  readonly fallbackFromRouteId?: string;
  readonly fallbackToRouteId?: string;
  readonly qualityOutcome?: string;
  readonly firstPass?: boolean;
  readonly repairRound?: number;
  readonly tokenUsage?: AnalyticsTokenUsage;
  readonly cost?: AnalyticsCost;
  readonly dimensions?: Readonly<Record<string, string | number | boolean>>;
}

export interface AnalyticsRange { readonly from?: string; readonly to?: string; }
export interface AnalyticsSummary {
  readonly from?: string;
  readonly to?: string;
  readonly eventCount: number;
  readonly runs: number;
  readonly attempts: number;
  readonly successes: number;
  readonly failures: number;
  readonly fallbacks: number;
  readonly qualityPasses: number;
  readonly qualityRejects: number;
  readonly qualityBlocked: number;
  readonly firstPassSuccesses: number;
  readonly repairRounds: number;
  readonly durationMs: number;
  readonly tokens: { readonly input?: number; readonly output?: number; readonly cacheRead?: number; readonly cacheWrite?: number; readonly reasoning?: number; readonly total?: number };
  readonly unknownTokenAttempts: number;
  readonly actualCostMicros?: number;
  readonly estimatedCostMicros?: number;
  readonly avoidedCostMicros?: number;
  readonly unknownCostEvents: number;
  readonly byPool: Readonly<Record<string, { readonly runs: number; readonly successes: number; readonly failures: number; readonly fallbacks: number; readonly tokens: number; readonly durationMs: number }>>;
  readonly byRoute: Readonly<Record<string, { readonly runs: number; readonly successes: number; readonly failures: number; readonly fallbacks: number; readonly tokens: number; readonly durationMs: number }>>;
  readonly byMission?: Readonly<Record<string, { readonly runs: number; readonly successes: number; readonly failures: number; readonly fallbacks: number; readonly tokens: number; readonly durationMs: number }>>;
  readonly byRole?: Readonly<Record<string, { readonly runs: number; readonly successes: number; readonly failures: number; readonly fallbacks: number; readonly tokens: number; readonly durationMs: number }>>;
  readonly byPoolRoute: Readonly<Record<string, { readonly poolId: string; readonly routeId: string; readonly runs: number; readonly successes: number; readonly failures: number; readonly fallbacks: number; readonly tokens: number; readonly durationMs: number }>>;
  readonly fallbackTransitions?: Readonly<Record<string, { readonly fromRouteId: string; readonly toRouteId: string; readonly failureClass?: string; readonly count: number }>>;
  readonly qualityByPool: Readonly<Record<string, { readonly observations: number; readonly passes: number; readonly rejects: number; readonly blocked: number; readonly firstPass: number; readonly repairRounds: number }>>;
  readonly qualityByRoute: Readonly<Record<string, { readonly observations: number; readonly passes: number; readonly rejects: number; readonly blocked: number; readonly firstPass: number; readonly repairRounds: number }>>;
  readonly costByCurrency: Readonly<Record<string, { readonly actualMicros?: number; readonly estimatedMicros?: number; readonly avoidedMicros?: number }>>;
}

export interface AnalyticsRecommendation {
  readonly recommendationId: string;
  readonly poolId: string;
  readonly proposedRouteId: string;
  readonly baselineRouteId?: string;
  readonly sampleSize: number;
  readonly from?: string;
  readonly to?: string;
  readonly score: number;
  readonly formulaVersion: string;
  readonly evidence: readonly string[];
  readonly limitations: readonly string[];
  readonly proposedDiff: Readonly<Record<string, unknown>>;
  readonly status: "proposed" | "ignored" | "applied";
}

export interface AnalyticsStoreAdapter {
  readonly enabled: boolean;
  append(event: AnalyticsEventV1): Promise<boolean> | boolean;
  list(range?: AnalyticsRange): readonly AnalyticsEventV1[];
  summary(range?: AnalyticsRange): AnalyticsSummary;
  saveRecommendation(recommendation: AnalyticsRecommendation): Promise<void> | void;
  listRecommendations(): readonly AnalyticsRecommendation[];
  updateRecommendationStatus?(recommendationId: string, status: AnalyticsRecommendation["status"]): boolean;
  saveAnalystAnalysis?(analysis: import("./analyst.js").AnalystAnalysisRecord): Promise<void> | void;
  listAnalystAnalyses?(): readonly import("./analyst.js").AnalystAnalysisRecord[];
  close?(): void;
}
export type AnalyticsStore = AnalyticsStoreAdapter;

export interface RecommendationPoolManager {
  getPool(poolId: string): Promise<{ readonly poolId: string; readonly entries: readonly { readonly routeId: string; readonly index: number }[] }> | { readonly poolId: string; readonly entries: readonly { readonly routeId: string; readonly index: number }[] };
  moveRoute(poolId: string, routeId: string, targetIndex: number): Promise<unknown> | unknown;
}

export class RecommendationApplicationService {
  constructor(private readonly store: AnalyticsStoreAdapter, private readonly pools: RecommendationPoolManager) {}

  async apply(recommendationId: string): Promise<"applied" | "stale" | "unavailable"> {
    const recommendation = this.store.listRecommendations().find((item) => item.recommendationId === recommendationId);
    if (!recommendation || recommendation.status !== "proposed") return "unavailable";
    const pool = await this.pools.getPool(recommendation.poolId);
    const entry = pool.entries.find((item) => item.routeId === recommendation.proposedRouteId);
    const baseline = recommendation.proposedDiff.baselineOrder;
    if (!entry || !Array.isArray(baseline) || baseline.length !== pool.entries.length || baseline.some((routeId, index) => routeId !== pool.entries[index]?.routeId)) return "stale";
    if (!this.store.updateRecommendationStatus) return "unavailable";
    if (entry.index !== 0) await this.pools.moveRoute(pool.poolId, entry.routeId, 0);
    return this.store.updateRecommendationStatus(recommendationId, "applied") ? "applied" : "unavailable";
  }

  ignore(recommendationId: string): boolean {
    return this.store.updateRecommendationStatus?.(recommendationId, "ignored") ?? false;
  }
}

export interface AnalyticsSink { record(event: AnalyticsEventV1): Promise<void> | void; }

const noop = (): void => undefined;
export class NoopAnalyticsSink implements AnalyticsSink {
  record(_event: AnalyticsEventV1): void { noop(); }
}

const bounded = (value: unknown, max = 512): string | undefined => typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
const secretLike = (value: string): boolean => /(?:bearer\s+[a-z0-9._-]{8,}|(?:api[_-]?key|authorization|token)\s*[:=]\s*\S+|sk-[a-z0-9]{16,}|begin (?:rsa|openSSH|ec) private key)/iu.test(value);
const safeText = (value: unknown, max = 512): string | undefined => { const text = bounded(value, max); return text && !secretLike(text) ? text : undefined; };
const numberValue = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
const boolValue = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;

export function estimateReferenceCost(usage: AnalyticsTokenUsage, pricing: ReferencePricingV1, billingMode: "metered_api" | "subscription" | "free" | "unknown" = "metered_api"): ReferenceCostEstimate {
  if (usage.provenance !== "observed" && usage.provenance !== "provider_reported" && usage.provenance !== "pi_runtime_reported") return {};
  const currency = pricing.currency.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{2,11}$/u.test(currency)) return {};
  const fields: readonly [number | undefined, number | undefined][] = [
    [usage.inputTokens, pricing.inputMicrosPerMillion],
    [usage.outputTokens, pricing.outputMicrosPerMillion],
    [usage.cacheReadTokens, pricing.cacheReadMicrosPerMillion],
    [usage.cacheWriteTokens, pricing.cacheWriteMicrosPerMillion],
  ];
  if (!fields.some(([tokens]) => tokens !== undefined) || fields.some(([tokens, rate]) => tokens !== undefined && (rate === undefined || !Number.isFinite(rate) || rate < 0))) return {};
  const amountMicros = Math.round(fields.reduce((total, [tokens, rate]) => total + (tokens ?? 0) * (rate ?? 0), 0) / 1_000_000);
  const equivalent: AnalyticsCost = { amountMicros, currency, provenance: "estimated", formulaVersion: "reference-pricing-v1", kind: "equivalent", billingMode: "metered_api" };
  return { equivalent, ...(billingMode === "subscription" || billingMode === "free" ? { avoided: { ...equivalent, kind: "avoided", billingMode } } : {}) };
}
const EVENT_TYPES: readonly AnalyticsEventType[] = ["run", "attempt", "fallback", "quality", "route", "config", "recommendation", "custom"];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isAnalyticsEvent = (value: unknown): value is AnalyticsEventV1 => isRecord(value) && typeof value.eventId === "string" && typeof value.occurredAt === "string" && !Number.isNaN(Date.parse(value.occurredAt)) && typeof value.eventType === "string" && EVENT_TYPES.includes(value.eventType as AnalyticsEventType);
const safeJson = (event: AnalyticsEventV1): string => JSON.stringify({
  eventId: safeText(event.eventId, 160), occurredAt: safeText(event.occurredAt, 64), eventType: event.eventType,
  missionId: safeText(event.missionId), taskId: safeText(event.taskId), runId: safeText(event.runId), attemptId: safeText(event.attemptId), verificationId: safeText(event.verificationId),
  qualityRound: numberValue(event.qualityRound), roleId: safeText(event.roleId), poolId: safeText(event.poolId), routeId: safeText(event.routeId), remoteModelId: safeText(event.remoteModelId), gatewayId: safeText(event.gatewayId), sourceLabel: safeText(event.sourceLabel), resourceClass: safeText(event.resourceClass), resourceId: safeText(event.resourceId), durationMs: numberValue(event.durationMs), outcome: safeText(event.outcome), failureClass: safeText(event.failureClass), fallbackFromRouteId: safeText(event.fallbackFromRouteId), fallbackToRouteId: safeText(event.fallbackToRouteId), qualityOutcome: safeText(event.qualityOutcome), firstPass: boolValue(event.firstPass), repairRound: numberValue(event.repairRound),
  tokenUsage: event.tokenUsage ? { inputTokens: numberValue(event.tokenUsage.inputTokens), outputTokens: numberValue(event.tokenUsage.outputTokens), cacheReadTokens: numberValue(event.tokenUsage.cacheReadTokens), cacheWriteTokens: numberValue(event.tokenUsage.cacheWriteTokens), reasoningTokens: numberValue(event.tokenUsage.reasoningTokens), totalTokens: numberValue(event.tokenUsage.totalTokens), provenance: event.tokenUsage.provenance } : undefined,
  cost: event.cost ? { amountMicros: numberValue(event.cost.amountMicros), currency: safeText(event.cost.currency, 12), provenance: event.cost.provenance, formulaVersion: safeText(event.cost.formulaVersion, 64), kind: event.cost.kind, billingMode: event.cost.billingMode } : undefined,
  dimensions: event.dimensions ? Object.fromEntries(Object.entries(event.dimensions).slice(0, 32).filter(([key]) => !/(?:prompt|transcript|source|secret|auth|header|content|output|argument|result|private|key)/iu.test(key)).map(([key, value]) => [safeText(key, 64), typeof value === "string" ? safeText(value, 128) : numberValue(value) ?? boolValue(value)])) : undefined,
});

const parseEvent = (value: unknown): AnalyticsEventV1 | undefined => {
  if (typeof value !== "string") return undefined;
  try { const parsed: unknown = JSON.parse(value); return isAnalyticsEvent(parsed) ? JSON.parse(safeJson(parsed)) as AnalyticsEventV1 : undefined; } catch { return undefined; }
};

const safeRecommendation = (recommendation: AnalyticsRecommendation): AnalyticsRecommendation => {
  const proposedDiff = Object.fromEntries(Object.entries(recommendation.proposedDiff).slice(0, 32).filter(([key]) => !/(?:prompt|transcript|source|secret|auth|header|content|output|argument|result|private|key)/iu.test(key)).map(([key, value]) => [safeText(key, 64), Array.isArray(value) ? value.slice(0, 32).map((item) => typeof item === "string" ? safeText(item, 128) : numberValue(item) ?? boolValue(item)).filter((item) => item !== undefined) : typeof value === "string" ? safeText(value, 128) : numberValue(value) ?? boolValue(value)]));
  const baselineRouteId = safeText(recommendation.baselineRouteId, 64);
  return { ...recommendation, recommendationId: safeText(recommendation.recommendationId, 160) ?? "invalid", poolId: safeText(recommendation.poolId, 64) ?? "invalid", proposedRouteId: safeText(recommendation.proposedRouteId, 64) ?? "invalid", ...(baselineRouteId === undefined ? {} : { baselineRouteId }), evidence: recommendation.evidence.slice(0, 16).map((item) => safeText(item, 256)).filter((item): item is string => item !== undefined), limitations: recommendation.limitations.slice(0, 16).map((item) => safeText(item, 256)).filter((item): item is string => item !== undefined), proposedDiff };
};

export class SQLiteAnalyticsStore implements AnalyticsStoreAdapter, AnalyticsSink {
  readonly enabled: boolean;
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(options: { readonly root: string; readonly enabled?: boolean; readonly databasePath?: string }) {
    this.enabled = options.enabled !== false;
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    const path = options.databasePath ?? join(options.root, "analytics.sqlite");
    this.db = new DatabaseSync(path);
    const hadEventsTable = this.db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='analytics_events'").get() as { present?: number } | undefined;
    const previousSchema = hadEventsTable?.present
      ? this.db.prepare("SELECT value FROM analytics_meta WHERE key='schema_version'").get() as { value?: string } | undefined
      : undefined;
    if (hadEventsTable?.present && !previousSchema) {
      this.db.close();
      throw new Error("analytics schema metadata is missing");
    }
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;" + ANALYTICS_SCHEMA_V1);
    const existing = previousSchema ?? this.db.prepare("SELECT value FROM analytics_meta WHERE key='schema_version'").get() as { value?: string } | undefined;
    if (existing?.value !== undefined && Number(existing.value) !== ANALYTICS_SCHEMA_VERSION) {
      this.db.close();
      throw new Error("unsupported analytics schema version");
    }
    this.db.prepare("INSERT OR IGNORE INTO analytics_meta(key,value) VALUES ('schema_version',?)").run(String(ANALYTICS_SCHEMA_VERSION));
    try { chmodSync(path, 0o600); } catch { /* best effort */ }
  }
  record(event: AnalyticsEventV1): void { this.append(event); }
  append(event: AnalyticsEventV1): boolean {
    if (!this.enabled || this.closed) return false;
    if (!isAnalyticsEvent(event)) return false;
    const eventId = safeText(event.eventId, 160); if (!eventId) return false;
    const occurredAt = safeText(event.occurredAt, 64); if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) return false;
    try { const result = this.db.prepare("INSERT OR IGNORE INTO analytics_events(event_id,occurred_at,event_type,payload_json) VALUES (?,?,?,?)").run(eventId, occurredAt, event.eventType, safeJson(event)); return Number(result.changes) === 1; } catch { return false; }
  }
  list(range?: AnalyticsRange): readonly AnalyticsEventV1[] {
    if (this.closed) return [];
    const from = range?.from ?? "0000-01-01T00:00:00.000Z"; const to = range?.to ?? "9999-12-31T23:59:59.999Z";
    return (this.db.prepare("SELECT payload_json FROM analytics_events WHERE occurred_at>=? AND occurred_at<=? ORDER BY occurred_at,event_id").all(from, to) as Array<{ payload_json: string }>).map((row) => parseEvent(row.payload_json)).filter((event): event is AnalyticsEventV1 => event !== undefined);
  }
  summary(range?: AnalyticsRange): AnalyticsSummary { return summarize(this.list(range), range); }
  saveRecommendation(recommendation: AnalyticsRecommendation): void {
    if (!this.enabled || this.closed) return;
    const safe = safeRecommendation(recommendation); if (safe.recommendationId === "invalid") return;
    this.db.prepare("INSERT OR IGNORE INTO analytics_recommendations(recommendation_id,created_at,status,payload_json) VALUES (?,?,?,?)").run(safe.recommendationId, new Date().toISOString(), safe.status, JSON.stringify(safe));
  }
  listRecommendations(): readonly AnalyticsRecommendation[] { if (this.closed) return []; return (this.db.prepare("SELECT payload_json FROM analytics_recommendations ORDER BY created_at,recommendation_id").all() as Array<{ payload_json: string }>).flatMap((row) => { try { return [JSON.parse(row.payload_json) as AnalyticsRecommendation]; } catch { return []; } }); }
  updateRecommendationStatus(recommendationId: string, status: AnalyticsRecommendation["status"]): boolean { if (this.closed) return false; const row = this.db.prepare("SELECT payload_json FROM analytics_recommendations WHERE recommendation_id=?").get(recommendationId) as { payload_json?: string } | undefined; if (!row?.payload_json) return false; try { const payload = { ...(JSON.parse(row.payload_json) as AnalyticsRecommendation), status }; const result = this.db.prepare("UPDATE analytics_recommendations SET status=?,payload_json=? WHERE recommendation_id=?").run(status, JSON.stringify(payload), recommendationId); return Number(result.changes) > 0; } catch { return false; } }
  saveAnalystAnalysis(analysis: import("./analyst.js").AnalystAnalysisRecord): void { if (!this.enabled || this.closed) return; const payload = JSON.stringify(analysis); const analysisId = `${analysis.recommendationId}:${analysis.routeId}:${analysis.inputFingerprint}`; this.db.prepare("INSERT OR IGNORE INTO analytics_analyst_results(analysis_id,recommendation_id,analyzed_at,route_id,input_fingerprint,payload_json) VALUES (?,?,?,?,?,?)").run(analysisId, analysis.recommendationId, analysis.analyzedAt, analysis.routeId, analysis.inputFingerprint, payload); }
  listAnalystAnalyses(): readonly import("./analyst.js").AnalystAnalysisRecord[] { if (this.closed) return []; return (this.db.prepare("SELECT payload_json FROM analytics_analyst_results ORDER BY analyzed_at,analysis_id").all() as Array<{ payload_json: string }>).flatMap((row) => { try { const value: unknown = JSON.parse(row.payload_json); return value && typeof value === "object" ? [value as import("./analyst.js").AnalystAnalysisRecord] : []; } catch { return []; } }); }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}

export class PersistentAnalyticsSink implements AnalyticsSink {
  constructor(private readonly store: AnalyticsStoreAdapter) {}
  record(event: AnalyticsEventV1): void { try { const result = this.store.append(event); if (result && typeof (result as Promise<boolean>).then === "function") void (result as Promise<boolean>).catch(() => undefined); } catch { /* analytics is non-critical */ } }
}

export class AnalyticsQueryService {
  constructor(private readonly store: AnalyticsStoreAdapter) {}
  overview(range?: AnalyticsRange): AnalyticsSummary { return this.store.summary(range); }
  events(range?: AnalyticsRange): readonly AnalyticsEventV1[] { return this.store.list(range); }
  recommendations(): readonly AnalyticsRecommendation[] { return this.store.listRecommendations(); }
  routePerformance(range?: AnalyticsRange): AnalyticsSummary["byRoute"] { return this.store.summary(range).byRoute; }
  poolPerformance(range?: AnalyticsRange): AnalyticsSummary["byPool"] { return this.store.summary(range).byPool; }
  missionPerformance(range?: AnalyticsRange): AnalyticsSummary["byMission"] { return this.store.summary(range).byMission; }
  tokenSummary(range?: AnalyticsRange): AnalyticsSummary["tokens"] { return this.store.summary(range).tokens; }
  costSummary(range?: AnalyticsRange): { readonly actualCostMicros?: number; readonly estimatedCostMicros?: number; readonly avoidedCostMicros?: number; readonly unknownCostEvents: number; readonly costByCurrency: AnalyticsSummary["costByCurrency"] } { const summary = this.store.summary(range); return { ...(summary.actualCostMicros === undefined ? {} : { actualCostMicros: summary.actualCostMicros }), ...(summary.estimatedCostMicros === undefined ? {} : { estimatedCostMicros: summary.estimatedCostMicros }), ...(summary.avoidedCostMicros === undefined ? {} : { avoidedCostMicros: summary.avoidedCostMicros }), unknownCostEvents: summary.unknownCostEvents, costByCurrency: summary.costByCurrency }; }
  qualitySummary(range?: AnalyticsRange): Pick<AnalyticsSummary, "qualityPasses" | "qualityRejects" | "qualityBlocked" | "firstPassSuccesses" | "repairRounds" | "qualityByPool" | "qualityByRoute"> { const summary = this.store.summary(range); return { qualityPasses: summary.qualityPasses, qualityRejects: summary.qualityRejects, qualityBlocked: summary.qualityBlocked, firstPassSuccesses: summary.firstPassSuccesses, repairRounds: summary.repairRounds, qualityByPool: summary.qualityByPool, qualityByRoute: summary.qualityByRoute }; }
  fallbackSummary(range?: AnalyticsRange): { readonly fallbacks: number; readonly fallbackTransitions?: AnalyticsSummary["fallbackTransitions"] } { const summary = this.store.summary(range); return { fallbacks: summary.fallbacks, ...(summary.fallbackTransitions === undefined ? {} : { fallbackTransitions: summary.fallbackTransitions }) }; }
}

export class ScoreEngine {
  static score(summary: AnalyticsSummary, poolId: string): { readonly poolId: string; readonly qualityScore?: number; readonly valueScore?: number; readonly sampleSize: number; readonly state: "ready" | "insufficient-data"; readonly components: readonly { readonly name: string; readonly rawValue?: number; readonly weight: number; readonly contribution?: number; readonly provenance: AnalyticsClassification }[]; readonly explanation: readonly string[] } {
    const bucket = summary.byPool[poolId]; if (!bucket || bucket.runs < 10) return { poolId, sampleSize: bucket?.runs ?? 0, state: "insufficient-data", components: [], explanation: ["at least 10 observed route samples are required"] };
    const success = bucket.successes / Math.max(1, bucket.runs); const quality = summary.qualityByPool?.[poolId]; const qualityRatio = quality && quality.observations > 0 ? quality.passes / quality.observations : undefined; const latencySeconds = bucket.durationMs / Math.max(1, bucket.runs) / 1000; const qualityScore = qualityRatio === undefined ? undefined : Math.round(qualityRatio * 1000) / 10; const valueScore = Math.round((success * 1000 - latencySeconds) * 10) / 10;
    return { poolId, ...(qualityScore === undefined ? {} : { qualityScore }), valueScore, sampleSize: bucket.runs, state: "ready", components: [{ name: "infrastructure reliability", rawValue: success, weight: 1, contribution: success, provenance: "observed" }, ...(qualityRatio === undefined ? [{ name: "quality review", weight: 0, provenance: "unknown" as const }] : [{ name: "quality review", rawValue: qualityRatio, weight: 1, contribution: qualityRatio, provenance: "observed" as const }]), { name: "average latency seconds", rawValue: latencySeconds, weight: -1, contribution: -latencySeconds, provenance: "observed" }], explanation: ["quality uses durable quality decisions when present; otherwise it is unavailable", "value = infrastructure reliability minus average latency seconds"] };
  }
}

export class RecommendationEngine {
  constructor(private readonly minimumSamples = 10) {}
  generate(summary: AnalyticsSummary, poolId: string, options: { readonly currentOrder?: readonly string[]; readonly range?: AnalyticsRange } = {}): AnalyticsRecommendation | undefined {
    const bucket = summary.byPool[poolId]; if (!bucket || bucket.runs < this.minimumSamples) return undefined;
    const currentOrder = options.currentOrder;
    const routes = Object.values(summary.byPoolRoute).filter((value) => value.poolId === poolId && value.runs >= this.minimumSamples && (currentOrder === undefined || currentOrder.includes(value.routeId))).sort((a, b) => (b.successes / b.runs) - (a.successes / a.runs) || a.routeId.localeCompare(b.routeId));
    const best = routes[0]; if (!best) return undefined;
    const currentIndex = currentOrder?.indexOf(best.routeId) ?? -1;
    if (currentOrder && currentIndex === 0) return undefined;
    const baselineRouteId = currentOrder?.[0];
    const from = summary.from ?? options.range?.from;
    const to = summary.to ?? options.range?.to;
    const proposedDiff = { poolId, routeId: best.routeId, ...(baselineRouteId === undefined ? {} : { currentPosition: currentIndex + 1, suggestedPosition: 1, baselineOrder: [...(currentOrder ?? [])] }) };
    const recommendationId = `rec-${createHash("sha256").update(`${poolId}:${best.routeId}:${baselineRouteId ?? ""}:${summary.from ?? options.range?.from ?? ""}:${summary.to ?? options.range?.to ?? ""}`).digest("hex").slice(0, 16)}`;
    return { recommendationId, poolId, proposedRouteId: best.routeId, ...(baselineRouteId === undefined ? {} : { baselineRouteId }), sampleSize: best.runs, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), score: best.successes / best.runs, formulaVersion: "quality-v1", evidence: [`${best.successes}/${best.runs} successful runs on ${best.routeId}`, ...(baselineRouteId === undefined ? [] : [`baseline ${baselineRouteId} at priority ${currentIndex + 1}`])], limitations: ["correlation is not causation", "recommendation does not inspect billing or live quota"], proposedDiff, status: "proposed" };
  }
}

export const summarize = (events: readonly AnalyticsEventV1[], range?: AnalyticsRange): AnalyticsSummary => {
  let runs = 0, attempts = 0, successes = 0, failures = 0, fallbacks = 0, qualityPasses = 0, qualityRejects = 0, qualityBlocked = 0, firstPassSuccesses = 0, repairRounds = 0, durationMs = 0, unknownCostEvents = 0, unknownTokenAttempts = 0;
  const tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; total?: number } = {};
  const byPool: Record<string, { runs: number; successes: number; failures: number; fallbacks: number; tokens: number; durationMs: number }> = {};
  const byRoute: Record<string, { runs: number; successes: number; failures: number; fallbacks: number; tokens: number; durationMs: number }> = {};
  const byMission: Record<string, { runs: number; successes: number; failures: number; fallbacks: number; tokens: number; durationMs: number }> = {};
  const byRole: Record<string, { runs: number; successes: number; failures: number; fallbacks: number; tokens: number; durationMs: number }> = {};
  const byPoolRoute: Record<string, { poolId: string; routeId: string; runs: number; successes: number; failures: number; fallbacks: number; tokens: number; durationMs: number }> = {};
  const fallbackTransitions: Record<string, { fromRouteId: string; toRouteId: string; failureClass?: string; count: number }> = {};
  const qualityByPool: Record<string, { observations: number; passes: number; rejects: number; blocked: number; firstPass: number; repairRounds: number }> = {};
  const qualityByRoute: Record<string, { observations: number; passes: number; rejects: number; blocked: number; firstPass: number; repairRounds: number }> = {};
  const costByCurrency: Record<string, { actualMicros?: number; estimatedMicros?: number; avoidedMicros?: number }> = {};
  let actualCostMicros = 0, estimatedCostMicros = 0, avoidedCostMicros = 0; let hasActual = false, hasEstimate = false, hasAvoided = false;
  const attemptRuns = new Set(events.filter((event) => event.eventType === "attempt" && event.runId).map((event) => event.runId));
  const isCanonicalSample = (event: AnalyticsEventV1): boolean => event.eventType === "attempt" || (event.eventType === "run" && (!event.runId || !attemptRuns.has(event.runId)));
  const successful = (event: AnalyticsEventV1): boolean => event.outcome === "success" || event.outcome === "completed";
  const failed = (event: AnalyticsEventV1): boolean => ["failure", "failed", "infrastructure_failure", "child_runtime_error", "timed_out", "cancelled", "invalid_child_result", "protocol_violation"].includes(event.outcome ?? "");
  const addBucket = (target: Record<string, { runs: number; successes: number; failures: number; fallbacks: number; tokens: number; durationMs: number }>, id: string, event: AnalyticsEventV1): void => {
    const bucket = target[id] ??= { runs: 0, successes: 0, failures: 0, fallbacks: 0, tokens: 0, durationMs: 0 };
    if (isCanonicalSample(event)) {
      bucket.runs++;
      if (successful(event)) bucket.successes++;
      if (failed(event)) bucket.failures++;
      bucket.tokens += event.tokenUsage?.totalTokens ?? 0;
      bucket.durationMs += event.durationMs ?? 0;
    }
    if (event.eventType === "fallback") bucket.fallbacks++;
  };
  for (const event of events) {
    if (event.eventType === "run") runs++; if (event.eventType === "attempt") attempts++; if (event.eventType === "fallback") fallbacks++;
    if (event.eventType === "run" && successful(event)) successes++; if (event.eventType === "run" && failed(event)) failures++;
    if (event.qualityOutcome === "pass") qualityPasses++; if (event.qualityOutcome === "reject") qualityRejects++; if (event.qualityOutcome === "blocked") qualityBlocked++; if (event.firstPass === true) firstPassSuccesses++; repairRounds += event.repairRound ?? 0; if (isCanonicalSample(event)) durationMs += event.durationMs ?? 0;
    if (event.qualityOutcome && event.poolId) { const bucket = qualityByPool[event.poolId] ??= { observations: 0, passes: 0, rejects: 0, blocked: 0, firstPass: 0, repairRounds: 0 }; bucket.observations++; if (event.qualityOutcome === "pass") bucket.passes++; if (event.qualityOutcome === "reject") bucket.rejects++; if (event.qualityOutcome === "blocked") bucket.blocked++; if (event.firstPass === true) bucket.firstPass++; bucket.repairRounds += event.repairRound ?? 0; }
    if (event.qualityOutcome && event.routeId) { const bucket = qualityByRoute[event.routeId] ??= { observations: 0, passes: 0, rejects: 0, blocked: 0, firstPass: 0, repairRounds: 0 }; bucket.observations++; if (event.qualityOutcome === "pass") bucket.passes++; if (event.qualityOutcome === "reject") bucket.rejects++; if (event.qualityOutcome === "blocked") bucket.blocked++; if (event.firstPass === true) bucket.firstPass++; bucket.repairRounds += event.repairRound ?? 0; }
    const usage = isCanonicalSample(event) ? event.tokenUsage : undefined;
    if (isCanonicalSample(event) && usage === undefined) unknownTokenAttempts++;
    if (usage) { for (const [key, value] of [["input", usage.inputTokens], ["output", usage.outputTokens], ["cacheRead", usage.cacheReadTokens], ["cacheWrite", usage.cacheWriteTokens], ["reasoning", usage.reasoningTokens], ["total", usage.totalTokens]] as const) if (value !== undefined) tokens[key] = (tokens[key] ?? 0) + value; }
    if (event.poolId) addBucket(byPool, event.poolId, event);
    if (event.routeId) addBucket(byRoute, event.routeId, event);
    if (event.missionId) addBucket(byMission, event.missionId, event);
    if (event.roleId) addBucket(byRole, event.roleId, event);
    if (event.eventType === "fallback" && event.fallbackFromRouteId && event.fallbackToRouteId) {
      const key = `${event.fallbackFromRouteId}->${event.fallbackToRouteId}:${event.failureClass ?? "unknown"}`;
      const transition = fallbackTransitions[key] ??= { fromRouteId: event.fallbackFromRouteId, toRouteId: event.fallbackToRouteId, ...(event.failureClass === undefined ? {} : { failureClass: event.failureClass }), count: 0 };
      transition.count++;
    }
    if (event.poolId && event.routeId) { const key = `${event.poolId}:${event.routeId}`; const bucket = byPoolRoute[key] ??= { poolId: event.poolId, routeId: event.routeId, runs: 0, successes: 0, failures: 0, fallbacks: 0, tokens: 0, durationMs: 0 }; if (isCanonicalSample(event)) { bucket.runs++; if (successful(event)) bucket.successes++; if (failed(event)) bucket.failures++; bucket.tokens += event.tokenUsage?.totalTokens ?? 0; bucket.durationMs += event.durationMs ?? 0; } if (event.eventType === "fallback") bucket.fallbacks++; }
    if (event.cost) { const amount = event.cost.amountMicros; const currency = event.cost.currency?.trim().toUpperCase(); if (amount === undefined || event.cost.provenance === "unknown" || event.cost.provenance === "unavailable" || !currency) unknownCostEvents++; else { const c = costByCurrency[currency] ??= {}; if (event.cost.kind === "actual" && (event.cost.provenance === "observed" || event.cost.provenance === "provider_reported")) { actualCostMicros += amount; hasActual = true; c.actualMicros = (c.actualMicros ?? 0) + amount; } else if (event.cost.kind === "avoided" && (event.cost.provenance === "estimated" || event.cost.provenance === "configured")) { avoidedCostMicros += amount; hasAvoided = true; c.avoidedMicros = (c.avoidedMicros ?? 0) + amount; } else if ((event.cost.kind === "equivalent" || event.cost.provenance === "estimated" || event.cost.provenance === "configured") && event.cost.kind !== "actual") { estimatedCostMicros += amount; hasEstimate = true; c.estimatedMicros = (c.estimatedMicros ?? 0) + amount; } else unknownCostEvents++; } } else if (isCanonicalSample(event)) unknownCostEvents++;
  }
  const currencies = Object.keys(costByCurrency);
  return { ...(range?.from ? { from: range.from } : {}), ...(range?.to ? { to: range.to } : {}), eventCount: events.length, runs, attempts, successes, failures, fallbacks, qualityPasses, qualityRejects, qualityBlocked, firstPassSuccesses, repairRounds, durationMs, tokens, unknownTokenAttempts, ...(hasActual && currencies.length <= 1 ? { actualCostMicros } : {}), ...(hasEstimate && currencies.length <= 1 ? { estimatedCostMicros } : {}), ...(hasAvoided && currencies.length <= 1 ? { avoidedCostMicros } : {}), unknownCostEvents, byPool, byRoute, byMission, byRole, byPoolRoute, fallbackTransitions, qualityByPool, qualityByRoute, costByCurrency };
};

export { AnalyticsQueryService as AnalyticsService };
export * from "./analyst.js";
