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

## ADR-031 — M11-R6 makes child result tools declarative and capture-only

- **Decision:** Child-session callers provide only a bounded `ResultProtocolSpec`; M5 creates the model-visible protocol tool internally. Its execution path validates and captures structured data in memory, returns a bounded acknowledgement, and cannot invoke caller callbacks or perform filesystem, process, or network work. A single worker-tool registry classifies guarded capabilities and protocol submissions; unknown or colliding tools fail closed.
- **Rationale:** External Review #3 reproduced arbitrary caller-supplied `submit_evil` execution in Pi `0.84.1` despite the M10 built-in-tool guard. Removing executable custom-tool injection at the child-session API closes the bypass at its source while preserving existing result schemas and post-run processing.
- **Consequences:** `submit_agent_result`, verification, repair, and recommendation analyst flows remain structured protocols; their captured payloads are processed only after child execution. rc.2 was already rejected; rc.3 was the local R6 candidate and was subsequently rejected by External Review #4. M11 remains implemented but not accepted pending independent review and Planner/manual gates.

## ADR-032 — M11-R8 anchors release evidence outside the mutable bundle

- **Decision:** Build and independently test releases from a detached checkout of one exact clean Git commit; bind the repository-defined check scripts and trusted executable identities; reject zero-test results, all symlinks, and non-regular entries; recursively hash every review-bundle file; and require the reviewer to supply the expected bundle-root SHA-256 separately. Create compatibility state with authentic M10 modules and compare observed M10→rc.4→M10 snapshots.
- **Rationale:** External Review #4 showed that mutable working-tree input, coordinated count forgery, incomplete manifests, and a checksum stored only beside editable data could all produce optimistic evidence. One Git source boundary, one independent test rerun, and one external root fact close those shared failure paths without redesigning the independently passing worker-safety architecture.
- **Consequences:** rc.3 is rejected and rc.4 is a local candidate only. Untracked/ignored files cannot enter the artifact; tracked dirt fails; `0/0` can never pass; review docs, root metadata, and nested M10 files are integrity-bound; and the bundle honestly remains unauthenticated unless its root digest arrives through an independent channel. M11 remains not accepted pending External Review #5 and Planner/manual gates; no live route or publication is implied.

## ADR-033 — M12.1 uses explicit native input for canonical Mission entry

- **Decision:** Register one Pi `0.84.1` `input` handler for an explicit beginning-position `@orchestrator <goal>` invocation. Route both that handler and the existing New Mission menu through `createCanonicalMission`, retaining MissionStore as the authority and appending only the existing pointer/status/revision session entry.
- **Rationale:** Users can start a canonical Mission without navigating configuration menus, while Pi's native pre-agent input event preserves ordinary prompt behavior and prevents the goal from being sent to the model after successful interception.
- **Consequences:** Empty explicit input is handled without persistence; ordinary/embedded/quoted/code input continues normally; marker case and surrounding whitespace follow the parser contract. No automatic classification, smart routing, Routing Memory, or background execution is introduced.

## ADR-034 — M12.1 names direct workers separately from canonical M7

- **Decision:** `/subagent-run` is presented as Direct Workers, including Direct Verification Worker. Its feedback states that direct execution creates no canonical Mission task, M7 verification run, quality decision, or quality history. `/verify-task`, quality status, and quality history are labeled canonical Mission quality (M7) without changing their execution or persistence semantics.
- **Rationale:** The Verification Pool is intentionally shared by direct read-only execution and canonical reviewers; naming the worker path and its negative guarantee prevents users from mistaking a foreground worker for a quality decision.
- **Consequences:** The pool and route policy remain unchanged. M12.1 does not promote direct output into Mission state or alter M7 confirmation, routing, protocol, or persistence behavior.

## ADR-035 — M12.2 keeps Smart Routing hybrid and user-controlled

- **Decision:** Use a deterministic bilingual local analyzer for clear prompts;
  return `NORMAL` for clear ordinary work and `SUGGEST_MISSION` for clear
  multi-stage work; reserve optional AI Triage for ambiguity; and expose one
  explicit Run as Mission/Run Normally choice. Keep explicit
  `@orchestrator <goal>` as the M12.1 bypass.
- **Rationale:** The local path is fast, predictable, offline-testable, and
  cost-free for common prompts. A bounded triage path covers semantic
  ambiguity without making model calls the default routing authority or
  silently changing user intent.
- **Decision details:** Triage is selected by stable configured route ID,
  receives only the current prompt plus local signals, must return strict JSON,
  and may use Fallback only for capability failure. Valid disagreement is not
  a quality-shopping trigger. Missing/stale routes and all capability failures
  degrade to the same user-choice recommendation.
- **Persistence/privacy:** Smart Routing settings use a versioned atomic
  rollback-capable sidecar because the host production path still uses legacy
  ConfigV1 route semantics. Routing telemetry is allowlisted bounded metadata
  with no raw prompt, transcript, provider response, or credential. Routing
  Memory and learned rules are explicitly deferred to M12.3.
- **Consequences:** M12.2 does not add a Control Center section, AUTO_MISSION,
  mid-run promotion, benchmark model selection, background scheduling, or
  automatic Mission creation. Live triage remains a separately evidenced gate
  requiring a secure authorized route.

