# Current project state

Last updated: 2026-08-13

Read this first for a fast operational snapshot. Git and verification evidence take precedence if this file is stale; see [Project state policy](PROJECT_STATE_POLICY.md).

## Identity

| Field | Current value |
|---|---|
| Product | Pi Multi-Orchestrator |
| Repository | `PiMultiOrchestrator` |
| Development phase | M10 accepted; M11 rc.4 remediated / acceptance pending |
| Last accepted milestone | M10 — Safety and hardening |
| Accepted M7 implementation commit | `db82ac141094db749835a0cc7f1f79dc780005e4` |
| Accepted M7 evidence HEAD | `d15dccfd3415e7c705600526a6ef7d634d8c90c5` |
| Accepted M8 implementation commit | `c5f741e65412dc4133e58962c314e2fae82f622e` |
| Accepted M8 evidence HEAD | `809394fdbc53c40ca86dbcd6f4dcd37573d5523f` |
| Accepted M8.5 implementation commit | `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1` |
| Accepted M8.5 evidence HEAD | `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1` |
| Accepted M9 implementation commit | `2032a2b` — `feat(tui): add full orchestrator control center` |
| Accepted M9 evidence HEAD | `1200d3349506a1d414def0f3c1e044d712711d9d` |
| M10 implementation commit | `3a6990d` — `feat(safety): harden trust permissions and recovery` |
| M10 evidence | `159/159 PASS`; typecheck/build/check/package/diff/secret validation PASS |
| Accepted M10 evidence HEAD | `13bed07b6cbc7c9a600820b1f39d54400a9828ca` |
| M11 candidate | `0.1.0-rc.4` — local, not public |
| M11-R2 historical candidate | `0.1.0-rc.1`, SHA-256 `48bd2762e3396eb1b274e8b2bff756ef6d107fa2ca6b89e3980c9c0e35679005`; rejected by Independent Review #2 for provenance, privacy, rescue, and integrated-worker safety gaps |
| M11-R4 historical release evidence | rc.2 artifact and `165/165 PASS`; rejected by Independent Review #3 for the custom-tool bypass |
| M11-R6 historical release evidence | rc.3 safety/remediation, release, compatibility, rescue, privacy, provenance, and bundle verification PASS; rejected by External Review #4 for release-evidence integrity defects |
| M11-R8 release evidence | rc.4 exact-Git build/test provenance, authentic M10 compatibility, privacy/no-symlink enforcement, `20/20` adversarial rejection, deterministic rebuild, and externally anchored recursive bundle verification PASS; External Review #5 pending |
| Configuration schema | Version 2 current; Version 1 imports migrate sequentially |
| Most recently validated Pi | `@earendil-works/pi-coding-agent@0.84.1` (`pi --version` `0.84.1`) |
| Most recently validated Node.js | `v22.23.0` |

## Development status

| Milestone | State |
|---|---|
| M0 — Specification Freeze | ACCEPTED / PASS |
| M1 — Configuration Foundation | ACCEPTED / PASS |
| M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC | ACCEPTED / PASS |
| M3 — Three Execution Pool Manager + Ordered Route Priorities + TUI Pool Editor | ACCEPTED / PASS |
| M4 — Routing + Health + Infrastructure Fallback Engine | ACCEPTED / PASS |
| M5 — Routed Subagent Execution | ACCEPTED / PASS |
| M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation | ACCEPTED / PASS |
| M7 — Quality Gates, Review, and Escalation | ACCEPTED / PASS |
| M8 — Analytics + Statistics + Cost/Token Accounting + Quality/Value Metrics + Auto-Tuning Recommendations | ACCEPTED / PASS |
| M8.5 — Manual AI Recommendation Analyst | ACCEPTED / PASS |
| M9 — Full TUI control center | ACCEPTED / PASS |
| M10 — Safety and hardening | ACCEPTED / PASS |
| M11 — Packaging, release, and dogfooding | IMPLEMENTED BUT NOT ACCEPTED |

## Stable / accepted capabilities

M2 adds these accepted capabilities to the M1 configuration foundation:

