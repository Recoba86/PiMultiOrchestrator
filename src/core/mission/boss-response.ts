import { classifyFailure, type FailureClass } from "../routing/index.js";
import { extractWorkerUsage } from "../workers/executor.js";
import { BossInfrastructureError, BossProtocolError, normalizeBossDecision, type BossDecision } from "./boss.js";

export type BossInvocationStage = "route-resolution" | "capability" | "request" | "response" | "decision-protocol";
export type BossResponseFailureClass = FailureClass | "empty_response" | "truncated" | "unsupported_shape" | "decision_protocol";

export interface BossInvocationDiagnostic {
	readonly stage: BossInvocationStage;
	readonly failureClass: BossResponseFailureClass;
	readonly hasText: boolean;
	readonly normalized: boolean;
	readonly stopReason?: string;
	readonly code?: string;
	readonly status?: number;
	readonly routeId?: string;
	readonly remoteModelId?: string;
	readonly fallbackAttempted?: boolean;
	readonly fallbackSelectedRouteId?: string;
	readonly textBlocks?: number;
	readonly thinkingBlocks?: number;
}

export type PiStopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

const USABLE_STOP_REASONS = new Set<string>(["stop", "length", "toolUse"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const boundedCode = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : undefined;
const boundedId = (value: unknown, max: number): string | undefined => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

const cancelError = (message = "Boss inference was cancelled"): Error => {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
};

export function attachBossDiagnostic<T extends Error>(error: T, diagnostic: BossInvocationDiagnostic): T & { readonly diagnostic: BossInvocationDiagnostic } {
	Object.defineProperty(error, "diagnostic", { value: diagnostic, enumerable: true });
	return error as T & { readonly diagnostic: BossInvocationDiagnostic };
}

export function sanitizeBossInvocationDiagnostic(value: unknown): BossInvocationDiagnostic | undefined {
	if (!isRecord(value) || typeof value.stage !== "string" || typeof value.failureClass !== "string") return undefined;
	const code = boundedCode(value.code);
	const routeId = boundedId(value.routeId, 128);
	const remoteModelId = boundedId(value.remoteModelId, 240);
	const fallbackSelectedRouteId = boundedId(value.fallbackSelectedRouteId, 128);
	const count = (key: "textBlocks" | "thinkingBlocks"): number | undefined => {
		const raw = value[key];
		return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= 1_024 ? raw : undefined;
	};
	const textBlocks = count("textBlocks");
	const thinkingBlocks = count("thinkingBlocks");
	return {
		stage: value.stage as BossInvocationStage,
		failureClass: value.failureClass as BossResponseFailureClass,
		hasText: value.hasText === true,
		normalized: value.normalized === true,
		...(typeof value.stopReason === "string" ? { stopReason: value.stopReason.slice(0, 32) } : {}),
		...(code === undefined ? {} : { code }),
		...(typeof value.status === "number" && Number.isSafeInteger(value.status) ? { status: value.status } : {}),
		...(routeId === undefined ? {} : { routeId }),
		...(remoteModelId === undefined ? {} : { remoteModelId }),
		...(value.fallbackAttempted === undefined ? {} : { fallbackAttempted: value.fallbackAttempted === true }),
		...(fallbackSelectedRouteId === undefined ? {} : { fallbackSelectedRouteId }),
		...(textBlocks === undefined ? {} : { textBlocks }),
		...(thinkingBlocks === undefined ? {} : { thinkingBlocks }),
	};
}

export function bossInvocationDiagnostic(error: unknown): BossInvocationDiagnostic | undefined {
	if (!error || typeof error !== "object" || !("diagnostic" in error)) return undefined;
	return sanitizeBossInvocationDiagnostic((error as { diagnostic?: unknown }).diagnostic);
}

const withDiagnostic = (error: BossInfrastructureError | BossProtocolError, diagnostic: BossInvocationDiagnostic): BossInfrastructureError | BossProtocolError =>
	attachBossDiagnostic(error, diagnostic);

export const BOSS_DECISION_TOOL_NAME = "submit_boss_decision";

export const BOSS_DECISION_TOOL_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["action", "summary", "tasks"],
	properties: {
		action: {
			type: "string",
			enum: ["dispatch", "replan", "complete", "blocked", "awaiting_user"],
			description: "The primary orchestrator action for this cycle",
		},
		summary: {
			type: "string",
			minLength: 1,
			description: "One bounded sentence summarizing why this action was chosen",
		},
		tasks: {
			type: "array",
			description: "Array of bounded tasks to execute for dispatch or replan",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["roleId", "executionClass", "objective"],
				properties: {
					taskId: { type: "string", description: "Stable task ID if repairing an existing task" },
					roleId: { type: "string", minLength: 1, description: "Role that will execute this task" },
					executionClass: { type: "string", enum: ["investigation", "implementation", "verification"] },
					poolId: { type: "string", enum: ["investigation", "implementation", "verification"] },
					objective: { type: "string", minLength: 1, description: "Specific bounded task objective" },
					acceptanceCriteria: { type: "array", items: { type: "string" }, description: "Specific verifiable criteria" },
				},
			},
		},
		acceptanceSatisfied: { type: "boolean", description: "Set true only when complete and all criteria are verified" },
		requiredFixes: { type: "array", items: { type: "string" }, description: "Specific fixes required on replan" },
	},
} as const;

