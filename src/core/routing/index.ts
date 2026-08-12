import type { DiversityPreference, StableId } from "../config/types.js";
import type { PoolId } from "../pools/index.js";

/** Infrastructure failures are deliberately separate from quality outcomes. */
export type FailureClass =
	| "quota_exhausted"
	| "rate_limited"
	| "authentication_failed"
	| "timeout"
	| "transport_error"
	| "provider_unavailable"
	| "model_unavailable"
	| "invalid_request"
	| "protocol_error"
	| "cancelled"
	| "unknown";

export type FailureAction = "RETRY_SAME_ROUTE" | "FALLBACK_NEXT_ROUTE" | "STOP";

export type DiversityMode = "none" | "prefer" | "require";

export type RouteAvailability = "available" | "missing" | "stale" | "unavailable" | "unknown";

export interface FailureInput {
	readonly status?: number;
	readonly code?: string;
	readonly category?: string;
	readonly timeout?: boolean;
	readonly cancelled?: boolean;
	readonly retryAfterMs?: number;
	readonly retryAfterAt?: string;
	/** Optional provider text is used only as an isolated heuristic and is never persisted. */
	readonly message?: string;
}

export interface FailureClassification {
	readonly class: FailureClass;
	readonly retryAfterMs?: number;
	readonly retryAfterAt?: string;
	readonly status?: number;
	readonly safeMessage: string;
}

export interface RouteHealthView {
	readonly circuit?: "unknown" | "healthy" | "degraded" | "open" | "probing";
	readonly cooldownUntil?: string;
	readonly cooldownReason?: FailureClass;
	readonly consecutiveFailures?: number;
	readonly probeInFlight?: boolean;
}

export interface RoutingCandidate {
	readonly routeId: StableId;
	readonly poolId: PoolId;
	readonly poolPosition: number;
	readonly poolEnabled: boolean;
	readonly globalEnabled: boolean;
	readonly remoteModelId: string;
	readonly resourceId?: StableId;
	readonly tags?: readonly string[];
	readonly underlyingFamily?: string;
	readonly availability?: RouteAvailability;
	readonly available?: boolean;
	readonly health?: RouteHealthView;
	readonly maxAttempts?: number;
}

export interface DiversityContext {
	readonly avoidRouteIds?: readonly StableId[];
	readonly avoidRemoteModelIds?: readonly string[];
	readonly avoidResourceIds?: readonly StableId[];
	readonly avoidTags?: readonly string[];
	readonly mode?: DiversityMode;
}

export interface RoutingPolicy {
	readonly maxAttempts: number;
	readonly timeoutMs: number;
	readonly rateLimitCooldownMs: number;
	readonly quotaCooldownMs: number;
	readonly fallback: { readonly enabled: boolean };
	readonly diversityPreference: DiversityPreference | DiversityMode;
}

export interface RoutingRequest {
	readonly poolId: PoolId;
	readonly candidates: readonly RoutingCandidate[];
	readonly policy: RoutingPolicy;
	readonly now: Date | string;
	readonly attemptedRouteIds?: readonly StableId[];
	readonly excludedRouteIds?: readonly StableId[];
	readonly diversity?: DiversityContext;
}

export interface CandidateEvaluation {
	readonly routeId: StableId;
	readonly poolPosition: number;
	readonly eligible: boolean;
	readonly reasons: readonly string[];
	readonly diversityConflict: boolean;
	readonly retryAt?: string;
}

export interface SelectedRoute {
	readonly kind: "SELECTED";
	readonly routeId: StableId;
	readonly poolId: PoolId;
	readonly poolPosition: number;
	readonly reason: string;
	readonly health: RouteHealthView | undefined;
	readonly diversityStatus: "clear" | "preferred-conflict" | "required-conflict";
	readonly evaluations: readonly CandidateEvaluation[];
}

export interface NoEligibleRoute {
	readonly kind: "NO_ELIGIBLE_ROUTE";
	readonly poolId: PoolId;
	readonly reasons: readonly CandidateEvaluation[];
	readonly earliestRetryAt?: string;
}

export type RoutingDecision = SelectedRoute | NoEligibleRoute;

export interface AttemptChain {
	readonly poolId: PoolId;
	readonly startedAt: string;
	readonly attemptedRouteIds: readonly StableId[];
	readonly retryCounts: Readonly<Record<string, number>>;
	readonly currentRouteId?: StableId;
	readonly lastFailure?: FailureClassification;
}

export interface FailureDecisionInput {
	readonly classification: FailureClassification;
	readonly retryCount: number;
	readonly maxSameRouteRetries: number;
	readonly fallbackEnabled: boolean;
}

const SAFE_MESSAGES: Record<FailureClass, string> = {
	quota_exhausted: "Provider quota exhausted",
	rate_limited: "Provider rate limited the route",
	authentication_failed: "Route authentication failed",
	timeout: "Route request timed out",
	transport_error: "Route transport failed",
	provider_unavailable: "Provider unavailable",
	model_unavailable: "Model unavailable",
	invalid_request: "Request rejected as invalid",
	protocol_error: "Provider protocol error",
	cancelled: "Request cancelled",
	unknown: "Unknown infrastructure failure",
};

