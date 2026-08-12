# Architecture decision log

Records through ADR-016 were accepted at M0; ADR-017 was accepted at M1. A later milestone may supersede a record only with a new decision entry and migration impact.

## ADR-001 — Pi is the initial host harness

- **Decision:** Ship as a Pi extension/package and use supported extension and SDK surfaces.
- **Rationale:** Pi already supplies the terminal session, tools, model registry, lifecycle events, custom commands, and TUI primitives.
- **Alternatives:** A standalone orchestrator or a fork of Pi.
- **Consequences:** Host-version compatibility must be tested; orchestration state remains ours rather than modifying Pi internals.

## ADR-002 — 9Router is the initial model gateway

- **Decision:** Discover and invoke remote routes through 9Router's OpenAI-compatible API. Compose with 9Router account/combo fallback instead of copying it.
- **Rationale:** It is the user's existing aggregation and subscription-routing layer.
- **Alternatives:** Direct integrations for every provider or replacing 9Router.
- **Consequences:** Catalog/resource metadata and actual-route response attribution require M2 proof of concept.

## ADR-003 — Configuration is data-driven and TUI-managed

- **Decision:** Ordinary model, pool, route, profile, budget, threshold, and policy changes are validated data edited through `/orchestrator`.
- **Rationale:** Source edits are unsafe and block routine operation.
- **Alternatives:** TypeScript constants or manual JSON as the primary UX.
- **Consequences:** Schema versioning, migration, history, rollback, and corruption recovery are product requirements.

## ADR-004 — There are exactly three execution pools

- **Decision:** Investigation, Implementation, and Verification are the only main worker pools.
- **Rationale:** They express materially different cost/tool/independence needs without proliferating per-persona pools.
- **Alternatives:** One global pool or one pool per role.
- **Consequences:** New roles map to one execution class; adding a fourth main pool requires a specification change.

## ADR-005 — Roles map dynamically to pools

- **Decision:** The Boss chooses role/persona; configuration maps each role to an execution class.
- **Rationale:** `debugger` and `coder` may share implementation routes while retaining different instructions and result schemas.
- **Alternatives:** Binding each role directly to a model or dedicated pool.
- **Consequences:** Task Packets carry both role and execution class, and routing never infers the class from a model name.

## ADR-006 — Route identity includes resource identity

- **Decision:** A route is a stable local `routeId` plus gateway, remote model identifier, and source/resource discriminator; underlying model family is separate metadata.
- **Rationale:** The same model through two subscriptions or APIs represents distinct quota, cost, health, and fallback resources.
- **Alternatives:** Deduplicate only by model name or Pi provider/model pair.
- **Consequences:** 9Router must expose or be configured with a stable discriminator; ambiguous catalog rows cannot be silently merged.

## ADR-007 — Infrastructure fallback and quality escalation are separate state transitions

- **Decision:** Transport/quota/auth/availability failures may select another eligible route. Successful-but-unacceptable work returns to the Boss for a new decision.
- **Rationale:** Retrying a rejected implementation is mission planning, not network resilience.
- **Alternatives:** One generic retry/fallback loop.
- **Consequences:** Events, counters, policies, and acceptance tests remain distinct.

## ADR-008 — Canonical mission state is authoritative

- **Decision:** Persist a validated mission snapshot and evidence records outside chat history. Child output is proposed evidence until the Boss promotes it.
- **Rationale:** Chat-to-chat summaries create context fragmentation and a telephone game.
- **Alternatives:** Rely on the Boss transcript or forward every prior child result.
- **Consequences:** Task Packets are bounded projections; reviewers inspect artifacts and exact evidence when available.

## ADR-009 — Recommendations never auto-apply by default

- **Decision:** Analytics may create explainable recommendations with Apply, Ignore, and Details; only explicit Apply mutates configuration.
- **Rationale:** Historical correlations are uncertain and configuration changes affect cost and quality.
- **Alternatives:** Silent priority tuning or no recommendations.
- **Consequences:** Recommendation generation and configuration mutation are separate audited actions.

## ADR-010 — Analytics configuration begins in M1; collection begins in M8

