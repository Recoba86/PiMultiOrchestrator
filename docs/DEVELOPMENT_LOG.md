# Development log

Last updated: 2026-08-13

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

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `e01456ed21be345b33176ae49fec365a534e7554`
- **Implementation commit:** `cae53b220e4cb78ec8b1f4f0400c9be4bb5a9697`
- **Accepted evidence HEAD:** `f5e25e21bbebe7995a9cc050efea3ed20d94f18c`
- **Commit:** `feat(routing): add health-aware fallback engine`
- **Purpose:** Add a pure ordered routing preview/decision boundary, explicit infrastructure failure actions, and reload-safe runtime route health without starting execution workers.
- **Major outcomes:** ConfigV1 remains schema version 1; pool array order remains canonical priority; `none`/`prefer`/`require` diversity is explicit; bounded retry/fallback chains stop conservatively for cancellation, invalid request, protocol, and unknown failures; 429 is rate-limited unless explicit quota evidence exists; `HealthStore` persists only sanitized runtime state in atomic `health.json`; health never mutates ConfigStore, history, or export; Routing & Fallback and Health & Quotas host flows plus direct status/settings/health commands are wired through Pi `0.84.1`.
- **Tests/evidence:** `86/86` tests PASS; typecheck/build/aggregate check PASS; fake-clock routing/health tests, corruption/separation tests, fake 9Router, Pi RPC health reset, M2/M3 provider/completion/pool regressions; paid calls `0`.
- **Important decisions:** 9Router account/combo fallback remains opaque; stale last-known-good catalog entries remain usable while missing/unavailable entries do not; health does not reorder pools; cancellation and invalid request do not trigger uncontrolled fallback; no SQLite, analytics, workers, mission state, or model execution in M4.
- **Deferred work:** human keyboard TUI smoke, live 9Router metadata/inference, cross-process runtime locking, workers/subagents, canonical mission state, quality gates, analytics, and M5 execution.
- **Live environment impact:** Pi configuration unchanged; 9Router unchanged; no credentials or Keychain access; fake localhost only; no paid calls.
- **Next authorized milestone at this handoff:** M5 — Routed Subagent Execution. Subsequent M5 implementation and acceptance state are recorded below.

**Correction to the prior M3 handoff:** the attached M4 mission subsequently authorized this implementation. STATE-4 now records M4 as accepted; M3 remains accepted. M5 was later authorized and its implementation and STATE-5 acceptance are recorded below.

## M5 — Routed Subagent Execution

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `e184858c0632881ef2acde33738ce0a08183e168`
- **Implementation commit:** `80b00a65da0a922633d9809b8520983f90038118` — `feat(agents): add routed subagent execution`.
- **Accepted evidence HEAD:** `c2e431aaf3384fc73acb2e7cd6201aa406d5266f`
- **Purpose:** Execute one bounded role/pool/task through M4-selected routes using isolated Pi SDK child sessions.
- **Major outcomes:** Added `src/core/workers` with exact route/model resolution, fresh in-memory child sessions, disabled Pi retries, per-pool tool allowlists, bounded one-shot `submit_agent_result`, tool-side-effect observation, timeout/cancellation cleanup, M4 retry/fallback/health callbacks, mutation-safe fallback, cwd serialization, parent-only `delegate_agent`, and `/subagent-run`.
- **Tests/evidence:** `97/97` tests PASS; typecheck, build, aggregate check, fake 9Router, and isolated Pi `0.84.1` parent→child evidence pass. The parent uses the exact route/model, the child exposes read/submit tools without delegate recursion, and temporary Pi/config/session roots are isolated. Built-in child tool execution, pool-specific allowlists, mutation-safe fallback, timeout/cancellation cleanup, HealthStore feedback, and M2/M3/M4 regressions passed.
- **Important decisions:** ConfigV1 remains version 1; M4 remains routing authority; role does not select model; child sessions do not inherit parent history/extensions/context; implementation mutation blocks automatic fallback; no child run state is persisted.
- **Deferred work:** M6 Context Broker/canonical mission state, Boss scheduling, parallel workers, worktree isolation, quality review, analytics, and live-provider proof.
- **Live environment impact:** Pi configuration unchanged; 9Router unchanged; credentials/Keychain unchanged; fake localhost only; paid calls `0`.
- **Next authorized milestone at this handoff:** M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation. M6 was subsequently accepted by STATE-6; M7 is next planned and not started.

