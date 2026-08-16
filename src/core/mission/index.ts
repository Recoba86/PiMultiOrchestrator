import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MISSION_STORE_MIGRATION_1_TO_2_SQL, MISSION_STORE_SCHEMA_SQL, MISSION_STORE_SCHEMA_V1_SQL, CURRENT_MISSION_STORE_SCHEMA_VERSION } from "./schema.js";
import {
	MissionClosedError, MissionConflictError, MissionCorruptError, MissionEvidenceError,
	MissionLeaseError, MissionNotFoundError, MissionPersistenceError, MissionValidationError,
	MissionUnauthorizedError, MissionVersionError,
} from "./errors.js";
import type {
	AttemptCreateInput, AttemptRecord, AttemptStatus, CanonicalItem, CheckpointKind, CheckpointRecord,
	EvidenceInput, EvidenceRecord, EvidenceStatus, LeaseOwner, LeaseRecord, MissionCreateInput,
	MissionEventRecord, MissionId, MissionPatch, MissionRecord, MissionStatus, MissionStoreAdapter,
	MissionStoreOptions, MissionTransitionOptions, PromoteEvidenceOptions, TaskCreateInput, TaskRecord,
	TaskStatus, TaskStatusOptions,
} from "./types.js";
import type {
	DiversityPreference, QualityDecisionInput, QualityDecisionRecord, QualityEscalationInput, QualityEscalationRequest,
	QualityFailureFinalizationInput, QualityFailureFinalizationResult, QualityFinalizationInput, QualityFinalizationResult,
	QualityStatus, TaskQualityStatus, VerificationRunInput, VerificationRunRecord, VerificationStatus,
} from "../quality/types.js";
import { resolveMissionAcceptanceCriteria } from "./acceptance-criteria.js";
import { activeMissionTasks } from "./task-identity.js";

type Row = Record<string, unknown>;
const json = (value: unknown): string => JSON.stringify(value ?? null);
const parse = <T>(value: unknown, fallback: T): T => {
	if (typeof value !== "string") return fallback;
	try { return JSON.parse(value) as T; } catch { throw new MissionCorruptError(); }
};
const nowIso = (clock: () => Date): string => clock().toISOString();
const clone = <T>(value: T): T => parse<T>(json(value), value);
const normalizeMissionText = (value: string): string => value.normalize("NFKC").replace(/[\u200b\ufeff\u2060]/gu, "").trim();

const idOf = (value: string | undefined, prefix: string, make: () => string): string =>
	value && value.length > 0 ? value : `${prefix}-${make()}`;

export const createCanonicalMission = (
	store: Pick<MissionStoreAdapter, "createMission">,
	goal: string,
	options: { readonly repositoryCwd?: string; readonly acceptanceCriteria?: readonly string[] } = {},
): MissionRecord => {
	const normalizedGoal = normalizeMissionText(goal);
	if (!normalizedGoal) throw new MissionValidationError([{ path: "goal", message: "goal is required" }]);
	const resolved = resolveMissionAcceptanceCriteria(normalizedGoal, options.acceptanceCriteria);
	return store.createMission({
		goal: normalizedGoal,
		...(resolved.criteria.length > 0 ? { acceptanceCriteria: resolved.criteria } : {}),
		...(options.repositoryCwd ? { repository: { cwd: options.repositoryCwd } } : {}),
		status: "draft",
		actor: "user",
	});
};

const MISSION_POOL_IDS = new Set(["investigation", "implementation", "verification"]);

export class SQLiteMissionStore implements MissionStoreAdapter {
	private readonly db: DatabaseSync;
	private readonly root: string;
	private readonly databasePath: string;
	private readonly clock: () => Date;
	private readonly makeId: () => string;
	private readonly maxJsonBytes: number;
	private readonly maxTextLength: number;
	private readonly leaseTtlMs: number;
	private readonly hooks: NonNullable<MissionStoreOptions["hooks"]>;
	private eventSequence = 0;
	private transactionDepth = 0;
	private closed = false;