- a real Pi extension entrypoint loaded explicitly from the local development build;
- a dynamic `9router` Pi provider exposing only explicitly enabled routes;
- separate complete remote catalog and enabled Pi model set;
- exact remote model IDs, stable local route identity, and distinct routes for distinct resources;
- new catalog models disabled by default and missing configured models retained as unavailable;
- an endpoint-bound, validated last-known-good catalog cache;
- environment-backed `SecretRef` resolution at the network boundary with no raw credential persistence;
- `/orchestrator`, `/9router-models`, `/9router-refresh`, and `/9router-status`;
- a searchable TUI model manager with explicit enable/disable flow and active-model disable protection;
- fake 9Router catalog and OpenAI-compatible chat endpoints; and
- passing actual Pi model-list, completion, and RPC command integration tests.

M3 adds accepted, configuration-only pool management:

- exactly three canonical Investigation, Implementation, and Verification pools;
- ConfigStore-backed add/remove membership and independent per-pool enable state;
- ordered route priorities with move-up, move-down, and arbitrary-index reorder;
- exact ordering persistence, history, and serialized same-process mutations;
- cross-pool membership without deduplication;
- retained globally disabled, missing, stale, and provider-unavailable memberships;
- distinct same-model routes preserved by stable route identity;
- one Pi-native editor reused by all three `/orchestrator` pool sections;
- `/pool-models` and `/pool-status`; and
- actual Pi/fake-gateway pool mutation, reload, and provider-regression proof.

These capabilities do not implement runtime routing, worker execution, or full multi-agent orchestration. Pool order is configuration priority only.

## M4 accepted capabilities

M4 adds the accepted pure, non-executing routing boundary and runtime health state:

- deterministic ordered eligibility and preview selection for the three pools;
- explicit `none`, `prefer`, and `require` diversity inputs with no model-name inference;
- bounded same-route retry, fallback, cancellation/invalid-request stop semantics, and loop-free attempt chains;
- structured quota, rate-limit, authentication, timeout, transport, provider/model, protocol, cancellation, and unknown failure classes;
- injectable `HealthStore` runtime JSON with atomic persistence, cooldown/retry-after, circuit state, success recovery, corruption quarantine, and manual reset;
- `/routing-status`, `/route-health`, and `/routing-settings`, plus Routing & Fallback and Health & Quotas sections in `/orchestrator`;
- fake-clock deterministic tests and isolated Pi `0.84.1` fake-gateway RPC/reset evidence.

M4 does not implement actual child/subagent execution, Boss runtime, Task Packet or Context Broker runtime, canonical mission state, quality review/escalation, analytics, auto-tuning, or full cost/budget-aware routing. It does not persist health in ConfigStore/export/history or reconstruct opaque 9Router account/combo fallback.

## M5 accepted capabilities

M5 adds direct Pi `0.84.1` SDK child-session execution with exact M4-selected route/model pinning, fresh isolated in-memory sessions, no automatic parent-history copy, and parent-only `delegate_agent` plus `/subagent-run`. Child recursion is prevented. Investigation, Implementation, and Verification use explicit profiles: Investigation and Verification have no edit/write tools; Implementation may use edit/write/bash. Each child receives one bounded `submit_agent_result`; missing or invalid results are not accepted. Tool calls are observed, potential mutations are detected, and safe infrastructure retry/fallback is available before mutation. Read-only fallback is supported; edit/write/bash failure stops automatic fallback, with bash treated conservatively. External cancellation aborts without fallback, timeout handling is bounded, cleanup is deterministic, HealthStore receives success/failure feedback, and mutating runs serialize per cwd. The actual Pi parent → delegate tool → routed child proof passed. Boss/planner runtime, automatic role generation, parallel subagents, worktree isolation, analytics, and auto-tuning remain deferred; M6 mission/context and M7 quality capabilities are recorded below.

## M6 accepted capabilities