## M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `8695bacab826c9829028c2b9fe97c4aa03285b7f`
- **Implementation commit:** `62282c1618f395b032e359005d018721e2b36868` — `feat(missions): add canonical mission state and context broker`.
- **Accepted evidence HEAD:** `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298`
- **Purpose:** Add the durable mission boundary and deterministic context/packet boundary consumed by future quality/reviewer work.
- **Major outcomes:** Node `node:sqlite` MissionStore with schema metadata, foreign keys, busy timeout, transactional revisions, tasks/attempts, proposed/accepted/rejected evidence, canonical items, event journal, checkpoints, leases, corruption checks, and interrupted-task recovery. ContextBroker emits accepted-only immutable bounded TaskPacketV1 values with deterministic ordering, omission counts, digest, and M5 child-request adaptation. Pi host exposes `/missions`, Context & Mission Settings, packet/task inspection, evidence accept/reject, and manual checkpoint actions while keeping session entries as pointers.
- **Tests/evidence:** Context Broker focused suite `6/6 PASS`; MissionStore focused suite `5/5 PASS`; provider host suite `14/14 PASS`; escalated canonical aggregate suite `111/111 PASS`; `npm run check` PASS; Node `22.23.0` `node:sqlite` PoC PASS; actual Pi `0.84.1` + fake gateway mission task flow passed packet generation, built-in read, proposed evidence, explicit acceptance, future-packet update, restart/resume, interrupted recovery, and MissionStore reopen.
- **Important decisions:** Config schema remains version 1; MissionStore schema is separate; worker results remain proposed until explicit admission; accepted canonical state is the only normal packet input; no transcript is persisted; operational completion is not quality acceptance; M7 quality/reviewer/Boss work is deferred.
- **Deferred work:** Boss/planner runtime, automatic decomposition/scheduling, quality/reviewer loop and gates, parallelism/worktrees, analytics, live-provider validation, and release work.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network were used.
- **Next authorized milestone:** M7 — Verification + Quality Gates + Reviewer Loop + Quality Escalation. Next planned; not started. Do not start M7.

## M7 — Verification + Quality Gates + Reviewer Loop + Quality Escalation

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `e4014730caf709b2ae2ceae4823583c14c810c1e`
- **Implementation commit:** `db82ac141094db749835a0cc7f1f79dc780005e4` — `feat(quality): add verification gates and bounded review loop`.
- **Accepted evidence HEAD:** `d15dccfd3415e7c705600526a6ef7d634d8c90c5` — `docs(m7): record implementation evidence`; accepted by STATE-7.
- **Purpose:** Add a durable, bounded quality-control boundary above M5 execution and M6 mission state without conflating quality judgment with M4 infrastructure health or canonical evidence.
- **Major outcomes:** Mission DB schema 1→2 migration; durable verification runs, quality decisions/status, mechanical provenance, escalations, interrupted-verification recovery, reviewer diversity, deterministic QualityGate semantics, caller-supplied `submit_verification_result` through M5, explicit quality host commands/history, and bounded verification→repair→re-review orchestration.
- **Tests/evidence:** `121/121` tests PASS; typecheck/build/check PASS; real Pi `0.84.1` + fake gateway `[P][fixture-v1]` reviewer reject→routed repair→re-review pass and MissionStore reopen lineage PASS; paid calls `0`.
- **Important decisions:** Config schema remains version 1; MissionStore quality schema is version 2; quality is separate from execution completion and M4 infrastructure health; quality rejection never updates M4 health or triggers infrastructure fallback; reviewer infrastructure failure still uses M4 health/fallback; reviewer/repair claims remain non-canonical until explicit M6 evidence admission; the quality loop is bounded and preserves immutable historical decisions; quality PASS alone is not Planner acceptance or mission completion.
- **Deferred work:** Boss/planner runtime, analytics, parallel/worktree orchestration, live-provider validation, and release work remain deferred. M8 was subsequently implemented and is pending Planner acceptance.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network were used.
- **Historical acceptance boundary:** At the STATE-7 handoff, M8 implementation was recorded below and remained pending Planner acceptance; STATE-8 later records M8 acceptance.

