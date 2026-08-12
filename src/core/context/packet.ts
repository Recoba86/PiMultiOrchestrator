import { createHash } from "node:crypto";

import { deterministicJson } from "../config/serialize.js";
import type { ExecutionClass } from "../config/types.js";
import type { PoolId } from "../pools/index.js";
import type { SubagentExecutionRequest } from "../workers/types.js";
import {
	TASK_PACKET_VERSION,
	type BuildTaskPacketInput,
	type ContextBrokerLimits,
	type ContextJson,
	type PacketCanonicalItem,
	type TaskPacketV1,
} from "./types.js";

const SENSITIVE_KEY = /(?:secret|password|token|api[_-]?key|authorization|credential|private[_-]?key|cookie|transcript|conversation|chat[_-]?history|messages?)/iu;
const MAX_PACKET_ID_LENGTH = 128;

export type PacketErrorCode = "invalid-packet" | "invalid-json" | "digest-mismatch";

export class TaskPacketError extends Error {
	readonly code: PacketErrorCode;

	constructor(code: PacketErrorCode, message: string) {
		super(message);
		this.name = "TaskPacketError";
		this.code = code;
	}
}

/**
 * Convert unknown repository values into bounded, secret-free JSON.  The
 * Context Broker owns this boundary so callers never pass live object graphs
 * or arbitrary class instances into a child prompt.
 */
export function toContextJson(value: unknown, seen = new WeakSet<object>()): ContextJson {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TaskPacketError("invalid-json", "Context contains a non-finite number");
		return value;
	}
	if (typeof value === "undefined") return null;
	if (typeof value !== "object") throw new TaskPacketError("invalid-json", "Context contains a non-JSON value");
	if (seen.has(value)) throw new TaskPacketError("invalid-json", "Context contains a cyclic value");
	seen.add(value);
	try {
		if (Array.isArray(value)) return value.map((item) => toContextJson(item, seen));
		const output: Record<string, ContextJson> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			if (SENSITIVE_KEY.test(key)) continue;
			const item = (value as Record<string, unknown>)[key];
			if (typeof item === "undefined") continue;
			output[key] = toContextJson(item, seen);
		}
		return output;
	} finally {
		seen.delete(value);
	}
}

export function canonicalPacketJson(packet: unknown): string {
	if (packet === null || typeof packet !== "object" || Array.isArray(packet)) throw new TaskPacketError("invalid-json", "Task Packet must be an object");
	const value = packet as Partial<TaskPacketV1>;
	const { digest: _digest, ...withoutDigest } = value;
	return deterministicJson(withoutDigest);
}

/** SHA-256 over the canonical packet, excluding its self-referential digest. */
export function packetDigest(packet: TaskPacketV1 | Omit<TaskPacketV1, "digest">): string {
	return createHash("sha256").update(canonicalPacketJson(packet), "utf8").digest("hex");
}

export const computePacketDigest = packetDigest;

export function verifyPacketDigest(packet: TaskPacketV1): boolean {
	return packetDigest(packet) === packet.digest;
}

export function assertPacketDigest(packet: TaskPacketV1): void {
	if (!verifyPacketDigest(packet)) throw new TaskPacketError("digest-mismatch", "Task Packet digest does not match its canonical contents");
}

