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

Status: NEXT PLANNED — NOT STARTED.

Deliverables:

- exactly three ordered execution pools;
- role-to-execution-class mapping;
- route add/remove/enable/reorder operations;
- Boss profiles and budget/quality policy presets as data;
- pool/profile TUI management and persistence.

Exit gate: pool reorder, role mapping, profile switch scheduling, invalid references, and project override tests pass.

## M4 — Routing, health, and infrastructure fallback

Deliverables:

- ordered eligibility router using priority, enabled state, health, policy, and soft diversity preference;
- failure classifier, retry-after handling, cooldown circuit breaker, recovery probe, and manual reset;
- infrastructure fallback events and all-routes-unhealthy result;
- explicit boundary with 9Router account/combo fallback.

Exit gate: deterministic clock-based routing, cooldown, recovery, quota, timeout, authentication, diversity, and fallback tests pass.

## M5 — Subagent execution

Deliverables:

- isolated child `pi` process executor following Pi's shipped pattern;
- task-packet input, role-specific tool allowlists, structured result submission, streaming progress, timeout, cancellation, and bounded concurrency;
- serial-by-default shared-worktree mutation policy;
- fake `pi` executable integration harness.

Exit gate: success, malformed result, crash, timeout, cancel, concurrency, output-bound, and tool-policy tests pass without a provider call.

## M6 — Context Broker and canonical mission state

Deliverables:

- mission lifecycle, transactional checkpoints, lease/recovery, and resume;
- runtime-state storage proof of concept, including `node:sqlite` portability under supported Pi launch modes;
- role-specific Task Packets with explicit size/content limits;
- evidence validation and promotion into canonical state;
- Pi session entry containing only the mission pointer and status, not duplicated full state.

Exit gate: restart/resume, stale lease, context isolation, rejected evidence, checkpoint atomicity, and session-switch tests pass.

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