## M8 — Analytics + Statistics + Cost/Token Accounting + Quality/Value Metrics + Auto-Tuning Recommendations

- **Status:** ACCEPTED / PASS by STATE-8
- **Starting HEAD:** `809394fdbc53c40ca86dbcd6f4dcd37573d5523f`
- **Implementation commit:** `c5f741e65412dc4133e58962c314e2fae82f622e`
- **Accepted evidence HEAD:** `809394fdbc53c40ca86dbcd6f4dcd37573d5523f`
- **Implementation:** separate local AnalyticsStore schema v1, bounded idempotent metadata events, Pi usage/latency fields, summaries, cost provenance, pool-specific recommendations, `/analytics`, and `/recommendations`.
- **Evidence:** `npm test` and `npm run check` `134/134 PASS`; typecheck/build PASS; actual Pi 0.84.1 fake-gateway mission analytics, token provenance/UNKNOWN handling, fallback, quality reject→repair→re-verification, billing migration/persistence, nine detail views, and recommendation controls PASS; paid/live calls `0`.
- **Decisions:** analytics remains separate from MissionStore and HealthStore; ConfigV1 imports migrate sequentially to ConfigV2 reference billing profiles; disabled collection keeps history and rejects new rows; unknown cost is not zero; recommendation generation does not mutate configuration and Apply uses PoolManager with stale protection.
- **Live impact:** no live Pi/provider configuration, credentials, Keychain, paid calls, or external network used.
- **Next at that historical handoff:** M9 was the next milestone; STATE-9 later records its acceptance.

**STATE-8 correction (historical):** M8 is accepted / PASS. At that handoff the analyst milestone and M9 were deferred, and AI-assisted recommendation analysis remained deferred; later entries record their implementation and acceptance without changing STATE-8 acceptance.

## M8.5 — Manual AI Recommendation Analyst

- **Status:** ACCEPTED / PASS by STATE-8.5.
- **Starting HEAD:** `5ba8c5276d1125138ce90ed9cc60021af5bab5bc` (accepted M8 state).
- **Implementation commit:** `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1` — `feat(analytics): add manual AI recommendation analyst`.
- **Accepted evidence HEAD:** `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1`.
- **Implementation:** optional manual-only Recommendation Analyst over deterministic M8 candidates; Verification Pool route selection; bounded analytics packet and structured SUPPORT/OPPOSE/INSUFFICIENT_EVIDENCE result; bounded audit metadata with deterministic input fingerprint and stale detection; no transcript/source/prompt/tool-output/secret persistence; no pool/config mutation or automatic Apply.
- **Host surface:** Statistics & Analytics → Recommendation Analyst and `/recommendation-analyst` with Deterministic only/AI-assisted mode, Verification Pool route selector, Analyze Now, Re-analyze, status, and last-analysis details. Execution is explicit only; no timer or background polling.
- **Evidence:** analyst suite `3/3 PASS`; provider/TUI suite `17/17 PASS`; full `npm test` `141/141 PASS`; typecheck, build, and aggregate check PASS; Pi `0.84.1` + fake-gateway support/oppose/insufficient and infrastructure-failure-preserves-deterministic flows PASS; paid/live calls `0`.
- **Decisions:** deterministic metrics remain authoritative; analyst output is advisory and may disagree; route failures use existing M4/M5 behavior without breaking deterministic recommendations; explicit Apply remains RecommendationApplicationService → PoolManager → ConfigStore; previous analyses remain auditable and stale when fingerprints change.
- **Deferred work:** Boss/planner runtime, scheduled/autonomous tuning, M9, live-provider validation, and release work.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network used.
- **Next at that historical handoff:** M9 was the next milestone; STATE-9 later records its acceptance.

