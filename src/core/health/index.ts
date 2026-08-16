import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { deterministicJson } from "../config/serialize.js";
import {
	ensureStorageDirectories,
	quarantineBytes,
	writeAtomicFile,
	type HistoryHooks,
} from "../config/history.js";
import type { StableId } from "../config/types.js";
import {
	classifyFailure,
	type FailureClassification,
	type FailureClass,
	type FailureInput,
} from "../routing/index.js";

export const HEALTH_VERSION = 1 as const;
export const HEALTH_FILE = "health.json" as const;
const MAX_BYTES = 1_048_576;
const MAX_ROUTES = 2_048;
const MAX_COOLDOWN_MS = 7 * 86_400_000;
const CIRCUIT_THRESHOLD = 3;

export type CircuitState = "unknown" | "healthy" | "degraded" | "open" | "probing";
export type HealthStatus =
	| "Healthy"
	| "Degraded"
	| "Cooldown"
	| "Authentication blocked"
	| "Quota cooldown"
	| "Rate-limit cooldown"
	| "Provider unavailable"
	| "Probing"
	| "Unknown";

export interface RouteHealthRecord {
	readonly routeId: StableId;
	readonly lastSuccessAt?: string;
	readonly lastFailureAt?: string;
	readonly lastFailureClass?: FailureClass;
	readonly consecutiveFailures: number;
	readonly cooldownUntil?: string;
	readonly cooldownReason?: FailureClass;
	readonly lastHttpStatus?: number;
	readonly retryAfterAt?: string;
	readonly circuit: CircuitState;
	readonly probeInFlight?: boolean;
}

export interface HealthSnapshot {
	readonly healthVersion: typeof HEALTH_VERSION;
	readonly generation: number;
	readonly updatedAt: string;
	readonly routes: Readonly<Record<string, RouteHealthRecord>>;
}

export type HealthLoadStatus = "missing" | "valid" | "corrupt";

export interface HealthLoadResult {
	readonly status: HealthLoadStatus;
	readonly snapshot?: HealthSnapshot;
	readonly diagnostics: readonly string[];
}

export interface HealthStoreOptions {
	readonly root: string;
	readonly clock?: () => Date;
	readonly hooks?: HistoryHooks;
	readonly failureThreshold?: number;
	readonly maxCooldownMs?: number;
}

export interface RecordFailureOptions {
	readonly now?: Date | string;
	readonly policy?: {
		readonly rateLimitCooldownMs?: number;
		readonly quotaCooldownMs?: number;
		readonly timeoutCooldownMs?: number;
		readonly transportCooldownMs?: number;
		readonly authenticationCooldownMs?: number;
		readonly providerCooldownMs?: number;
		readonly modelCooldownMs?: number;
	};
	readonly retryAfterMs?: number;
	readonly retryAfterAt?: string;
}

export class HealthStoreError extends Error {
	readonly code: "root-required" | "corrupt" | "invalid-route";

	constructor(code: HealthStoreError["code"], message: string) {
		super(message);
		this.name = "HealthStoreError";
		this.code = code;
	}
}

export class HealthStore {
	readonly root: string;
	private readonly clock: () => Date;
	private readonly hooks: HistoryHooks;
	private readonly failureThreshold: number;
	private readonly maxCooldownMs: number;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(options: HealthStoreOptions) {
		if (!options.root) throw new HealthStoreError("root-required", "Health store root is required");
		this.root = options.root;
		this.clock = options.clock ?? (() => new Date());
		this.hooks = options.hooks ?? {};
		this.failureThreshold = clampInt(options.failureThreshold ?? CIRCUIT_THRESHOLD, 1, 16);
		this.maxCooldownMs = clampInt(options.maxCooldownMs ?? MAX_COOLDOWN_MS, 0, MAX_COOLDOWN_MS);
	}

	load(): Promise<HealthLoadResult> {
		return this.enqueue(() => this.loadUnlocked());
	}

	async get(routeId: StableId): Promise<RouteHealthRecord | undefined> {
		return (await this.load()).snapshot?.routes[routeId];
	}