export interface BossDecisionToolDeclaration {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>;
	readonly constrainedSampling?: { readonly type: "json_schema"; readonly strict: "prefer" | "require" };
}

export function createBossDecisionTool(): BossDecisionToolDeclaration {
	return {
		name: BOSS_DECISION_TOOL_NAME,
		description: "Submit the canonical Boss orchestrator decision for this Mission cycle. Capture-only control-plane tool; performs no filesystem, network, shell, or Mission mutation.",
		parameters: BOSS_DECISION_TOOL_SCHEMA as unknown as Record<string, unknown>,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
	};
}

export function extractBossAssistantText(content: unknown): { readonly text: string; readonly textBlocks: number; readonly thinkingBlocks: number; readonly toolCalls: number; readonly decisionToolCall?: Record<string, unknown> } {
	if (!Array.isArray(content)) return { text: "", textBlocks: 0, thinkingBlocks: 0, toolCalls: 0 };
	let textBlocks = 0;
	let thinkingBlocks = 0;
	let toolCalls = 0;
	let decisionToolCall: Record<string, unknown> | undefined;
	const parts: string[] = [];
	for (const block of content) {
		if (!isRecord(block) || typeof block.type !== "string") continue;
		if (block.type === "thinking") {
			thinkingBlocks += 1;
			continue;
		}
		if (block.type === "toolCall") {
			toolCalls += 1;
			if (block.name === BOSS_DECISION_TOOL_NAME && isRecord(block.arguments)) {
				decisionToolCall ??= block.arguments as Record<string, unknown>;
			}
			continue;
		}
		if (block.type === "text" && typeof block.text === "string") {
			textBlocks += 1;
			parts.push(block.text);
		}
	}
	return {
		text: parts.join("\n").trim(),
		textBlocks,
		thinkingBlocks,
		toolCalls,
		...(decisionToolCall === undefined ? {} : { decisionToolCall }),
	};
}

const tokenUsageFromResponse = (response: unknown): BossDecision["tokenUsage"] => {
	const usage = extractWorkerUsage(response);
	if (usage === undefined) return undefined;
	return {
		...(usage.input === undefined ? {} : { inputTokens: usage.input }),
		...(usage.output === undefined ? {} : { outputTokens: usage.output }),
		...(usage.cacheRead === undefined ? {} : { cacheReadTokens: usage.cacheRead }),
		...(usage.cacheWrite === undefined ? {} : { cacheWriteTokens: usage.cacheWrite }),
		...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
		...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
		provenance: "observed",
	};
};