M6 adds durable Canonical Mission State in a separate versioned SQLite MissionStore behind an adapter; its Mission DB schema is independent from ConfigStore. It stores missions, tasks/runs, evidence, canonical items, checkpoints, events, revisions, and conflict protection independently from ConfigStore, HealthStore, and Pi session history. Worker output enters as proposed evidence; explicit accept/reject controls canonical promotion and provenance, while ingestion preserves route/run/packet provenance. The deterministic ContextBroker admits accepted state only by default and emits immutable, bounded TaskPacketV1 values with SHA-256 digests, mission-revision lineage, and omitted-item counts. M5 consumes packet-derived context; mutation-risk recovery does not auto-rerun, and operational completion remains distinct from quality acceptance. Mission Control exposes `/missions`, Context & Mission Settings, packet/task inspection, evidence/checkpoint actions, restart/resume, and interrupted-task recovery while Pi session entries remain pointers only.

M6 does not implement Boss/planner runtime, automatic decomposition or scheduling, parallel workers, worktree isolation, analytics, or auto-tuning. M7 quality state and reviewer/repair boundary are recorded below.

## M7 accepted capabilities

M7 adds a separate MissionStore schema v2 quality layer with transactional v1→v2 migration, durable verification runs, immutable QualityDecision history, task quality status separate from execution and M4 infrastructure health, bounded structured reviewer results, criterion-level mechanical evidence/provenance, deterministic QualityGate `PASS`/`REJECT`/`BLOCKED` outcomes, reviewer route-diversity preference, and durable `QualityEscalationRequest` records. Verification Pool reviewers execute through M4→M5; quality rejection does not penalize implementation-route health, while reviewer infrastructure failure still uses M4 health/fallback. The bounded repair/re-review loop applies implementation-route exclusion where required, enforces a maximum round count, preserves round/packet provenance and immutable history, and survives MissionStore reopen/restart. Re-verification creates new immutable history rather than rewriting prior decisions. Mission Control exposes quality-status UI/RPC, history, and confirmation-gated Verify/Re-verify/quality-loop actions; quality results remain non-canonical until explicit M6 evidence admission. Quality PASS alone is not Planner/product milestone acceptance.

| M7 implementation evidence | Result |
|---|---|
| QualityGate, structured-result, service, migration, worker-protocol, host, and Pi quality-loop suites | `121/121 PASS` |
| Typecheck and build | PASS |
| Mission DB v1→v2 fixture migration and reopen | PASS |
| Actual Pi/fake quality reviewer loop | `[P][fixture-v1] PASS` — reviewer reject → routed repair → re-review pass; durable lineage reopened |
| Planner acceptance / STATE-7 | ACCEPTED / PASS |
| Paid calls / live environment changes | `0` / NONE |

| M6 accepted evidence | Result |
|---|---|
| Context Broker focused tests | `6/6 PASS` |
| MissionStore focused tests | `5/5 PASS` |
| Host/provider focused tests | `14/14 PASS` |
| Full deterministic/fake/actual-Pi regression suite | `111/111 PASS` |
| Typecheck and build | PASS |
| Dedicated Pi/fake mission task execution, evidence admission, and reopen/resume flow | `[P][fixture-v1] PASS` — real Pi 0.84.1, fake SSE/tool flow, proposed→accepted evidence, reopened MissionStore |
| Paid calls / live environment changes | `0` / NONE |

| M5 accepted evidence | Result |
|---|---|
| Full deterministic, fake integration, and actual Pi suite | `97/97 PASS` |
| Typecheck, build, and aggregate check | PASS |
| Actual Pi `0.84.1` fake parent→child flow | PASS — exact parent/child model, child read + submit tools, no delegate recursion |
| Exact M4 route/model pinning, tool profiles, mutation-safe fallback, timeout/cancellation cleanup, HealthStore feedback, M2/M3/M4 regressions | PASS |
| Paid calls / live environment changes | `0` / NONE |

| M3 acceptance evidence | Result |
|---|---|
| Deterministic, fake integration, and actual Pi suite | `70/70 PASS` |
| Typecheck and build | PASS |
| Actual Pi pool editor over RPC | PASS — add, reorder, status, save, reload |
| M2 provider regression after pool edit | PASS — expected fake routes: `5`; Pi exposed: `5` |
| Paid calls / live environment changes | `0` / NONE |