**STATE-8.5 acceptance:** M8.5 is accepted / PASS. The analyst remains optional, manual-only, advisory, Verification-Pool-bound, and unable to mutate deterministic facts or Apply recommendations automatically.

## M9 — Full TUI control center

- **Status:** ACCEPTED / PASS by STATE-9.
- **Starting HEAD:** `20f1854fcc5f0901652ce8ada9918605f912b4a3`.
- **Implementation commit:** `2032a2b` — `feat(tui): add full orchestrator control center`.
- **Purpose:** Unify the accepted M2–M8.5 capabilities behind one keyboard-accessible Pi Control Center without reimplementing domain engines.
- **Major outcomes:** Exact twelve top-level sections in the required order; dashboard-first safe metadata; native TUI/RPC selector navigation; textual loading, error, stale, empty, busy, and deferred states; accepted Models, Pools, Routing, Health, Context/Mission, Analytics, Recommendation Analyst, Budget/Quality, Diagnostics, and ConfigStore backup/history views; direct command compatibility; Boss runtime remains explicitly unimplemented.
- **Tests/evidence:** Focused M9 suite `5/5 PASS`; provider suite `17/17 PASS`; full deterministic/fake/actual-Pi regression suite `146/146 PASS`; `npm run check`, typecheck, build, package dry-run, diff check, secret scan, and project-state consistency PASS. Human keyboard-driven TUI smoke is pending because no authorized interactive keyboard session was available; this remains open validation, not an M9 acceptance blocker. RPC/native selector coverage passed.
- **Important decisions:** The twelve top-level labels are fixed; nested actions reuse existing services; dashboard and diagnostics expose safe metadata only; Backup/Restore uses ConfigStore export/history/restore while MissionStore/AnalyticsStore backup remains explicitly unavailable; M9 adds no autonomous Boss, background worker, or automatic priority mutation.
- **Deferred work:** Human keyboard TUI smoke, Boss/planner runtime, autonomous scheduling/tuning, M10 safety/hardening, packaging, and live-provider validation.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network used.
- **Next authorized milestone:** M10 — Safety and hardening, planned/not started. Do not start M10.

**STATE-9 acceptance:** M9 is accepted / PASS. Accepted implementation commit is `2032a2b`; accepted evidence HEAD is `1200d3349506a1d414def0f3c1e044d712711d9d`. The human keyboard-driven TUI smoke remains pending as an explicitly open validation item; no live or paid environment was used.

## M10 — Safety and hardening

- **Status:** ACCEPTED / PASS by STATE-10.
- **Starting HEAD:** `79ce6728ef068d2ce598dc1fce8e09d594d47323` (STATE-9 accepted baseline).
- **Implementation commit:** `3a6990d` — `feat(safety): harden trust permissions and recovery`.
- **Accepted evidence HEAD:** `13bed07b6cbc7c9a600820b1f39d54400a9828ca` (`docs: record M10 implementation state`).
- **Purpose:** Add the smallest application-level trust, path, command, privacy, locking, lease, integrity, backup/restore, and crash-recovery boundary without claiming an OS sandbox or autonomous approval.
- **Major outcomes:** Separate local TrustStore with untrusted-by-default trust/revoke; canonical PathSafetyPolicy and CommandSafetyPolicy; bounded SecretSanitizer and capability matrix; cross-process ConfigStore lock/re-read CAS; owner-token mission leases and race-safe attempts; validated SQLite MissionStore/AnalyticsStore backup/restore and integrity diagnostics; degraded analytics corruption handling; host Diagnostics and Backup/Restore visibility; Implementation trust gating.
- **Tests/evidence:** Trust/security suite `5/5 PASS`; recovery/lease/backup/fault suite `7/7 PASS`; provider suite `18/18 PASS`; full deterministic/fake/actual-Pi suite `159/159 PASS`; typecheck, build, `npm run check`, package dry-run, diff check, secret scan, and project-state consistency PASS. Human keyboard smoke remains pending because no authorized interactive session was available.
- **Important decisions:** Trust state is local and never portable configuration; policies are application-level and must not be mistaken for kernel isolation; secrets are redacted structurally and by registered value; database restore requires validated SQLite snapshots and explicit operator action; analytics corruption degrades to diagnostics rather than inventing an empty history; M4/M5 routing and M6/M7 state remain authoritative.
- **Deferred work:** Human keyboard TUI smoke, OS sandboxing, Boss/planner runtime, autonomous scheduling/tuning, parallel/worktree orchestration, live-provider validation, packaging, and release work.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network were used.
- **Next authorized milestone at this historical STATE-10 handoff:** M11 — Packaging, release, and dogfooding. It was subsequently implemented and remains pending Planner acceptance.