## ADR-036 — M12.3 stores conservative abstract Routing Memory

- **Decision:** Persist Routing Memory in a separate versioned,
  atomic/rollback-capable `routing-memory.json` sidecar. Store only bounded
  bilingual routing signatures plus action, source, confidence, observations,
  timestamps, and enabled state. Keep explicit `Always orchestrate similar
  tasks` rules authoritative over learned rules; require repeated consistent
  choices before learned Mission/Normal activation; and expose all rule
  management through Routing & Fallback → Learned Behaviors.
- **Rationale:** Personalization needs durable state, but prompt history and
  semantic embeddings would create an unnecessary privacy and overgeneralization
  surface. Abstract structural signals support deterministic English/Persian/
  mixed-language matching, restart persistence, migration, bounded growth, and
  inspectable user control without remembering content.
- **Safety policy:** Explicit `@orchestrator` remains the first input bypass.
  Same-tier conflicts never auto-route; explicit rules outrank learned rules;
  keyword-only and materially escalated matches are rejected; learned Normal
  cannot suppress a materially more complex or sensitive current task; and
  strong memory hits short-circuit unnecessary AI Triage. AUTO_MISSION always
  calls the existing canonical Mission creation operation once.
- **Privacy/recovery:** No prompt, transcript, source text, tool result,
  provider response, credential, or secret is persisted in memory or routing
  telemetry. Corrupt rows are isolated, schema-version 0 rules migrate per
  row, unsupported envelopes fail closed to ordinary routing, and backup/
  restore is validation- and confirmation-gated. M12.3 does not add mid-run
  promotion, procedural skill generation, benchmark model selection, Boss
  optimization, or background scheduling.

## ADR-037 — RC15 closes recursive worker read and content-command bypasses

- **Decision:** Treat shell expansion, recursive shell reads, npm lifecycle
  commands, and worker Git content inspection as non-allowlisted. Built-in
  `grep` and `find` use a bounded recursive descendant scan that fails closed
  on credential-like names, symlinks, enumeration errors, or oversized trees.
- **Rationale:** Review of the integrated Pi hook found that a command-level
  allowlist alone did not prevent glob expansion, recursive descendant reads,
  npm child-process execution, or Git commands that expose arbitrary tracked
  content. The shared WorkerSafetyGuard is the smallest common enforcement
  point for these paths.
- **Consequences:** Read-only worker capabilities remain application-level,
  not an OS sandbox. The bounded scan has a deliberate finite ceiling and
  check/use race window; other platforms, real providers, human TUI smoke,
  Planner acceptance, and publication remain separate gates.

## ADR-038 — RC18 preserves external Pi provider catalogs

- **Decision:** Keep the public Pi provider namespace `9router`, but probe the
  credential-blind user `models.json` catalog before factory reconciliation and
  confirm the bound `ctx.modelRegistry` at `session_start`. Treat an existing
  provider as external and do not register, replace, or unregister it. Mark a
  provider PMO-owned only after this host successfully registers an absent
  namespace; only that owned provider may be updated or removed.
- **Rationale:** Pi `0.84.1` replaces a provider's full model list when a
  `models` projection is supplied, and its public registration API has no
  ownership token. A fail-closed occupancy check is the least invasive way to
  preserve user catalogs while retaining standalone PMO behavior.
- **Consequences:** `ConfigV1` and route identity stay unchanged. Current and
  legacy 9Router capability aliases are normalized into the domain/cache layer,
  with conservative defaults only when fields are absent. A provider created
  dynamically by another extension after both probes remains unprovable under
  Pi 0.84.1's public API. Dynamic Route Catalog & Capability Sync is deferred.

## ADR-039 — RC19 adopts Pi providers and delegates secure setup to Pi auth

- **Decision:** Treat an existing Pi `9router` provider as the authoritative
  external catalog and read its credential-blind `getModels()` result without
  registration, replacement, or unregistration. Keep PMO route enablement and
  pool assignment explicit. When no provider exists, offer a TUI-only masked
  API-key flow with explicit Test & Save; test `/v1/models` first, then call
  Pi's public `ModelRuntime.login` API and persist only a fixed `pi-auth`
  reference in PMO configuration. RPC raw-key setup fails closed.
- **Rationale:** Pi `0.84.1` exposes the complete provider catalog through
  `getModels()` even when auth-filtered availability is empty, and it already
  owns restrictive auth storage. Registering a `$PMO_PI_AUTH` placeholder would
  make Pi treat it as a literal/configured key, so Pi-auth-backed provider
  registration must omit `apiKey` and rely on stored credentials.
- **Consequences:** External provider ownership remains outside PMO; existing
  models stay intact through refresh/reload/disposal. PMO config/history/cache
  contain no raw key. A failed test cannot persist setup state. Secure setup is
  TUI-only until Pi exposes an equivalent masked RPC input contract; Keychain
  fallback and automatic pool assignment remain out of scope.

## ADR-040 — RC20 keeps effort per Pool entry and refreshes catalogs manually

- **Decision:** Store Thinking Effort on each Pool route entry. Expose only
  `auto`, `low`, `medium`, `high`, `xhigh`, and `max`, filtered by route
  capability metadata. Auto omits the Pi override; explicit unsupported or
  stale values make the entry unavailable until the user changes it. Record
  requested and observed effective effort as bounded analytics metadata.