- **Decision:** M1 defines a disabled-by-default, metadata-only analytics policy but records no events. Privacy-minimal collection and storage begin with M8, and never include prompts, source, secrets, or full conversations by default.
- **Rationale:** M1 has no runtime engine or analytics store; delaying collection avoids speculative telemetry while preserving a validated policy boundary.
- **Alternatives:** Add telemetry late or persist full traces.
- **Consequences:** M1 tests only configuration validation/export boundaries. M8 owns event semantics, unknown fields, estimated-cost labels, and durable storage.

## ADR-011 — Workers initially use isolated child Pi processes

- **Decision:** M5 follows Pi's shipped subagent pattern and launches bounded child `pi` processes in JSON mode.
- **Rationale:** Process isolation, cancellation, per-agent model/tool selection, and context isolation already have a verified host precedent.
- **Alternatives:** Multiple in-process SDK sessions or installing `pi-subagents`.
- **Consequences:** We own scheduling, structured-result validation, process cleanup, and resume semantics; no third-party subagent extension is installed.

## ADR-012 — Persistence is split by responsibility

- **Decision:** Human-editable configuration remains versioned JSON; transactional mission/health/analytics data uses SQLite; Pi session entries store only a mission pointer/status.
- **Rationale:** JSON is portable for import/export, while concurrent event/query data needs transactions and indexes.
- **Alternatives:** All JSON files, all SQLite, or storing everything in Pi session JSONL.
- **Consequences:** M1 owns only versioned JSON configuration. M6 must prove the SQLite driver under supported Node and standalone Pi launch modes before freezing the physical runtime-state driver.

## ADR-017 — M1 uses a strict standard-library configuration engine

- **Decision:** M1 uses strict hand-written validation, deterministic JSON, an injected root, atomic same-directory rename, bounded history, a process-local mutation queue, and an optional no-content post-commit audit callback with no default sink. Loading a corrupt active file may expose the newest valid history snapshot in memory, but only explicit recovery quarantines and repairs disk state.
- **Rationale:** Node provides the required primitives without a runtime schema, database, locking, or telemetry dependency. Explicit recovery preserves evidence and prevents startup from silently rewriting user data.
- **Alternatives:** Add a schema framework, use SQLite for configuration, silently restore at load, or add cross-process locking before a second writer exists.
- **Consequences:** Unknown fields are rejected, arrays preserve declared order and replace wholesale, secret values are structurally absent, and cross-process writer coordination remains an M10 hardening concern.

## ADR-013 — Secrets are references, never ordinary configuration

- **Decision:** Persist only a secret-store reference. Resolve credentials at request time from an approved store such as Pi auth, environment, or macOS Keychain.
- **Rationale:** Config history, project overrides, backups, exports, and diagnostics are not secret stores.
- **Alternatives:** Literal API keys in config or silently copying 9Router credentials.
- **Consequences:** Missing credentials produce an explicit unavailable route; export needs no heuristic redaction of allowed fields.

## ADR-014 — Global/project precedence is explicit

- **Decision:** Schema defaults < global config < trusted project override < mission launch override. Objects merge by declared keys; arrays replace as a whole; identities are merged by stable ID only where the schema declares keyed collections.
- **Rationale:** Generic deep merge creates surprising pool order and partial secret-bearing objects.
- **Alternatives:** Pi settings merge semantics, project-only config, or implicit array concatenation.
- **Consequences:** Untrusted project overrides are ignored with diagnostics, and the effective configuration is inspectable.

## ADR-015 — Shared-worktree mutation is serial by default

- **Decision:** At most one implementation worker may mutate a shared worktree. Read-only investigation/verification may run concurrently; parallel mutators require explicit isolated worktrees later.
- **Rationale:** Concurrent edits are a smaller reliability win than deterministic ownership and conflict avoidance.
- **Alternatives:** Unrestricted parallel workers or mandatory worktree management in M5.
- **Consequences:** Initial throughput is bounded but safe; add worktree orchestration only when measured demand justifies it.

## ADR-016 — Active model and Boss switches occur only at safe boundaries

- **Decision:** Disabling an active route or changing a Boss profile is staged until Pi is idle and a valid replacement is selected. Failed Boss turns with completed tool side effects are never blindly replayed.
- **Rationale:** A model change can preserve transcript context, but replaying a side-effecting turn can duplicate changes.
- **Alternatives:** Immediate removal/switch or automatic whole-turn replay.
- **Consequences:** The TUI shows pending activation and recovery choices; canonical state, not hidden model state, carries continuity.

