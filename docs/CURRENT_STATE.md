# Current project state

Last updated: 2026-08-12

Read this first for a fast operational snapshot. Git and verification evidence take precedence if this file is stale; see [Project state policy](PROJECT_STATE_POLICY.md).

## Identity

| Field | Current value |
|---|---|
| Product | Pi Multi-Orchestrator |
| Repository | `PiMultiOrchestrator` |
| Development phase | M7 implemented; planner acceptance pending |
| Last accepted milestone | M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation |
| Accepted M6 implementation commit | `62282c1618f395b032e359005d018721e2b36868` |
| Accepted M6 evidence HEAD | `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298` |
| Configuration schema | Version 1 |
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
| M7 — Quality Gates, Review, and Escalation | IMPLEMENTED BUT NOT ACCEPTED |
| M8 — Analytics and Recommendations | NEXT PLANNED / NOT STARTED |

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

M5 adds direct Pi `0.84.1` SDK child-session execution with exact M4-selected route/model pinning, fresh isolated in-memory sessions, no automatic parent-history copy, and parent-only `delegate_agent` plus `/subagent-run`. Child recursion is prevented. Investigation, Implementation, and Verification use explicit profiles: Investigation and Verification have no edit/write tools; Implementation may use edit/write/bash. Each child receives one bounded `submit_agent_result`; missing or invalid results are not accepted. Tool calls are observed, potential mutations are detected, and safe infrastructure retry/fallback is available before mutation. Read-only fallback is supported; edit/write/bash failure stops automatic fallback, with bash treated conservatively. External cancellation aborts without fallback, timeout handling is bounded, cleanup is deterministic, HealthStore receives success/failure feedback, and mutating runs serialize per cwd. The actual Pi parent → delegate tool → routed child proof passed. Boss/planner runtime, automatic role generation, parallel subagents, worktree isolation, quality/reviewer loops, analytics, and auto-tuning remain deferred; M6 mission/context capabilities are recorded below.

## M6 accepted capabilities

M6 adds durable Canonical Mission State in a separate versioned SQLite MissionStore behind an adapter; its Mission DB schema is independent from ConfigStore. It stores missions, tasks/runs, evidence, canonical items, checkpoints, events, revisions, and conflict protection independently from ConfigStore, HealthStore, and Pi session history. Worker output enters as proposed evidence; explicit accept/reject controls canonical promotion and provenance, while ingestion preserves route/run/packet provenance. The deterministic ContextBroker admits accepted state only by default and emits immutable, bounded TaskPacketV1 values with SHA-256 digests, mission-revision lineage, and omitted-item counts. M5 consumes packet-derived context; mutation-risk recovery does not auto-rerun, and operational completion remains distinct from quality acceptance. Mission Control exposes `/missions`, Context & Mission Settings, packet/task inspection, evidence/checkpoint actions, restart/resume, and interrupted-task recovery while Pi session entries remain pointers only.

M6 does not implement Boss/planner runtime, automatic decomposition or scheduling, parallel workers, worktree isolation, analytics, or auto-tuning. M7 quality state and reviewer/repair boundary are recorded below.

## M7 implementation pending planner acceptance

M7 adds a separate MissionStore schema v2 quality layer with transactional v1→v2 migration, durable verification runs, immutable quality decisions/history, task quality status separate from execution and M4 health, bounded `submit_verification_result`, conservative mechanical checks, deterministic QualityGate evaluation, reviewer route diversity, escalation records, interrupted-verification recovery, and explicit bounded repair/re-review through the existing M4→M5 executor boundary. Mission Control exposes quality status/history and confirmation-gated Verify/Re-verify/quality-loop actions; quality rejection never records an infrastructure failure or silently promotes canonical evidence.

| M7 implementation evidence | Result |
|---|---|
| QualityGate, structured-result, service, migration, worker-protocol, host, and Pi quality-loop suites | `121/121 PASS` |
| Typecheck and build | PASS |
| Mission DB v1→v2 fixture migration and reopen | PASS |
| Actual Pi/fake quality reviewer loop | `[P][fixture-v1] PASS` — reviewer reject → routed repair → re-review pass; durable lineage reopened |
| Planner acceptance / STATE-7 | PENDING |
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

- Boss/planner runtime and automatic role generation;
- automatic task decomposition and scheduling;
- Reviewer quality loops and automated quality gates;
- parallel subagents and worktree isolation;
- analytics collection, storage, dashboard, and auto-tuning;
- cross-process configuration locking; and
- Keychain credential adapter.

## Next milestone rule

M6 is accepted by STATE-6. M7 is implemented but planner acceptance is pending. Do not start M8.

## Accepted evidence history

- M0: `56cb8e04b3aefdbfe28e41f20794570a61751029` — `docs: freeze initial orchestrator specification` — ACCEPTED / PASS.
- M1: `b451408a57306cdb0c0cd9d4b41f76edd92c9395` — `feat(core): add configuration foundation` — ACCEPTED / PASS; `41/41` tests, typecheck, and aggregate check passed.
- M2: `43f810cc9c6fbda50abd69b94d5f8aad1597756a` — `feat(pi): add selective 9Router model manager` — ACCEPTED / PASS; evidence recorded above.
- M3: `e2efde838d84197f1fbe289e3e8ded090bdd2d87` — `feat(pools): add execution pool manager` — ACCEPTED / PASS; `70/70` tests, typecheck/build, and actual Pi/fake-gateway pool mutation/reload evidence passed.
- M4: `cae53b220e4cb78ec8b1f4f0400c9be4bb5a9697` — `feat(routing): add health-aware fallback engine` — ACCEPTED / PASS; evidence HEAD `f5e25e21bbebe7995a9cc050efea3ed20d94f18c`, `86/86` tests, and isolated Pi/fake-gateway routing/health evidence passed.
- M5: `80b00a65da0a922633d9809b8520983f90038118` — `feat(agents): add routed subagent execution` — ACCEPTED / PASS by STATE-5; evidence HEAD `c2e431aaf3384fc73acb2e7cd6201aa406d5266f`, `97/97` tests, typecheck/build/check, and isolated Pi `0.84.1` parent→child evidence passed.

- M6: `62282c1618f395b032e359005d018721e2b36868` — `feat(missions): add canonical mission state and context broker` — ACCEPTED / PASS by STATE-6; evidence HEAD `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298`, `111/111` tests, typecheck/build/check, and isolated Pi `0.84.1` mission flow passed.

- M7 implementation: current worktree — IMPLEMENTED BUT NOT ACCEPTED; Mission DB v1→v2 migration, durable quality records/status, structured reviewer protocol, deterministic gate, bounded escalation/repair/re-review, host quality commands, focused tests, and actual Pi/fake reviewer reject→repair→re-review evidence are present. STATE-7 planner acceptance remains pending.

## Assumptions agents must not make

- Do not assume this extension is installed in the live Pi configuration.
- Do not treat fake-gateway evidence as live 9Router proof.
- Do not treat configured pools as runtime routing or worker execution.
- Do not assume M7 is planner-accepted or that Boss, analytics, or parallel-work orchestration is implemented.
- Do not treat accepted pool management as runtime routing or worker execution.
- Do not assume a GitHub remote, tag, public release, or stable package exists.
