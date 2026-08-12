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

Status: IMPLEMENTED BUT NOT ACCEPTED — AWAITING PLANNER ACCEPTANCE.

Deliverables:

- mission lifecycle, transactional revisions, checkpoints, lease/recovery, and resume primitives;
- a separate versioned Node `node:sqlite` MissionStore with bound SQL, foreign keys, busy timeout, and corruption checks;
- deterministic accepted-only Context Broker and immutable role/pool TaskPacketV1 with explicit size/content limits;
- proposed worker evidence with explicit acceptance/rejection and canonical provenance;
- `/missions`, Context & Mission Settings, and packet inspection while Pi session entries contain only mission pointers/status.

Exit gate: MissionStore/ContextBroker deterministic suites, restart/reopen and interrupted recovery, stale lease, context isolation, rejected/proposed evidence, checkpoint atomicity, packet lineage/digest, M2–M5 regressions, and the actual Pi/fake mission task/evidence/reopen flow pass in the implementation worktree (`111/111`, typecheck/build); Planner acceptance remains required before M6 is accepted.

## M7 — Quality gates, review, and escalation

Deliverables:

- configurable gates for diff, tests, reviews, acceptance criteria, regressions, and critical findings;
- reviewer independence/diversity policy;
- quality rejection returning to the Boss rather than route fallback;
- bounded retry/escalation decisions and terminal mission states.

Exit gate: reviewer rejection, failed tests, missing evidence, retry, alternate investigator/reviewer, and Boss-only completion tests pass.

## M8 — Analytics and recommendations

Deliverables:

- privacy-minimal metadata collection, durable events, and query projections;
- mission, agent, token, cost, route, pool, Boss, and fallback reports;
- explainable, sample-size-aware pool-specific recommendations;
- explicit Apply/Ignore/Details actions with no silent mutation.

Exit gate: aggregation, unknown-cost, subscription-vs-metered, privacy, explainability, and recommendation-no-mutation tests pass.

## M9 — Full TUI control center

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
