# Roadmap

## Delivery rules

Each milestone is independently reviewable, migratable, and testable without paid model calls. A milestone may begin only when its dependencies and exit gate are satisfied. Later requirements do not justify speculative implementation in an earlier milestone.

## M0 — Specification freeze and repository foundation

Status: ACCEPTED / PASS.

Deliverables:

- authoritative product, architecture, acceptance, decision, and roadmap documents;
- Pi `0.84.1` API validation and named proof-of-concept gaps;
- local Git repository with no production code or remote.

Exit gate: all required documents exist, internal references and Markdown pass checks, no likely secret is committed, contradictions are resolved, and a local commit is created when identity is available.

## M1 — Foundation and configuration engine

Status: ACCEPTED / PASS.

Deliverables:

- TypeScript package skeleton using the installed/supported Pi package contract;
- versioned global configuration and trusted project override schemas;
- validation, defaults, deterministic merge rules, migration, atomic save, history, rollback, and corruption recovery;
- secret-reference types that cannot serialize resolved secret values;
- metadata-only analytics configuration controls, with no event collection or storage;
- fake clock/filesystem boundaries only where deterministic tests require them.

Exit gate: deterministic tests prove save/restore/migrate/recover/precedence/export-redaction behavior. No live Pi configuration is changed.

## M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC

Status: ACCEPTED / PASS.

Deliverables:

- authenticated, timeout-bounded `GET /v1/models` discovery through the secret resolver;
- full catalog cache with freshness and last-known-good semantics;
- explicit enabled-route set and dynamic Pi provider exposing only enabled 9Router routes;
- minimal Models & 9Router TUI: refresh, search, inspect, enable, disable, connection setup, and catalog/provider diagnostics; live route-test UX remains deferred because it can consume quota;
- proof of route identity, observed metadata limits, and runtime provider refresh behavior against a fake 9Router and the installed Pi runtime. The optional live catalog probe remains credential-gated and was skipped when credentials were absent.

Exit gate: remote 36/enabled 5, new-disabled-by-default, stale-catalog, duplicate-underlying-model, and unavailable-gateway acceptance tests pass.

## M3 — Three Execution Pool Manager + Ordered Route Priorities + TUI Pool Editor

Status: ACCEPTED / PASS.

Deliverables:

- exactly three ordered execution pools;
- route add/remove, per-pool enable/disable, and reorder operations using the existing schema;
- persistent list-order priority with history and serialized same-process mutations;
- one generic Pi-native pool editor reused by all three pools;
- `/orchestrator` pool sections plus `/pool-models` and `/pool-status`; and
- management-only status for globally disabled, missing, and unavailable routes without deleting membership.

Role, Boss-profile, and operational-profile data defined in M1 remain compatible; M3 adds no profile scheduling, task routing, or role execution.

Exit gate: PASS — pool add/remove/reorder, cross-pool independence, global-disable/missing retention, same-model distinct-route, history/concurrency, Pi TUI/command, actual Pi with fake gateway, and M2 regression tests all passed (`70/70`).

## M4 — Routing, health, and infrastructure fallback

Status: ACCEPTED / PASS.

Deliverables:

- pure ordered eligibility/preview router using pool priority, enabled state, availability, health, attempt exclusions, and explicit diversity context;
- failure classifier and bounded same-route retry/fallback/stop decisions, including conservative 429, cancellation, invalid-request, protocol, and unknown semantics;
- injectable runtime `HealthStore` JSON with retry-after/cooldown, circuit state, success recovery, corruption quarantine, and manual reset, kept out of ConfigStore/export/history;
- Routing & Fallback and Health & Quotas flows in `/orchestrator`, plus `/routing-status`, `/route-health`, and `/routing-settings`;
- fake-clock/unit, fake-gateway, and Pi `0.84.1` integration evidence with the M2/M3 regressions intact; and
- explicit boundary with opaque 9Router account/combo fallback; M4 never executes a model request.

Exit gate: PASS — `86/86` tests, typecheck, build, aggregate check, fake-gateway, and real Pi `0.84.1` routing/health RPC checks passed. M5 was subsequently authorized and is recorded below.

## M5 — Routed Subagent Execution

Status: ACCEPTED / PASS.

Deliverables:

- direct Pi `0.84.1` SDK child sessions with in-memory session/runtime state and exact M4 route/model pinning;
- explicit role/pool/task request, per-pool tool allowlists, bounded `submit_agent_result`, tool observation, timeout, cancellation, and deterministic cleanup;
- M4 retry/fallback/health integration with automatic fallback blocked after `edit`, `write`, or `bash`;
- serial-by-cwd Implementation execution, parent-only `delegate_agent`, `/subagent-run`, and fake-gateway/actual-Pi parent→child proof.

Exit gate: PASS — `97/97` tests, typecheck, build, aggregate check, fake-gateway, and Pi `0.84.1` parent→child evidence prove tool boundaries, structured result protocol, exact model selection, safe fallback, mutation stop, cancellation, timeout, isolation, and M2–M4 regressions. Paid calls and live environment changes were zero/none.