**STATE-10 acceptance:** M10 is accepted / PASS. The Planner accepted the local trust, path/command, privacy, concurrency, integrity, backup/restore, and fault-recovery evidence above. Human keyboard-driven TUI smoke remains an explicitly open validation item; it is not an M10 acceptance blocker. No live or paid environment was used.

## M11 — Packaging, release, and dogfooding

- **Status:** IMPLEMENTED BUT NOT ACCEPTED.
- **Implementation commit:** `4cebcce` — `feat(release): package and validate release candidate`.
- **Purpose:** Package the compiled extension as a reproducible local Pi `pi-package` release candidate with an explicit entrypoint, strict allowlist, artifact verification, compatibility/install/upgrade/rollback/rescue procedures, staged dogfooding, and an independent-review bundle.
- **Major outcomes:** Version `0.1.0-rc.1`; Pi `0.84.1` peer compatibility; no runtime npm dependencies; package Diagnostics exposes version/schema metadata; release workflow emits checksum, file list, machine-readable manifest, unpacked source-independent entrypoint checks, and `EXTERNAL_REVIEW_PENDING` review material.
- **Tests/evidence:** The prior `161/161` candidate record and direct-`.tgz` install claim were superseded by Review #1. R2 now records `163/163 PASS`, release-candidate subtests `4/4 PASS`, typecheck/build/check/package dry-run, diff/secret/state checks PASS, and a fresh `0.1.0-rc.1` artifact of 103 files/155072 bytes with SHA-256 `48bd2762e3396eb1b274e8b2bff756ef6d107fa2ca6b89e3980c9c0e35679005`; manifest `dirty: false`, Pi `0.84.1`, schemas `2/2/1`, live calls `0`. The checksum-derived directory-source Pi harness passed all-twelve Control Center, Diagnostics/dashboard, baseline upgrade, rollback, rescue, and state-hash preservation; direct `.tgz` remains unsupported. No real-route smoke was authorized.
- **Important decisions:** A local RC is not a public release. No npm publish, GitHub release, tag, remote, live Pi settings, credentials, or paid inference is allowed. Pi core remains a peer dependency, and no lifecycle script or bundled runtime state is added.
- **Deferred work:** Independent external review, authorized real-route smoke, human keyboard smoke when available, Planner acceptance, and any public publication gates.
- **Next authorized milestone:** None is recorded after M11 in the current roadmap; do not start a new milestone.

### M11-R2 — independent release-review remediation (complete; external review pending)

- **Status:** M11 remains IMPLEMENTED BUT NOT ACCEPTED; independent Review #1 result was FAIL, and R2 remediation evidence is PASS. A new independent clean-context Review #2 is still required.
- **Correction:** Pi `0.84.1` does not support `pi install <artifact>.tgz`; the supported local RC source is a checksum-verified fresh directory extracted from that exact immutable artifact. The source checkout is not an install source.
- **Remediation scope:** fresh ignored-`dist` replacement/build provenance, stale runtime milestone projection, stronger secret/private-key/path/runtime-state scanning, self-contained artifact/checksum/review evidence, deterministic bundle verification, and reproducible upgrade/rollback/rescue harnesses.
- **Evidence:** Corrective commits are `82fa48b` and `5cdc305`. The self-contained bundle includes the exact artifact/checksum, artifact-derived directory source, `test-evidence.json` (`163/163`, check/package PASS), `pi-install-evidence.json` (Pi `0.84.1`, all-twelve/dashboard/Diagnostics, install/remove/reinstall, upgrade/rollback hashes, rescue, UNTRUSTED default), and `REVIEW_EVIDENCE.json` with `EXTERNAL_REVIEW_PENDING`.
- **Boundary:** no real-route smoke, publication, tag, push, live Pi configuration, credentials, or paid inference. Planner acceptance remains open pending a new independent clean-context M11 review.

