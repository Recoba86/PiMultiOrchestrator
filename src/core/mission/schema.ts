import { MISSION_STORE_SCHEMA_VERSION } from "./types.js";

export const MISSION_STORE_META_TABLE = "mission_store_meta" as const;

/**
 * The schema intentionally stores bounded domain values as JSON text.  The
 * values are validated before reaching these tables and all writes use bound
 * parameters; SQLite remains the transaction/foreign-key boundary rather
 * than a second domain validator.
 */
const MISSION_STORE_BASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mission_store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS missions (
  mission_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft','planned','active','paused','running','awaiting-review','blocked','failed','cancelled','completed')),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  goal TEXT NOT NULL,
  constraints_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  repository_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  approved_decisions_json TEXT NOT NULL,
  validated_findings_json TEXT NOT NULL,
  completed_work_json TEXT NOT NULL,
  current_change_state_json TEXT NOT NULL,
  test_review_evidence_json TEXT NOT NULL,
  unresolved_issues_json TEXT NOT NULL,
  next_steps_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS mission_revisions (
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (mission_id, revision)
) STRICT;

CREATE TABLE IF NOT EXISTS mission_events (
  event_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  task_id TEXT,
  attempt_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  role_id TEXT NOT NULL,
  execution_class TEXT NOT NULL CHECK (execution_class IN ('investigation','implementation','verification')),
  pool_id TEXT,
  objective TEXT NOT NULL,
  constraints_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  allowed_tools_json TEXT NOT NULL,
  allowed_actions_json TEXT NOT NULL,
  output_schema_id TEXT,
  context_budget INTEGER,
  packet_json TEXT,
  packet_revision INTEGER NOT NULL CHECK (packet_revision >= 0),
  last_run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','planned','ready','running','interrupted','succeeded','execution_completed','failed','cancelled','blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  route_id TEXT,
  remote_model_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','interrupted','cancelled','timed-out','unknown')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  terminal_state TEXT,
  mutation_observed INTEGER NOT NULL CHECK (mutation_observed IN (0,1)),
  result_json TEXT,
  packet_revision INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS mission_leases (
  mission_id TEXT PRIMARY KEY REFERENCES missions(mission_id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  recovered_from TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS evidence (
  evidence_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(task_id) ON DELETE SET NULL,
  attempt_id TEXT REFERENCES attempts(attempt_id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','accepted','approved','rejected','stale')),
  content_json TEXT NOT NULL,
  artifact_refs_json TEXT NOT NULL,
  source_revision INTEGER,
  admitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  rejection_reason TEXT
  ,packet_revision INTEGER
  ,run_id TEXT
  ,route_id TEXT
  ,remote_model_id TEXT
  ,role_id TEXT
  ,execution_class TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS canonical_items (
  item_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  kind TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id) ON DELETE RESTRICT,
  promoted_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS mission_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (mission_id, revision)
) STRICT;

CREATE INDEX IF NOT EXISTS mission_events_mission_revision_idx ON mission_events(mission_id, revision, created_at);
CREATE INDEX IF NOT EXISTS mission_revisions_mission_revision_idx ON mission_revisions(mission_id, revision);
CREATE INDEX IF NOT EXISTS tasks_mission_status_idx ON tasks(mission_id, status, created_at);
CREATE INDEX IF NOT EXISTS attempts_mission_status_idx ON attempts(mission_id, status, started_at);
CREATE INDEX IF NOT EXISTS evidence_mission_status_idx ON evidence(mission_id, status, admitted_at);
CREATE INDEX IF NOT EXISTS checkpoints_mission_revision_idx ON mission_checkpoints(mission_id, revision);
`;

/** Durable M7 quality state.  JSON columns are bounded by the adapter before
 * insertion; SQLite remains the transaction and foreign-key boundary. */
export const MISSION_STORE_QUALITY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS verification_runs (
  verification_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  target_run_id TEXT NOT NULL,
  target_packet_id TEXT,
  round INTEGER NOT NULL CHECK (round >= 0),
  reviewer_run_id TEXT,
  reviewer_route_id TEXT,
  reviewer_remote_model_id TEXT,
  implementation_route_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','interrupted','blocked')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  quality_decision_id TEXT,
  potential_mutation_observed INTEGER NOT NULL CHECK (potential_mutation_observed IN (0,1)),
  failure_summary TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS quality_decisions (
  decision_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  verification_id TEXT NOT NULL REFERENCES verification_runs(verification_id) ON DELETE RESTRICT,
  target_run_id TEXT NOT NULL,
  target_packet_id TEXT,
  round INTEGER NOT NULL CHECK (round >= 0),
  verdict TEXT NOT NULL CHECK (verdict IN ('pass','reject','blocked')),
  criterion_results_json TEXT NOT NULL,
  mechanical_checks_json TEXT NOT NULL,
  reviewer_summary TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  required_fixes_json TEXT NOT NULL,
  risks_json TEXT NOT NULL,
  gate_reasons_json TEXT NOT NULL,
  reviewer_route_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS quality_escalations (
  escalation_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  rejected_run_id TEXT NOT NULL,
  verification_id TEXT NOT NULL REFERENCES verification_runs(verification_id) ON DELETE RESTRICT,
  quality_round INTEGER NOT NULL CHECK (quality_round >= 0),
  failed_criteria_json TEXT NOT NULL,
  required_fixes_json TEXT NOT NULL,
  reviewer_findings_json TEXT NOT NULL,
  prior_implementation_route_ids_json TEXT NOT NULL,
  reviewer_route_id TEXT,
  preferred_pool TEXT NOT NULL CHECK (preferred_pool = 'implementation'),
  route_exclusions_json TEXT NOT NULL,
  diversity TEXT NOT NULL CHECK (diversity IN ('none','prefer','require')),
  status TEXT NOT NULL CHECK (status IN ('ready','exhausted','blocked')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS task_quality_status (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('unverified','verification_running','passed','rejected','blocked','review_required')),
  quality_round INTEGER NOT NULL CHECK (quality_round >= 0),
  latest_verification_id TEXT,
  latest_decision_id TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS verification_runs_mission_task_idx ON verification_runs(mission_id, task_id, round, started_at);
CREATE INDEX IF NOT EXISTS quality_decisions_mission_task_idx ON quality_decisions(mission_id, task_id, round, created_at);
CREATE INDEX IF NOT EXISTS quality_escalations_mission_task_idx ON quality_escalations(mission_id, task_id, quality_round, created_at);
CREATE INDEX IF NOT EXISTS task_quality_status_mission_idx ON task_quality_status(mission_id, status, updated_at);
`;

/** The exact M6 schema used by migration fixtures and v1 databases. */
export const MISSION_STORE_SCHEMA_V1_SQL = MISSION_STORE_BASE_SCHEMA_SQL;

/** Current schema for a brand-new MissionStore. */
export const MISSION_STORE_SCHEMA_SQL = `${MISSION_STORE_BASE_SCHEMA_SQL}\n${MISSION_STORE_QUALITY_SCHEMA_SQL}`;

/** Sequential, transactional v1 -> v2 migration. */
export const MISSION_STORE_MIGRATION_1_TO_2_SQL = `
${MISSION_STORE_QUALITY_SCHEMA_SQL}
INSERT OR IGNORE INTO task_quality_status(task_id, mission_id, status, quality_round, latest_verification_id, latest_decision_id, updated_at)
SELECT task_id, mission_id, 'unverified', 0, NULL, NULL, updated_at FROM tasks;
UPDATE mission_store_meta SET value = '2' WHERE key = 'schema_version';
`;

export const CURRENT_MISSION_STORE_SCHEMA_VERSION = MISSION_STORE_SCHEMA_VERSION;
