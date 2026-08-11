# Current project state

Last updated: 2026-08-12

Read this first for a fast operational snapshot. Git and verification evidence take precedence if this file is stale; see [Project state policy](PROJECT_STATE_POLICY.md).

## Identity

| Field | Current value |
|---|---|
| Product | Pi Multi-Orchestrator |
| Repository | `PiMultiOrchestrator` |
| Development phase | Accepted M2; DOCS-2 integration awaiting Planner review |
| Last accepted milestone | M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC |
| Accepted M2 commit | `43f810cc9c6fbda50abd69b94d5f8aad1597756a` |
| Configuration schema | Version 1 |
| Most recently validated Pi | `@earendil-works/pi-coding-agent@0.84.1` (`pi --version` `0.84.1`) |
| Most recently validated Node.js | `v22.23.0` |

## Development status

| Milestone | State |
|---|---|
| M0 — Specification Freeze | ACCEPTED / PASS |
| M1 — Configuration Foundation | ACCEPTED / PASS |
| M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC | ACCEPTED / PASS |
| M3 — Three Execution Pool Manager + Ordered Route Priorities + TUI Pool Editor | NOT STARTED — NOT YET AUTHORIZED until the Planner accepts the DOCS-2 handoff |

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

These capabilities do not yet implement full multi-agent orchestration.

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

Automated Pi-native TUI callback and RPC tests passed. A real human keyboard-driven TUI smoke has not yet been performed. This is open validation, not an M2 acceptance blocker.

### Deferred capabilities

- pool manager and priority editing;
- execution router and health/circuit-breaker runtime;
- workers/subagents and Boss runtime;
- Context Broker and Canonical Mission State runtime;
- quality escalation;
- analytics collection, storage, dashboard, and auto-tuning;
- cross-process configuration locking; and
- Keychain credential adapter.

## Next milestone rule

M3 is not started and is not yet authorized. The Planner must accept the DOCS-2 handoff before authorizing M3.

## Accepted evidence history

- M0: `56cb8e04b3aefdbfe28e41f20794570a61751029` — `docs: freeze initial orchestrator specification` — ACCEPTED / PASS.
- M1: `b451408a57306cdb0c0cd9d4b41f76edd92c9395` — `feat(core): add configuration foundation` — ACCEPTED / PASS; `41/41` tests, typecheck, and aggregate check passed.
- M2: `43f810cc9c6fbda50abd69b94d5f8aad1597756a` — `feat(pi): add selective 9Router model manager` — ACCEPTED / PASS; evidence recorded above.

## Assumptions agents must not make

- Do not assume this extension is installed in the live Pi configuration.
- Do not treat fake-gateway evidence as live 9Router proof.
- Do not treat configured pools as runtime-operational.
- Do not assume M3 is authorized or implemented.
- Do not assume a GitHub remote, tag, public release, or stable package exists.
