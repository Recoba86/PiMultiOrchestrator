import {
	boundedLimits,
	buildPacketDigestInput,
	canonicalPacketJson,
	freezeTaskPacket,
	itemJsonLength,
	makePacketId,
	normalizeExecutionClass,
	normalizeJsonList,
	normalizePoolId,
	normalizeStringList,
	normalizeText,
	packetDigest,
	toContextJson,
} from "./packet.js";
import { TASK_PACKET_VERSION } from "./types.js";
import { POOL_IDS, type PoolId } from "../pools/index.js";
import type {
	BuildTaskPacketInput,
	CanonicalItemStatus,
	ContextCanonicalItem,
	ContextJson,
	ContextMissionRecord,
	ContextRepository,
	ContextTaskRecord,
	TaskPacketV1,
	ContextBrokerOptions,
	PacketCanonicalItem,
} from "./types.js";

const ACCEPTED_STATUSES = new Set<CanonicalItemStatus>(["accepted", "approved"]);
const SENSITIVE_KIND = /(?:secret|credential|api[_-]?key|private[_-]?key|transcript|conversation|chat[_-]?history|messages?)/iu;
const MAX_ID_LENGTH = 256;
// Bound the canonical projection itself; the fixed digest is metadata outside
// the context payload and is checked separately by packet verification.
const PACKET_METADATA_RESERVE = 0;

export type ContextBrokerErrorCode = "mission-not-found" | "task-not-found" | "invalid-input" | "revision-mismatch";

export class ContextBrokerError extends Error {
	readonly code: ContextBrokerErrorCode;

	constructor(code: ContextBrokerErrorCode, message: string) {
		super(message);
		this.name = "ContextBrokerError";
		this.code = code;
	}
}

export interface ContextBuildOutput {
	readonly packet: TaskPacketV1;
	readonly includedCanonicalItemIds: readonly string[];
	readonly omittedCount: number;
}

export class ContextBroker {
	private readonly repository: ContextRepository;
	private readonly options: ContextBrokerOptions;

	constructor(repository: ContextRepository, options: ContextBrokerOptions = {}) {
		this.repository = repository;
		this.options = { ...options };
	}

