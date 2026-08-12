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

Status: NEXT PLANNED — NOT STARTED.

Deliverables:

- all twelve control-center sections from the product specification;
- keyboard-accessible navigation, progress, error, stale-data, confirmation, and empty states;
- live mission/agent/route/review visibility without log inspection.

Exit gate: scripted component tests plus an explicitly controlled Pi TUI smoke checklist pass.

## M10 — Safety and hardening

Deliverables:

- protected-path and destructive-command policy;
- project trust enforcement, secret filtering, permission review, database recovery, lock/lease hardening, and crash fault injection;
- import/export adversarial tests and privacy review.

Exit gate: threat-model scenarios and recovery drills pass with no secret or user-data loss.

## M11 — Packaging, release, and dogfooding

Deliverables:

- versioned Pi package and installation/upgrade/rollback documentation;
- compatibility matrix and controlled real-route smoke suite;
- release artifact and independent external review;
- staged dogfooding while Codex or another external harness remains a rescue path.

Exit gate: clean install, upgrade, rollback, package verification, manual acceptance, and authorized publication gates pass. Creating a GitHub repository, remote, tag, or release requires separate authorization.