const parseDecisionText = (raw: string, phase: "plan" | "evaluate" | undefined, tokenUsage: BossDecision["tokenUsage"]): BossDecision => {
	const withUsage = (value: BossDecision): BossDecision => tokenUsage === undefined ? value : { ...value, tokenUsage };
	const candidates = [raw, raw.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")];
	for (const candidate of candidates) {
		try {
			return withUsage(normalizeBossDecision(JSON.parse(candidate), phase === undefined ? {} : { phase }));
		} catch (error) {
			if (error instanceof BossProtocolError) throw error;
		}
	}
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start >= 0 && end > start) {
		try {
			return withUsage(normalizeBossDecision(JSON.parse(raw.slice(start, end + 1)), phase === undefined ? {} : { phase }));
		} catch (error) {
			if (error instanceof BossProtocolError) throw error;
		}
	}
	throw new BossProtocolError("Boss provider returned malformed JSON");
};

const requestStatus = (error: unknown, message: string): number | undefined => {
	const record = isRecord(error) ? error : {};
	if (typeof record.status === "number" && Number.isSafeInteger(record.status)) return record.status;
	if (typeof record.statusCode === "number" && Number.isSafeInteger(record.statusCode)) return record.statusCode;
	if (/\b401\b|\bunauthorized\b|\bauthentication/iu.test(message)) return 401;
	if (/\b403\b/u.test(message)) return 403;
	if (/\b429\b/u.test(message)) return 429;
	if (/\b502\b|\b503\b|\b504\b/u.test(message)) return 503;
	return undefined;
};

export function classifyBossRequestFailure(error: unknown): { readonly failureClass: FailureClass; readonly code?: string; readonly status?: number } {
	const record = isRecord(error) ? error : {};
	const message = error instanceof Error ? error.message.slice(0, 240) : "";
	const code = typeof record.code === "string" ? record.code : error instanceof Error ? error.name : undefined;
	const status = requestStatus(error, message);
	const classified = classifyFailure({
		message,
		cancelled: false,
		...(code === undefined ? {} : { code }),
		...(status === undefined ? {} : { status }),
	});
	return {
		failureClass: classified.class === "unknown" ? "transport_error" : classified.class,
		...(classified.status === undefined ? {} : { status: classified.status }),
		code: classified.class === "unknown" ? "transport_error" : classified.class,
	};
}

export function bossInfrastructureError(message: string, diagnostic: BossInvocationDiagnostic): BossInfrastructureError {
	return withDiagnostic(new BossInfrastructureError(message), diagnostic) as BossInfrastructureError;
}

export function bossProtocolError(message: string, diagnostic: BossInvocationDiagnostic): BossProtocolError {
	return withDiagnostic(new BossProtocolError(message), diagnostic) as BossProtocolError;
}

export function wrapBossRequestFailure(error: unknown, identity: { readonly routeId?: string; readonly remoteModelId?: string } = {}): never {
	const classified = classifyBossRequestFailure(error);
	throw bossInfrastructureError(`Boss request failed: ${classified.failureClass}`, {
		stage: "request",
		failureClass: classified.failureClass,
		hasText: false,
		normalized: false,
		...(classified.code === undefined ? {} : { code: classified.code }),
		...(classified.status === undefined ? {} : { status: classified.status }),
		...(identity.routeId === undefined ? {} : { routeId: identity.routeId }),
		...(identity.remoteModelId === undefined ? {} : { remoteModelId: identity.remoteModelId }),
	});
}

const isRefusalMessage = (value: unknown): boolean =>
	typeof value === "string" && /refus(?:al|ed)|content.?filter|safety.?filter/iu.test(value);