	buildPacket(input: BuildTaskPacketInput): Readonly<TaskPacketV1> {
		if (!input || typeof input !== "object") throw new ContextBrokerError("invalid-input", "Packet input is required");
		const missionId = requiredId(input.missionId, "missionId");
		const taskId = requiredId(input.taskId, "taskId");
		const mission = this.repository.getMission(missionId);
		if (!mission || typeof mission !== "object") throw new ContextBrokerError("mission-not-found", "Mission is not available to the Context Broker");
		if (mission.missionId !== missionId) throw new ContextBrokerError("invalid-input", "Repository returned a mismatched mission");
		if (!Number.isSafeInteger(mission.revision) || mission.revision < 1) throw new ContextBrokerError("invalid-input", "Mission revision is invalid");
		if (input.sourceMissionRevision !== undefined && input.sourceMissionRevision !== mission.revision) {
			throw new ContextBrokerError("revision-mismatch", "Mission revision changed before packet construction");
		}

		const task = this.repository.getTask?.(taskId);
		if (this.repository.getTask !== undefined && (!task || typeof task !== "object")) throw new ContextBrokerError("task-not-found", "Task is not available to the Context Broker");
		if (task?.missionId !== undefined && task.missionId !== missionId) throw new ContextBrokerError("invalid-input", "Task belongs to another mission");
		const limits = boundedLimits(input, this.options);
		const roleId = requiredText(input.roleId ?? input.role ?? task?.roleId, "roleId", limits.maxTextChars);
		const taskPoolId = validPoolId(task?.poolId);
		const executionClass = normalizeExecutionClass(input.executionClass ?? task?.executionClass, input.poolId ?? taskPoolId);
		const poolId = normalizePoolId(input.poolId ?? taskPoolId, executionClass);
		const objective = requiredText(input.objective ?? task?.objective ?? mission.objective ?? mission.goal, "objective", limits.maxTextChars);
		const contextBudget = boundedContextBudget(input.contextBudget ?? task?.contextBudget ?? limits.maxChars, limits.maxChars);

		const sourceItems = this.readCanonicalItems(mission);
		const selected = this.selectItems(sourceItems, input, limits);
		const missionConstraints = mission.constraints ?? [];
		const taskConstraints = task?.constraints ?? [];
		const constraintsInput = input.constraints ?? [...missionConstraints, ...taskConstraints];
		const acceptanceCriteria = normalizeStringList(input.acceptanceCriteria ?? task?.acceptanceCriteria ?? mission.acceptanceCriteria, limits.maxTextChars);
		const allowedTools = normalizeStringList(input.allowedTools ?? task?.allowedTools, limits.maxTextChars);
		const allowedActions = normalizeStringList(input.allowedActions ?? task?.allowedActions, limits.maxTextChars);
		const priorAttempts = normalizeJsonList(input.priorAttempts ?? task?.priorAttempts, limits.maxItemChars);
		const scopes = normalizeStringList(input.scopes, limits.maxTextChars);
		const tags = normalizeStringList(input.tags, limits.maxTextChars);
		const relevantFiles = normalizeStringList([
			...(input.relevantFiles ?? []),
			...selected.items.flatMap((item) => item.relevantFiles ?? []),
		], limits.maxTextChars);
		const relevantArtifactRefs = normalizeStringList([
			...(input.relevantArtifactRefs ?? []),
			...selected.items.flatMap((item) => item.artifactRefs ?? []),
		], limits.maxTextChars);
		const repositoryRevision = boundedOptionalText(mission.repository?.revision, limits.maxTextChars);
		const repositoryCwd = boundedOptionalText(input.cwd ?? task?.cwd ?? mission.repository?.cwd, limits.maxTextChars);
		const outputSchemaId = requiredText(input.outputSchemaId ?? task?.outputSchemaId ?? `${roleId}-v1`, "outputSchemaId", limits.maxTextChars);
		const parentPacketId = optionalId(input.parentPacketId);

		const base = {
			packetVersion: TASK_PACKET_VERSION,
			missionId,
			taskId,
			role: roleId,
			roleId,
			executionClass,
			poolId,
			sourceMissionRevision: mission.revision,
			sourceRevision: mission.revision,
			canonicalGeneration: mission.revision,
			...(repositoryRevision === undefined ? {} : { repositoryRevision }),
			...(repositoryCwd === undefined ? {} : { repositoryCwd }),
			objective,
			constraints: normalizeJsonList(constraintsInput, limits.maxItemChars),
			approvedFindings: selected.items,
			relevantArtifactRefs,
			relevantFiles,
			acceptanceCriteria,
			allowedTools,
			allowedActions,
			priorAttempts,
			outputSchemaId,
			contextBudget,
			scopes,
			tags,
			includedCanonicalItemIds: selected.items.map((item) => item.itemId),
			omittedCount: selected.omittedCount,
			omittedItemIds: selected.omittedItemIds,
			...(parentPacketId === undefined ? {} : { parentPacketId }),
		} satisfies Omit<TaskPacketV1, "packetId" | "digest">;

		const boundedBase = this.fitPacketBudget(base, sourceItems, selected, limits.maxChars, limits.maxItems);
		const digestSeed = buildPacketDigestInput(boundedBase);
		const packetId = makePacketId({ ...input, missionId, taskId, sourceMissionRevision: mission.revision }, digestSeed, this.options.packetId);
		const withoutDigest = { ...boundedBase, packetId } as Omit<TaskPacketV1, "digest">;
		const packet: TaskPacketV1 = { ...withoutDigest, digest: packetDigest(withoutDigest) };
		return freezeTaskPacket(packet);
	}

	buildPacketResult(input: BuildTaskPacketInput): ContextBuildOutput {
		const packet = this.buildPacket(input);
		return Object.freeze({
			packet,
			includedCanonicalItemIds: packet.includedCanonicalItemIds,
			omittedCount: packet.omittedCount,
		});
	}

	async buildPacketAsync(input: BuildTaskPacketInput): Promise<Readonly<TaskPacketV1>> {
		return this.buildPacket(input);
	}

	private readCanonicalItems(mission: ContextMissionRecord): readonly ContextCanonicalItem[] {
		const listed = this.repository.listCanonicalItems?.(mission.missionId)
			?? this.repository.getCanonicalItems?.(mission.missionId)
			?? this.repository.listAcceptedCanonicalItems?.(mission.missionId)
			?? this.repository.listItems?.(mission.missionId);
		// A store may expose a physical canonical_items projection before its
		// mission snapshot JSON is backfilled. Keep the accepted snapshot as the
		// fallback instead of silently emitting an empty packet.
		if (listed !== undefined && listed.length > 0) return listed.map((item, index) => normalizeCanonicalItem(item, `canonical-${index + 1}`));
		const groups: [string, readonly unknown[]][] = [
			...(mission.plan === undefined || mission.plan === null ? [] : [["plan", [mission.plan] as readonly unknown[]] as [string, readonly unknown[]]]),
			["finding", mission.validatedFindings ?? []],
			["completed-work", mission.completedWork ?? []],
			["test-evidence", mission.testReviewEvidence ?? []],
			["approved-decision", mission.approvedDecisions ?? []],
		];
		return groups.flatMap(([kind, values]) => values.map((value, index) => normalizeCanonicalItem(value, `${kind}-${index + 1}`, kind)));
	}

