# Development log

Last updated: 2026-08-12

This is an append-oriented record of meaningful milestone outcomes, not a daily diary. Do not rewrite accepted history to match later intentions; add an explicit correction when evidence changes.

## M0 — Specification Freeze

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** No prior repository commit
- **Accepted/final HEAD:** `56cb8e04b3aefdbfe28e41f20794570a61751029`
- **Commit:** `docs: freeze initial orchestrator specification`
- **Purpose:** Freeze product behavior, architecture, acceptance cases, decisions, and delivery order before implementation.
- **Major outcomes:** Authoritative specification set; Pi `0.84.1` and Node.js `v22.23.0` baseline; host/9Router/custom ownership boundaries; proof-of-concept register; no production implementation.
- **Important decisions:** Pi as host; 9Router as gateway; exactly three execution pools; stable route/resource identity; infrastructure fallback separated from quality escalation; canonical mission state outside chat; secret references only; serial shared-worktree mutation.
- **Tests/evidence:** M0 repository, link/Markdown, scope/secret, baseline, and cross-document acceptance; accepted commit above.
- **Deferred work:** All production implementation, integration, runtime state, TUI, workers, analytics, hardening, and packaging.
- **Live environment impact:** No Pi configuration or 9Router modification; no credentials, paid calls, GitHub remote, or release.
- **Next authorized milestone:** M1 — Configuration Foundation.

## M1 — Configuration Foundation

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `56cb8e04b3aefdbfe28e41f20794570a61751029`
- **Accepted/final HEAD:** `b451408a57306cdb0c0cd9d4b41f76edd92c9395`
- **Commit:** `feat(core): add configuration foundation`
- **Purpose:** Implement the smallest deterministic, offline configuration boundary needed by later milestones.
- **Major outcomes:** TypeScript package; strict schema version 1; defaults and validation; exactly three configured pools; route/resource, role, Boss-profile, operational-profile, safety, quality, routing, and analytics policy data; migrations; deterministic resolution/serialization; atomic persistence; bounded history; explicit corruption recovery; import/export.
- **Major semantics:** Defaults < global < trusted project < mission precedence; arrays replace unless explicitly keyed; resolved secrets are structurally absent; writes use expected generations and a FIFO same-process mutation queue; load does not silently repair corrupt disk state.
- **Tests/evidence:** Planner-supplied accepted evidence: `41/41 PASS`; typecheck PASS; aggregate check PASS; accepted worktree clean.
- **Important decisions:** ADR-017 adopted a strict standard-library configuration engine with injected storage root and no runtime telemetry sink.
- **Deferred work:** Cross-process locking; guaranteed parent-directory `fsync`; SQLite/runtime portability proof; Pi runtime, 9Router, model manager, TUI, routing, workers, mission state, analytics, and release work.
- **Live environment impact:** Pi configuration unchanged; 9Router not contacted or modified; credentials not accessed; no paid calls.
- **Next authorized milestone:** M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC.

## M2 — 9Router Integration + Selective Model Manager

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `b451408a57306cdb0c0cd9d4b41f76edd92c9395`
- **Accepted/final HEAD:** `43f810cc9c6fbda50abd69b94d5f8aad1597756a`
- **Commit:** `feat(pi): add selective 9Router model manager`
- **Purpose:** Prove catalog discovery, selective route exposure, minimal model management, stable resource identity, and controlled Pi runtime behavior within the authorized M2 boundaries.
- **Major outcomes:** Real Pi extension entrypoint; 9Router client; `SecretResolver` boundary; selective model manager; catalog/runtime separation; provider reconciliation; TUI commands; fake 9Router integration; actual Pi runtime proof.
- **Tests/evidence:** `58/58` tests PASS; typecheck PASS; aggregate check PASS; real Pi fake model-list PASS with `5` expected and `5` exposed routes; real Pi fake completion PASS with `PI_FAKE_9ROUTER_OK`; actual Pi RPC command PASS; zero paid calls.
- **Important decisions:** `ConfigV1` remains schema version 1; gateway config ID is `ninerouter`; Pi provider namespace is `9router`; M2 supports environment `SecretRef` only; cache is bound to the normalized endpoint; an active route cannot be disabled while active; newly discovered models remain disabled; missing models remain configured but unavailable.
- **Deferred work:** M3 pool management; routing/workers; live metadata verification; human keyboard-driven TUI smoke; Keychain support; analytics.
- **Live environment impact:** Pi configuration unchanged; 9Router configuration unchanged; no credentials persisted; Keychain unchanged; no paid calls.
- **Next authorized milestone:** None. M3 requires Planner acceptance of the DOCS-2 handoff.