- **Decision:** Make Refresh Models a visible, manual action. PMO-owned
  connections use the live 9Router client; externally-owned Pi providers use
  Pi's refresh API and remain external. Successful refreshes publish only
  validated catalog data and report added/removed/changed entries. Failures
  retain the last-known-good catalog and never alter PMO enablement, Pool order,
  or effort settings.
- **Decision:** Treat discovery, PMO enablement, Pool membership, and provider
  ownership as separate state. New routes are disabled, disabled routes stay
  in existing Pools as unavailable, and genuine duplicate identities remain
  ambiguous rather than being guessed. Periodic synchronization and Benchmark
  Lab are deferred.
- **Rationale:** Pi 0.84.1 defaults an omitted thinking override through its
  own model/provider behavior, while a hardcoded `off` defeats reasoning. Pool
  roles need independent policy, and manual source-aware refresh addresses
  catalog drift without taking ownership of a user's Pi provider.

## ADR-041 — RC21 refreshes static Pi providers through a transient auth bridge

- **Decision:** Normalize nested catalog metadata before compact aliases and
  preserve absent capabilities as unknown. For an external static Pi provider,
  use the bound Pi registry's `getProviderAuth()` result transiently with the
  existing bounded 9Router client; retain Pi's native refresh path when the
  provider exposes `refreshModels`. Mark the PMO view upstream-authoritative
  after success so stale static metadata cannot overwrite it. Keep exact route
  IDs in diagnostics only, not normal picker labels.
- **Rationale:** Pi `0.84.1`'s static `models.json` providers do not make an
  upstream request through `ModelRegistry.refresh()`, while PMO already owns
  safe bounded catalog parsing, LKG persistence, and diffing. The public auth
  bridge avoids re-entry and PMO credential persistence without taking provider
  ownership.
- **Consequences:** Auth exists in memory only for the request and is never
  logged or stored by PMO. A static external refresh can discover models before
  PMO gateway configuration exists; the cache binds to the upstream base URL
  until explicit PMO enablement creates route state. Periodic sync and runtime
  execution of newly discovered external models remain outside this repair.

## ADR-042 — RC25 pins a weighted Boss per Mission

- **Decision:** Represent Boss profiles as multiple validated route entries with
  numeric weights and optional thinking policy. Select one eligible Boss once at
  Mission start, persist the assignment before inference, and reuse it for all
  normal planning, dispatch evaluation, repair/replan, verification
  interpretation, and final goal decisions. A genuine infrastructure failure
  may invoke an explicit fallback, which records the original and replacement
  route and pins the replacement for the remainder of the Mission. Quality
  rejection never rotates the Boss.
- **Decision:** Use one bounded canonical goal loop for explicit
  `@orchestrator` and Smart Routing Mission/AUTO_MISSION entries. Completion
  requires the Boss acceptance decision plus execution and M7 Verification
  evidence; recoverable failures replan/repair/reverify, while exhausted bounds
  produce explicit blocked/review evidence. Boss analytics and weight
  recommendations use the existing safe Recommendation architecture, and
  recommendations require explicit user Apply.
- **Rationale:** Mission continuity and attribution require one accountable Boss
  across ordinary cycles. Separating infrastructure fallback from quality
  escalation prevents silent model roulette, while bounded goal looping prevents
  a finished child task or one-shot planner response from being mistaken for
  Mission completion.
- **Boundary:** The Boss is not an implementation worker. Investigation,
  Implementation, and Verification retain independent per-task/run scheduling;
  route identity remains exact internally; and contextual/central
  recommendations share canonical, sample/stale-safe state with explicit Apply.

## ADR-043 — RC26 records CANCELLED and SAFETY_STOP without a new MissionStatus

- **Decision:** Keep the RC25 canonical goal loop and once-per-Mission pinned
  Boss. Add first-class orchestration terminals `CANCELLED` and `SAFETY_STOP`
  beside `COMPLETED`, `BLOCKED`, and `AWAITING_USER`. Persist cancellation as
  MissionStatus `cancelled`. Persist safety-stop as MissionStatus `blocked`
  plus explicit `plan.orchestration.terminal = "SAFETY_STOP"` and a bounded
  sanitized provenance from the existing M10 trust/path/command safety errors.
  Do not add a new persistent MissionStatus for safety-stop.
- **Decision:** Cancellation and safety-stop are never infrastructure fallback
  reasons, never quality escalation, never false `COMPLETED`, and never
  continue repair/replan. Analytics retain `bossTerminalState` including
  `CANCELLED` and `SAFETY_STOP`.
- **Decision:** Runtime package metadata is derived from the nearest
  `pi-multi-orchestrator` package.json. The development-line title is keyed by
  that version; unknown versions fail closed as `stale-development-line:*`.
  `latestAcceptedMilestone` remains M10 and `productionReady` remains false.
- **Rationale:** Operators and diagnostics need truthful terminal classification
  without a schema migration or a second safety system. Package metadata must
  not silently advertise an older development line after the manifest advances.
- **Boundary:** RC26 prepares `0.1.0-rc.26` in source only. Publication, tags,
  npm dist-tags, and GitHub Releases remain a separate operator-owned step.
  RC25 remains the public prerelease until that step occurs.