export function parseBossAssistantResponse(
	response: unknown,
	options: { readonly signal?: AbortSignal; readonly phase?: "plan" | "evaluate"; readonly routeId?: string; readonly remoteModelId?: string } = {},
): BossDecision {
	if (options.signal?.aborted) throw cancelError();
	const identity = {
		...(options.routeId === undefined ? {} : { routeId: options.routeId }),
		...(options.remoteModelId === undefined ? {} : { remoteModelId: options.remoteModelId }),
	};
	if (!isRecord(response)) {
		throw bossProtocolError("Boss response contained no assistant text", {
			stage: "response",
			failureClass: "unsupported_shape",
			hasText: false,
			normalized: false,
			...identity,
		});
	}
	const stopReason = typeof response.stopReason === "string" ? response.stopReason : undefined;
	if (stopReason === "aborted") throw cancelError();
	const extracted = extractBossAssistantText(response.content);
	const base = {
		hasText: extracted.text.length > 0,
		normalized: false,
		textBlocks: extracted.textBlocks,
		thinkingBlocks: extracted.thinkingBlocks,
		...(stopReason === undefined ? {} : { stopReason: stopReason.slice(0, 32) }),
		...identity,
	};
	if (stopReason === "error") {
		const providerText = typeof response.errorMessage === "string" ? response.errorMessage : typeof response.rawStopReason === "string" ? response.rawStopReason : "";
		if (isRefusalMessage(providerText)) {
			throw bossProtocolError("Boss provider refused the orchestration request", {
				stage: "response",
				failureClass: "invalid_request",
				code: "refusal",
				...base,
			});
		}
		const status = requestStatus(response, providerText);
		const classified = classifyFailure({
			message: providerText.slice(0, 240),
			...(typeof response.rawStopReason === "string" ? { code: response.rawStopReason.slice(0, 64) } : {}),
			...(status === undefined ? {} : { status }),
		});
		const failureClass = classified.class === "unknown" ? "provider_unavailable" : classified.class;
		throw bossInfrastructureError(`Boss request failed: ${failureClass}`, {
			stage: "response",
			failureClass,
			code: failureClass,
			...(classified.status === undefined ? {} : { status: classified.status }),
			...base,
		});
	}
	if (stopReason === "pending" || stopReason === "deferred") {
		throw bossInfrastructureError("Boss provider did not complete the orchestration response", {
			stage: "response",
			failureClass: "provider_unavailable",
			code: stopReason,
			...base,
		});
	}
	const tokenUsage = tokenUsageFromResponse(response);
	if (extracted.decisionToolCall !== undefined) {
		try {
			const normalized = normalizeBossDecision(extracted.decisionToolCall, options.phase === undefined ? {} : { phase: options.phase });
			return tokenUsage === undefined ? normalized : { ...normalized, tokenUsage };
		} catch (error) {
			if (error instanceof BossProtocolError) {
				throw withDiagnostic(error, {
					stage: "decision-protocol",
					failureClass: "decision_protocol",
					hasText: true,
					normalized: false,
					code: "decision_protocol",
					...(stopReason === undefined ? {} : { stopReason }),
					...identity,
				});
			}
			throw error;
		}
	}
	if (stopReason !== undefined && !USABLE_STOP_REASONS.has(stopReason) && !extracted.text) {
		throw bossInfrastructureError("Boss response used an unsupported completion shape", {
			stage: "response",
			failureClass: "unsupported_shape",
			...base,
		});
	}
	if (!extracted.text) {
		if (stopReason === "length") {
			throw bossProtocolError("Boss response ended: max_tokens with no complete decision", {
				stage: "response",
				failureClass: "truncated",
				code: "max_tokens",
				...base,
			});
		}
		if (stopReason === "toolUse") {
			throw bossInfrastructureError("Boss response used an unsupported completion shape", {
				stage: "response",
				failureClass: "unsupported_shape",
				...base,
			});
		}
		throw bossInfrastructureError("Boss response contained no assistant text", {
			stage: "response",
			failureClass: "empty_response",
			...base,
		});
	}
	try {
		return parseDecisionText(extracted.text, options.phase, tokenUsage);
	} catch (error) {
		if (error instanceof BossProtocolError) {
			if (stopReason === "length" && error.message === "Boss provider returned malformed JSON") {
				throw bossProtocolError("Boss response ended: max_tokens with no complete decision", {
					stage: "response",
					failureClass: "truncated",
					code: "max_tokens",
					hasText: true,
					normalized: false,
					stopReason,
					...identity,
				});
			}
			throw withDiagnostic(error, {
				stage: "decision-protocol",
				failureClass: "decision_protocol",
				hasText: true,
				normalized: false,
				code: "decision_protocol",
				...(stopReason === undefined ? {} : { stopReason }),
				...identity,
			});
		}
		throw error;
	}
}