## ADR-018 — M2 reuses ConfigV1 and projects selected 9Router routes into Pi

- **Decision:** M2 keeps semantic schema version 1. The config gateway ID is the schema-valid `ninerouter`; the Pi provider namespace is `9router`. Authoritative connection and enabled-route choices use the existing gateway/route fields, while a separate versioned `catalog.json` stores validated last-known-good discovery state. The configured base is the `/v1` base. M2 resolves environment references only, passes `$ENV_NAME` to Pi, and blocks disabling the active 9Router model until the user switches.
- **Rationale:** M1 already models every durable M2 choice. Catalog freshness is runtime evidence, not user configuration; separating it avoids a needless migration and prevents cache state entering history/export. Pi `0.84.1` can replace one extension provider's model list without restart, and blocking the active route is the smallest safe policy.
- **Alternatives:** Add ConfigV2 fields for catalog status; copy the full catalog into Pi; persist plaintext credentials; implement Keychain writes; stage an automatic replacement model.
- **Consequences:** New catalog rows remain unconfigured/disabled; rows without resource identity are visibly ambiguous and an explicit enable keeps an unknown-resource warning without auto-merging. Cache snapshots are bound to the normalized gateway base and are withheld after an endpoint change until refresh. Missing enabled routes retain exact local identity but leave the provider projection, failed refresh keeps the last-good cache, pools remain unchanged until M3, and Keychain/Pi-auth resolution is explicitly unavailable in M2.

## ADR-019 — M3 keeps pool priority and availability as separate configuration concerns

- **Decision:** M3 reuses ConfigV1. Each canonical pool's entry array is the sole priority order; membership and per-pool enablement remain distinct from a route's global enabled state and remote/catalog availability. Globally disabled or missing routes stay in their pools until an explicit membership edit.
- **Rationale:** The existing schema already expresses every M3 choice. Retaining unavailable memberships preserves user intent and prevents discovery outages or global model changes from silently rewriting priorities.
- **Alternatives:** Add a numeric priority field, create ConfigV2, auto-remove unavailable routes, or make pool edits reconcile the Pi provider.
- **Consequences:** Pool mutations use `ConfigStore` history and its process-local FIFO queue; the same route may belong to multiple pools independently; pool-only changes do not alter provider registration; actual eligibility and selection remain M4 work.

## ADR-020 — M4 health is runtime state, separate from user configuration

- **Decision:** M4 stores route health in an injectable, versioned atomic `health.json` runtime file. Cooldowns, circuit state, failure class, retry-after, success timestamps, and manual reset never enter ConfigStore, config history, export, analytics, prompts, or completions.
- **Rationale:** Health changes frequently and must survive reload without rewriting user intent or pool order. Corrupt runtime state can be quarantined independently of valid configuration.
- **Alternatives:** Put health beside each ConfigV1 route, persist it in config history, or add SQLite in M4.
- **Consequences:** Health updates are serialized in-process; stale last-known-good catalog data remains usable, while missing/unavailable routes are ineligible. Cross-process coordination and durable analytics remain later work.

## ADR-021 — M4 routing is deterministic and conservative

- **Decision:** Pool array position is canonical priority. The pure router filters disabled, missing, unavailable, attempted, excluded, cooldown, and required-diversity conflicts, then selects the first eligible route. Diversity is explicit (`none`, `prefer`, `require`) and never inferred from model names. Rate limits/timeouts/transports may retry within the ConfigV1 budget; cancellation, invalid requests, protocol errors, and unknown failures stop; fallback is bounded and loop-free.
- **Rationale:** Deterministic selection preserves user order and makes failures explainable without pretending to know provider internals. 429 is rate-limited unless explicit structured quota evidence exists.
- **Alternatives:** Random/score-based routing, family-name heuristics, unbounded fallback, or reconstructing 9Router's internal account/combo attempts.
- **Consequences:** The router is a preview/decision boundary only. 9Router remains responsible for opaque internal fallback; quality outcomes belong to later quality gates and do not poison infrastructure health.