## M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation

Status: ACCEPTED / PASS.

Deliverables:

- mission lifecycle, transactional revisions, checkpoints, lease/recovery, and resume primitives;
- a separate versioned Node `node:sqlite` MissionStore with bound SQL, foreign keys, busy timeout, and corruption checks;
- deterministic accepted-only Context Broker and immutable role/pool TaskPacketV1 with explicit size/content limits;
- proposed worker evidence with explicit acceptance/rejection and canonical provenance;
- `/missions`, Context & Mission Settings, and packet inspection while Pi session entries contain only mission pointers/status.

Exit gate: PASS — MissionStore/ContextBroker deterministic suites, restart/reopen and interrupted recovery, stale lease, context isolation, rejected/proposed evidence, checkpoint atomicity, packet lineage/digest, M2–M5 regressions, and the actual Pi/fake mission task/evidence/reopen flow passed (`111/111`, `npm run check`, Node `22.23.0`, Pi `0.84.1`). Accepted implementation commit `62282c1618f395b032e359005d018721e2b36868`; accepted evidence HEAD `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298`.

## M7 — Quality gates, review, and escalation

Status: ACCEPTED / PASS.

Deliverables:

- MissionStore schema v1→v2 migration preserving all M6 rows and defaulting quality to unverified;
- durable verification runs, quality decisions/status, reviewer findings, mechanical-check provenance, and escalation history;
- bounded `submit_verification_result` through the existing M4→M5 child boundary with read-only Verification tools;
- deterministic QualityGate PASS/REJECT/BLOCKED semantics and reviewer route diversity;
- explicit Verify/Re-verify and confirmation-gated bounded quality-loop host actions; and
- quality rejection kept separate from M4 health/fallback and canonical evidence admission.

Exit gate: PASS — `121/121` tests, typecheck/build/check, and actual Pi `0.84.1` + fake-gateway reviewer reject→routed repair→re-review pass with durable lineage. At the STATE-7 handoff, M8 was next planned and not started; STATE-8 later records M8 acceptance.

## M8 — Analytics + Statistics + Cost/Token Accounting + Quality/Value Metrics + Auto-Tuning Recommendations

Status: ACCEPTED / PASS by STATE-8.

Deliverables:

- privacy-minimal metadata collection, durable events, and query projections;
- mission, agent, token, cost, route, pool, Boss, and fallback reports;
- explainable, sample-size-aware pool-specific recommendations;
- explicit Apply/Ignore/Details actions with no silent mutation.
- local `analytics.sqlite` schema v1 with idempotent privacy-minimal events, Pi usage/latency capture, `/analytics`, and `/recommendations`.

Exit gate: PASS — `134/134` tests, `npm run check`, actual Pi 0.84.1 fake-gateway analytics/fallback/quality telemetry, token provenance/UNKNOWN handling, restart dedupe, ConfigV1→V2 billing migration/persistence, nine analytics detail views, and recommendation Details/Ignore/Apply/stale protection. STATE-8 records Planner acceptance; live/paid calls `0`.

## M8.5 — Manual AI Recommendation Analyst

Status: ACCEPTED / PASS by STATE-8.5.

Deliverables:

- optional manual-only AI reasoning over deterministic M8 recommendations;
- Verification Pool route selection with no hard-coded model and existing M4/M5 execution;
- bounded analytics input and structured SUPPORT/OPPOSE/INSUFFICIENT_EVIDENCE output;
- bounded audit metadata, deterministic input fingerprint, stale analysis detection, and privacy filtering;
- Recommendation Analyst UI/RPC with explicit Analyze Now/Re-analyze and no background execution or automatic Apply.

Evidence: `141/141` full tests, analyst/provider focused suites, typecheck/build/check PASS, and Pi `0.84.1` fake-gateway support/oppose/insufficient/failure-preserves-deterministic flows. Analyst execution is manual-only, deterministic recommendations remain authoritative, and explicit Apply remains the M8/M3 mutation path; paid calls `0`.

## M9 — Full TUI control center

Status: ACCEPTED / PASS by STATE-9.

Deliverables:

- all twelve control-center sections from the product specification;
- keyboard-accessible navigation, progress, error, stale-data, confirmation, and empty states;
- live mission/agent/route/review visibility without log inspection.

Acceptance evidence: exact twelve-section/dashboard and RPC/native selector suite `5/5 PASS`; existing provider suite `17/17 PASS`; full suite `146/146 PASS`; `npm run check`, typecheck, build, package dry-run, diff check, secret scan, and project-state consistency PASS. Human keyboard-driven TUI smoke remains pending because no authorized interactive keyboard session was available; this is open validation and not an M9 acceptance blocker. M9 does not add Boss runtime, autonomous scheduling, background work, or automatic priority mutation.