## ADR-044 — RC27 validates Boss protocol and bootstraps autonomous Tasks

- **Decision:** Keep the RC25/RC26 canonical goal loop, once-per-Mission pinned
  Boss, infrastructure-only fallback, M7 quality separation, CANCELLED, and
  SAFETY_STOP. Validate Boss inference JSON at runtime with
  `normalizeBossDecision`. Treat plan-phase `dispatch`/`replan` with zero tasks
  as `BossProtocolError`, not a silent cycle. Feed bounded corrective feedback
  to the same pinned Boss. Protocol/quality failure must not trigger M4
  infrastructure fallback.
- **Decision:** `@orchestrator`, Smart Routing Run as Mission, and AUTO_MISSION
  must create canonical Tasks themselves. The `/missions` Task editor remains
  for explicit manual Missions and must not be required to make `@orchestrator`
  work. Automatic Mission UX must not tell the user to add a Task.
- **Decision:** Goal-level acceptance criteria are durable. Explicit structured
  criteria outrank labelled goal sections, which outrank bounded derived
  criteria. Do not overwrite explicit user criteria. Goal criteria stay
  distinct from per-Task criteria.
- **Rationale:** Public RC26 dogfood Mission
  `mission-5f02627a-f84b-4ecb-95c1-a900dacfa5a8` burned 4 Boss cycles with 0
  tasks and entered `AWAITING_USER` while asking the user to add a Task.
- **Boundary:** RC27 prepares `0.1.0-rc.27` in source only. Public RC26
  (`0.1.0-rc.26`, tag `v0.1.0-rc.26`, source
  `11153f0587634bcba732a5b214c95319c305f9e6`) is immutable. Publication, tags,
  npm dist-tags, and GitHub Releases remain a separate operator-owned step.

## ADR-045 — RC28 normalizes live Boss inference and separates fallback from scheduling

- **Decision:** Keep RC25–RC27 pinning, strict `normalizeBossDecision`,
  zero-actionable-plan repair, Goal criteria provenance, autonomous Task
  bootstrap, M4 vs M7 separation, CANCELLED, and SAFETY_STOP. Add one canonical
  Boss-response normalization layer over Pi's public `AssistantMessage`
  contract from `@earendil-works/pi-ai` 0.84.1: `StopReason` is
  `pending | stop | length | toolUse | error | aborted | deferred`; user-visible
  text is only `content[].type === "text"` (Pi `contentText()`); thinking
  blocks are never the decision.
- **Decision:** Treat `stop` and `length` as usable completions when final
  text parses to a valid BossDecision. Empty assistant text, truncated
  max-token output, unsupported shapes, represented refusals, cancellation,
  and classified request/response failures stay distinct. Do not require
  `stopReason === "stop"` as the only success. Do not flatten live
  `completeSimple` failures to a generic "provider request failed".
- **Decision:** Boss scheduling eligibility, infrastructure fallback
  eligibility, and response protocol validity are three predicates.
  `selectBossEntry` continues to require enabled routes with weight > 0.
  `selectBossFallbackEntry` requires enabled/available/compatible unused
  routes and MUST NOT require positive weight. No separate fallback-disable
  policy exists in this RC, so weight 0 may still fallback. Protocol/quality
  errors still must not fallback. A successful fallback remains the Mission pin.
- **Decision:** Persist only sanitized invocation diagnostics (stage, class,
  stopReason, hasText, normalized, optional code/status, route ids, fallback
  attempted/selected). Never persist API keys, authorization headers, raw
  provider payloads, or hidden reasoning. Inspect and terminal reasons must
  show the classified failure instead of a black-box infrastructure sentence.
- **Decision:** Boss Profile UI is presentation-only: a stored display name of
  `Unconfigured Boss` with configured routes is shown as `Default Boss`;
  scheduled Boss is the positive-weight assignment preview; editor selection
  is labelled separately; fallback eligibility is visible. Do not imply that a
  zero-weight editor route is the active Boss.
- **Rationale:** Public RC27 dogfood Mission
  `mission-89d5e163-17ee-4218-b06c-dea5fa4b480b` persisted criteria and pin but
  received no usable assistant text (`Boss provider returned no decision`).
  Mission `mission-aa30ed69-3213-4cf0-882a-a60be426412d` pinned an eligible
  Tabi route then blocked at cycle 0 with
  `Boss infrastructure is unavailable and no configured fallback remains`
  after the original structured failure was discarded and weight 0 Cursor
  could not fallback. These are observed route/runtime compatibility failures,
  not provider blame and not Mission bootstrap regressions.
- **Boundary:** RC28 prepares `0.1.0-rc.28` in source only. Public RC27
  (`0.1.0-rc.27`, source `267612d15dcc0784856e7dafd6704d2f802272b9`) is
  immutable. Publication, tags, npm dist-tags, GitHub Releases, and live Pi
  install remain a separate operator-owned step. RC27 history is not rewritten.

Correction 2026-08-16: RC28 was subsequently published as the public immutable
prerelease `pi-multi-orchestrator@0.1.0-rc.28`, tag `v0.1.0-rc.28`, source
`aad28c33260326665ec17e347d50fe985b18a953`. This ADR is not rewritten.