	private selectItems(items: readonly ContextCanonicalItem[], input: BuildTaskPacketInput, limits: ReturnType<typeof boundedLimits>): { readonly items: readonly PacketCanonicalItem[]; readonly omittedCount: number; readonly omittedItemIds: readonly string[] } {
		const requestedScopes = normalizeStringList(input.scopes, limits.maxTextChars);
		const requestedTags = normalizeStringList(input.tags, limits.maxTextChars);
		const requestedKinds = new Set(normalizeStringList(input.includeKinds, limits.maxTextChars));
		const requestedIds = new Set(normalizeStringList(input.includeCanonicalItemIds, limits.maxTextChars));
		const ordered = [...items]
			.filter((item) => accepted(item.status) && !SENSITIVE_KIND.test(item.kind))
			.map((item) => normalizeCanonicalItem(item, item.itemId))
			.sort((left, right) => left.itemId.localeCompare(right.itemId) || left.kind.localeCompare(right.kind));
		const selected: PacketCanonicalItem[] = [];
		const omitted: string[] = [];
		for (const item of ordered) {
			if (requestedIds.size > 0 && !requestedIds.has(item.itemId)) { omitted.push(item.itemId); continue; }
			if (requestedKinds.size > 0 && !requestedKinds.has(item.kind)) { omitted.push(item.itemId); continue; }
			if (requestedScopes.length > 0 && !requestedScopes.some((scope) => item.scopes?.includes(scope) === true)) { omitted.push(item.itemId); continue; }
			if (requestedTags.length > 0 && !requestedTags.some((tag) => item.tags?.includes(tag) === true)) { omitted.push(item.itemId); continue; }
			const packetItem = packetItemFromCanonical(item);
			if (itemJsonLength(packetItem) > limits.maxItemChars || selected.length >= limits.maxItems) { omitted.push(item.itemId); continue; }
			selected.push(packetItem);
		}
		const rejectedOrUnselected = items.filter((item) => !ordered.some((candidate) => candidate.itemId === item.itemId)).map((item) => item.itemId);
		for (const itemId of rejectedOrUnselected) if (!omitted.includes(itemId)) omitted.push(itemId);
		for (const requestedId of requestedIds) if (!items.some((item) => item.itemId === requestedId) && !omitted.includes(requestedId)) omitted.push(requestedId);
		return { items: selected, omittedCount: omitted.length, omittedItemIds: [...new Set(omitted)].sort((a, b) => a.localeCompare(b)) };
	}

	private fitPacketBudget<T extends Omit<TaskPacketV1, "packetId" | "digest">>(base: T, sourceItems: readonly ContextCanonicalItem[], selected: { readonly items: readonly PacketCanonicalItem[]; readonly omittedCount: number; readonly omittedItemIds: readonly string[] }, maxChars: number, maxItems: number): T {
		let items = [...base.approvedFindings];
		let omittedCount = selected.omittedCount;
		let omittedItemIds = [...selected.omittedItemIds];
		const baseWithoutItems = { ...base, approvedFindings: [], includedCanonicalItemIds: [], omittedCount: 0, omittedItemIds: [] };
		const candidate = (): T => ({ ...baseWithoutItems, approvedFindings: items, includedCanonicalItemIds: items.map((item) => item.itemId), omittedCount, omittedItemIds } as T);
		let bounded = candidate();
		while (canonicalPacketJson(bounded).length + PACKET_METADATA_RESERVE > maxChars && omittedItemIds.length > 0) {
			omittedItemIds.pop();
			bounded = candidate();
		}
		while (items.length > 0 && canonicalPacketJson(candidate()).length + PACKET_METADATA_RESERVE > maxChars) {
			const removed = items.pop();
			if (removed !== undefined) {
				omittedCount += 1;
				omittedItemIds.push(removed.itemId);
			}
		}
		bounded = candidate();
		// Trim optional list projections in stable order if metadata, rather than
		// canonical items, is what consumes the packet budget.
		const shrinkable = ["priorAttempts", "constraints", "relevantArtifactRefs", "relevantFiles", "acceptanceCriteria", "allowedActions", "allowedTools", "scopes", "tags"] as const;
		for (const field of shrinkable) {
			while (canonicalPacketJson(bounded).length + PACKET_METADATA_RESERVE > maxChars && bounded[field].length > 0) {
				const next = [...bounded[field]];
				next.pop();
				bounded = { ...bounded, [field]: next } as T;
			}
		}
		if (canonicalPacketJson(bounded).length + PACKET_METADATA_RESERVE > maxChars && bounded.objective.length > 16) {
			let objective = bounded.objective;
			while (canonicalPacketJson(bounded).length + PACKET_METADATA_RESERVE > maxChars && objective.length > 16) {
				objective = objective.slice(0, Math.max(16, objective.length - 64));
				bounded = { ...bounded, objective } as T;
			}
		}
		if (canonicalPacketJson(bounded).length + PACKET_METADATA_RESERVE > maxChars) throw new ContextBrokerError("invalid-input", "Task Packet metadata exceeds the context bound");
		void sourceItems;
		void maxItems;
		return bounded;
	}
}