## ADR-022 — M5 uses fresh direct SDK child sessions

- **Decision:** M5 creates a fresh Pi `0.84.1` `AgentSession` per route attempt with `SessionManager.inMemory`, an empty resource boundary, the exact M4-selected model, and retries disabled. The parent alone exposes `delegate_agent`; children receive only the pool allowlist plus one bounded `submit_agent_result` tool.
- **Rationale:** Direct SDK control gives deterministic model/tool/session isolation without copying parent history or loading the orchestrator recursively. M4 remains the sole retry/fallback authority.
- **Alternatives:** Reuse parent history, load the full extension in children, allow Pi's hidden retries, or use the shipped process example as a second execution path.
- **Consequences:** Child output is a bounded in-memory handoff, not canonical mission state. `edit`, `write`, and `bash` conservatively block automatic fallback; implementation runs serialize by cwd. Worktrees, Context Broker, Boss scheduling, and durable child state remain deferred.

## ADR-023 — M6 separates canonical mission state from config and Pi sessions

- **Decision:** Store mission revisions, tasks, attempts, evidence, canonical items, checkpoints, leases, and the event journal in an injected-root SQLite MissionStore using the supported Node `node:sqlite` adapter. Keep ConfigV1 JSON and HealthStore unchanged; Pi session entries contain only mission pointers/status.
- **Rationale:** Mission state needs transactions, revision CAS, foreign keys, recovery, and indexed event history. It is not human-editable configuration and must survive Pi reload without becoming hidden conversation state.
- **Consequences:** The MissionStore schema is versioned independently; corrupt databases fail typed without silent replacement; no raw SQL escapes the adapter; cross-process scheduling and analytics remain deferred.

## ADR-024 — M6 admits worker evidence explicitly and packets accepted state only

- **Decision:** Every structured M5 worker result enters MissionStore as proposed evidence. Only explicit operator acceptance may create/update a canonical item and advance the mission revision. ContextBroker defaults to accepted canonical items and emits immutable, bounded, digest-linked TaskPacketV1 values.
- **Rationale:** Execution completion is not quality verification, and proposed/rejected findings must not silently steer later work. Packet lineage and omission reporting make context deterministic and inspectable without persisting transcripts.
- **Consequences:** M7 owns reviewer/quality acceptance; M6 provides no Boss planning, automatic evidence admission, parallel scheduling, or transcript resume.
## ADR-025 — M8 analytics remains separate, metadata-only, and operator-applied

- **Decision:** M8 stores bounded idempotent telemetry in a separate local `analytics.sqlite` schema v1. ConfigV1 remains version 1 and its existing disabled-by-default `analytics` policy is authoritative.
- **Consequences:** Analytics failures are non-critical; unsupported Pi usage fields and provider-default zero pricing remain unknown; mixed currencies are not summed; recommendations are pool-specific, sample-gated, explainable, and never mutate configuration until an explicit Apply action uses PoolManager.
- **Privacy:** Prompts, transcripts, source, tool arguments/results, headers, credentials, and completion text are not persisted.

## ADR-026 — M8.5 analyst is manual, advisory, and Verification-Pool bound

- **Decision:** The optional Recommendation Analyst runs only after an explicit operator Analyze Now/Re-analyze action. It selects a configured Verification Pool route by stable `routeId`, consumes a bounded deterministic analytics packet, and returns one bounded SUPPORT/OPPOSE/INSUFFICIENT_EVIDENCE result. It cannot alter facts, pools, ConfigStore, or Apply state; explicit Apply remains the M8 RecommendationApplicationService → PoolManager path.
- **Rationale:** Deterministic metrics and recommendations remain the source of truth while an operator may request bounded qualitative context. Reusing M4/M5 preserves route identity, retries, health separation, and privacy boundaries without hard-coding a model.
- **Persistence:** Store only recommendation ID, route ID, timestamp, deterministic input fingerprint, verdict, factors, caveats, and concise explanation. Keep prior records; a changed fingerprint makes the old analysis stale. Never persist prompts, transcripts, source, tool output, or secrets.
- **Consequences:** AI-assisted analysis is optional and manual-only; unavailable/rate-limited/timed-out analyst routes leave the deterministic recommendation usable. Scheduled analysis, automatic tuning, and automatic Apply remain deferred.