## ADR-046 — RC29 Mission runtime convergence: delivery vs protocol, identity, capability, active completion

- **Decision:** Keep RC25–RC28 pinning, weight-0 infrastructure fallback,
  classified invocation diagnostics, strict `normalizeBossDecision`, Goal
  criteria provenance, autonomous Task bootstrap, three worker Pools, Context
  Broker boundedness, M7 independence, CANCELLED, SAFETY_STOP, and the
  ADR-045 rule that thinking/CoT is never the Boss decision. Do not rewrite
  public RC26/RC27 or the unpublished RC28 candidate identity.
- **Decision:** Empty user-visible assistant text (`stop`/`length` with no
  `type:"text"`, including thinking-only completions) is an **invocation
  delivery failure**. Persist class `empty_response` and treat it as
  `BossInfrastructureError` so remaining compatible Boss routes may fallback.
  After fallback is exhausted, terminal `BLOCKED` with the classified reason.
  Do not burn `maxCycles` as `AWAITING_USER` with 0 Tasks. Truncated
  incomplete JSON, empty `dispatch`/`replan` task arrays, and invalid
  BossDecision documents remain **protocol** and still must not fallback
  (RC27-02 unchanged).
- **Decision:** Safety budgets are distinct. Invocation-delivery /
  infrastructure exhaustion is `BLOCKED`. Decision-protocol exhaustion with
  no Tasks remains informative `AWAITING_USER`. Productive
  plan→execute→verify→evaluate iterations keep the existing cycle bound
  (default 4) and must not be conflated with hollow delivery retries.
- **Decision:** Logical Task identity is `executionClass` plus NFKC / lower /
  collapsed objective. Reuse the latest non-cancelled Mission Task with that
  key, or an explicit `taskId` that already belongs to the Mission and is not
  cancelled. Repair rejected work on the same identity; do not multiply Tasks
  because an LLM omitted an ID. Historical cancelled or superseded rows stay
  durable. `completedAndVerified` and store completion inspect **active**
  Tasks only.
- **Decision:** COMPLETED requires Boss `complete` with `acceptanceSatisfied`
  **and** every active Task `execution_completed` with M7 `passed`. Boss
  semantic judgment cannot hide missing durable state; durable state cannot
  complete without the Boss complete action.
- **Decision:** Before Boss inference, Goal/criteria that require
  worker-impossible operations (`git commit`, `git push`, npm publish, other
  network/publication) terminal `AWAITING_USER` with provenance
  `CAPABILITY_MISMATCH`. Implementation workers never receive
  `explicitlyAuthorized` for those commands. Negated language
  (`do not` / `without`) is not a mismatch.
- **Decision:** Boss inference receives a bounded canonical Mission
  projection (Task ID, objective, class, lifecycle, latest Attempt, quality,
  accepted evidence summary, required fixes, supersession, outstanding Goal
  criteria). No raw transcripts or hidden reasoning. M7 reviewer prompts are
  execution-class specific. Persist `lastFeedback` and the next cycle in
  `plan.orchestration`. Terminal `completed` / `cancelled` / `blocked` /
  `awaiting-review` Missions do not resume Boss inference.
- **Rationale:** Live RC28 Mission
  `mission-04452706-5486-4131-8565-dcec84f52beb` pinned Tabi, fell back after
  HTTP 403, then classified Cursor thinking-only `empty_response` as protocol
  four times and labelled `AWAITING_USER` with 0 Tasks. RC28 selection and
  classification worked; the remaining failure was treating hollow delivery as
  protocol and burning the productive cycle budget. The same Goal also
  required commit/push, which workers cannot perform; that mismatch never
  executed because planning never ran. Evidence is in
  `docs/mission-runtime-root-cause.md`.
- **Boundary:** Development identity is `0.1.0-rc.29` with status
  IN PROGRESS / LOCAL DOGFOOD REQUIRED. Public RC28
  (`0.1.0-rc.28`, tag `v0.1.0-rc.28`, source
  `aad28c33260326665ec17e347d50fe985b18a953`, artifact SHA-256
  `9f516b23af13749148289c616298db0f48b1a51c8cb61e9814e09097db1a0fa3`) is
  immutable. Publication, tags, npm dist-tags, GitHub Releases, and live Pi
  install remain operator-owned. Do not call RC29 pre-release ready until a
  real isolated Pi Mission using this runtime reaches COMPLETED.

## ADR-047 — Enforced Boss Decision Tool Transport

- **Decision:** Assistant prose is not an authoritative control plane. Free-form JSON in assistant text is rejected as the primary orchestrator transport mechanism.
- **Decision:** The canonical and preferred Boss decision transport is the schema-enforced `submit_boss_decision` tool call. Invocations define `submit_boss_decision` with strict JSON schema constrained sampling and force tool selection via `toolChoice`.
- **Decision:** Strict text JSON is retained only as a secondary compatibility fallback for legacy/stub test runtimes when no toolCall block exists.
- **Decision:** Thinking / Chain-of-Thought (`type: "thinking"`) content blocks are explicitly ignored and excluded from decision parsing.
- **Decision:** Decision transport capability failures (missing tool definitions / uncarried control tools / empty responses) are classified as `BossInfrastructureError` eligible for controlled fallback. Semantic protocol failures (malformed tool arguments or invalid plans) remain `BossProtocolError` with machine-readable corrective feedback and early termination on repeated identical failure fingerprints without infrastructure fallback.
- **Rationale:** Forensic investigation of `mission-939cfa52-87d2-4e6f-b8d8-bc5930c90a73` proved that free-form model text is non-compliant with JSON schema instructions under complex planning prompts. Moving to structured `submit_boss_decision` tool transport enforces schema validation at inference time and eliminates parsing ambiguity.
- **Consequences:** All Boss routes compatible with Pi 0.84.1 / 9Router receive the `submit_boss_decision` tool definition; `normalizeBossDecision` remains the final strict validator.