## M2 acceptance evidence

| Evidence | Result |
|---|---|
| Deterministic and fake integration tests | `58/58 PASS` |
| Actual Pi with fake model catalog | PASS — expected enabled fake routes: `5`; Pi exposed: `5` |
| Actual Pi with fake completion | PASS — `PI_FAKE_9ROUTER_OK` |
| Actual Pi RPC command test | PASS |
| Paid calls | `0` |
| Live Pi configuration modified | NO |
| 9Router configuration modified | NO |
| Credentials persisted | NO |
| Keychain modified | NO |

## Open risks and not-yet-verified work

### Live 9Router metadata

The live probe was skipped because credentials were not present in the Codex environment. The following remain unverified:

- real live model count;
- live metadata shape;
- stable resource/provider identity;
- subscription/account identity; and
- combo attribution.

Fake-gateway metadata behavior is not proof of live 9Router metadata.

### MissionStore runtime compatibility

The Node `node:sqlite` API is experimental; the adapter boundary isolates that compatibility risk from the rest of the product.

### Human TUI smoke

Automated Pi-native dialog callback and RPC tests passed for the M2 model manager and M3 pool editor. A real human keyboard-driven TUI smoke has not yet been performed. This remains explicit open validation.

### Deferred capabilities

- Boss/planner runtime;
- automatic broad mission decomposition and task scheduling;
- general role generation;
- parallel workers and worktree isolation/fan-out;
- autonomous/scheduled tuning and autonomous priority mutation;
- automatic pool reordering and budget-aware routing;
- public publication, tag, and GitHub release;
- Keychain credential adapter.

## Next milestone rule

M6 is accepted by STATE-6, M7 is accepted by STATE-7, M8 is accepted by STATE-8, M8.5 is accepted by STATE-8.5, M9 is accepted by STATE-9, and M10 is accepted by STATE-10. M11 is implemented but not accepted; Planner review and the release gates below remain open.

## M8 implementation snapshot

M8 is accepted by STATE-8. It adds a separate local AnalyticsStore with idempotent telemetry and restart dedupe; route, pool, mission, fallback, and quality statistics; actual Pi token provenance with UNKNOWN preservation; ConfigV1→V2 billing/reference profiles; cost provenance, fixed-point reference estimates, and multi-currency safety; Quality/Value metrics with insufficient-data behavior; deterministic recommendations; explicit Details/Ignore/Apply; stale recommendation protection; no automatic priority mutation; and Apply through PoolManager with ConfigStore history. Analytics remains disabled by default and prompts, transcripts, tool arguments, source, headers, and secrets are not persisted.

| M8 accepted evidence | Result |
|---|---|
| Full deterministic, fake integration, and actual Pi suite | `134/134 PASS` |
| Typecheck, build, and aggregate check | PASS |
| Actual Pi 0.84.1 fake-gateway mission→analytics, token provenance, fallback, quality reject→repair→re-verification | PASS |
| Restart dedupe and ConfigV1→V2 billing-profile migration/persistence | PASS |
| Nine analytics detail views | PASS |
| Recommendation Details/Ignore/Apply/stale protection; PoolManager + ConfigStore history; automatic Apply | PASS / NO |
| Paid calls / live environment changes | `0` / NONE |

## M8.5 accepted capability snapshot

M8.5 is accepted by STATE-8.5. It adds an optional, manual-only Recommendation Analyst over the deterministic M8 candidate: the analyst is selected only from enabled Verification Pool routes, uses no hard-coded model, receives a bounded analytics-only packet with no source/transcript/secret input, returns one bounded SUPPORT/OPPOSE/INSUFFICIENT_EVIDENCE result, and cannot change metrics, pools, ConfigStore, or Apply state. Results persist only bounded audit metadata and become stale when the deterministic input fingerprint changes. The Statistics & Analytics → Recommendation Analyst UI exposes Deterministic only/AI-assisted mode, route selection, Analyze Now, Re-analyze, status, and last-analysis details; there is no periodic or background execution. Analyst infrastructure failure leaves the deterministic recommendation usable, and explicit Apply remains the existing RecommendationApplicationService → PoolManager → ConfigStore path. No AI transcript/source/prompt/tool output/secret is persisted.