	async list(): Promise<Readonly<Record<string, RouteHealthRecord>>> {
		return (await this.load()).snapshot?.routes ?? {};
	}

	async recordFailure(routeId: StableId, failure: FailureClassification | FailureInput, options: RecordFailureOptions = {}): Promise<RouteHealthRecord> {
		return this.enqueue(async () => {
			assertRouteId(routeId);
			const now = toDate(options.now ?? this.clock()).toISOString();
			const classification = isClassification(failure) ? failure : classifyFailure(failure);
			// Cancellation and result-capability misses are not infrastructure health.
			if (classification.class === "cancelled" || classification.class === "result_capability") {
				const loaded = await this.readRaw();
				return loaded.result.snapshot?.routes[routeId] ?? { routeId, consecutiveFailures: 0, circuit: "healthy" };
			}
			const loaded = await this.loadForWrite();
			const previous = loaded.snapshot.routes[routeId];
			const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
			const cooldownUntil = calculateCooldownUntil(classification, now, options, this.maxCooldownMs);
			const circuit: CircuitState = consecutiveFailures >= this.failureThreshold ? "open" : "degraded";
			const record: RouteHealthRecord = {
				routeId,
				...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
				lastFailureAt: now,
				lastFailureClass: classification.class,
				consecutiveFailures,
				...(cooldownUntil ? { cooldownUntil } : {}),
				...(cooldownUntil ? { cooldownReason: classification.class } : {}),
				...(classification.status === undefined ? {} : { lastHttpStatus: classification.status }),
				...(classification.retryAfterAt ? { retryAfterAt: classification.retryAfterAt } : {}),
				circuit,
			};
			const routes = { ...loaded.snapshot.routes, [routeId]: record };
			await this.saveSnapshot({
				healthVersion: HEALTH_VERSION,
				generation: loaded.snapshot.generation + 1,
				updatedAt: now,
				routes,
			});
			return record;
		});
	}

	async recordSuccess(routeId: StableId, at: Date | string = this.clock()): Promise<RouteHealthRecord> {
		return this.enqueue(async () => {
			assertRouteId(routeId);
			const timestamp = toDate(at).toISOString();
			const loaded = await this.loadForWrite();
			const previous = loaded.snapshot.routes[routeId];
			const record: RouteHealthRecord = {
				routeId,
				lastSuccessAt: timestamp,
				...(previous?.lastFailureAt ? { lastFailureAt: previous.lastFailureAt } : {}),
				...(previous?.lastFailureClass ? { lastFailureClass: previous.lastFailureClass } : {}),
				consecutiveFailures: 0,
				circuit: "healthy",
			};
			await this.saveSnapshot({
				healthVersion: HEALTH_VERSION,
				generation: loaded.snapshot.generation + 1,
				updatedAt: timestamp,
				routes: { ...loaded.snapshot.routes, [routeId]: record },
			});
			return record;
		});
	}

	async reset(routeId: StableId, at: Date | string = this.clock()): Promise<RouteHealthRecord> {
		return this.enqueue(async () => {
			assertRouteId(routeId);
			const timestamp = toDate(at).toISOString();
			const loaded = await this.loadForWrite();
			const previous = loaded.snapshot.routes[routeId];
			const record: RouteHealthRecord = {
				routeId,
				...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
				...(previous?.lastFailureAt ? { lastFailureAt: previous.lastFailureAt } : {}),
				...(previous?.lastFailureClass ? { lastFailureClass: previous.lastFailureClass } : {}),
				consecutiveFailures: 0,
				circuit: "healthy",
			};
			await this.saveSnapshot({
				healthVersion: HEALTH_VERSION,
				generation: loaded.snapshot.generation + 1,
				updatedAt: timestamp,
				routes: { ...loaded.snapshot.routes, [routeId]: record },
			});
			return record;
		});
	}