## M3 — Three Execution Pool Manager

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `9535af998d434fa179781bc350a27fde1201d8e9`
- **Accepted/final HEAD:** `e2efde838d84197f1fbe289e3e8ded090bdd2d87`
- **Commit:** `feat(pools): add execution pool manager`
- **Purpose:** Manage the three canonical pool memberships and list-order priorities as configuration without implementing runtime routing or workers.
- **Major outcomes:** One pool service; add/remove/per-pool-enable/reorder operations; retained disabled/missing memberships; generic Pi-native pool editor; `/orchestrator` pool sections; `/pool-models`; `/pool-status`; actual Pi with fake-gateway proof.
- **Tests/evidence:** `npm install` PASS; typecheck/build PASS; canonical suite `70/70 PASS`; actual Pi `0.84.1` fake-gateway pool command/mutation/reload PASS; M2 provider regression `5/5` routes PASS; package dry-run and diff checks PASS; paid calls `0`.
- **Important decisions:** ConfigV1 stays at version 1; array order is the sole priority; global enabled state, pool membership, and per-pool enabled state remain separate; pool-only edits never reconcile the Pi provider.
- **Deferred work:** M4 routing, eligibility, health, fallback, and diversity; workers/subagents; live 9Router validation; human keyboard-driven TUI smoke unless separately performed.
- **Live environment impact:** Pi configuration unchanged; real 9Router unchanged; credentials and Keychain unchanged; no paid calls.
- **Next authorized milestone at M3 handoff:** M4 — Routing, health, and infrastructure fallback (subsequently authorized; see the appended M4 entry below).

## M4 — Routing + Health + Infrastructure Fallback Engine

- **Status:** IMPLEMENTED BUT NOT ACCEPTED — AWAITING PLANNER ACCEPTANCE
- **Starting HEAD:** `e01456ed21be345b33176ae49fec365a534e7554`
- **Accepted/final HEAD:** implementation commit recorded after verification; Planner acceptance remains pending
- **Commit:** `feat(routing): add health-aware fallback engine`
- **Purpose:** Add a pure ordered routing preview/decision boundary, explicit infrastructure failure actions, and reload-safe runtime route health without starting execution workers.
- **Major outcomes:** ConfigV1 remains schema version 1; pool array order remains canonical priority; `none`/`prefer`/`require` diversity is explicit; bounded retry/fallback chains stop conservatively for cancellation, invalid request, protocol, and unknown failures; 429 is rate-limited unless explicit quota evidence exists; `HealthStore` persists only sanitized runtime state in atomic `health.json`; health never mutates ConfigStore, history, or export; Routing & Fallback and Health & Quotas host flows plus direct status/settings/health commands are wired through Pi `0.84.1`.
- **Tests/evidence:** `86/86` tests PASS; typecheck/build/aggregate check PASS; fake-clock routing/health tests, corruption/separation tests, fake 9Router, Pi RPC health reset, M2/M3 provider/completion/pool regressions; paid calls `0`.
- **Important decisions:** 9Router account/combo fallback remains opaque; stale last-known-good catalog entries remain usable while missing/unavailable entries do not; health does not reorder pools; cancellation and invalid request do not trigger uncontrolled fallback; no SQLite, analytics, workers, mission state, or model execution in M4.
- **Deferred work:** human keyboard TUI smoke, live 9Router metadata/inference, cross-process runtime locking, workers/subagents, canonical mission state, quality gates, analytics, and M5 execution.
- **Live environment impact:** Pi configuration unchanged; 9Router unchanged; no credentials or Keychain access; fake localhost only; no paid calls.
- **Next authorized milestone:** Planner review/acceptance of M4, then M5. Do not start M5 from this handoff.

**Correction to the prior M3 handoff:** the attached M4 mission subsequently authorized this implementation. M3 remains accepted; the M4 status above is implementation-only and still awaits Planner acceptance.

## Future milestone entry template

- **Milestone:**
- **Status:** PLANNED / IN PROGRESS / IMPLEMENTED BUT NOT ACCEPTED / ACCEPTED / RELEASED / DEPRECATED
- **Starting HEAD:**
- **Accepted/final HEAD:**
- **Commit:**
- **Purpose:**
- **Major outcomes:**
- **Tests/evidence:**
- **Important decisions:**
- **Deferred work:**
- **Live environment impact:**
- **Next authorized milestone:**