const boundedRetryAfterMs = (value: number | undefined): number | undefined => {
	if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
	return Math.min(Math.trunc(value), 86_400_000);
};

const normalized = (value: string | undefined): string => value?.trim().toLocaleLowerCase().replace(/[\s-]+/gu, "_") ?? "";

/**
 * Classify only safe structured transport metadata first. Message matching is
 * a bounded fallback and never survives into health persistence.
 */
export function classifyFailure(input: FailureInput): FailureClassification {
	let failureClass: FailureClass;
	const code = normalized(input.code ?? input.category);
	const message = normalized(input.message);
	if (input.cancelled || code === "cancelled" || code === "aborted") failureClass = "cancelled";
	else if (code.includes("quota") || code === "insufficient_quota" || code === "quota_exhausted" || message.includes("quota_exhausted")) failureClass = "quota_exhausted";
	else if (code === "authentication_failed" || code === "authentication" || code === "unauthorized" || input.status === 401 || input.status === 403) failureClass = "authentication_failed";
	else if (input.timeout || code === "timeout" || code === "deadline_exceeded" || message.includes("timeout")) failureClass = "timeout";
	else if (code === "rate_limited" || code === "rate_limit" || code === "too_many_requests" || input.status === 429) failureClass = "rate_limited";
	else if (code === "model_unavailable" || code === "model_not_found") failureClass = "model_unavailable";
	else if (code === "provider_unavailable" || code === "service_unavailable" || input.status === 502 || input.status === 503 || input.status === 504) failureClass = "provider_unavailable";
	else if (code === "invalid_request" || code === "bad_request" || input.status === 400 || input.status === 422) failureClass = "invalid_request";
	else if (code === "protocol_error" || code === "malformed" || code === "decode_error") failureClass = "protocol_error";
	else if (code === "transport_error" || code === "transport" || code === "network_error" || input.status === 0) failureClass = "transport_error";
	else failureClass = "unknown";
	const retryAfterMs = boundedRetryAfterMs(input.retryAfterMs);
	return {
		class: failureClass,
		...(retryAfterMs === undefined ? {} : { retryAfterMs }),
		...(input.retryAfterAt && isIsoDate(input.retryAfterAt) ? { retryAfterAt: input.retryAfterAt } : {}),
		...(input.status === undefined ? {} : { status: input.status }),
		safeMessage: SAFE_MESSAGES[failureClass],
	};
}

export function failureMessage(failureClass: FailureClass): string {
	return SAFE_MESSAGES[failureClass];
}

export function decideFailureAction(input: FailureDecisionInput): FailureAction {
	const retryable = input.classification.class === "rate_limited" || input.classification.class === "timeout" || input.classification.class === "transport_error";
	if (retryable && input.retryCount < Math.max(0, Math.trunc(input.maxSameRouteRetries))) return "RETRY_SAME_ROUTE";
	if (input.fallbackEnabled && input.classification.class !== "cancelled" && input.classification.class !== "invalid_request" && input.classification.class !== "unknown" && input.classification.class !== "protocol_error") {
		return "FALLBACK_NEXT_ROUTE";
	}
	return "STOP";
}

export function createAttemptChain(poolId: PoolId, startedAt: Date | string): AttemptChain {
	return {
		poolId,
		startedAt: toIso(startedAt),
		attemptedRouteIds: [],
		retryCounts: {},
	};
}

export function recordAttempt(chain: AttemptChain, routeId: StableId, failure?: FailureClassification): AttemptChain {
	const attempted = chain.attemptedRouteIds.includes(routeId) ? [...chain.attemptedRouteIds] : [...chain.attemptedRouteIds, routeId];
	const retryCounts = { ...chain.retryCounts };
	if (failure !== undefined) retryCounts[routeId] = (retryCounts[routeId] ?? 0) + 1;
	return {
		...chain,
		attemptedRouteIds: attempted,
		retryCounts,
		currentRouteId: routeId,
		...(failure === undefined ? {} : { lastFailure: failure }),
	};
}

export function nextAfterFailure(
	chain: AttemptChain,
	classification: FailureClassification,
	policy: RoutingPolicy,
): FailureAction {
	// `recordAttempt` increments the failure count before this decision.  The
	// first failure therefore has zero prior retries and may consume one retry.
	const retryCount = chain.currentRouteId === undefined ? 0 : Math.max(0, (chain.retryCounts[chain.currentRouteId] ?? 1) - 1);
	return decideFailureAction({
		classification,
		retryCount,
		maxSameRouteRetries: Math.max(0, policy.maxAttempts - 1),
		fallbackEnabled: policy.fallback.enabled,
	});
}