| M8.5 implementation evidence | Result |
|---|---|
| Analyst protocol, bounds, verdicts, privacy, stale detection | `3/3 PASS` focused analyst suite |
| Host/TUI/RPC Recommendation Analyst surface | `17/17 PASS` focused provider suite |
| Pi 0.84.1 + fake-gateway manual analyst flow and M8 regressions | `141/141 PASS` full suite; fake support/oppose/insufficient and failure-preserves-deterministic flows PASS |
| Typecheck, build, aggregate check, and diff check | PASS |
| Planner acceptance / STATE-8.5 | ACCEPTED / PASS |
| Paid calls / live environment changes | `0` / NONE |

## M9 accepted capability snapshot

M9 adds the unified `/orchestrator` Control Center with exactly twelve top-level sections: Models & 9Router; Investigation Pool; Implementation Pool; Verification Pool; Boss / Orchestrator Profiles; Routing & Fallback; Health & Quotas; Budget / Quality Profiles; Context & Mission Settings; Statistics & Analytics; Diagnostics; and Backup / Restore. It provides a dashboard-first home, consistent keyboard/native TUI and RPC navigation, textual loading/error/stale/empty states, model and pool management, routing/health controls, mission/quality workflows, analytics/recommendations/Recommendation Analyst views, diagnostics, and safe ConfigStore backup/restore controls. Live operational status is visible without normal log inspection, and the Operator Guide documents the surface. Boss runtime, autonomous mission decomposition/scheduling, parallel workers/worktree isolation, and automatic recommendation Apply remain deferred. M10 hardening is recorded in the implementation snapshot below. Human keyboard-driven TUI smoke remains open validation, not an M9 acceptance blocker.

| M9 accepted evidence | Result |
|---|---|
| Exact twelve-section Control Center and dashboard contract | `5/5 PASS` focused M9 suite |
| Existing host/provider regressions | `17/17 PASS` focused provider suite |
| Full deterministic, fake integration, and actual Pi regression suite | `146/146 PASS`; `npm run check` PASS |
| Typecheck, build, and diff check | PASS |
| Human keyboard-driven TUI smoke | PENDING — no authorized interactive keyboard session in this run; RPC/native selector coverage passed |
| Planner acceptance / STATE-9 | ACCEPTED / PASS |
| Paid calls / live environment changes | `0` / NONE |

## M10 accepted capability snapshot

M10 implements a conservative application-level safety and recovery boundary without claiming an OS sandbox. A separate local TrustStore defaults projects to untrusted and supports explicit trust/revoke; trust is not portable configuration. Central PathSafetyPolicy and CommandSafetyPolicy canonicalize workspace paths, protect credentials and runtime databases, detect symlink/traversal escapes, classify destructive or ambiguous commands, and require review or block before mutation. Existing M5 tool profiles remain the upper permission bound; the capability matrix makes Investigation/Verification read-only while Implementation mutation requires trust. SecretSanitizer redacts resolved values and sensitive structures before diagnostics/errors or persistence.

Config mutations now use a cross-process lock and reread-under-lock CAS path. Mission leases have owner tokens, expiry/renewal/non-owner checks, and race-safe active-attempt guards. MissionStore and AnalyticsStore provide validated SQLite-native backup/restore and integrity diagnostics; corrupt AnalyticsStore state degrades to diagnostics rather than silently becoming empty data. Fault injection and adversarial policy tests cover crash/recovery, privacy, protected paths, and import/backup boundaries.