## ADR-048 — Two-phase worker result finalization

- **Decision:** Worker task execution and worker result handoff are separate phases. Exactly one capture-only finalization turn may run when the work phase has no structured result and either (1) the provider completed normally, or (2) the child timed out after useful non-result tool activity, `mutationObserved` is not true, the worker was not cancelled, and SAFETY_STOP did not terminate the child. Finalization cannot perform task work, expose normal tools, or replay side effects.
- **Decision:** Finalization uses the same child `AgentSession` and the same canonical Attempt. Tools are restricted with `setActiveToolsByName([resultTool])`. `AgentSession.prompt` does not support `toolChoice`; the strongest supported enforcement is tool restriction plus `ToolDefinition.constrainedSampling` and a one-turn `shouldStopAfterTurn` budget. Timeout salvage does not create a Task, Attempt, or Boss cycle and does not replay the assigned work.
- **Decision:** After mutation, infrastructure failure during finalization must not fallback to a fresh implementation worker. Timeout salvage is forbidden after `mutationObserved=true`, CANCELLED, or SAFETY_STOP.
- **Decision:** When provider-success finalization also fails to capture a valid result, keep backward-compatible `invalid_child_result` (or `partial_mutation_requires_review` after mutation) and attach a precise in-memory `resultFinalization` diagnostic. A timeout-salvage miss remains an M4 infrastructure timeout; it is not `result_capability`. Do not add a persisted terminal-state enum. ADR-049 supersedes the hard stop only for non-mutating provider-success misses after the one turn.
- **Rationale:** `mission-306fb445-f267-4745-b5fc-a3c46e1760f5` proved DeepSeek can call `submit_agent_result`, but the live Mission omitted it. `mission-0fda6357-6e16-4ad3-bf2c-8284bf4e7824` then proved a read-only worker can finish useful inspection and still hit the child timeout before `submit_agent_result`. Copying Boss `toolChoice` into the work phase would hide investigation/implementation tools. Same-session capture-only finalization recovers the handoff without replaying work or raising the work-phase timeout.
- **Consequences:** Work-phase protocol violations with no valid capture do not loop into finalization. Evidence admission still requires a parsed structured result. Worker-incomplete anti-repeat remains a Boss stop, not a substitute for capturing a result.

## ADR-049 — Worker result-capability fallback after exhausted finalization

- **Decision:** A worker result-capability failure after the single capture-only finalization turn may cross-route fallback only when the Task execution observed no mutation. Mutation-observed work must never be automatically replayed.
- **Decision:** Distinguish three families:
  - **Infrastructure failure** — timeout, auth, transport, quota, unavailable. M4 may `RETRY_SAME_ROUTE` then `FALLBACK_NEXT_ROUTE` per `routing.maxAttempts` and `routing.fallback.enabled`. These classes update HealthStore.
  - **Result capability failure** — `result_capability`. The provider completed work, one bounded finalization turn ran, and no valid `submit_agent_result` exists. Same-route retry is forbidden. If `mutation_observed=false`, fallback is enabled, and another eligible route exists, M4 uses existing `FALLBACK_NEXT_ROUTE` / `selectRoute` against the same canonical Task. This class MUST NOT be recorded as infrastructure health and MUST NOT be labeled timeout/transport.
  - **Quality failure** — a valid structured result exists and is unacceptable. M7 / Boss repair only. Never M4 result-capability fallback.
- **Decision:** ADR-048 still owns the one-turn capture-only finalization. This ADR supersedes ADR-048's hard executor stop **only** for the non-mutating, finalization-attempted miss.
- **Decision:** Persist metadata-only finalization diagnostics on the MissionStore `attempt_*` event payload (`finalizationRequired`, `finalizationAttempted`, `finalizationSucceeded`, `finalizationOutcome`, `routeId`, `attemptId`, safe `stopReason` / `failureClass`). Do not persist raw model text, hidden reasoning, prompts, transport, credentials, or headers.
- **Rationale:** `mission-0bfe84d8-6848-404b-94b4-81cc1bff502e` exhausted DeepSeek after timeout → same-route retry → omitted result. Stopping the chain prevented Gemini/Luna from executing the same Investigation Task. Replaying mutated implementation work would violate WORK-07.
- **Consequences:** `routing.maxAttempts` remains the same-route **infrastructure** retry budget. Result-capability failure never consumes same-route retries. No `maxSameRouteRetries` config field is added.

## ADR-050 — Autonomous Boss-led mutation recovery