	async beginProbe(routeId: StableId, at: Date | string = this.clock()): Promise<boolean> {
		return this.enqueue(async () => {
			assertRouteId(routeId);
			const timestamp = toDate(at).toISOString();
			const loaded = await this.loadForWrite();
			const previous = loaded.snapshot.routes[routeId];
			if (!previous || previous.probeInFlight || (previous.cooldownUntil && Date.parse(previous.cooldownUntil) > Date.parse(timestamp))) return false;
			const record: RouteHealthRecord = { ...previous, circuit: "probing", probeInFlight: true };
			await this.saveSnapshot({ healthVersion: HEALTH_VERSION, generation: loaded.snapshot.generation + 1, updatedAt: timestamp, routes: { ...loaded.snapshot.routes, [routeId]: record } });
			return true;
		});
	}

	async recover(): Promise<HealthLoadResult> {
		return this.enqueue(async () => {
			const loaded = await this.readRaw();
			if (loaded.status !== "corrupt" || !loaded.bytes) return loaded.result;
			await quarantineBytes(this.root, loaded.bytes, this.hooks);
			return { status: "missing", diagnostics: ["Corrupt runtime health was quarantined"] };
		});
	}

	status(record: RouteHealthRecord | undefined, now: Date | string = this.clock()): HealthStatus {
		if (!record) return "Unknown";
		const nowMs = toDate(now).getTime();
		if (record.probeInFlight || record.circuit === "probing") return "Probing";
		if (record.cooldownUntil && Date.parse(record.cooldownUntil) > nowMs) {
			if (record.cooldownReason === "authentication_failed") return "Authentication blocked";
			if (record.cooldownReason === "quota_exhausted") return "Quota cooldown";
			if (record.cooldownReason === "rate_limited") return "Rate-limit cooldown";
			if (record.cooldownReason === "provider_unavailable" || record.cooldownReason === "model_unavailable") return "Provider unavailable";
			return "Cooldown";
		}
		if (record.circuit === "healthy" || record.consecutiveFailures === 0) return "Healthy";
		if (record.circuit === "degraded" || record.circuit === "open") return "Degraded";
		return "Unknown";
	}

	blocked(record: RouteHealthRecord | undefined, now: Date | string = this.clock()): boolean {
		if (!record) return false;
		if (record.probeInFlight) return true;
		return record.cooldownUntil !== undefined && Date.parse(record.cooldownUntil) > toDate(now).getTime();
	}

	private async loadForWrite(): Promise<{ readonly snapshot: HealthSnapshot }> {
		const loaded = await this.readRaw();
		if (loaded.status === "valid" && loaded.result.snapshot) return { snapshot: loaded.result.snapshot };
		if (loaded.status === "corrupt" && loaded.bytes) {
			await quarantineBytes(this.root, loaded.bytes, this.hooks);
		}
		return { snapshot: emptySnapshot(this.clock()) };
	}

	private async loadUnlocked(): Promise<HealthLoadResult> {
		return (await this.readRaw()).result;
	}

	private async readRaw(): Promise<{ readonly status: HealthLoadStatus; readonly bytes?: Uint8Array; readonly result: HealthLoadResult }> {
		let bytes: Buffer;
		try {
			bytes = await readFile(join(this.root, HEALTH_FILE));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", result: { status: "missing", diagnostics: [] } };
			return { status: "corrupt", result: { status: "corrupt", diagnostics: ["Runtime health could not be read"] } };
		}
		if (bytes.byteLength > MAX_BYTES) return { status: "corrupt", bytes, result: { status: "corrupt", diagnostics: ["Runtime health is too large"] } };
		try {
			const snapshot = validateSnapshot(JSON.parse(bytes.toString("utf8")) as unknown);
			return { status: "valid", result: { status: "valid", snapshot, diagnostics: [] } };
		} catch {
			return { status: "corrupt", bytes, result: { status: "corrupt", diagnostics: ["Runtime health is corrupt or invalid"] } };
		}
	}