| M10 implementation evidence | Result |
|---|---|
| Trust, path/command policy, sanitizer, and capability tests | `5/5 PASS` |
| Lease, cross-process config, backup/restore, corruption, and fault tests | `7/7 PASS` |
| Provider/host regression suite | `18/18 PASS` |
| Full deterministic/fake/actual-Pi regression suite | `159/159 PASS` |
| Typecheck, build, aggregate check, package dry-run, diff check, secret scan | PASS |
| Human keyboard-driven TUI smoke | PENDING — no authorized interactive session; automated native/RPC coverage remains PASS |
| Implementation commit | `3a6990d` — `feat(safety): harden trust permissions and recovery` |
| Planner acceptance / STATE-10 | ACCEPTED / PASS |
| Paid calls / live environment changes | `0` / NONE |

M10 does not provide kernel/OS sandboxing, autonomous approval, automatic rerun after mutation-risk failure, or live-provider verification. Review #2 found that the accepted M10 evidence did not exercise policy at the integrated real worker tool boundary; M11-R4 adds that pre-tool enforcement without changing M10's accepted status. Human keyboard-driven TUI smoke remains open validation and is not an M10 acceptance blocker. M11 is implemented but not accepted and is not production-ready.

## M11 implementation snapshot — acceptance pending

M11 packages the compiled Pi extension as local release candidate
`0.1.0-rc.4` using Pi's `pi-package` manifest and explicit
`dist/host/pi-extension.js` entrypoint. The allowlist contains compiled
JavaScript/declarations, README, and the small operator guide; runtime
databases, sessions, source checkout paths, `.git`, dependencies, and secrets
are excluded. Pi remains a peer dependency and the package has no runtime npm
dependencies. The candidate workflow creates a detached staging checkout from
exact clean Git content, builds there with bound tool identities and
repository-defined scripts, emits an immutable `.tgz` plus checksum, copies an
exact artifact-derived `directory-source/`, and verifies the unpacked
entrypoint, privacy boundary, source-map policy, file records, and absence of
symlinks.

Pi `0.84.1` does not support installing a local `.tgz` directly. The supported
RC workflow is checksum verification, fresh extraction, and `pi install
<directory-source> --no-approve` in isolated roots; the source checkout is
never installed. `run-release-verification.mjs` records actual check/test
evidence, Pi startup/Diagnostics/all-twelve-section results, remove/reinstall,
M10 compatibility-baseline upgrade, rollback, state hashes, and rescue in a
self-contained review bundle. R8 evidence is complete: the artifact-derived
directory-source workflow passed on Pi `0.84.1`, the actual Pi `submit_evil`
regression passed, and the full release/compatibility/rescue workflow passed
with `169/169` tests plus `20/20` integrity attacks rejected. Direct `.tgz`
installation is explicitly recorded as unsupported. The release manifest binds
commit `ae39f24937988ef95975b2b45c018f4c45efd23c`, source digest
`b91432b23b9fa44b3f1e750ff852ca78369f4f3d4808242841124364a510868b`,
trusted Node/npm/TypeScript/Pi identities, independently rerun test evidence,
artifact SHA-256 `a1e14c83da374c5f6a1b849c589feb444002d46e8a0634c0bbd5d520a539572b`,
and worker-safety evidence. A recursive no-symlink bundle manifest is checked
against a separately supplied root digest. The bundle remains
`EXTERNAL_REVIEW_PENDING`. No real-route smoke was authorized or performed.
M10 remains the last Planner-accepted milestone.

## Accepted evidence history

- M0: `56cb8e04b3aefdbfe28e41f20794570a61751029` — `docs: freeze initial orchestrator specification` — ACCEPTED / PASS.
- M1: `b451408a57306cdb0c0cd9d4b41f76edd92c9395` — `feat(core): add configuration foundation` — ACCEPTED / PASS; `41/41` tests, typecheck, and aggregate check passed.
- M2: `43f810cc9c6fbda50abd69b94d5f8aad1597756a` — `feat(pi): add selective 9Router model manager` — ACCEPTED / PASS; evidence recorded above.
- M3: `e2efde838d84197f1fbe289e3e8ded090bdd2d87` — `feat(pools): add execution pool manager` — ACCEPTED / PASS; `70/70` tests, typecheck/build, and actual Pi/fake-gateway pool mutation/reload evidence passed.
- M4: `cae53b220e4cb78ec8b1f4f0400c9be4bb5a9697` — `feat(routing): add health-aware fallback engine` — ACCEPTED / PASS; evidence HEAD `f5e25e21bbebe7995a9cc050efea3ed20d94f18c`, `86/86` tests, and isolated Pi/fake-gateway routing/health evidence passed.
- M5: `80b00a65da0a922633d9809b8520983f90038118` — `feat(agents): add routed subagent execution` — ACCEPTED / PASS by STATE-5; evidence HEAD `c2e431aaf3384fc73acb2e7cd6201aa406d5266f`, `97/97` tests, typecheck/build/check, and isolated Pi `0.84.1` parent→child evidence passed.