- **Decision:** `mutation_observed=true` after a missing/invalid structured worker result no longer automatically implies human review when the mutation is local and observable. Human intervention is the last resort, not the normal incomplete Implementation handoff.
- **Decision:** Preserve ADR-049 unchanged for CLASS A: `mutation_observed=false` plus exhausted finalization remains `RESULT_CAPABILITY_FAILURE` and may `FALLBACK_NEXT_ROUTE`. M4 still MUST NOT cross-route replay `mutation_observed=true` work.
- **Decision:** Classify mutation before any continuation:
  - **CLASS A / none** — no mutation; ADR-049 owns fallback.
  - **CLASS B / local_observable** — completed `edit`/`write`/`bash` without unsafe-external effect, inside the trusted project boundary, with no publication/push/external mutation. Enter `AUTONOMOUS_MUTATION_RECOVERY`. Preserve the current worktree. Do not rollback automatically. Do not blindly redo the Task from scratch.
  - **CLASS C / unsafe_external or unknown** — git push, npm publish, GitHub Release, destructive external API/database mutation, unknown/unbounded side effect, mutation outside the trusted project boundary, or a `NETWORK_OR_PUBLICATION` / device / privilege safety block. Boss may summarize; autonomous continuation is forbidden. Action is `REQUEST_HUMAN`.
- **Decision:** Recovery is a bounded sequence on the **same canonical Task**. The failed Attempt remains historical truth (`interrupted` / `partial_mutation_requires_review`). Continuation creates a new Attempt. Do not duplicate the logical Task.
- **Decision:** Before another Implementation Worker mutates anything, dispatch a read-only recovery assessment on the Investigation pool using capture-only `submit_recovery_assessment`. Thinking/CoT and free-form JSON prose are not control data. The assessment receives a bounded changed-worktree projection (git status, paths, diffstat; secrets redacted) plus Task objective, acceptance criteria, and failed Attempt identity.
- **Decision:** Boss recovery uses a separate capture-only `submit_recovery_decision` tool, not the ordinary `submit_boss_decision` loop. Allowed actions: `CONTINUE_EXISTING_WORK`, `REPAIR_EXISTING_WORK`, `ROLLBACK_AND_RETRY`, `REQUEST_HUMAN`. `ROLLBACK_AND_RETRY` is valid only when a safe local rollback boundary is proven; otherwise coerce to `REQUEST_HUMAN`. `REQUEST_HUMAN` is reserved for CLASS C, unrecoverable ambiguity, failed inspection, exhausted recovery budget, or policy-required authorization — not merely because one Worker omitted `submit_agent_result`.
- **Decision:** Continuation Workers receive a recovery packet whose starting state is the current worktree. They are explicitly instructed not to restart from zero. Existing M7 repair semantics remain after a valid structured result.
- **Decision:** Maximum one autonomous mutation-recovery sequence per logical Task (`recovery-assessment` Evidence count). Failed inspection is a truthful terminal and consumes that budget. Recovery must not burn ordinary Boss replan cycles as an infinite repair loop. SAFETY_STOP and CANCELLED remain non-recoverable.
- **Rationale:** RC29 proved Boss → Task → Worker → structured result → Evidence → M7 → COMPLETED. Live incomplete Implementation handoffs with local file edits were stopping for humans even though the worktree was recoverable. Boss already owns orchestration; local edits are recoverable state.
- **Consequences:** Development identity is `0.1.0-rc.30`. RC29 artifact `pi-multi-orchestrator-0.1.0-rc.29.tgz` remains a frozen unpublished candidate and is not modified. No publication, tag, or GitHub Release is authorized by this ADR.
- **Publication correction (2026-08-17):** a later operator publication mission published the already-frozen RC30 candidate as public prerelease `0.1.0-rc.30`, tag `v0.1.0-rc.30`, source `ef344ad12abeace41e9ba4f88f552b6f67306107`. This ADR itself did not authorize that step. RC29 remains unpublished.

## ADR-051 — Pi-native Live Mission Progress

- **Decision:** Canonical Mission events are the single source of live execution truth. Presentation is a projection (`projectMissionProgress`) plus a Pi TUI overlay, not a second state machine, not a separate ncurses app, and not operator SQLite polling.
- **Decision:** Prefer Pi 0.84.2 `ctx.ui.setWidget(key, string[])` as the updatable live surface, with `setStatus` / `setWorkingMessage` for footer/working indicators. `notify` remains for Mission created / terminal notices and is the bounded fallback only when `setWidget` is absent. Heartbeats update the widget; they do not append a permanent log line every second.
- **Decision:** On Pi restart/resume, reconstruct the latest in-flight Mission (`running` / `active` / `planned`) from durable events and continue streaming. Do not paint completed history onto ordinary non-orchestrated Pi turns.
- **Decision:** Render operational execution state only: Mission/Boss/Task/Worker/tool/Evidence/M7/recovery/finalization/terminal. Exclude hidden reasoning/CoT, raw provider payloads, auth headers, secrets, and unrestricted prompts/completions. Tool targets are basename-bounded; safety blocks are visible and non-terminating for the display.
- **Rationale:** Public RC30 Mission `mission-ecdeb469-146f-4cc5-8726-3ebddf8789df` did substantial Boss/Worker/M7 work while the user saw only "Boss execution starting automatically..." then silence until `awaiting-review after 4 Boss cycles`.
- **Consequences:** Development identity is `0.1.0-rc.31` LOCAL / UNPUBLISHED. Public RC30 remains immutable. This ADR does not ship a full Mission Cockpit.