Exit gate: PASS — STATE-9 records Planner acceptance of implementation commit `2032a2b` with evidence HEAD `1200d3349506a1d414def0f3c1e044d712711d9d`; human keyboard smoke remains a separately open validation item.

## M10 — Safety and hardening

Status: ACCEPTED / PASS by STATE-10.

Deliverables:

- protected-path and destructive-command policy;
- project trust enforcement, secret filtering, permission review, database recovery, lock/lease hardening, and crash fault injection;
- import/export adversarial tests and privacy review.

Evidence: full suite `159/159 PASS` with loopback-capable fake Pi execution; TrustStore/path/command/privacy, lease/CAS, SQLite backup/restore, corruption degradation, and fault-injection tests PASS; typecheck/build/check/package/diff/secret validation PASS. Human keyboard smoke remains open validation but is not an M10 acceptance blocker. No live or paid calls were used.

Implementation commit: `3a6990d` — `feat(safety): harden trust permissions and recovery`.

Exit gate: PASS — STATE-10 records Planner acceptance of implementation commit `3a6990d` with evidence HEAD `13bed07b6cbc7c9a600820b1f39d54400a9828ca`. The safety boundary is application-level and does not claim an OS/kernel sandbox; human keyboard smoke remains separately open validation.

## M11 — Packaging, release, and dogfooding

Status: IMPLEMENTED BUT NOT ACCEPTED.

Deliverables:

- versioned Pi package and installation/upgrade/rollback documentation;
- compatibility matrix and controlled real-route smoke suite;
- release artifact and independent external review;
- staged dogfooding while Codex or another external harness remains a rescue path.

The rc.1 candidate and its R2 evidence were rejected by Independent Review #2 for release-provenance, privacy, rescue, and integrated-worker safety gaps. M11-R4 remediation added execution-time worker guards, trusted release executables, source/tree/build identity binding, strict evidence parsing, privacy/symlink coverage, a real M10 baseline, seeded-state preservation, and broken-candidate rescue; its rc.2 candidate was rejected by Independent Review #3 after the custom-tool bypass was reproduced. M11-R6 produced rc.3 by removing caller-supplied executable child tools and independently passed worker safety, but External Review #4 rejected its release-evidence integrity. M11-R8 produced rc.4 from exact Git content, independently reran the bound tests, rejected forged/zero evidence and symlinks, used version-correct M10 compatibility code, recursively hashed the full review bundle, and required an externally supplied root digest. M11-R9/R10/R11 produced rc.7: Verification no longer advertises categorically blocked shell tools, M7 finalization is atomic with normalized criteria and reviewer diversity, and the nested result schema matches the strict parser.

Stage 3 autonomous closeout is PASS on the explicit supported route `9router/ag/claude-opus-4-6-thinking` through the actual M7 path. Compatibility findings remain route-specific: Tabi produced a valid structured result but a quality REJECT after one failed exploratory mechanical check; DeepSeek Flash exhausted its explicit request cap without submission; DeepSeek Pro and cx/gpt-5.6-sol remain unproven. RC.8 Stage 4A autonomous Computer-Use dogfood is also PASS: a disposable-root Mission → Task → Implementation run created the requested fixture, and the normal Verify action completed a durable M7 `pass` decision on the same explicit route. Final human sanity, fully independent External Review #5, and Planner acceptance remain open. A local RC is not a public release; npm publish, GitHub release, tags, remotes, and live configuration require separate authorization.

Exit gate: RC.8 clean install, upgrade, rollback, package verification, Stage 4A autonomous dogfood, and canonical M7 evidence pass. Final human sanity, independent review, Planner acceptance, and authorized publication gates remain pending. Creating a GitHub repository, remote, tag, or release requires separate authorization.

## M12 — Smart Mission Entry, Hybrid Routing & Routing Memory

Status: IN PROGRESS. Only M12.1 is authorized; M12.2, M12.3, and the M12 Final Gate are not started.

### M12.1 — Frictionless Mission Entry

Status: COMPLETE / LOCAL PASS; not a public release or accepted development milestone.

Deliverables:

- explicit `@orchestrator <goal>` entry through Pi `0.84.1` native input handling;
- one shared canonical Mission creation operation for input and the existing New Mission menu;
- real MissionStore persistence with goal/status/Repository metadata and pointer-only Pi history;
- clear `Direct Workers` and canonical Mission/M7 terminology without changing `/verify-task` semantics; and
- deterministic parser, persistence, menu-equivalence, ordinary-input, and direct-worker regression coverage.

Exit gate: PASS — local typecheck/build/full tests, release verification, focused UX review, and isolated offline Pi `0.84.1` checks pass; M10 remains the latest accepted milestone, with independent review, Planner/manual acceptance, and publication gates still separate.

### M12.2 — Hybrid Smart Router

Status: NOT STARTED.

### M12.3 — Adaptive Routing Memory

Status: NOT STARTED.

### M12 Final Gate — Routing Dogfood

Status: NOT STARTED.