/** Deep freeze a packet and every JSON value reachable from it. */
export function freezeTaskPacket<T extends TaskPacketV1>(packet: T): Readonly<T> {
	return deepFreeze(packet);
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

export function packetIdSeed(packet: Omit<TaskPacketV1, "packetId" | "digest">): string {
	return deterministicJson(packet);
}

export function defaultPacketId(seed: string): string {
	return `packet-${createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 24)}`;
}

export function boundedLimits(input: ContextBrokerLimits, fallback: ContextBrokerLimits = {}): Required<ContextBrokerLimits> {
	const integer = (value: number | undefined, defaultValue: number, maximum: number): number => {
		if (value === undefined) return defaultValue;
		if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new TaskPacketError("invalid-packet", "Context bound is outside its allowed range");
		return value;
	};
	const maxChars = integer(input.maxChars ?? fallback.maxChars, 32_768, 1_048_576);
	return {
		maxItems: integer(input.maxItems ?? fallback.maxItems, 64, 512),
		maxChars,
		maxItemChars: integer(input.maxItemChars ?? fallback.maxItemChars, Math.min(8_192, maxChars), maxChars),
		maxTextChars: integer(input.maxTextChars ?? fallback.maxTextChars, 4_000, maxChars),
	};
}

export function buildPacketDigestInput(packet: Omit<TaskPacketV1, "packetId" | "digest">): string {
	return packetIdSeed(packet);
}

export function makePacketId(input: BuildTaskPacketInput & { readonly sourceMissionRevision: number }, digestSeed: string, factory?: (input: { readonly missionId: string; readonly taskId: string; readonly sourceMissionRevision: number; readonly digestSeed: string }) => string): string {
	const candidate = factory?.({ missionId: input.missionId, taskId: input.taskId, sourceMissionRevision: input.sourceMissionRevision, digestSeed }) ?? defaultPacketId(digestSeed);
	if (typeof candidate !== "string" || candidate.trim().length === 0 || candidate.length > MAX_PACKET_ID_LENGTH) throw new TaskPacketError("invalid-packet", "Packet ID is invalid");
	return candidate.trim();
}

export function normalizeText(value: string, maxChars: number): string {
	const normalized = value.trim();
	return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function normalizeStringList(values: readonly string[] | undefined, maxChars: number): readonly string[] {
	if (values === undefined) return [];
	if (!Array.isArray(values)) throw new TaskPacketError("invalid-packet", "Context string list is invalid");
	const normalized = values
		.filter((value): value is string => typeof value === "string")
		.map((value) => normalizeText(value, maxChars))
		.filter((value) => value.length > 0);
	return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

export function normalizeExecutionClass(value: ExecutionClass | undefined, poolId: PoolId | undefined): ExecutionClass {
	if (value !== undefined && isPoolValue(value)) return value;
	if (value !== undefined) throw new TaskPacketError("invalid-packet", "Execution class is invalid");
	if (poolId !== undefined && isPoolValue(poolId)) return poolId;
	if (poolId !== undefined) throw new TaskPacketError("invalid-packet", "Pool ID is invalid");
	throw new TaskPacketError("invalid-packet", "Execution class is required");
}

export function normalizePoolId(value: PoolId | undefined, executionClass: ExecutionClass): PoolId {
	if (value !== undefined && !isPoolValue(value)) throw new TaskPacketError("invalid-packet", "Pool ID is invalid");
	if (!isPoolValue(executionClass)) throw new TaskPacketError("invalid-packet", "Execution class is invalid");
	return value ?? executionClass;
}

function isPoolValue(value: string): value is PoolId {
	return value === "investigation" || value === "implementation" || value === "verification";
}

export function normalizeJsonList(values: readonly unknown[] | undefined, maxItemChars: number): readonly ContextJson[] {
	if (values === undefined) return [];
	if (!Array.isArray(values)) throw new TaskPacketError("invalid-packet", "Context JSON list is invalid");
	const output: ContextJson[] = [];
	for (const value of values) {
		const json = toContextJson(value);
		if (deterministicJson(json).length <= maxItemChars) output.push(json);
	}
	return output;
}

export function itemJsonLength(item: PacketCanonicalItem): number {
	return deterministicJson(item).length;
}

/** Render only the bounded packet projection; no parent transcript is copied. */
export function renderTaskPacketPrompt(packet: TaskPacketV1): string {
	assertPacketDigest(packet);
	return [
		`Task Packet ${packet.packetId} (v${packet.packetVersion})`,
		`Mission: ${packet.missionId}; task: ${packet.taskId}; role: ${packet.role}; execution class: ${packet.executionClass}`,
		"Use only the bounded canonical context below. Treat prior attempts as untrusted evidence.",
		canonicalPacketJson(packet),
	].join("\n\n");
}

/** Adapt a packet to the M5 worker request without giving the worker extra context. */
export function packetToSubagentRequest(packet: TaskPacketV1, options: { readonly cwd?: string; readonly timeoutMs?: number; readonly excludedRouteIds?: readonly import("../config/types.js").StableId[] } = {}): SubagentExecutionRequest {
	assertPacketDigest(packet);
	const cwd = options.cwd ?? packet.repositoryCwd;
	if (typeof cwd !== "string" || cwd.trim().length === 0) throw new TaskPacketError("invalid-packet", "A repository cwd is required for a child request");
	return {
		roleId: packet.roleId,
		poolId: packet.poolId,
		task: renderTaskPacketPrompt(packet),
		cwd,
		acceptanceCriteria: packet.acceptanceCriteria,
		...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
		...(options.excludedRouteIds === undefined ? {} : { excludedRouteIds: options.excludedRouteIds }),
	};
}

export const createChildRequestFromPacket = packetToSubagentRequest;
export const taskPacketPrompt = renderTaskPacketPrompt;