## ADR-052 — Feedback-driven M7 repair convergence

- **Decision:** M7 quality gates match Task acceptance criteria to reviewer `criterionResults` by normalized text and, when no names match and counts are equal, by stable order. Reviewer slugs such as `current_public_version` must not block a result that already marked the corresponding criteria satisfied.
- **Decision:** For investigation Tasks, `mutationObserved=false` on the worker Attempt is admissible evidence for a no-modification criterion. Reviewers must not block solely because git/shell is unavailable. Do not weaken M7 for implementation Tasks or failed criteria.
- **Decision:** When the gate blocks and the reviewer left `requiredFixes` empty, synthesize requiredFixes from gate reasons so Boss and repair packets receive the actual rejection, not a generic "blocked".
- **Decision:** Boss `complete` is illegal in projection/control logic when any active Task quality is blocked, rejected, unverified, or not M7-passed. The durable completion gate remains the final defense and still rejects an illegal complete.
- **Decision:** Repair packets inject canonical quality feedback (`verdict`, `requiredFixes`, not-verified criteria, findings). A bounded rejection fingerprint of Task identity + M7 verdict + requiredFixes + evidence kind + repair instruction prevents blindly re-dispatching the same blocked strategy. A materially different repair remains allowed. Repeated identical fingerprints terminal as truthful `AWAITING_USER` rather than burning the cycle budget.
- **Decision:** Quality failure never becomes M4 infrastructure fallback. ADR-049 and ADR-050 remain unchanged.
- **Rationale:** Forensic reconstruction of `mission-ecdeb469-146f-4cc5-8726-3ebddf8789df` showed workers answered the public version from `package.json` / `RELEASE_STATE.md`, while M7 blocked because reviewers used slug criterion names (and once `not_verified` for no-mod without git). Boss then requested `complete` while quality was blocked; the completion gate rejected; the same Task was re-dispatched four times without targeted repair.
- **Consequences:** Development identity is `0.1.0-rc.31` LOCAL / UNPUBLISHED / DOGFOOD. Do not publish, tag, or GitHub-release RC31 in this ADR. Public RC30 is untouched.

## ADR-053 — Complete Pi-native streaming and reliable cancellation

- **Decision:** Split Mission presentation into two distinct, dedicated layers:
  - **Layer A (Live Compact Status Widget):** `ctx.ui.setWidget` provides an updatable, current-state snapshot strictly capped at <= 8 lines, displaying phase, active agent/model, elapsed time, and cancellation hint (`Esc to cancel`). Historical logs are strictly excluded, eliminating the `MAX_WIDGET_LINES` (10) truncation boundary.
  - **Layer B (Main Pi Activity Transcript):** Canonical Mission events, worker progression, and safe tool activity stream directly into the main Pi terminal transcript via `pi.appendEntry` and a registered custom entry renderer (`pi-multi-orchestrator:activity`).
- **Decision:** Reliable foreground cancellation follows Pi-native semantics: `Escape` (`\x1b`, Pi `app.interrupt`) and `Ctrl+C` (`\u0003`) are intercepted by `ctx.ui.onTerminalInput` while an active Mission is owned, invoking `ctx.abort()`. Cancellation propagates cleanly via `AbortSignal` through Boss, Worker, and M7 execution handles.
- **Decision:** An explicit operator command `/mission-cancel [mission-id]` provides deterministic cancellation for active owned missions, fails closed on ambiguous/unowned missions, and updates durable state (`mission_cancelled`, attempt terminalization, verification blocked).
- **Decision:** Interrupted terminal/process crashes remain distinctly recovered as `INTERRUPTED` without rewriting historical records to clean `CANCELLED`.
- **Decision:** Amendments to ADR-051 and RC31-01 for real-world hardening:
  - Startup silence: Pi session start / resume remains quiet by default (`resumeLiveProgress` does not paint historical or unowned active mission widgets).
  - Decoupled ownership leases: Mission execution leases are heartbeat-driven and distinct from UI presentation heartbeats. Background intervals must be `unref()`-guarded.
  - Non-stealing lease recovery: `recoverInterrupted` respects unexpired foreign leases, reconciling foreign executions silently only after true expiry.
  - Atomic claim: `claimMissionExecution` atomically acquires the mission lease and transitions to `running`; losers dispatch 0 tasks/attempts.
  - Owner shutdown: `interruptOwnedExecution` provides atomic, owner-specific terminalization during host dispose without corrupting foreign leases.
  - Truthful health display: Expired cooldown timestamps are never displayed as active in `/routes` or `/orchestrator`.
- **Rationale:** Live dogfooding proved that widget history accumulation caused ugly truncation notices, activity was invisible in the main transcript, and `Ctrl+C` failed to abort active in-flight missions because Pi maps `Escape` to `app.interrupt` and `Ctrl+C` to `app.clear`.
- **Consequences:** Development identity is `0.1.0-rc.31` LOCAL / UNPUBLISHED / DOGFOOD. Not tagged, published, or released. RC30 remains the public immutable prerelease.