export function buildTaskPacket(repository: ContextRepository, input: BuildTaskPacketInput, options?: ContextBrokerOptions): Readonly<TaskPacketV1> {
	return new ContextBroker(repository, options).buildPacket(input);
}

export const createTaskPacket = buildTaskPacket;
export const buildContextPacket = buildTaskPacket;

function accepted(status: CanonicalItemStatus | string | undefined): boolean {
	return status === undefined || ACCEPTED_STATUSES.has(status as CanonicalItemStatus);
}

function requiredId(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_ID_LENGTH) throw new ContextBrokerError("invalid-input", `${field} is invalid`);
	return value.trim();
}

function optionalId(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	return requiredId(value, "parentPacketId");
}

function requiredText(value: unknown, field: string, maxChars: number): string {
	if (typeof value !== "string" || value.trim().length === 0) throw new ContextBrokerError("invalid-input", `${field} is required`);
	return normalizeText(value, maxChars);
}

function boundedOptionalText(value: string | undefined, maxChars: number): string | undefined {
	return value === undefined ? undefined : normalizeText(value, maxChars);
}

function boundedContextBudget(value: number, maxChars: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) throw new ContextBrokerError("invalid-input", "Context budget is invalid");
	return Math.min(value, maxChars);
}

function validPoolId(value: string | undefined): PoolId | undefined {
	return value !== undefined && (POOL_IDS as readonly string[]).includes(value) ? value as PoolId : undefined;
}

function normalizeCanonicalItem(value: ContextCanonicalItem | unknown, fallbackId: string, fallbackKind = "canonical"): ContextCanonicalItem {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { itemId: fallbackId, kind: fallbackKind, value };
	}
	const object = value as Record<string, unknown>;
	const itemId = typeof object.itemId === "string" && object.itemId.trim().length > 0 ? object.itemId.trim() : fallbackId;
	const kind = typeof object.kind === "string" && object.kind.trim().length > 0 ? object.kind.trim() : fallbackKind;
	const status = typeof object.status === "string" ? object.status : object.accepted === false ? "rejected" : object.accepted === true ? "accepted" : undefined;
	const itemValue = "value" in object ? object.value : value;
	const sourceEvidenceId = typeof object.sourceEvidenceId === "string" ? object.sourceEvidenceId : typeof object.evidenceId === "string" ? object.evidenceId : undefined;
	const tags = stringArray(object.tags);
	const scopes = stringArray(object.scopes ?? object.scope);
	const relevantFiles = stringArray(object.relevantFiles ?? object.files);
	const artifactRefs = stringArray(object.artifactRefs ?? object.artifacts);
	return {
		itemId,
		kind,
		value: itemValue,
		...(status === undefined ? {} : { status }),
		...(sourceEvidenceId === undefined ? {} : { sourceEvidenceId }),
		...(tags === undefined ? {} : { tags }),
		...(scopes === undefined ? {} : { scopes }),
		...(relevantFiles === undefined ? {} : { relevantFiles }),
		...(artifactRefs === undefined ? {} : { artifactRefs }),
	};
}

function packetItemFromCanonical(item: ContextCanonicalItem): PacketCanonicalItem {
	const packetItem: PacketCanonicalItem = {
		itemId: item.itemId,
		kind: item.kind,
		value: toContextJson(item.value),
		...(item.tags === undefined ? {} : { tags: normalizeStringList(item.tags, 1_000) }),
		...(item.scopes === undefined ? {} : { scopes: normalizeStringList(item.scopes, 1_000) }),
		...(item.relevantFiles === undefined ? {} : { relevantFiles: normalizeStringList(item.relevantFiles, 2_000) }),
		...(item.artifactRefs === undefined ? {} : { artifactRefs: normalizeStringList(item.artifactRefs, 2_000) }),
		...(item.sourceEvidenceId === undefined ? {} : { sourceEvidenceId: normalizeText(item.sourceEvidenceId, 256) }),
		...(item.status === "accepted" || item.status === "approved" ? { validationStatus: item.status } : { validationStatus: "accepted" as const }),
	};
	return packetItem;
}

function stringArray(value: unknown): readonly string[] | undefined {
	if (typeof value === "string" && value.trim().length > 0) return [value];
	if (!Array.isArray(value)) return undefined;
	const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
	return values.length > 0 ? values : undefined;
}