### M11-R4 — release provenance and integrated worker safety remediation

- **Status:** IMPLEMENTED / REMEDIATED; M11 remains NOT ACCEPTED.
- **Implementation commits:** `50ee46f` — `fix(safety): enforce worker tool safety at execution`; `55a15cc` — `fix(release): bind rc evidence to trusted provenance`.
- **Purpose:** Close Independent Review #2 findings without changing M10 acceptance: enforce M10 path/command/trust policy at the real Pi child-session tool boundary, prevent role/profile tool expansion, bind release evidence to trusted executables and clean source/build identity, strengthen privacy/symlink checks, use the real M10 baseline, preserve seeded state, and exercise extension-independent rescue.
- **Evidence:** local `0.1.0-rc.2`; exact artifact checksum/source/build identities in the generated release manifest; `165/165 PASS`; release-candidate `4/4 PASS`; typecheck/build/check/package dry-run/diff/secret/state checks PASS; Pi `0.84.1` directory-source install, all twelve Control Center sections, trusted M10 baseline upgrade/rollback, seeded Config/Mission/Analytics/Trust preservation, broken-candidate rescue, clean privacy report, and self-contained bundle verification PASS.
- **Release provenance:** manifest records clean Git commit/tree, source digest, build digest, trusted Node/npm/Pi identities, artifact file records, checksum, and machine-neutral evidence. A fake `PATH` executable cannot supply release totals or Pi identity.
- **Boundary:** no real-route smoke, publication, tag, push, live Pi configuration, credentials, or paid inference. Review bundle status remains `EXTERNAL_REVIEW_PENDING`; human keyboard smoke and Planner acceptance remain open.

### M11-R6 — close custom worker-tool bypass and build rc.3

- **Status:** IMPLEMENTED / REMEDIATED; M11 remains NOT ACCEPTED.
- **Starting HEAD:** `6e4498c6e4c0b64b1d02f4a167438e2856904bfb`.
- **Trigger:** Independent Review #3 reproduced a HIGH-severity Pi `0.84.1` bypass in which a caller-supplied `submit_evil` result-tool handler mutated a fixture while project trust was false.
- **Remediation:** Replace caller-supplied executable child result tools with declarative, bounded capture-only protocol specifications. M5 owns protocol-tool construction; protocol execution validates and captures in memory only. Guarded capabilities and protocol submissions have explicit classifications; unknown tools and collisions fail closed. Existing agent, verification, repair, and recommendation protocols retain their bounded schemas and duplicate handling.
- **Implementation commits:** `e9aab31` (`fix(safety): close custom worker tool bypass`), `6d438a9` (`fix(release): bind rc3 safety evidence`), and `e6b9807` (`fix(release): guard RPC teardown writes`).
- **Release evidence:** Version `0.1.0-rc.3` was the local R6 candidate. Its clean release pipeline passed `169/169`, actual Pi `0.84.1` `submit_evil` regression, provenance/privacy, M10 compatibility upgrade/rollback, broken-candidate rescue, and self-contained `EXTERNAL_REVIEW_PENDING` bundle verification outside the checkout; External Review #4 subsequently rejected its release-evidence integrity.
- **Boundary:** no live route, provider call, publication, tag, push, live Pi configuration, credentials, or paid inference. Stage 3 remains NOT AUTHORIZED / NOT PERFORMED; next required action is a clean-parent plus clean-reviewer External Review #4.

### M11-R8 — harden release evidence integrity and build rc.4