- M6: `62282c1618f395b032e359005d018721e2b36868` — `feat(missions): add canonical mission state and context broker` — ACCEPTED / PASS by STATE-6; evidence HEAD `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298`, `111/111` tests, typecheck/build/check, and isolated Pi `0.84.1` mission flow passed.

- M7: `db82ac141094db749835a0cc7f1f79dc780005e4` — ACCEPTED / PASS by STATE-7; evidence HEAD `d15dccfd3415e7c705600526a6ef7d634d8c90c5`, `121/121` tests, typecheck/build/check, and actual Pi/fake reviewer reject→repair→re-review lineage passed.

- M8: `c5f741e` implementation accepted by STATE-8 with evidence HEAD `809394f`; `134/134` and actual Pi/fake analytics evidence passed.
- M8.5: `28b75be` implementation accepted by STATE-8.5 with evidence HEAD `28b75be`; `141/141`, actual Pi/fake analyst evidence, and manual-only/stale/privacy/explicit-Apply checks passed.
- M9: `2032a2b` — `feat(tui): add full orchestrator control center` — ACCEPTED / PASS by STATE-9; evidence HEAD `1200d3349506a1d414def0f3c1e044d712711d9d`, `146/146`, typecheck/build/check/package/diff/secret/state validation PASS.
- M10: `3a6990d` — `feat(safety): harden trust permissions and recovery` — ACCEPTED / PASS by STATE-10; evidence HEAD `13bed07b6cbc7c9a600820b1f39d54400a9828ca`, `159/159`, typecheck/build/check/package/diff/secret validation PASS; human keyboard smoke remains pending open validation.
- M11: rc.1 historical candidate was rejected by Independent Review #2. M11-R4 remediation commits `50ee46f` (integrated worker safety) and `55a15cc` (trusted release provenance/privacy/bundle) produce rc.2 evidence; `165/165`, isolated Pi directory-source/upgrade/rollback/rescue, seeded-state preservation, and self-contained bundle verification PASS. Exact artifact/source/build identities are in the generated manifest. External review and Planner acceptance remain pending.
- M11-R6: External Review #3 found that caller-supplied `submit_evil` custom-tool handlers could execute in an untrusted Pi child session. rc.3 replaced caller-supplied executable result tools with declarative capture-only protocols and passed its local gates, but External Review #4 rejected it for release-evidence integrity defects.
- M11-R8: commits `9c5b29e` and `ae39f24` produce rc.4 from exact Git content, independently rerun the bound `npm run check`, reject zero/forged evidence and all symlinks, recursively bind the review bundle to an external root digest, seed and read compatibility state with version-correct M10/candidate modules, assert actual `pi list` identity, and pass `169/169`, `20/20` attacks, Pi install/upgrade/rollback/rescue, worker-safety, privacy, and deterministic rebuild gates. M11 remains implemented but not accepted; External Review #5 and Planner acceptance remain pending.

## Assumptions agents must not make

- Do not assume this extension is installed in the live Pi configuration.
- Do not treat fake-gateway evidence as live 9Router proof.
- Do not treat configured pools as runtime routing or worker execution.
- M10 acceptance does not imply OS sandboxing, autonomous approval, Boss/planner runtime, scheduled tuning, automatic priority mutation, parallel/worktree orchestration, or release readiness.
- Do not treat accepted pool management as runtime routing or worker execution.
- Do not assume a GitHub remote, tag, public release, or stable package exists.