	constructor(options: MissionStoreOptions) {
		if (!options.root) throw new MissionPersistenceError("constructor", "root-required");
		this.root = options.root;
		this.clock = options.clock ?? (() => new Date());
		this.makeId = options.id ?? randomUUID;
		this.maxJsonBytes = options.maxJsonBytes ?? 1_000_000;
		this.maxTextLength = options.maxTextLength ?? 32_000;
		this.leaseTtlMs = options.leaseTtlMs ?? 120_000;
		this.hooks = options.hooks ?? {};
		const path = options.databasePath ?? join(options.root, "mission.sqlite");
		this.databasePath = path;
		try {
			mkdirSync(options.root, { recursive: true, mode: 0o700 });
			if (statSafe(path) && statSafe(path)!.isDirectory()) throw new Error("database path is a directory");
			this.db = new DatabaseSync(path);
			this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
			chmodSafe(path, 0o600);
			chmodSafe(`${path}-wal`, 0o600);
			chmodSafe(`${path}-shm`, 0o600);
			// Create only the M6 base first. Existing v1 files therefore enter the
			// explicit migration path instead of being silently treated as v2.
			this.db.exec(MISSION_STORE_SCHEMA_V1_SQL);
			const meta = this.db.prepare("SELECT value FROM mission_store_meta WHERE key='schema_version'").get() as Row | undefined;
			if (meta && Number(meta.value) !== CURRENT_MISSION_STORE_SCHEMA_VERSION) {
				if (Number(meta.value) !== 1 || CURRENT_MISSION_STORE_SCHEMA_VERSION !== 2) throw new MissionVersionError(Number(meta.value), CURRENT_MISSION_STORE_SCHEMA_VERSION);
				this.db.exec("BEGIN IMMEDIATE");
				try { this.db.exec(MISSION_STORE_MIGRATION_1_TO_2_SQL); this.integrityCheck(); this.db.exec("COMMIT"); }
				catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* preserve migration failure */ } throw error; }
			} else if (!meta) {
				this.db.exec("BEGIN IMMEDIATE");
				try {
					this.db.exec(MISSION_STORE_SCHEMA_SQL);
					this.db.prepare("INSERT INTO mission_store_meta(key,value) VALUES ('schema_version',?)").run(String(CURRENT_MISSION_STORE_SCHEMA_VERSION));
					this.db.exec("COMMIT");
				} catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* preserve initialization failure */ } throw error; }
			} else {
				// Current database: ensure tables/indexes exist for a partially-created
				// v2 file, without mutating M6 rows.
				this.db.exec(MISSION_STORE_SCHEMA_SQL);
				this.db.exec("INSERT OR IGNORE INTO task_quality_status(task_id,mission_id,status,quality_round,latest_verification_id,latest_decision_id,updated_at) SELECT task_id,mission_id,'unverified',0,NULL,NULL,updated_at FROM tasks");
			}
			this.integrityCheck();
		} catch (error) {
			if (error instanceof MissionVersionError || error instanceof MissionCorruptError) throw error;
			throw new MissionPersistenceError("open", "Mission database could not be opened");
		}
	}

	private ensureOpen(): void { if (this.closed) throw new MissionClosedError(); }
	private tx<T>(fn: () => T): T {
		this.ensureOpen();
		if (this.transactionDepth > 0) return fn();
		try {
			this.hooks.fault?.("before-transaction");
			this.db.exec("BEGIN IMMEDIATE");
			this.transactionDepth = 1;
			const result = fn();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			try { this.db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
			throw error;
		} finally {
			this.transactionDepth = 0;
		}
	}
	private bounded(value: unknown, path: string): string {
		const text = json(value);
		if (Buffer.byteLength(text, "utf8") > this.maxJsonBytes) throw new MissionValidationError([{ path, message: "value exceeds bound" }]);
		return text;
	}
	private text(value: unknown, path: string): string {
		if (typeof value !== "string") throw new MissionValidationError([{ path, message: "text is missing or exceeds bound" }]);
		const normalized = normalizeMissionText(value);
		if (normalized.length === 0 || normalized.length > this.maxTextLength) throw new MissionValidationError([{ path, message: "text is missing or exceeds bound" }]);
		return normalized;
	}
	private missionRow(id: string): Row {
		const row = this.db.prepare("SELECT * FROM missions WHERE mission_id=?").get(id) as Row | undefined;
		if (!row) throw new MissionNotFoundError("mission", id);
		return row;
	}
	private assertMissionCompletable(missionId: string): void {
		const tasks = activeMissionTasks(this, missionId);
		if (tasks.length === 0) throw new MissionValidationError([{ path: "status", message: "mission requires at least one completed and passed task" }]);
		for (const task of tasks) {
			if (task.status !== "execution_completed") throw new MissionValidationError([{ path: "status", message: `task ${String(task.taskId)} is not execution-completed` }]);
			const quality = this.db.prepare("SELECT status,latest_decision_id FROM task_quality_status WHERE task_id=? AND mission_id=?").get(String(task.taskId), missionId) as Row | undefined;
			if (!quality || quality.status !== "passed" || typeof quality.latest_decision_id !== "string" || quality.latest_decision_id.length === 0) throw new MissionValidationError([{ path: "status", message: `task ${String(task.taskId)} has not passed quality review` }]);
		}
	}
	private missionFrom(row: Row): MissionRecord {
		return Object.freeze({
			missionId: row.mission_id as MissionId, revision: Number(row.revision), status: row.status as MissionStatus,
			goal: String(row.goal), title: String(row.title ?? row.goal), objective: String(row.objective ?? row.goal),
			constraints: parse(row.constraints_json, []), acceptanceCriteria: parse(row.acceptance_json, []),
			repository: parse(row.repository_json, {}), plan: parse(row.plan_json, null), approvedDecisions: parse(row.approved_decisions_json, []),
			validatedFindings: parse(row.validated_findings_json, []), completedWork: parse(row.completed_work_json, []),
			currentChangeState: parse(row.current_change_state_json, null), testReviewEvidence: parse(row.test_review_evidence_json, []),
			unresolvedIssues: parse(row.unresolved_issues_json, []), nextSteps: parse(row.next_steps_json, []),
			createdAt: String(row.created_at), updatedAt: String(row.updated_at),
		}) as MissionRecord;
	}
	private taskFrom(row: Row): TaskRecord {
		return Object.freeze({ taskId: row.task_id as TaskRecord["taskId"], missionId: row.mission_id as MissionId, revision: Number(row.revision),
			roleId: String(row.role_id), executionClass: row.execution_class as TaskRecord["executionClass"], ...(row.pool_id ? { poolId: String(row.pool_id) } : {}),
			...(row.last_run_id ? { lastRunId: row.last_run_id as TaskRecord["lastRunId"] } : {}), packetRevision: Number(row.packet_revision ?? 0),
			objective: String(row.objective), constraints: parse(row.constraints_json, []), acceptanceCriteria: parse(row.acceptance_json, []),
			allowedTools: parse(row.allowed_tools_json, []), allowedActions: parse(row.allowed_actions_json, []),
			...(row.output_schema_id ? { outputSchemaId: String(row.output_schema_id) } : {}), ...(row.context_budget == null ? {} : { contextBudget: Number(row.context_budget) }),
			...(row.packet_json ? { packet: parse(row.packet_json, null) } : {}), status: row.status as TaskStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
		}) as TaskRecord;
	}
	private event(missionId: string, revision: number, kind: string, actor = "system", payload?: unknown, taskId?: string, attemptId?: string): void {
		this.db.prepare("INSERT INTO mission_events(event_id,mission_id,revision,kind,actor,task_id,attempt_id,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
			.run(`event-${this.makeId()}-${++this.eventSequence}`, missionId, revision, kind, actor, taskId ?? null, attemptId ?? null, payload === undefined ? null : this.bounded(payload, "event.payload"), nowIso(this.clock));
		this.hooks.fault?.("after-event");
	}
	private snapshot(mission: MissionRecord): string { const value = this.bounded(mission, "mission"); this.hooks.fault?.("after-snapshot"); return value; }
	private bump(missionId: string, patch: MissionPatch, options: MissionTransitionOptions | undefined, kind: string): MissionRecord {
		const current = this.missionFrom(this.missionRow(missionId));
		if (options?.expectedRevision !== undefined && options.expectedRevision !== current.revision) throw new MissionConflictError(options.expectedRevision, current.revision);
		const updated = { ...current, ...clone(patch), revision: current.revision + 1, updatedAt: nowIso(this.clock) } as MissionRecord;
		this.db.prepare(`UPDATE missions SET revision=?,goal=?,constraints_json=?,acceptance_json=?,repository_json=?,plan_json=?,approved_decisions_json=?,current_change_state_json=?,unresolved_issues_json=?,next_steps_json=?,updated_at=? WHERE mission_id=? AND revision=?`)
			.run(updated.revision, updated.goal, json(updated.constraints), json(updated.acceptanceCriteria), json(updated.repository), json(updated.plan), json(updated.approvedDecisions), json(updated.currentChangeState), json(updated.unresolvedIssues), json(updated.nextSteps), updated.updatedAt, missionId, current.revision);
		this.db.prepare("INSERT INTO mission_revisions(mission_id,revision,snapshot_json,created_at) VALUES (?,?,?,?)").run(missionId, updated.revision, this.snapshot(updated), updated.updatedAt);
		this.event(missionId, updated.revision, kind, options?.actor ?? "system", options?.metadata);
		return Object.freeze(updated);
	}

	close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
	getMission(missionId: MissionId | string): MissionRecord | undefined { this.ensureOpen(); const row = this.db.prepare("SELECT * FROM missions WHERE mission_id=?").get(String(missionId)) as Row | undefined; return row ? this.missionFrom(row) : undefined; }
	listMissions(): readonly MissionRecord[] { this.ensureOpen(); return (this.db.prepare("SELECT * FROM missions ORDER BY created_at,mission_id").all() as Row[]).map((row) => this.missionFrom(row)); }
	createMission(input: MissionCreateInput): MissionRecord {
		const goal = this.text(input.goal, "goal"); const title = this.text(input.title ?? goal, "title"); const objective = this.text(input.objective ?? goal, "objective"); const id = idOf(input.missionId as string | undefined, "mission", this.makeId) as MissionId; const at = nowIso(this.clock);
		return this.tx(() => {
			if (this.db.prepare("SELECT 1 FROM missions WHERE mission_id=?").get(id)) throw new MissionValidationError([{ path: "missionId", message: "duplicate mission id" }]);
			const mission = Object.freeze({ missionId: id, revision: 1, status: input.status ?? "draft", goal, title, objective,
				constraints: clone(input.constraints ?? []), acceptanceCriteria: clone(input.acceptanceCriteria ?? []), repository: clone(input.repository ?? {}), plan: clone(input.plan ?? null), approvedDecisions: clone(input.approvedDecisions ?? []), validatedFindings: [], completedWork: [], currentChangeState: null, testReviewEvidence: [], unresolvedIssues: [], nextSteps: clone(input.nextSteps ?? []), createdAt: at, updatedAt: at }) as MissionRecord;
			this.db.prepare("INSERT INTO missions(mission_id,revision,status,title,objective,goal,constraints_json,acceptance_json,repository_json,plan_json,approved_decisions_json,validated_findings_json,completed_work_json,current_change_state_json,test_review_evidence_json,unresolved_issues_json,next_steps_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
				.run(mission.missionId, 1, mission.status, mission.title, mission.objective, mission.goal, json(mission.constraints), json(mission.acceptanceCriteria), json(mission.repository), json(mission.plan), json(mission.approvedDecisions), "[]", "[]", "null", "[]", "[]", json(mission.nextSteps), at, at);
			this.db.prepare("INSERT INTO mission_revisions(mission_id,revision,snapshot_json,created_at) VALUES (?,?,?,?)").run(id, 1, this.snapshot(mission), at); this.event(id, 1, "mission_created", input.actor ?? "user");
			return mission;
		});
	}
	updateMission(missionId: MissionId | string, patch: MissionPatch, options?: MissionTransitionOptions): MissionRecord { return this.tx(() => this.bump(String(missionId), patch, options, "mission_updated")); }
	transitionMission(missionId: MissionId | string, status: MissionStatus, options?: MissionTransitionOptions): MissionRecord { return this.tx(() => { const current = this.missionFrom(this.missionRow(String(missionId))); if (options?.expectedRevision !== undefined && options.expectedRevision !== current.revision) throw new MissionConflictError(options.expectedRevision, current.revision); const actor = options?.actor ?? "system"; if (status === "completed" && actor !== "boss") throw new MissionUnauthorizedError("Only the Boss may complete a mission"); if (status === "completed") this.assertMissionCompletable(String(missionId)); if (current.status === status) throw new MissionValidationError([{ path: "status", message: "mission is already in that state" }]); if (!canTransition(current.status, status)) throw new MissionValidationError([{ path: "status", message: `cannot transition mission from ${current.status} to ${status}` }]); const updated = { ...current, status, revision: current.revision + 1, currentChangeState: { status }, updatedAt: nowIso(this.clock) } as MissionRecord; this.db.prepare("UPDATE missions SET status=?,revision=?,current_change_state_json=?,updated_at=? WHERE mission_id=? AND revision=?").run(status, updated.revision, json(updated.currentChangeState), updated.updatedAt, String(missionId), current.revision); this.db.prepare("INSERT INTO mission_revisions(mission_id,revision,snapshot_json,created_at) VALUES (?,?,?,?)").run(String(missionId), updated.revision, this.snapshot(updated), updated.updatedAt); this.event(String(missionId), updated.revision, `mission_${status}`, actor, options?.metadata); return updated; }); }

	getTask(taskId: string): TaskRecord | undefined { this.ensureOpen(); const row = this.db.prepare("SELECT * FROM tasks WHERE task_id=?").get(taskId) as Row | undefined; return row ? this.taskFrom(row) : undefined; }
	listTasks(missionId: string): readonly TaskRecord[] { this.ensureOpen(); return (this.db.prepare("SELECT * FROM tasks WHERE mission_id=? ORDER BY created_at,task_id").all(missionId) as Row[]).map((r) => this.taskFrom(r)); }
	listCanonicalItems(missionId: string): readonly CanonicalItem[] { this.ensureOpen(); const rows = this.db.prepare("SELECT item_id,kind,value_json,source_evidence_id,promoted_at FROM canonical_items WHERE mission_id=? ORDER BY revision,item_id").all(missionId) as Row[]; return rows.map((row) => ({ itemId: String(row.item_id), kind: String(row.kind), value: parse(row.value_json, null), ...(row.source_evidence_id == null ? {} : { sourceEvidenceId: row.source_evidence_id as NonNullable<CanonicalItem["sourceEvidenceId"]> }), ...(row.promoted_at == null ? {} : { promotedAt: String(row.promoted_at) }) } as CanonicalItem)); }
	saveTaskPacket(taskId: string, packet: unknown, expectedRevision?: number): TaskRecord { return this.tx(() => { const row = this.db.prepare("SELECT * FROM tasks WHERE task_id=?").get(taskId) as Row | undefined; if (!row) throw new MissionNotFoundError("task", taskId); const current = this.taskFrom(row); if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new MissionConflictError(expectedRevision, current.revision); const nextRevision = current.revision + 1; const nextPacketRevision = current.packetRevision + 1; const at = nowIso(this.clock); this.db.prepare("UPDATE tasks SET packet_json=?,packet_revision=?,revision=?,updated_at=? WHERE task_id=? AND revision=?").run(this.bounded(packet, "task.packet"), nextPacketRevision, nextRevision, at, taskId, current.revision); this.event(String(current.missionId), nextRevision, "task_packet_created", "system", { packetRevision: nextPacketRevision }, taskId); return this.taskFrom(this.db.prepare("SELECT * FROM tasks WHERE task_id=?").get(taskId) as Row); }); }
	createTask(input: TaskCreateInput): TaskRecord {
		const mission = this.missionRow(String(input.missionId)); const id = idOf(input.taskId as string | undefined, "task", this.makeId); const at = nowIso(this.clock);
		return this.tx(() => { if (this.db.prepare("SELECT 1 FROM tasks WHERE task_id=?").get(id)) throw new MissionValidationError([{ path: "taskId", message: "duplicate task id" }]); if (input.contextBudget !== undefined && (!Number.isSafeInteger(input.contextBudget) || input.contextBudget <= 0)) throw new MissionValidationError([{ path: "contextBudget", message: "context budget must be a positive integer" }]);
			if (input.poolId !== undefined && !MISSION_POOL_IDS.has(input.poolId)) throw new MissionValidationError([{ path: "poolId", message: "pool must be investigation, implementation, or verification" }]);
			const task = Object.freeze({ taskId: id, missionId: String(input.missionId) as MissionId, revision: Number(mission.revision), roleId: this.text(input.roleId, "roleId"), executionClass: input.executionClass, ...(input.poolId ? { poolId: input.poolId } : {}), packetRevision: 0, objective: this.text(input.objective, "objective"), constraints: clone(input.constraints ?? []), acceptanceCriteria: clone(input.acceptanceCriteria ?? []), allowedTools: clone(input.allowedTools ?? []), allowedActions: clone(input.allowedActions ?? []), ...(input.outputSchemaId ? { outputSchemaId: input.outputSchemaId } : {}), ...(input.contextBudget === undefined ? {} : { contextBudget: input.contextBudget }), ...(input.packet === undefined ? {} : { packet: clone(input.packet) }), status: input.status ?? "pending", createdAt: at, updatedAt: at }) as TaskRecord;
			this.db.prepare("INSERT INTO tasks(task_id,mission_id,revision,role_id,execution_class,pool_id,objective,constraints_json,acceptance_json,allowed_tools_json,allowed_actions_json,output_schema_id,context_budget,packet_json,packet_revision,last_run_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, task.missionId, task.revision, task.roleId, task.executionClass, task.poolId ?? null, task.objective, json(task.constraints), json(task.acceptanceCriteria), json(task.allowedTools), json(task.allowedActions), task.outputSchemaId ?? null, task.contextBudget ?? null, task.packet === undefined ? null : this.bounded(task.packet, "task.packet"), 0, null, task.status, at, at);
				this.db.prepare("INSERT INTO task_quality_status(task_id,mission_id,status,quality_round,latest_verification_id,latest_decision_id,updated_at) VALUES (?,?,?,0,NULL,NULL,?)").run(id, task.missionId, "unverified", at);
				this.event(task.missionId, Number(mission.revision), "task_created", "user", undefined, id); return task;
			});
		}
	private setTask(taskId: string, status: TaskStatus, options?: TaskStatusOptions): TaskRecord { return this.tx(() => { const row = this.db.prepare("SELECT * FROM tasks WHERE task_id=?").get(taskId) as Row | undefined; if (!row) throw new MissionNotFoundError("task", taskId); const task = this.taskFrom(row); if (options?.expectedRevision !== undefined && options.expectedRevision !== task.revision) throw new MissionConflictError(options.expectedRevision, task.revision); const at = nowIso(this.clock); this.db.prepare("UPDATE tasks SET status=?,revision=?,updated_at=? WHERE task_id=?").run(status, task.revision + 1, at, taskId); this.event(String(task.missionId), task.revision + 1, `task_${status}`, options?.actor ?? "system", options?.reason, taskId); return this.taskFrom(this.db.prepare("SELECT * FROM tasks WHERE task_id=?").get(taskId) as Row); }); }
	startTask(taskId: string, options?: TaskStatusOptions): TaskRecord { const task = this.getTask(taskId); if (!task) throw new MissionNotFoundError("task", taskId); if (!["pending", "planned", "ready", "interrupted"].includes(task.status)) throw new MissionValidationError([{ path: "status", message: "task is not runnable" }]); return this.setTask(taskId, "running", options); }
	finishTask(taskId: string, status: Extract<TaskStatus, "succeeded" | "failed" | "cancelled" | "blocked" | "execution_completed"> = "execution_completed", options?: TaskStatusOptions): TaskRecord { return this.setTask(taskId, status, options); }

	createAttempt(input: AttemptCreateInput): AttemptRecord { return this.tx(() => { const task = this.getTask(input.taskId); if (!task) throw new MissionNotFoundError("task", String(input.taskId)); const active = this.db.prepare("SELECT attempt_id FROM attempts WHERE task_id=? AND status='running' LIMIT 1").get(String(input.taskId)) as Row | undefined; if (active) throw new MissionLeaseError("task is already leased by an active attempt"); const ttl = input.leaseTtlMs ?? this.leaseTtlMs; if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new MissionLeaseError("lease ttl must be positive"); const id = idOf(input.attemptId as string | undefined, "attempt", this.makeId); if (this.db.prepare("SELECT 1 FROM attempts WHERE attempt_id=?").get(id)) throw new MissionValidationError([{ path: "attemptId", message: "duplicate attempt id" }]); const at = nowIso(this.clock); const expires = new Date(this.clock().getTime() + ttl).toISOString(); const packetRevision = input.packetRevision ?? task.packetRevision; this.db.prepare("UPDATE tasks SET status='running',last_run_id=?,revision=revision+1,updated_at=? WHERE task_id=?").run(id, at, String(input.taskId)); this.db.prepare("INSERT INTO attempts(attempt_id,task_id,mission_id,revision,route_id,remote_model_id,status,lease_owner,lease_expires_at,started_at,ended_at,terminal_state,mutation_observed,result_json,packet_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.taskId, task.missionId, task.revision + 1, input.routeId ?? null, input.remoteModelId ?? null, "running", input.leaseOwner ?? null, input.leaseOwner ? expires : null, at, null, null, 0, null, packetRevision, at, at); if (task.executionClass === "implementation") this.db.prepare("INSERT INTO task_quality_status(task_id,mission_id,status,quality_round,latest_verification_id,latest_decision_id,updated_at) VALUES (?,?,?,0,NULL,NULL,?) ON CONFLICT(task_id) DO UPDATE SET status='unverified',quality_round=0,latest_verification_id=NULL,latest_decision_id=NULL,updated_at=excluded.updated_at").run(input.taskId, task.missionId, "unverified", at); this.event(String(task.missionId), task.revision + 1, "task_started", "system", undefined, String(input.taskId), id); return this.attempt(id)!; }); }
	updateAttemptProvenance(attemptId: string, options: { readonly routeId?: string; readonly remoteModelId?: string; readonly packetRevision?: number }): AttemptRecord { return this.tx(() => { const current = this.attempt(attemptId); if (!current) throw new MissionNotFoundError("attempt", attemptId); if (current.status !== "running") throw new MissionValidationError([{ path: "attemptId", message: "attempt is already terminal" }]); this.db.prepare("UPDATE attempts SET route_id=COALESCE(?,route_id),remote_model_id=COALESCE(?,remote_model_id),packet_revision=COALESCE(?,packet_revision),updated_at=? WHERE attempt_id=?").run(options.routeId ?? null, options.remoteModelId ?? null, options.packetRevision ?? null, nowIso(this.clock), attemptId); return this.attempt(attemptId)!; }); }
	getAttempt(attemptId: string): AttemptRecord | undefined { this.ensureOpen(); return this.attempt(attemptId); }
	private attempt(id: string): AttemptRecord | undefined { const row = this.db.prepare("SELECT * FROM attempts WHERE attempt_id=?").get(id) as Row | undefined; if (!row) return undefined; return ({ attemptId: row.attempt_id as AttemptRecord["attemptId"], taskId: row.task_id as AttemptRecord["taskId"], missionId: row.mission_id as MissionId, revision: Number(row.revision), ...(row.route_id ? { routeId: row.route_id as AttemptRecord["routeId"] } : {}), ...(row.remote_model_id ? { remoteModelId: String(row.remote_model_id) } : {}), status: row.status as AttemptStatus, ...(row.lease_owner ? { leaseOwner: row.lease_owner as LeaseOwner } : {}), ...(row.lease_expires_at ? { leaseExpiresAt: String(row.lease_expires_at) } : {}), startedAt: String(row.started_at), ...(row.ended_at ? { endedAt: String(row.ended_at) } : {}), ...(row.terminal_state ? { terminalState: String(row.terminal_state) } : {}), mutationObserved: Number(row.mutation_observed) === 1, ...(row.result_json ? { result: parse(row.result_json, null) } : {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(row.packet_revision == null ? {} : { packetRevision: Number(row.packet_revision) }) } as unknown as AttemptRecord); }
	finishAttempt(attemptId: string, status: Exclude<AttemptStatus, "running">, options: { readonly terminalState?: string; readonly mutationObserved?: boolean; readonly result?: unknown } = {}): AttemptRecord { return this.tx(() => { const current = this.attempt(attemptId); if (!current) throw new MissionNotFoundError("attempt", attemptId); if (current.status !== "running") throw new MissionValidationError([{ path: "status", message: "attempt is already terminal" }]); const at = nowIso(this.clock); const mutationObserved = options.mutationObserved ?? current.mutationObserved; this.db.prepare("UPDATE attempts SET status=?,ended_at=?,terminal_state=?,mutation_observed=?,result_json=?,updated_at=? WHERE attempt_id=?").run(status, at, options.terminalState ?? null, mutationObserved ? 1 : 0, options.result === undefined ? null : this.bounded(options.result, "attempt.result"), at, attemptId); const taskStatus: TaskStatus = status === "succeeded" ? "execution_completed" : status === "interrupted" ? "interrupted" : status === "cancelled" ? "cancelled" : status === "timed-out" ? "interrupted" : "blocked"; this.db.prepare("UPDATE tasks SET status=?,revision=revision+1,updated_at=? WHERE task_id=?").run(taskStatus, at, current.taskId); this.event(String(current.missionId), current.revision + 1, `attempt_${status}`, "system", undefined, String(current.taskId), attemptId); return this.attempt(attemptId)!; }); }

	private qualityList(value: unknown, path: string): readonly string[] {
		if (!Array.isArray(value) || value.length > 128 || value.some((item) => typeof item !== "string" || item.length > this.maxTextLength)) throw new MissionValidationError([{ path, message: "bounded string list is invalid" }]);
		return value.map((item) => String(item).trim()).filter(Boolean);
	}
	private verificationFrom(row: Row): VerificationRunRecord {
		return {
			verificationId: String(row.verification_id), missionId: row.mission_id as VerificationRunRecord["missionId"], taskId: row.task_id as VerificationRunRecord["taskId"], targetRunId: String(row.target_run_id),
			...(row.target_packet_id == null ? {} : { targetPacketId: String(row.target_packet_id) }), round: Number(row.round),
			...(row.reviewer_run_id == null ? {} : { reviewerRunId: String(row.reviewer_run_id) }), ...(row.reviewer_route_id == null ? {} : { reviewerRouteId: String(row.reviewer_route_id) }),
			...(row.reviewer_remote_model_id == null ? {} : { reviewerRemoteModelId: String(row.reviewer_remote_model_id) }), ...(row.implementation_route_id == null ? {} : { implementationRouteId: String(row.implementation_route_id) }),
			status: row.status as VerificationStatus, startedAt: String(row.started_at), ...(row.completed_at == null ? {} : { completedAt: String(row.completed_at) }),
			...(row.quality_decision_id == null ? {} : { qualityDecisionId: String(row.quality_decision_id) }), potentialMutationObserved: Number(row.potential_mutation_observed) === 1,
			...(row.failure_summary == null ? {} : { failureSummary: String(row.failure_summary) }),
		};
	}
	private decisionFrom(row: Row): QualityDecisionRecord {
		return {
			decisionId: String(row.decision_id), missionId: row.mission_id as QualityDecisionRecord["missionId"], taskId: row.task_id as QualityDecisionRecord["taskId"], verificationId: String(row.verification_id), targetRunId: String(row.target_run_id),
			...(row.target_packet_id == null ? {} : { targetPacketId: String(row.target_packet_id) }), round: Number(row.round), verdict: row.verdict as QualityDecisionRecord["verdict"], criterionResults: parse(row.criterion_results_json, []), mechanicalChecks: parse(row.mechanical_checks_json, []), reviewerSummary: String(row.reviewer_summary), findings: parse(row.findings_json, []), requiredFixes: parse(row.required_fixes_json, []), risks: parse(row.risks_json, []), ...(row.reviewer_route_id == null ? {} : { reviewerRouteId: String(row.reviewer_route_id) }), createdAt: String(row.created_at),
		} as QualityDecisionRecord;
	}
	private escalationFrom(row: Row): QualityEscalationRequest {
		return {
			escalationId: String(row.escalation_id), missionId: row.mission_id as QualityEscalationRequest["missionId"], taskId: row.task_id as QualityEscalationRequest["taskId"], rejectedRunId: String(row.rejected_run_id), verificationId: String(row.verification_id), qualityRound: Number(row.quality_round), failedCriteria: parse(row.failed_criteria_json, []), requiredFixes: parse(row.required_fixes_json, []), reviewerFindings: parse(row.reviewer_findings_json, []), priorImplementationRouteIds: parse(row.prior_implementation_route_ids_json, []), ...(row.reviewer_route_id == null ? {} : { reviewerRouteId: String(row.reviewer_route_id) }), preferredPool: "implementation", routeExclusions: parse(row.route_exclusions_json, []), diversity: row.diversity as DiversityPreference, status: row.status as QualityEscalationRequest["status"], createdAt: String(row.created_at),
		};
	}
	createVerificationRun(input: VerificationRunInput): VerificationRunRecord {
		return this.tx(() => {
			const mission = this.missionRow(String(input.missionId)); const task = this.db.prepare("SELECT * FROM tasks WHERE task_id=?").get(String(input.taskId)) as Row | undefined;
			if (!task) throw new MissionNotFoundError("task", String(input.taskId));
			if (String(task.mission_id) !== String(input.missionId)) throw new MissionValidationError([{ path: "taskId", message: "task does not belong to mission" }]);
			const targetAttempt = this.attempt(String(input.targetRunId));
			if (!targetAttempt) throw new MissionNotFoundError("attempt", String(input.targetRunId));
			if (String(targetAttempt.missionId) !== String(input.missionId) || String(targetAttempt.taskId) !== String(input.taskId)) throw new MissionValidationError([{ path: "targetRunId", message: "target attempt does not belong to mission task" }]);
			if (targetAttempt.status !== "succeeded") throw new MissionValidationError([{ path: "targetRunId", message: "target attempt did not succeed" }]);
			const id = idOf(input.verificationId, "verification", this.makeId); const round = input.round ?? 0;
			if (!Number.isSafeInteger(round) || round < 0) throw new MissionValidationError([{ path: "round", message: "round must be a non-negative integer" }]);
			if (this.db.prepare("SELECT 1 FROM verification_runs WHERE verification_id=?").get(id)) throw new MissionValidationError([{ path: "verificationId", message: "duplicate verification id" }]);
			if (this.db.prepare("SELECT 1 FROM verification_runs WHERE mission_id=? AND task_id=? AND status='running'").get(String(input.missionId), String(input.taskId))) throw new MissionValidationError([{ path: "taskId", message: "task already has a running verification" }]);
			const at = nowIso(this.clock);
			this.db.prepare("INSERT INTO verification_runs(verification_id,mission_id,task_id,target_run_id,target_packet_id,round,reviewer_run_id,reviewer_route_id,reviewer_remote_model_id,implementation_route_id,status,started_at,completed_at,quality_decision_id,potential_mutation_observed,failure_summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.missionId, input.taskId, this.text(input.targetRunId, "targetRunId"), input.targetPacketId ?? null, round, input.reviewerRunId ?? null, input.reviewerRouteId ?? null, input.reviewerRemoteModelId ?? null, input.implementationRouteId ?? null, "running", at, null, null, input.potentialMutationObserved ? 1 : 0, null);
			this.event(String(input.missionId), Number(mission.revision), "verification_started", "system", { verificationId: id, taskId: String(input.taskId), round });
			return this.verificationFrom(this.db.prepare("SELECT * FROM verification_runs WHERE verification_id=?").get(id) as Row);
		});
	}
	getVerificationRun(verificationId: string): VerificationRunRecord | undefined { this.ensureOpen(); const row = this.db.prepare("SELECT * FROM verification_runs WHERE verification_id=?").get(verificationId) as Row | undefined; return row ? this.verificationFrom(row) : undefined; }
	updateVerificationRun(verificationId: string, patch: Partial<VerificationRunRecord>): VerificationRunRecord {
		return this.tx(() => {
			const row = this.db.prepare("SELECT * FROM verification_runs WHERE verification_id=?").get(verificationId) as Row | undefined; if (!row) throw new MissionNotFoundError("verification", verificationId);
			const current = this.verificationFrom(row); if (patch.missionId !== undefined && String(patch.missionId) !== String(current.missionId)) throw new MissionValidationError([{ path: "missionId", message: "verification identity is immutable" }]); if (patch.taskId !== undefined && String(patch.taskId) !== String(current.taskId)) throw new MissionValidationError([{ path: "taskId", message: "verification identity is immutable" }]); if (patch.targetRunId !== undefined && String(patch.targetRunId) !== String(current.targetRunId)) throw new MissionValidationError([{ path: "targetRunId", message: "verification target is immutable" }]); if (current.status !== "running" && patch.status !== undefined && patch.status !== current.status) throw new MissionValidationError([{ path: "status", message: "verification is already terminal" }]);
			const next = { ...current, ...patch } as VerificationRunRecord; if (!["running", "completed", "interrupted", "blocked"].includes(next.status)) throw new MissionValidationError([{ path: "status", message: "verification status is invalid" }]);
			if (next.status === "completed" && next.qualityDecisionId === undefined) throw new MissionValidationError([{ path: "qualityDecisionId", message: "completed verification requires a quality decision" }]);
			if (!Number.isSafeInteger(next.round) || next.round < 0) throw new MissionValidationError([{ path: "round", message: "round must be a non-negative integer" }]);
			const failure = next.failureSummary === undefined ? null : this.text(next.failureSummary, "failureSummary"); const at = next.completedAt ?? (next.status === "running" ? null : nowIso(this.clock));
			this.db.prepare("UPDATE verification_runs SET target_run_id=?,target_packet_id=?,round=?,reviewer_run_id=?,reviewer_route_id=?,reviewer_remote_model_id=?,implementation_route_id=?,status=?,completed_at=?,quality_decision_id=?,potential_mutation_observed=?,failure_summary=? WHERE verification_id=?").run(this.text(next.targetRunId, "targetRunId"), next.targetPacketId ?? null, next.round, next.reviewerRunId ?? null, next.reviewerRouteId ?? null, next.reviewerRemoteModelId ?? null, next.implementationRouteId ?? null, next.status, at, next.qualityDecisionId ?? null, next.potentialMutationObserved ? 1 : 0, failure, verificationId);
			this.event(String(current.missionId), Number(this.missionRow(String(current.missionId)).revision), `verification_${next.status}`, "system", { verificationId });
			return this.verificationFrom(this.db.prepare("SELECT * FROM verification_runs WHERE verification_id=?").get(verificationId) as Row);
		});
	}
	recordQualityDecision(input: QualityDecisionInput): QualityDecisionRecord {
		return this.tx(() => {
			const mission = this.missionRow(String(input.missionId)); const task = this.db.prepare("SELECT mission_id FROM tasks WHERE task_id=?").get(String(input.taskId)) as Row | undefined; if (!task) throw new MissionNotFoundError("task", String(input.taskId)); if (String(task.mission_id) !== String(input.missionId)) throw new MissionValidationError([{ path: "taskId", message: "task does not belong to mission" }]);
			const verification = this.getVerificationRun(input.verificationId); if (!verification) throw new MissionNotFoundError("verification", input.verificationId); if (String(verification.missionId) !== String(input.missionId) || String(verification.taskId) !== String(input.taskId)) throw new MissionValidationError([{ path: "verificationId", message: "verification does not belong to target" }]); if (String(input.targetRunId) !== String(verification.targetRunId)) throw new MissionValidationError([{ path: "targetRunId", message: "decision target does not match verification" }]); if (verification.status !== "running") throw new MissionValidationError([{ path: "verificationId", message: "quality decision requires a running verification" }]); if (this.db.prepare("SELECT 1 FROM quality_decisions WHERE verification_id=?").get(input.verificationId)) throw new MissionValidationError([{ path: "verificationId", message: "verification already has a quality decision" }]);
			if (!Number.isSafeInteger(input.round) || input.round < 0) throw new MissionValidationError([{ path: "round", message: "round must be a non-negative integer" }]); if (input.round !== verification.round) throw new MissionValidationError([{ path: "round", message: "decision round does not match verification" }]); if (!["pass", "reject", "blocked"].includes(input.gate.verdict)) throw new MissionValidationError([{ path: "gate.verdict", message: "quality verdict is invalid" }]);
			const id = idOf(input.decisionId, "decision", this.makeId); if (this.db.prepare("SELECT 1 FROM quality_decisions WHERE decision_id=?").get(id)) throw new MissionValidationError([{ path: "decisionId", message: "duplicate decision id" }]); const at = nowIso(this.clock); const summary = this.text(input.reviewerSummary, "reviewerSummary");
			const findings = this.qualityList(input.findings ?? input.gate.findings ?? [], "quality.findings"); const requiredFixes = this.qualityList(input.requiredFixes ?? input.gate.requiredFixes ?? [], "quality.requiredFixes"); const risks = this.qualityList(input.risks ?? input.gate.risks ?? [], "quality.risks");
			this.db.prepare("INSERT INTO quality_decisions(decision_id,mission_id,task_id,verification_id,target_run_id,target_packet_id,round,verdict,criterion_results_json,mechanical_checks_json,reviewer_summary,findings_json,required_fixes_json,risks_json,gate_reasons_json,reviewer_route_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.missionId, input.taskId, input.verificationId, this.text(input.targetRunId, "targetRunId"), input.targetPacketId ?? null, input.round, input.gate.verdict, this.bounded(input.gate.criterionResults, "quality.criterionResults"), this.bounded(input.gate.mechanicalChecks, "quality.mechanicalChecks"), summary, this.bounded(findings, "quality.findings"), this.bounded(requiredFixes, "quality.requiredFixes"), this.bounded(risks, "quality.risks"), this.bounded(input.gate.reasons, "quality.reasons"), input.reviewerRouteId ?? null, at);
			this.db.prepare("UPDATE verification_runs SET quality_decision_id=? WHERE verification_id=?").run(id, input.verificationId); this.event(String(input.missionId), Number(mission.revision), `quality_${input.gate.verdict}`, "reviewer", { decisionId: id, verificationId: input.verificationId, round: input.round });
			return this.decisionFrom(this.db.prepare("SELECT * FROM quality_decisions WHERE decision_id=?").get(id) as Row);
		});
	}
	finalizeQualityVerification(input: QualityFinalizationInput): QualityFinalizationResult {
		return this.tx(() => {
			const decision = this.recordQualityDecision(input.decision);
			const completed = this.updateVerificationRun(input.verificationId, { status: "completed", completedAt: decision.createdAt, qualityDecisionId: decision.decisionId });
			const status: TaskQualityStatus = { taskId: completed.taskId, missionId: completed.missionId, status: decision.verdict === "pass" ? "passed" : decision.verdict === "reject" ? "rejected" : "blocked", qualityRound: completed.round, latestVerificationId: completed.verificationId, latestDecisionId: decision.decisionId, updatedAt: decision.createdAt };
			return { run: completed, decision, status: this.setTaskQualityStatus(status) };
		});
	}
	finalizeQualityFailure(input: QualityFailureFinalizationInput): QualityFailureFinalizationResult {
		return this.tx(() => {
			const current = this.getVerificationRun(input.verificationId);
			if (!current) throw new MissionNotFoundError("verification", input.verificationId);
			if (current.status !== "running") return { run: current, status: this.getTaskQualityStatus(String(current.taskId))! };
			const updated = this.updateVerificationRun(input.verificationId, { status: input.status === "review_required" ? "interrupted" : "blocked", failureSummary: input.failureSummary });
			const status: TaskQualityStatus = { taskId: updated.taskId, missionId: updated.missionId, status: input.status, qualityRound: updated.round, latestVerificationId: updated.verificationId, updatedAt: updated.completedAt ?? updated.startedAt };
			return { run: updated, status: this.setTaskQualityStatus(status) };
		});
	}
	createQualityEscalation(input: QualityEscalationInput): QualityEscalationRequest {
		return this.tx(() => {
			const mission = this.missionRow(String(input.missionId)); const task = this.db.prepare("SELECT mission_id FROM tasks WHERE task_id=?").get(String(input.taskId)) as Row | undefined; if (!task) throw new MissionNotFoundError("task", String(input.taskId)); if (String(task.mission_id) !== String(input.missionId)) throw new MissionValidationError([{ path: "taskId", message: "task does not belong to mission" }]);
			const id = idOf(input.escalationId, "escalation", this.makeId); if (this.db.prepare("SELECT 1 FROM quality_escalations WHERE escalation_id=?").get(id)) throw new MissionValidationError([{ path: "escalationId", message: "duplicate escalation id" }]); if (!Number.isSafeInteger(input.qualityRound) || input.qualityRound < 0) throw new MissionValidationError([{ path: "qualityRound", message: "quality round is invalid" }]);
			const failedCriteria = this.qualityList(input.failedCriteria, "failedCriteria"); const requiredFixes = this.qualityList(input.requiredFixes, "requiredFixes"); const reviewerFindings = this.qualityList(input.reviewerFindings, "reviewerFindings"); const priorRoutes = this.qualityList(input.priorImplementationRouteIds, "priorImplementationRouteIds"); const exclusions = this.qualityList(input.routeExclusions ?? [], "routeExclusions"); const diversity = input.diversity ?? "prefer"; if (!["none", "prefer", "require"].includes(diversity)) throw new MissionValidationError([{ path: "diversity", message: "diversity is invalid" }]);
			const verification = this.getVerificationRun(input.verificationId); if (!verification) throw new MissionNotFoundError("verification", input.verificationId); if (String(verification.missionId) !== String(input.missionId) || String(verification.taskId) !== String(input.taskId)) throw new MissionValidationError([{ path: "verificationId", message: "verification does not belong to target" }]); if (String(input.rejectedRunId) !== String(verification.targetRunId)) throw new MissionValidationError([{ path: "rejectedRunId", message: "escalation target does not match verification" }]);
			const status = input.status ?? "ready"; const at = nowIso(this.clock); this.db.prepare("INSERT INTO quality_escalations(escalation_id,mission_id,task_id,rejected_run_id,verification_id,quality_round,failed_criteria_json,required_fixes_json,reviewer_findings_json,prior_implementation_route_ids_json,reviewer_route_id,preferred_pool,route_exclusions_json,diversity,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.missionId, input.taskId, this.text(input.rejectedRunId, "rejectedRunId"), this.text(input.verificationId, "verificationId"), input.qualityRound, this.bounded(failedCriteria, "failedCriteria"), this.bounded(requiredFixes, "requiredFixes"), this.bounded(reviewerFindings, "reviewerFindings"), this.bounded(priorRoutes, "priorImplementationRouteIds"), input.reviewerRouteId ?? null, "implementation", this.bounded(exclusions, "routeExclusions"), diversity, status, at); this.event(String(input.missionId), Number(mission.revision), "escalation_created", "system", { escalationId: id, qualityRound: input.qualityRound }); return this.escalationFrom(this.db.prepare("SELECT * FROM quality_escalations WHERE escalation_id=?").get(id) as Row);
		});
	}
	getTaskQualityStatus(taskId: string): TaskQualityStatus | undefined { this.ensureOpen(); const row = this.db.prepare("SELECT * FROM task_quality_status WHERE task_id=?").get(taskId) as Row | undefined; return row ? ({ taskId: row.task_id as TaskQualityStatus["taskId"], missionId: row.mission_id as TaskQualityStatus["missionId"], status: row.status as QualityStatus, qualityRound: Number(row.quality_round), ...(row.latest_verification_id == null ? {} : { latestVerificationId: String(row.latest_verification_id) }), ...(row.latest_decision_id == null ? {} : { latestDecisionId: String(row.latest_decision_id) }), updatedAt: String(row.updated_at) } as TaskQualityStatus) : undefined; }
	setTaskQualityStatus(input: TaskQualityStatus): TaskQualityStatus { return this.tx(() => {
			const missionId = String(input.missionId); const taskId = String(input.taskId); this.missionRow(missionId);
			if (!this.db.prepare("SELECT 1 FROM tasks WHERE task_id=? AND mission_id=?").get(taskId, missionId)) throw new MissionNotFoundError("task", taskId);
			if (!Number.isSafeInteger(input.qualityRound) || input.qualityRound < 0) throw new MissionValidationError([{ path: "qualityRound", message: "quality round is invalid" }]);
			if (!["unverified", "verification_running", "passed", "rejected", "blocked", "review_required"].includes(input.status)) throw new MissionValidationError([{ path: "status", message: "quality status is invalid" }]);
			const verification = input.latestVerificationId === undefined ? undefined : this.getVerificationRun(input.latestVerificationId);
			if (input.latestVerificationId !== undefined && (!verification || String(verification.missionId) !== missionId || String(verification.taskId) !== taskId)) throw new MissionValidationError([{ path: "latestVerificationId", message: "verification does not belong to task" }]);
			const decisionRow = input.latestDecisionId === undefined ? undefined : this.db.prepare("SELECT * FROM quality_decisions WHERE decision_id=?").get(input.latestDecisionId) as Row | undefined;
			const decision = decisionRow ? this.decisionFrom(decisionRow) : undefined;
			if (input.latestDecisionId !== undefined && (!decision || String(decision.missionId) !== missionId || String(decision.taskId) !== taskId)) throw new MissionValidationError([{ path: "latestDecisionId", message: "decision does not belong to task" }]);
			if (decision && verification && decision.verificationId !== verification.verificationId) throw new MissionValidationError([{ path: "latestDecisionId", message: "decision verification does not match latest verification" }]);
			if (input.status === "verification_running" && verification?.status !== "running") throw new MissionValidationError([{ path: "status", message: "running quality status requires a running verification" }]);
			if (input.status === "passed" && (decision?.verdict !== "pass" || verification?.status !== "completed")) throw new MissionValidationError([{ path: "status", message: "passed quality status requires a completed passing decision" }]);
			if (input.status === "rejected" && (decision?.verdict !== "reject" || verification?.status !== "completed")) throw new MissionValidationError([{ path: "status", message: "rejected quality status requires a completed rejecting decision" }]);
			if (input.status === "blocked" && (decision === undefined ? !["blocked", "interrupted"].includes(verification?.status ?? "") : decision.verdict !== "blocked" || verification?.status !== "completed")) throw new MissionValidationError([{ path: "status", message: "blocked quality status requires completed verification failure evidence" }]);
			const at = this.text(input.updatedAt, "updatedAt");
			this.db.prepare("INSERT INTO task_quality_status(task_id,mission_id,status,quality_round,latest_verification_id,latest_decision_id,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET mission_id=excluded.mission_id,status=excluded.status,quality_round=excluded.quality_round,latest_verification_id=excluded.latest_verification_id,latest_decision_id=excluded.latest_decision_id,updated_at=excluded.updated_at").run(input.taskId, input.missionId, input.status, input.qualityRound, input.latestVerificationId ?? null, input.latestDecisionId ?? null, at);
			this.event(missionId, Number(this.missionRow(missionId).revision), "quality_status_changed", "system", { taskId, status: input.status, qualityRound: input.qualityRound }); return this.getTaskQualityStatus(taskId)!;
		}); }
	listVerificationRuns(missionId: string, taskId?: string): readonly VerificationRunRecord[] { this.ensureOpen(); const rows = (taskId === undefined ? this.db.prepare("SELECT * FROM verification_runs WHERE mission_id=? ORDER BY round,started_at,verification_id").all(missionId) : this.db.prepare("SELECT * FROM verification_runs WHERE mission_id=? AND task_id=? ORDER BY round,started_at,verification_id").all(missionId, taskId)) as Row[]; return rows.map((row) => this.verificationFrom(row)); }
	listQualityDecisions(missionId: string, taskId?: string): readonly QualityDecisionRecord[] { this.ensureOpen(); const rows = (taskId === undefined ? this.db.prepare("SELECT * FROM quality_decisions WHERE mission_id=? ORDER BY round,created_at,decision_id").all(missionId) : this.db.prepare("SELECT * FROM quality_decisions WHERE mission_id=? AND task_id=? ORDER BY round,created_at,decision_id").all(missionId, taskId)) as Row[]; return rows.map((row) => this.decisionFrom(row)); }
	listQualityEscalations(missionId: string, taskId?: string): readonly QualityEscalationRequest[] { this.ensureOpen(); const rows = (taskId === undefined ? this.db.prepare("SELECT * FROM quality_escalations WHERE mission_id=? ORDER BY quality_round,created_at,escalation_id").all(missionId) : this.db.prepare("SELECT * FROM quality_escalations WHERE mission_id=? AND task_id=? ORDER BY quality_round,created_at,escalation_id").all(missionId, taskId)) as Row[]; return rows.map((row) => this.escalationFrom(row)); }

	admitEvidence(input: EvidenceInput): EvidenceRecord { return this.tx(() => { const mission = this.missionRow(String(input.missionId)); const taskId = input.taskId === undefined ? undefined : String(input.taskId); const attemptId = input.attemptId === undefined ? undefined : String(input.attemptId); const runId = input.runId === undefined ? undefined : String(input.runId); if (taskId !== undefined && !this.db.prepare("SELECT 1 FROM tasks WHERE task_id=? AND mission_id=?").get(taskId, String(input.missionId))) throw new MissionValidationError([{ path: "taskId", message: "task does not belong to mission" }]); const linkedAttempt = attemptId === undefined ? undefined : this.attempt(attemptId); if (attemptId !== undefined && !linkedAttempt) throw new MissionNotFoundError("attempt", attemptId); if (linkedAttempt && (String(linkedAttempt.missionId) !== String(input.missionId) || (taskId !== undefined && String(linkedAttempt.taskId) !== taskId))) throw new MissionValidationError([{ path: "attemptId", message: "attempt does not belong to mission task" }]); const linkedTaskId = taskId ?? (linkedAttempt === undefined ? undefined : String(linkedAttempt.taskId)); const id = idOf(input.evidenceId as string | undefined, "evidence", this.makeId); if (this.db.prepare("SELECT 1 FROM evidence WHERE evidence_id=?").get(id)) throw new MissionValidationError([{ path: "evidenceId", message: "duplicate evidence id" }]); const content = this.bounded(input.content, "evidence.content"); const artifactRefs = this.bounded(input.artifactRefs ?? [], "evidence.artifactRefs"); const at = nowIso(this.clock); const record = { evidenceId: id, missionId: String(input.missionId), ...(linkedTaskId ? { taskId: linkedTaskId as EvidenceRecord["taskId"] } : {}), ...(linkedAttempt ? { attemptId: linkedAttempt.attemptId } : {}), kind: this.text(input.kind, "evidence.kind"), status: "proposed" as const, content: clone(input.content), artifactRefs: clone(input.artifactRefs ?? []), ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }), admittedAt: at, ...(input.packetRevision === undefined ? {} : { packetRevision: input.packetRevision }), ...(runId ? { runId: runId as AttemptRecord["attemptId"] } : {}), ...(input.routeId ? { routeId: input.routeId } : {}), ...(input.remoteModelId ? { remoteModelId: input.remoteModelId } : {}), ...(input.roleId ? { roleId: input.roleId } : {}), ...(input.executionClass ? { executionClass: input.executionClass } : {}) } as EvidenceRecord; this.db.prepare("INSERT INTO evidence(evidence_id,mission_id,task_id,attempt_id,kind,status,content_json,artifact_refs_json,source_revision,admitted_at,reviewed_at,rejection_reason,packet_revision,run_id,route_id,remote_model_id,role_id,execution_class) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, record.missionId, record.taskId ?? null, record.attemptId ?? null, record.kind, "proposed", content, artifactRefs, record.sourceRevision ?? null, at, null, null, record.packetRevision ?? null, record.runId ?? null, record.routeId ?? null, record.roleId ?? null, record.executionClass ?? null); this.event(String(input.missionId), Number(mission.revision), "evidence_proposed", input.actor ?? "worker", { evidenceId: id }); return record; }); }
	private evidence(id: string): EvidenceRecord { const row = this.db.prepare("SELECT * FROM evidence WHERE evidence_id=?").get(id) as Row | undefined; if (!row) throw new MissionNotFoundError("evidence", id); return ({ evidenceId: row.evidence_id as EvidenceRecord["evidenceId"], missionId: row.mission_id as MissionId, ...(row.task_id ? { taskId: row.task_id as EvidenceRecord["taskId"] } : {}), ...(row.attempt_id ? { attemptId: row.attempt_id as EvidenceRecord["attemptId"] } : {}), kind: String(row.kind), status: row.status as EvidenceStatus, content: parse(row.content_json, null), artifactRefs: parse(row.artifact_refs_json, []), ...(row.source_revision == null ? {} : { sourceRevision: Number(row.source_revision) }), admittedAt: String(row.admitted_at), ...(row.reviewed_at ? { reviewedAt: String(row.reviewed_at) } : {}), ...(row.rejection_reason ? { rejectionReason: String(row.rejection_reason) } : {}), ...(row.packet_revision == null ? {} : { packetRevision: Number(row.packet_revision) }), ...(row.run_id ? { runId: row.run_id as EvidenceRecord["runId"] } : {}), ...(row.route_id ? { routeId: String(row.route_id) } : {}), ...(row.remote_model_id ? { remoteModelId: String(row.remote_model_id) } : {}), ...(row.role_id ? { roleId: String(row.role_id) } : {}), ...(row.execution_class ? { executionClass: row.execution_class as EvidenceRecord["executionClass"] } : {}) } as unknown as EvidenceRecord); }
	listEvidence(missionId: string, status?: EvidenceStatus): readonly EvidenceRecord[] { this.ensureOpen(); const rows = (status ? this.db.prepare("SELECT evidence_id FROM evidence WHERE mission_id=? AND status=? ORDER BY admitted_at,evidence_id").all(missionId, status) : this.db.prepare("SELECT evidence_id FROM evidence WHERE mission_id=? ORDER BY admitted_at,evidence_id").all(missionId)) as Row[]; return rows.map((r) => this.evidence(String(r.evidence_id))); }
	promoteEvidence(evidenceId: string, options: PromoteEvidenceOptions = {}): EvidenceRecord { const initial = this.evidence(evidenceId); const initialMission = this.missionFrom(this.missionRow(String(initial.missionId))); if (initial.status !== "proposed") throw new MissionEvidenceError("Only proposed evidence can be accepted"); if (initial.sourceRevision !== undefined && initial.sourceRevision !== initialMission.revision) { this.tx(() => { const at = nowIso(this.clock); this.db.prepare("UPDATE evidence SET status='stale',reviewed_at=?,rejection_reason=? WHERE evidence_id=? AND status='proposed'").run(at, "source revision is stale", evidenceId); this.event(String(initial.missionId), initialMission.revision, "evidence_stale", options.actor ?? "system", { evidenceId, sourceRevision: initial.sourceRevision }); }); throw new MissionConflictError(initial.sourceRevision, initialMission.revision); } return this.tx(() => { const evidence = this.evidence(evidenceId); if (evidence.status !== "proposed") throw new MissionEvidenceError("Only proposed evidence can be accepted"); const mission = this.missionFrom(this.missionRow(String(evidence.missionId))); if (evidence.sourceRevision !== undefined && evidence.sourceRevision !== mission.revision) throw new MissionConflictError(evidence.sourceRevision, mission.revision); if (options.expectedRevision !== undefined && options.expectedRevision !== mission.revision) throw new MissionConflictError(options.expectedRevision, mission.revision); const at = nowIso(this.clock); const newRevision = mission.revision + 1; const item: CanonicalItem = { itemId: options.itemId ?? `canonical-${this.makeId()}`, kind: options.canonicalKind ?? evidence.kind, value: clone(evidence.content), sourceEvidenceId: evidence.evidenceId, promotedAt: at }; const target = options.target ?? "validatedFindings"; if (!["validatedFindings", "completedWork", "testReviewEvidence", "approvedDecisions"].includes(target)) throw new MissionEvidenceError("Unknown canonical target"); const column = target === "validatedFindings" ? "validated_findings_json" : target === "completedWork" ? "completed_work_json" : target === "testReviewEvidence" ? "test_review_evidence_json" : "approved_decisions_json"; const updated = { ...mission, revision: newRevision, [target]: [...(mission[target] as readonly CanonicalItem[]), item], updatedAt: at } as MissionRecord; this.db.prepare("UPDATE evidence SET status='accepted',reviewed_at=? WHERE evidence_id=?").run(at, evidenceId); this.db.prepare("INSERT INTO canonical_items(item_id,mission_id,revision,kind,value_json,source_evidence_id,promoted_at) VALUES (?,?,?,?,?,?,?)").run(item.itemId, mission.missionId, newRevision, item.kind, json(item.value), evidence.evidenceId, at); this.db.prepare(`UPDATE missions SET revision=?,${column}=?,updated_at=? WHERE mission_id=? AND revision=?`).run(newRevision, json(updated[target]), at, mission.missionId, mission.revision); this.db.prepare("INSERT INTO mission_revisions(mission_id,revision,snapshot_json,created_at) VALUES (?,?,?,?)").run(mission.missionId, newRevision, this.snapshot(updated), at); this.event(String(mission.missionId), newRevision, "evidence_accepted", options.actor ?? "user", { evidenceId, itemId: item.itemId }); return this.evidence(evidenceId); }); }
	rejectEvidence(evidenceId: string, reason: string, actor: "boss" | "worker" | "reviewer" | "system" | "user" = "user"): EvidenceRecord { return this.tx(() => { const current = this.evidence(evidenceId); if (current.status !== "proposed") throw new MissionEvidenceError("Only proposed evidence can be rejected"); const mission = this.missionFrom(this.missionRow(String(current.missionId))); const at = nowIso(this.clock); this.db.prepare("UPDATE evidence SET status='rejected',reviewed_at=?,rejection_reason=? WHERE evidence_id=?").run(at, this.text(reason, "rejection"), evidenceId); this.event(String(current.missionId), mission.revision, "evidence_rejected", actor, { evidenceId }); return this.evidence(evidenceId); }); }

	acquireLease(missionId: string, owner: string, options: { readonly ttlMs?: number; readonly forceRecover?: boolean } = {}): LeaseRecord { return this.tx(() => { this.missionRow(missionId); if (!owner.trim()) throw new MissionLeaseError("lease owner is required"); const ttl = options.ttlMs ?? this.leaseTtlMs; if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new MissionLeaseError("lease ttl must be positive"); const existing = this.db.prepare("SELECT * FROM mission_leases WHERE mission_id=?").get(missionId) as Row | undefined; const now = this.clock(); const expiry = existing ? Date.parse(String(existing.expires_at)) : Number.NaN; if (existing && !Number.isFinite(expiry)) throw new MissionLeaseError("lease expiry is invalid"); const wasActive = existing !== undefined && expiry > now.getTime(); if (wasActive && String(existing?.owner) !== owner) throw new MissionLeaseError("mission is leased by another owner"); const expires = new Date(now.getTime() + ttl).toISOString(); const recoveredFrom = existing?.owner && String(existing.owner) !== owner ? String(existing.owner) : null; const acquiredAt = existing && String(existing.owner) === owner ? String(existing.acquired_at) : now.toISOString(); this.db.prepare("INSERT OR REPLACE INTO mission_leases(mission_id,owner,acquired_at,heartbeat_at,expires_at,recovered_from) VALUES (?,?,?,?,?,?)").run(missionId, owner, acquiredAt, now.toISOString(), expires, recoveredFrom); if (recoveredFrom) this.event(missionId, Number(this.missionRow(missionId).revision), "lease_recovered", "system", { recoveredFrom, owner }); return { missionId: missionId as MissionId, owner: owner as LeaseOwner, ownerToken: owner as LeaseOwner, acquiredAt, heartbeatAt: now.toISOString(), expiresAt: expires, ...(recoveredFrom ? { recoveredFrom: recoveredFrom as LeaseOwner } : {}) }; }); }
	heartbeatLease(missionId: string, owner: string, ttlMs = this.leaseTtlMs): LeaseRecord { return this.tx(() => { const existing = this.db.prepare("SELECT * FROM mission_leases WHERE mission_id=?").get(missionId) as Row | undefined; if (!existing || String(existing.owner) !== owner) throw new MissionLeaseError("lease not held"); const expiry = Date.parse(String(existing.expires_at)); if (!Number.isFinite(expiry) || expiry <= this.clock().getTime()) throw new MissionLeaseError("lease has expired"); if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new MissionLeaseError("lease ttl must be positive"); const now = this.clock(); const expires = new Date(now.getTime() + ttlMs).toISOString(); this.db.prepare("UPDATE mission_leases SET heartbeat_at=?,expires_at=? WHERE mission_id=? AND owner=? AND expires_at>?").run(now.toISOString(), expires, missionId, owner, now.toISOString()); return { missionId: missionId as MissionId, owner: owner as LeaseOwner, ownerToken: owner as LeaseOwner, acquiredAt: String(existing.acquired_at), heartbeatAt: now.toISOString(), expiresAt: expires }; }); }
	releaseLease(missionId: string, owner: string): void { this.tx(() => { const existing = this.db.prepare("SELECT owner FROM mission_leases WHERE mission_id=?").get(missionId) as Row | undefined; if (!existing) return; if (String(existing.owner) !== owner) throw new MissionLeaseError("lease owned by another process"); this.db.prepare("DELETE FROM mission_leases WHERE mission_id=? AND owner=?").run(missionId, owner); }); }
	recordCheckpoint(missionId: string, kind: CheckpointKind = "manual"): CheckpointRecord { return this.tx(() => { const mission = this.missionFrom(this.missionRow(missionId)); const existing = this.db.prepare("SELECT * FROM mission_checkpoints WHERE mission_id=? AND revision=?").get(missionId, mission.revision) as Row | undefined; if (existing) return { checkpointId: existing.checkpoint_id as CheckpointRecord["checkpointId"], missionId: existing.mission_id as MissionId, revision: Number(existing.revision), kind: existing.kind as CheckpointKind, status: existing.status as MissionStatus, snapshot: parse(existing.snapshot_json, mission), createdAt: String(existing.created_at) }; const id = `checkpoint-${this.makeId()}` as CheckpointRecord["checkpointId"]; const at = nowIso(this.clock); this.db.prepare("INSERT INTO mission_checkpoints(checkpoint_id,mission_id,revision,kind,status,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?)").run(id, missionId, mission.revision, kind, mission.status, this.snapshot(mission), at); this.event(missionId, mission.revision, "checkpoint_created", "system", { checkpointId: id }); return { checkpointId: id, missionId: missionId as MissionId, revision: mission.revision, kind, status: mission.status, snapshot: mission, createdAt: at }; }); }
	listCheckpoints(missionId: string): readonly CheckpointRecord[] { this.ensureOpen(); const rows = this.db.prepare("SELECT * FROM mission_checkpoints WHERE mission_id=? ORDER BY revision").all(missionId) as Row[]; return rows.map((r) => ({ checkpointId: r.checkpoint_id as CheckpointRecord["checkpointId"], missionId: r.mission_id as MissionId, revision: Number(r.revision), kind: r.kind as CheckpointKind, status: r.status as MissionStatus, snapshot: parse(r.snapshot_json, {} as MissionRecord), createdAt: String(r.created_at) })); }
	listEvents(missionId: string): readonly MissionEventRecord[] { this.ensureOpen(); const rows = this.db.prepare("SELECT * FROM mission_events WHERE mission_id=? ORDER BY created_at,rowid").all(missionId) as Row[]; return rows.map((r) => ({ eventId: r.event_id as MissionEventRecord["eventId"], missionId: r.mission_id as MissionId, revision: Number(r.revision), kind: String(r.kind), actor: r.actor as MissionEventRecord["actor"], ...(r.task_id ? { taskId: r.task_id as MissionEventRecord["taskId"] } : {}), ...(r.attempt_id ? { attemptId: r.attempt_id as MissionEventRecord["attemptId"] } : {}), ...(r.payload_json ? { payload: parse(r.payload_json, null) } : {}), createdAt: String(r.created_at) } as MissionEventRecord)); }
	recoverInterrupted(options: { readonly now?: Date; readonly owner?: string } = {}): readonly AttemptRecord[] { return this.tx(() => { const now = options.now ?? this.clock(); const rows = (options.owner === undefined ? this.db.prepare("SELECT attempt_id FROM attempts WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)").all(now.toISOString()) : this.db.prepare("SELECT attempt_id FROM attempts WHERE status='running' AND lease_owner=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)").all(options.owner, now.toISOString())) as Row[]; const out: AttemptRecord[] = []; for (const row of rows) { const current = this.attempt(String(row.attempt_id)); if (!current) continue; this.db.prepare("UPDATE attempts SET status='interrupted',ended_at=?,terminal_state=?,updated_at=? WHERE attempt_id=? AND status='running'").run(now.toISOString(), "recovered_interrupted", now.toISOString(), current.attemptId); this.db.prepare("UPDATE tasks SET status='interrupted',revision=revision+1,updated_at=? WHERE task_id=? AND status='running'").run(now.toISOString(), current.taskId); this.event(String(current.missionId), current.revision + 1, "task_interrupted", "system", { mutationObserved: current.mutationObserved }, String(current.taskId), String(current.attemptId)); out.push(this.attempt(String(current.attemptId))!); }
		const qualityRows = this.db.prepare("SELECT verification_id,mission_id,task_id,round FROM verification_runs WHERE status='running'").all() as Row[];
		for (const row of qualityRows) {
			const completedAt = now.toISOString();
			this.db.prepare("UPDATE verification_runs SET status='interrupted',completed_at=?,failure_summary=? WHERE verification_id=? AND status='running'").run(completedAt, "verification interrupted during runtime recovery", String(row.verification_id));
			this.db.prepare("UPDATE task_quality_status SET status='review_required',quality_round=?,latest_verification_id=?,updated_at=? WHERE task_id=?").run(Number(row.round), String(row.verification_id), completedAt, String(row.task_id));
			this.event(String(row.mission_id), Number(this.missionRow(String(row.mission_id)).revision), "verification_interrupted", "system", { verificationId: String(row.verification_id), taskId: String(row.task_id) }, String(row.task_id));
		}
		return out; }); }
	/** Create a SQLite-native, self-consistent backup and publish it atomically. */
	async backup(destinationPath = join(this.root, "backups", `mission-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}.sqlite`)): Promise<string> {
		this.ensureOpen();
		if (sameFile(destinationPath, this.databasePath)) throw new MissionPersistenceError("backup", "destination-matches-source");
		const parent = dirname(destinationPath);
		mkdirSync(parent, { recursive: true, mode: 0o700 });
		const temporary = `${destinationPath}.tmp-${randomUUID()}`;
		try {
			await sqliteBackup(this.db, temporary);
			validateSqliteBackup(temporary);
			removeSqliteSidecars(destinationPath);
			renameSync(temporary, destinationPath);
			chmodSafe(destinationPath, 0o600);
			return destinationPath;
		} catch (error) {
			try { unlinkSync(temporary); } catch { /* best effort */ }
			throw new MissionPersistenceError("backup", error instanceof Error ? error.message : "backup failed");
		}
	}
	/** Explicit restore primitive. It validates before replacing the target atomically. */
	static async restore(options: MissionStoreOptions, backupPath: string): Promise<SQLiteMissionStore> {
		if (!backupPath) throw new MissionPersistenceError("restore", "backup-path-required");
		validateSqliteBackup(backupPath);
		const target = options.databasePath ?? join(options.root, "mission.sqlite");
		if (sameFile(target, backupPath)) throw new MissionPersistenceError("restore", "source-matches-destination");
		mkdirSync(options.root, { recursive: true, mode: 0o700 });
		const temporary = `${target}.restore-${randomUUID()}`;
		const source = new DatabaseSync(backupPath, { readOnly: true });
		try { await sqliteBackup(source, temporary); } finally { source.close(); }
		try { validateSqliteBackup(temporary); removeSqliteSidecars(target); renameSync(temporary, target); chmodSafe(target, 0o600); }
		catch (error) { try { unlinkSync(temporary); } catch { /* best effort */ } throw new MissionPersistenceError("restore", error instanceof Error ? error.message : "restore failed"); }
		return new SQLiteMissionStore(options);
	}
	integrityCheck(): void {
		this.ensureOpen();
		try {
			const result = this.db.prepare("PRAGMA integrity_check").get() as Row | undefined;
			if (result && Object.values(result)[0] !== "ok") throw new MissionCorruptError();
			const foreign = this.db.prepare("PRAGMA foreign_key_check").all();
			if (foreign.length > 0) throw new MissionCorruptError("Mission database foreign-key integrity check failed");
			const jsonColumns: readonly [string, string][] = [
				["missions", "constraints_json"], ["missions", "acceptance_json"], ["missions", "repository_json"], ["missions", "plan_json"], ["missions", "approved_decisions_json"], ["missions", "validated_findings_json"], ["missions", "completed_work_json"], ["missions", "current_change_state_json"], ["missions", "test_review_evidence_json"], ["missions", "unresolved_issues_json"], ["missions", "next_steps_json"],
				["mission_revisions", "snapshot_json"], ["mission_events", "payload_json"], ["tasks", "constraints_json"], ["tasks", "acceptance_json"], ["tasks", "allowed_tools_json"], ["tasks", "allowed_actions_json"], ["tasks", "packet_json"], ["attempts", "result_json"], ["evidence", "content_json"], ["evidence", "artifact_refs_json"], ["canonical_items", "value_json"], ["mission_checkpoints", "snapshot_json"],
				["quality_decisions", "criterion_results_json"], ["quality_decisions", "mechanical_checks_json"], ["quality_decisions", "findings_json"], ["quality_decisions", "required_fixes_json"], ["quality_decisions", "risks_json"], ["quality_decisions", "gate_reasons_json"], ["quality_escalations", "failed_criteria_json"], ["quality_escalations", "required_fixes_json"], ["quality_escalations", "reviewer_findings_json"], ["quality_escalations", "prior_implementation_route_ids_json"], ["quality_escalations", "route_exclusions_json"],
			];
			for (const [table, column] of jsonColumns) {
				for (const row of this.db.prepare(`SELECT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`).all() as Row[]) {
					if (typeof row.value === "string") JSON.parse(row.value);
				}
			}
		} catch (error) {
			if (error instanceof MissionCorruptError) throw error;
			throw new MissionCorruptError();
		}
	}
	integrityDiagnostics(): readonly string[] {
		try { this.integrityCheck(); return []; }
		catch (error) { return [error instanceof Error ? error.message : "Mission database integrity check failed"]; }
	}
}

function statSafe(path: string): ReturnType<typeof statSync> | undefined { try { return statSync(path); } catch { return undefined; } }
function sameFile(left: string, right: string): boolean {
	if (resolve(left) === resolve(right)) return true;
	try { const a = statSync(left); const b = statSync(right); return a.dev === b.dev && a.ino === b.ino; } catch { return false; }
}
function removeSqliteSidecars(path: string): void { for (const sidecar of [`${path}-wal`, `${path}-shm`]) { try { unlinkSync(sidecar); } catch { /* absent or already cleaned by SQLite */ } } }
function validateSqliteBackup(path: string): void {
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		const integrity = db.prepare("PRAGMA integrity_check").get() as Row | undefined;
		if (integrity && Object.values(integrity)[0] !== "ok") throw new Error("SQLite integrity check failed");
		if (db.prepare("PRAGMA foreign_key_check").all().length > 0) throw new Error("SQLite foreign-key check failed");
		const meta = db.prepare("SELECT value FROM mission_store_meta WHERE key='schema_version'").get() as Row | undefined;
		if (!meta || !["1", "2"].includes(String(meta.value))) throw new Error("Mission schema metadata is missing or unsupported");
		for (const table of ["missions", "tasks", "attempts", "evidence"] as const) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Mission table '${table}' is missing`);
		if (String(meta.value) === "2") for (const table of ["mission_revisions", "mission_events", "mission_leases", "canonical_items", "mission_checkpoints", "verification_runs", "quality_decisions", "quality_escalations", "task_quality_status"] as const) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Mission table '${table}' is missing`);
		const jsonColumns: readonly [string, string][] = [
			["missions", "constraints_json"], ["missions", "acceptance_json"], ["missions", "repository_json"], ["missions", "plan_json"], ["missions", "approved_decisions_json"], ["missions", "validated_findings_json"], ["missions", "completed_work_json"], ["missions", "current_change_state_json"], ["missions", "test_review_evidence_json"], ["missions", "unresolved_issues_json"], ["missions", "next_steps_json"], ["mission_revisions", "snapshot_json"], ["mission_events", "payload_json"], ["tasks", "constraints_json"], ["tasks", "acceptance_json"], ["tasks", "allowed_tools_json"], ["tasks", "allowed_actions_json"], ["tasks", "packet_json"], ["attempts", "result_json"], ["evidence", "content_json"], ["evidence", "artifact_refs_json"], ["canonical_items", "value_json"], ["mission_checkpoints", "snapshot_json"], ["quality_decisions", "criterion_results_json"], ["quality_decisions", "mechanical_checks_json"], ["quality_decisions", "findings_json"], ["quality_decisions", "required_fixes_json"], ["quality_decisions", "risks_json"], ["quality_decisions", "gate_reasons_json"], ["quality_escalations", "failed_criteria_json"], ["quality_escalations", "required_fixes_json"], ["quality_escalations", "reviewer_findings_json"], ["quality_escalations", "prior_implementation_route_ids_json"], ["quality_escalations", "route_exclusions_json"],
		];
		for (const [table, column] of jsonColumns) {
			if (!(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))) continue;
			for (const row of db.prepare(`SELECT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`).all() as Row[]) if (typeof row.value === "string") JSON.parse(row.value);
		}
	} finally { db.close(); }
}
function chmodSafe(path: string, mode: number): void { try { chmodSync(path, mode); } catch { /* SQLite may create sidecars lazily. */ } }
function canTransition(from: MissionStatus, to: MissionStatus): boolean {
	const allowed: Record<MissionStatus, readonly MissionStatus[]> = {
		draft: ["planned", "active", "running", "blocked", "cancelled"],
		planned: ["active", "running", "blocked", "cancelled"],
		active: ["paused", "running", "awaiting-review", "blocked", "failed", "cancelled"],
		paused: ["running", "blocked", "cancelled"],
		running: ["paused", "awaiting-review", "blocked", "failed", "cancelled"],
		"awaiting-review": ["running", "completed", "blocked", "failed", "cancelled"],
		blocked: ["running", "failed", "cancelled"],
		failed: ["cancelled"],
		cancelled: [],
		completed: [],
	};
	return allowed[from].includes(to);
}
export const MissionStore = SQLiteMissionStore;
export const SqliteMissionStore = SQLiteMissionStore;
export const createMissionStore = (options: MissionStoreOptions): MissionStoreAdapter => new SQLiteMissionStore(options);
export const backupMissionStore = (store: SQLiteMissionStore, destinationPath?: string): Promise<string> => store.backup(destinationPath);
export const restoreMissionStore = (options: MissionStoreOptions, backupPath: string): Promise<SQLiteMissionStore> => SQLiteMissionStore.restore(options, backupPath);
export * from "./types.js";
export * from "./errors.js";
export * from "./execution.js";
export {
	deriveAcceptanceCriteriaFromGoal,
	extractLabelledAcceptanceCriteria,
	inferAcceptanceCriteriaProvenance,
	resolveMissionAcceptanceCriteria,
	type MissionAcceptanceCriteriaProvenance,
} from "./acceptance-criteria.js";
export { evaluateMissionCapability, capabilityMismatchReason } from "./capability-preflight.js";
export { taskIdentityKey, resolveOrCreateMissionTask, activeMissionTasks, completedAndVerified } from "./task-identity.js";
export { projectBossCanonicalState } from "./boss-projection.js";
export { BOSS_SYSTEM_PROMPT, bossInferencePrompt } from "./boss-prompt.js";
export {
	BOSS_DECISION_TOOL_NAME,
	BOSS_DECISION_TOOL_SCHEMA,
	createBossDecisionTool,
	parseBossAssistantResponse,
	extractBossAssistantText,
	type BossDecisionToolDeclaration,
} from "./boss-response.js";