- **Status:** IMPLEMENTED / REMEDIATED; M11 remains NOT ACCEPTED. External Review #4 result was FAIL; rc.3 is rejected and External Review #5 is next.
- **Starting HEAD:** `2277cec7bdec9a694121c781f9c36811651df694`.
- **Implementation commits:** `9c5b29e` (`fix(release): harden evidence integrity and source provenance`) and `ae39f24` (`fix(release): build rc4 candidate`).
- **Remediation:** release source and the independent `npm run check` now come from a detached exact-Git staging checkout; test scripts/results and trusted Node/npm/TypeScript/Pi identities are bound to the source; zero/forged totals fail; assignment/JSON private paths are detected; artifacts and bundles reject all symlinks; every bundle file is recursively hashed and checked against an explicitly supplied external root digest; M10 state is created/read with M10 modules and candidate state with rc.4 modules; semantic equality/data-loss results are observed; actual `pi list` package identity/version/source is asserted.
- **Evidence:** local `0.1.0-rc.4`; build commit `ae39f24937988ef95975b2b45c018f4c45efd23c`; source digest `b91432b23b9fa44b3f1e750ff852ca78369f4f3d4808242841124364a510868b`; artifact SHA-256 `a1e14c83da374c5f6a1b849c589feb444002d46e8a0634c0bbd5d520a539572b`; independent `169/169 PASS`; mandatory attacks `20/20 PASS`; deterministic second build SHA equal; Pi `0.84.1` directory-source install, `/orchestrator`, Diagnostics, twelve sections, authentic M10 upgrade/rollback, non-empty Config/Mission/Analytics/Trust equality, broken-candidate rescue, privacy, and worker-safety regression PASS.
- **Boundary:** fake gateway and temporary roots only; live calls `0`, paid inference `0`; no real-route smoke, publication, tag, push, live Pi configuration, or credentials. Stage 3 is NOT AUTHORIZED / NOT PERFORMED; Stage 4 remains pending.

### M11-R9/R10/R11 — autonomous Stage 3 closeout and RC.7

- **Status:** IMPLEMENTED BUT NOT ACCEPTED; autonomous Stage 3 closeout PASS.
- **Starting HEAD:** `e536045b2c74dcd233ebba484574a65a8d3ccdde` (RC.6).
- **Final HEAD:** `d460319040a66a43016912034a9284225cc3d5a5` (`Fix verification result schema contract`).
- **Purpose:** Resolve the real-route M7 blocker while preserving fail-closed safety, then establish a defensible real-route compatibility conclusion.
- **Production changes:** RC.5 removed non-executable `bash` from Verification visibility; RC.6 made M7 finalization atomic, normalized criteria, and preserved reviewer route diversity; RC.7 aligned nested `submit_verification_result` schema requirements with the strict parser and stated the exact payload contract in the reviewer prompt.
- **Offline evidence:** RC.7 release verification passed `174/174` tests, `20/20` integrity attacks, typecheck/build, Pi `0.84.1` compatibility/install/rollback/rescue, worker safety, privacy, provenance, artifact SHA-256 `3411e8bdbb5ab90769db32f30d4b0962a2fdefd47f22fd31d58d02716df6ff19`, and external bundle root `50fd45bb9a1c68ab4077061d463a282ff3901c206afe52b7c7bc6c4d957d704f`.
- **Real-route evidence:** historical Investigation PASS `9router/cx/gpt-5.6-luna`; historical Implementation PASS `9router/ag/claude-opus-4-6-thinking`; RC.7 M7 Verification PASS on explicit `9router/ag/claude-opus-4-6-thinking` with 3 provider requests, valid structured submission, M7 decision `pass`, and no mutation. Tabi became schema-valid but rejected after reporting one failed exploratory mechanical check. DeepSeek Flash stopped at the explicit 8-request cap without submission. Prior DeepSeek Pro and cx/gpt-5.6-sol compatibility remain unproven.
- **Safety and boundary:** fallback, retry, repair, analyst, and hidden inference were disabled; credentials remained in-memory only; main Pi config, models/auth files, fixtures, and source repository were unchanged by real-route runs. M11 remains local, not accepted, not production-ready, and unpublished; Planner/External Review #5 and Stage 4 human/manual dogfood remain separate gates.

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

## Future milestone entry template