export interface BossRouteProbeResult {
	readonly routeId: string;
	readonly remoteModelId?: string;
	readonly success: boolean;
	readonly failureClass?: string;
	readonly code?: string;
	readonly status?: number;
	readonly stopReason?: string;
	readonly hasText: boolean;
	readonly textLength: number;
	readonly elapsedMs: number;
}

const probeIdentity = (identity: { readonly routeId: string; readonly remoteModelId?: string }): Pick<BossRouteProbeResult, "routeId" | "remoteModelId"> => ({
	routeId: identity.routeId,
	...(identity.remoteModelId === undefined ? {} : { remoteModelId: identity.remoteModelId }),
});

/** Classify a live completeSimple result for visible-text Boss compatibility. Never returns assistant text. */
export function evaluateBossVisibleTextProbe(
	response: unknown,
	identity: { readonly routeId: string; readonly remoteModelId?: string },
	elapsedMs: number,
): BossRouteProbeResult {
	const elapsed = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : 0;
	const base = { ...probeIdentity(identity), elapsedMs: elapsed };
	if (!isRecord(response)) {
		return { ...base, success: false, failureClass: "unsupported_shape", hasText: false, textLength: 0 };
	}
	const stopReason = typeof response.stopReason === "string" ? response.stopReason.slice(0, 32) : undefined;
	const extracted = extractBossAssistantText(response.content);
	const hasText = extracted.text.length > 0;
	const textLength = extracted.text.length;
	if (stopReason === "error" || stopReason === "aborted" || stopReason === "pending" || stopReason === "deferred") {
		return {
			...base,
			success: false,
			failureClass: stopReason === "error" ? "provider_unavailable" : stopReason === "aborted" ? "cancelled" : "provider_unavailable",
			code: stopReason,
			...(stopReason === undefined ? {} : { stopReason }),
			hasText,
			textLength,
		};
	}
	if (!hasText) {
		return {
			...base,
			success: false,
			failureClass: stopReason === "length" ? "truncated" : "empty_response",
			code: stopReason === "length" ? "max_tokens" : "empty_response",
			...(stopReason === undefined ? {} : { stopReason }),
			hasText: false,
			textLength: 0,
		};
	}
	const usable = stopReason === undefined || stopReason === "stop" || stopReason === "length";
	return {
		...base,
		success: usable,
		...(usable ? {} : { failureClass: "unsupported_shape", code: stopReason }),
		...(stopReason === undefined ? {} : { stopReason }),
		hasText: true,
		textLength,
	};
}

export function bossRouteProbeFromError(
	error: unknown,
	identity: { readonly routeId: string; readonly remoteModelId?: string },
	elapsedMs: number,
): BossRouteProbeResult {
	const elapsed = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : 0;
	try {
		if (!(error instanceof BossInfrastructureError) && !(error instanceof BossProtocolError)) wrapBossRequestFailure(error, identity);
		throw error;
	} catch (wrapped) {
		const diagnostic = bossInvocationDiagnostic(wrapped);
		const remoteModelId = identity.remoteModelId ?? diagnostic?.remoteModelId;
		return {
			...probeIdentity({ routeId: identity.routeId, ...(remoteModelId === undefined ? {} : { remoteModelId }) }),
			success: false,
			failureClass: diagnostic?.failureClass ?? "transport_error",
			...(diagnostic?.code === undefined ? {} : { code: diagnostic.code }),
			...(diagnostic?.status === undefined ? {} : { status: diagnostic.status }),
			...(diagnostic?.stopReason === undefined ? {} : { stopReason: diagnostic.stopReason }),
			hasText: diagnostic?.hasText === true,
			textLength: 0,
			elapsedMs: elapsed,
		};
	}
}