	private async saveSnapshot(snapshot: HealthSnapshot): Promise<void> {
		validateSnapshot(snapshot);
		if (Object.keys(snapshot.routes).length > MAX_ROUTES) throw new HealthStoreError("corrupt", "Runtime health has too many routes");
		await ensureStorageDirectories(this.root, this.hooks);
		await writeAtomicFile(join(this.root, HEALTH_FILE), deterministicJson(snapshot), this.hooks, "active");
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.queue.then(operation, operation);
		this.queue = run.then(() => undefined, () => undefined);
		return run;
	}
}

export function healthPath(root: string): string {
	return join(root, HEALTH_FILE);
}

export function healthRecordStatus(record: RouteHealthRecord | undefined, now: Date | string = new Date()): HealthStatus {
	if (!record) return "Unknown";
	const nowMs = toDate(now).getTime();
	if (record.probeInFlight || record.circuit === "probing") return "Probing";
	if (record.cooldownUntil && Date.parse(record.cooldownUntil) > nowMs) {
		if (record.cooldownReason === "authentication_failed") return "Authentication blocked";
		if (record.cooldownReason === "quota_exhausted") return "Quota cooldown";
		if (record.cooldownReason === "rate_limited") return "Rate-limit cooldown";
		if (record.cooldownReason === "provider_unavailable" || record.cooldownReason === "model_unavailable") return "Provider unavailable";
		return "Cooldown";
	}
	if (record.circuit === "healthy" || record.consecutiveFailures === 0) return "Healthy";
	if (record.circuit === "degraded" || record.circuit === "open") return "Degraded";
	return "Unknown";
}

function emptySnapshot(now: Date): HealthSnapshot {
	return { healthVersion: HEALTH_VERSION, generation: 0, updatedAt: now.toISOString(), routes: {} };
}

function calculateCooldownUntil(
	classification: FailureClassification,
	now: string,
	options: RecordFailureOptions,
	maxCooldownMs: number,
): string | undefined {
	const nowMs = Date.parse(now);
	const explicitAt = options.retryAfterAt && Number.isFinite(Date.parse(options.retryAfterAt)) ? Date.parse(options.retryAfterAt) : undefined;
	const explicitMs = options.retryAfterMs ?? classification.retryAfterMs;
	const fromMs = explicitMs !== undefined && Number.isFinite(explicitMs) && explicitMs >= 0 ? nowMs + Math.min(Math.trunc(explicitMs), maxCooldownMs) : undefined;
	const fromAt = classification.retryAfterAt && Number.isFinite(Date.parse(classification.retryAfterAt)) ? Date.parse(classification.retryAfterAt) : undefined;
	const authoritative = Math.max(explicitAt ?? 0, fromAt ?? 0, fromMs ?? 0);
	if (authoritative > nowMs) return new Date(Math.min(authoritative, nowMs + maxCooldownMs)).toISOString();
	const policy = options.policy;
	const defaultMs = classification.class === "quota_exhausted"
		? policy?.quotaCooldownMs
		: classification.class === "rate_limited"
			? policy?.rateLimitCooldownMs
			: classification.class === "authentication_failed"
				? policy?.authenticationCooldownMs ?? 300_000
				: classification.class === "timeout"
					? policy?.timeoutCooldownMs ?? 30_000
					: classification.class === "transport_error"
						? policy?.transportCooldownMs ?? 30_000
						: classification.class === "provider_unavailable"
							? policy?.providerCooldownMs ?? 60_000
							: classification.class === "model_unavailable"
								? policy?.modelCooldownMs ?? 60_000
								: 0;
		if (!defaultMs || defaultMs < 0) return undefined;
		return new Date(nowMs + Math.min(Math.trunc(defaultMs), maxCooldownMs)).toISOString();
}

function isClassification(value: FailureClassification | FailureInput): value is FailureClassification {
	return typeof (value as FailureClassification).class === "string" && typeof (value as FailureClassification).safeMessage === "string";
}