## ADR-027 — M9 uses one fixed native Control Center shell

- **Decision:** `/orchestrator` exposes exactly twelve fixed top-level sections in product order. The host shell uses Pi `0.84.1` native selectors for TUI and RPC UI, reuses existing domain commands/services, and presents a safe dashboard before section navigation.
- **Rationale:** One small presentation boundary keeps navigation consistent without duplicating M2–M8.5 business logic or inventing future runtime engines.
- **Consequences:** Deferred capabilities are textual `Not implemented yet`/`Planned`; ConfigStore backup uses existing export/history/restore, while MissionStore/AnalyticsStore backup remains unavailable until a safe primitive exists. M9 does not imply Boss runtime, background work, autonomous tuning, or release readiness.

## ADR-028 — M10 centralizes application safety and keeps recovery stores separate

- **Decision:** Keep project trust in a separate local TrustStore with an untrusted default; route all host path/command checks through conservative PathSafetyPolicy and CommandSafetyPolicy; sanitize values and sensitive structures before diagnostics; keep ConfigStore, MissionStore, and AnalyticsStore storage/locks/integrity boundaries separate; use validated SQLite-native backup/restore rather than ad-hoc file copies.
- **Rationale:** One policy boundary prevents individual commands from weakening workspace, credential, or destructive-operation rules, while separate recovery stores avoid turning analytics or trust metadata into portable user configuration. Cross-process locks and owner-token leases protect against lost updates and stale workers without introducing a scheduler.
- **Consequences:** Trust is never transferred by config import/export or backup; destructive/ambiguous commands block or require review; analytics corruption degrades to diagnostics; backup restore is explicit and validated; the policies are application-level and do not claim OS/kernel sandboxing. M11 packaging/release remains separate and not started.

## ADR-029 — M11 ships a local Pi release candidate with an independent rescue path

- **Decision:** Package only the compiled extension entrypoint and declarations as `0.1.0-rc.1` with Pi `0.84.x` as a peer dependency. The `.tgz` is the immutable release artifact; Pi `0.84.1` is installed only from a fresh checksum-verified directory extracted from that artifact. Generate the artifact, checksum, file list, manifest, unpacked verification, compatibility/checklist/dogfood records, machine-readable upgrade/rollback evidence, and self-contained external-review bundle outside the checkout. Do not publish, tag, push, call live routes, or alter live Pi state.
- **Rationale:** Pi's supported `pi-package` contract provides the extension manifest, while its local package manager treats a `.tgz` path as a loadable extension file rather than an archive. Artifact checksum verification followed by directory extraction makes the supported source explicit and reproducible. A strict allowlist prevents state, secrets, source paths, and development dependencies from shipping. A rescue path that can remove/restore the package without importing the extension limits blast radius.
- **Consequences:** M10 remains the latest accepted milestone; M11 is implemented but not accepted until independent review, authorized real-route/manual gates, and Planner review close. A local RC is not a public or production-ready release. No persistence schema changes are introduced by packaging.

## ADR-030 — M11-R4 binds safety and release evidence at execution time

- **Decision:** Install a `WorkerSafetyGuard` on every real Pi child-session tool boundary; clamp active tools to the role/profile, apply PathSafetyPolicy and CommandSafetyPolicy before execution, require trust for Implementation mutation, and allow only the bounded result protocol outside those filesystem/command rules. Release verification uses trusted absolute Node/npm/Pi/system executables, clean Git/source/tree/build identity, strict test-total parsing, machine-neutral evidence, and artifact/privacy/symlink binding.
- **Rationale:** M10's accepted policy tests did not prove that an integrated worker could not bypass policy through Pi's built-in tools, and rc.1 evidence could be forged or drift from its source/build inputs. One shared pre-tool guard and one trusted evidence path close those gaps at the actual execution/provenance boundaries.
- **Consequences:** Verification/Investigation remain read-only; Implementation mutation remains trust-gated and serial. A local rc.2 can be independently checked but is still not accepted, public, or production-ready until external review and Planner/manual gates close. No live route, publication, tag, push, or live Pi configuration change is implied.