export function selectRoute(request: RoutingRequest): RoutingDecision {
	const now = toDate(request.now);
	const attempted = new Set(request.attemptedRouteIds ?? []);
	const excluded = new Set(request.excludedRouteIds ?? []);
	const diversityMode = request.diversity?.mode ?? mapDiversity(request.policy.diversityPreference);
	const raw = [...request.candidates]
		.filter((candidate) => candidate.poolId === request.poolId)
		.sort((left, right) => left.poolPosition - right.poolPosition || left.routeId.localeCompare(right.routeId));
	const evaluations: CandidateEvaluation[] = raw.map((candidate) => evaluateCandidate(candidate, now, attempted, excluded, request.diversity, diversityMode));
	const eligible = raw
		.map((candidate, index) => ({ candidate, evaluation: evaluations[index]! }))
		.filter(({ evaluation }) => evaluation.eligible);
	const preferred = diversityMode === "prefer" ? eligible.filter(({ evaluation }) => !evaluation.diversityConflict) : eligible;
	const selected = preferred[0] ?? (diversityMode === "prefer" ? eligible[0] : undefined);
	if (selected) {
		const conflict = selected.evaluation.diversityConflict;
		return {
			kind: "SELECTED",
			routeId: selected.candidate.routeId,
			poolId: request.poolId,
			poolPosition: selected.candidate.poolPosition,
			reason: conflict ? "Highest-priority eligible route; diversity preference could not be satisfied" : "Highest-priority eligible route",
			health: selected.candidate.health,
			diversityStatus: conflict ? "preferred-conflict" : "clear",
			evaluations,
		};
	}
	const retryTimes = evaluations.flatMap((evaluation) => evaluation.retryAt ? [evaluation.retryAt] : []);
	const earliestRetryAt = retryTimes.sort()[0];
	return {
		kind: "NO_ELIGIBLE_ROUTE",
		poolId: request.poolId,
		reasons: evaluations,
		...(earliestRetryAt === undefined ? {} : { earliestRetryAt }),
	};
}

export const previewRouting = selectRoute;

function evaluateCandidate(
	candidate: RoutingCandidate,
	now: Date,
	attempted: ReadonlySet<StableId>,
	excluded: ReadonlySet<StableId>,
	diversity: DiversityContext | undefined,
	diversityMode: DiversityMode,
): CandidateEvaluation {
	const reasons: string[] = [];
	if (!candidate.poolEnabled) reasons.push("pool entry disabled");
	if (!candidate.globalEnabled) reasons.push("route globally disabled");
	if (candidate.availability === "missing") reasons.push("route missing remotely");
	// A stale last-known-good catalog is still usable; its age is surfaced by
	// the host, while a positively missing route is hard-ineligible.
	else if (candidate.availability === "unavailable" || candidate.available === false) reasons.push("route unavailable");
	else if (candidate.availability === "unknown") reasons.push("route availability unknown");
	if (attempted.has(candidate.routeId)) reasons.push("route already attempted");
	if (excluded.has(candidate.routeId)) reasons.push("route explicitly excluded");
	const cooldownUntil = candidate.health?.cooldownUntil;
	const blockedByCooldown = cooldownUntil !== undefined && isFuture(cooldownUntil, now);
	if (blockedByCooldown) reasons.push(`cooldown until ${cooldownUntil}`);
	if (candidate.health?.probeInFlight) reasons.push("health probe already in flight");
	const diversityConflict = hasDiversityConflict(candidate, diversity);
	if (diversityConflict && diversityMode === "require") reasons.push("required diversity conflict");
	const hardUnavailable = reasons.length > 0;
	return {
		routeId: candidate.routeId,
		poolPosition: candidate.poolPosition,
		eligible: !hardUnavailable,
		reasons,
		diversityConflict,
		...(blockedByCooldown ? { retryAt: cooldownUntil } : {}),
	};
}

function hasDiversityConflict(candidate: RoutingCandidate, diversity: DiversityContext | undefined): boolean {
	if (!diversity) return false;
	if (diversity.avoidRouteIds?.includes(candidate.routeId)) return true;
	if (diversity.avoidRemoteModelIds?.includes(candidate.remoteModelId)) return true;
	if (candidate.resourceId !== undefined && diversity.avoidResourceIds?.includes(candidate.resourceId)) return true;
	if (candidate.tags && diversity.avoidTags?.some((tag) => candidate.tags?.includes(tag))) return true;
	return false;
}

function mapDiversity(value: DiversityPreference | DiversityMode): DiversityMode {
	if (value === "none") return "none";
	return value.startsWith("require") ? "require" : "prefer";
}

function isFuture(value: string, now: Date): boolean {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && parsed > now.getTime();
}

function toDate(value: Date | string): Date {
	const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (!Number.isFinite(date.getTime())) throw new TypeError("Routing time must be a valid date");
	return date;
}

function toIso(value: Date | string): string {
	return toDate(value).toISOString();
}

function isIsoDate(value: string): boolean {
	return Number.isFinite(Date.parse(value));
}
