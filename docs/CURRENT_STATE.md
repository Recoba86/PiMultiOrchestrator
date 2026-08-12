# Current project state

Last updated: 2026-08-12

Read this first for a fast operational snapshot. Git and verification evidence take precedence if this file is stale; see [Project state policy](PROJECT_STATE_POLICY.md).

## Identity

| Field | Current value |
|---|---|
| Product | Pi Multi-Orchestrator |
| Repository | `PiMultiOrchestrator` |
| Development phase | M3 accepted; M4 next planned |
| Last accepted milestone | M3 — Three Execution Pool Manager + Ordered Route Priorities + TUI Pool Editor |
| Accepted M3 commit | `e2efde838d84197f1fbe289e3e8ded090bdd2d87` |
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

### Human TUI smoke

Automated Pi-native dialog callback and RPC tests passed for the M2 model manager and M3 pool editor. A real human keyboard-driven TUI smoke has not yet been performed. This remains explicit open validation.

### Deferred capabilities

- execution router and health/circuit-breaker runtime;
- infrastructure fallback and diversity routing;
- workers/subagents and Boss runtime;
- Context Broker and Canonical Mission State runtime;
- quality escalation;
- analytics collection, storage, dashboard, and auto-tuning;
- cross-process configuration locking; and
- Keychain credential adapter.

## Next milestone rule

M3 is accepted by STATE-3. M4 is the next planned milestone and is not started. Do not start M4 without its mission and acceptance plan.

## Accepted evidence history

- M0: `56cb8e04b3aefdbfe28e41f20794570a61751029` — `docs: freeze initial orchestrator specification` — ACCEPTED / PASS.
- M1: `b451408a57306cdb0c0cd9d4b41f76edd92c9395` — `feat(core): add configuration foundation` — ACCEPTED / PASS; `41/41` tests, typecheck, and aggregate check passed.
- M2: `43f810cc9c6fbda50abd69b94d5f8aad1597756a` — `feat(pi): add selective 9Router model manager` — ACCEPTED / PASS; evidence recorded above.
- M3: `e2efde838d84197f1fbe289e3e8ded090bdd2d87` — `feat(pools): add execution pool manager` — ACCEPTED / PASS; `70/70` tests, typecheck/build, and actual Pi/fake-gateway pool mutation/reload evidence passed.

## Assumptions agents must not make

- Do not assume this extension is installed in the live Pi configuration.
- Do not treat fake-gateway evidence as live 9Router proof.
- Do not treat configured pools as runtime routing or worker execution.
- Do not assume M4 has started merely because M3 is accepted.
- Do not treat accepted pool management as runtime routing or worker execution.
- Do not assume a GitHub remote, tag, public release, or stable package exists.