function validateSnapshot(value: unknown): HealthSnapshot {
	if (!isRecord(value) || value.healthVersion !== HEALTH_VERSION || !Number.isSafeInteger(value.generation) || value.generation < 0 || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || !isRecord(value.routes)) throw new HealthStoreError("corrupt", "Runtime health schema is invalid");
	const routes: Record<string, RouteHealthRecord> = {};
	for (const [key, raw] of Object.entries(value.routes)) {
		const record = validateRecord(raw);
		if (key !== record.routeId) throw new HealthStoreError("corrupt", "Runtime health route identity is invalid");
		routes[key] = record;
	}
	return { healthVersion: HEALTH_VERSION, generation: value.generation, updatedAt: value.updatedAt, routes };
}

function validateRecord(value: unknown): RouteHealthRecord {
	if (!isRecord(value) || !isStableId(value.routeId) || !Number.isSafeInteger(value.consecutiveFailures) || value.consecutiveFailures < 0 || value.consecutiveFailures > 1_000 || !isCircuit(value.circuit)) throw new HealthStoreError("corrupt", "Runtime health route record is invalid");
	const optionalDates = [value.lastSuccessAt, value.lastFailureAt, value.cooldownUntil, value.retryAfterAt];
	if (optionalDates.some((date) => date !== undefined && (typeof date !== "string" || !Number.isFinite(Date.parse(date))))) throw new HealthStoreError("corrupt", "Runtime health timestamp is invalid");
	if (value.lastFailureClass !== undefined && !isFailureClass(value.lastFailureClass)) throw new HealthStoreError("corrupt", "Runtime health failure class is invalid");
	if (value.cooldownReason !== undefined && !isFailureClass(value.cooldownReason)) throw new HealthStoreError("corrupt", "Runtime health cooldown reason is invalid");
	if (value.lastHttpStatus !== undefined && (!Number.isSafeInteger(value.lastHttpStatus) || value.lastHttpStatus < 100 || value.lastHttpStatus > 599)) throw new HealthStoreError("corrupt", "Runtime health status is invalid");
	if (value.probeInFlight !== undefined && typeof value.probeInFlight !== "boolean") throw new HealthStoreError("corrupt", "Runtime health probe state is invalid");
	return {
		routeId: value.routeId as StableId,
		...(value.lastSuccessAt === undefined ? {} : { lastSuccessAt: value.lastSuccessAt }),
		...(value.lastFailureAt === undefined ? {} : { lastFailureAt: value.lastFailureAt }),
		...(value.lastFailureClass === undefined ? {} : { lastFailureClass: value.lastFailureClass as FailureClass }),
		consecutiveFailures: value.consecutiveFailures,
		...(value.cooldownUntil === undefined ? {} : { cooldownUntil: value.cooldownUntil }),
		...(value.cooldownReason === undefined ? {} : { cooldownReason: value.cooldownReason as FailureClass }),
		...(value.lastHttpStatus === undefined ? {} : { lastHttpStatus: value.lastHttpStatus }),
		...(value.retryAfterAt === undefined ? {} : { retryAfterAt: value.retryAfterAt }),
		circuit: value.circuit as CircuitState,
		...(value.probeInFlight === undefined ? {} : { probeInFlight: value.probeInFlight }),
	};
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStableId(value: unknown): value is string {
	return typeof value === "string" && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value) && value.length <= 64;
}

function isCircuit(value: unknown): value is CircuitState {
	return value === "unknown" || value === "healthy" || value === "degraded" || value === "open" || value === "probing";
}

function isFailureClass(value: unknown): value is FailureClass {
	return value === "quota_exhausted" || value === "rate_limited" || value === "authentication_failed" || value === "timeout" || value === "transport_error" || value === "provider_unavailable" || value === "model_unavailable" || value === "invalid_request" || value === "protocol_error" || value === "result_capability" || value === "cancelled" || value === "unknown";
}

function assertRouteId(routeId: StableId): void {
	if (!isStableId(routeId)) throw new HealthStoreError("invalid-route", "Route identity is invalid");
}

function clampInt(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

function toDate(value: Date | string): Date {
	const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (!Number.isFinite(date.getTime())) throw new TypeError("Health time must be a valid date");
	return date;
}
