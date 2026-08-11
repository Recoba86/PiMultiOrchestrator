# Current project state

Last updated: 2026-08-12

Read this first for a fast operational snapshot. Git and verification evidence take precedence if this file is stale; see [Project state policy](PROJECT_STATE_POLICY.md).

## Identity

| Field | Current value |
|---|---|
| Product | Pi Multi-Orchestrator |
| Repository | `PiMultiOrchestrator` |
| Development phase | M2 development, in another worktree |
| Last accepted milestone | M1 — Configuration Foundation |
| Last accepted commit | `b451408a57306cdb0c0cd9d4b41f76edd92c9395` |
| Configuration schema | Version 1 |
| Most recently validated Pi | `@earendil-works/pi-coding-agent@0.84.1` (`pi --version` `0.84.1`, M0 read-only validation) |
| Most recently validated Node.js | `v22.23.0` (M0 baseline) |

## Development status

| Milestone | State |
|---|---|
| M0 — Specification Freeze | ACCEPTED / PASS |
| M1 — Configuration Foundation | ACCEPTED / PASS |
| M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC | IN PROGRESS ELSEWHERE — NOT YET ACCEPTED |

## Stable / accepted capabilities

The accepted product implementation is the M1 offline configuration foundation only:

- TypeScript package and project foundation;
- strict version 1 configuration schema and validation;
- exactly three execution pools represented in configuration;
- stable route/resource identity fields;
- Boss, role, and profile configuration foundations;
- deterministic migrations, serialization, and scope resolution;
- atomic configuration persistence with bounded history and explicit recovery;
- validated import/export without resolved secrets;
- defaults < global < trusted project < mission precedence;
- same-process mutation serialization; and
- deterministic temporary-local tests.

These are configuration capabilities, not runtime orchestration.

## Not implemented or not accepted

- production Pi extension runtime or stable installable package;
- real 9Router integration or accepted real-route proof;
- selective model TUI or pool editor;
- runtime routing, health, fallback, or circuit breaking;
- workers/subagents or Boss runtime;
- Context Broker or Canonical Mission State runtime;
- quality escalation or runtime quality gates;
- analytics engine, recommendations, or auto-tuning; and
- production packaging or release.

## Current risks and deferred work

- Configuration writes are serialized only within one process; cross-process locking is deferred.
- Parent-directory `fsync` is best effort across filesystems.
- SQLite/runtime-state compatibility across supported Pi launch modes is not proven.
- Stable 9Router resource identity requires the M2 proof of concept.
- Actual model/resource attribution inside an opaque 9Router combo may remain unknown.

## Current authorized work

**M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC**

State: **IN PROGRESS — NOT YET ACCEPTED**

M2 work is occurring outside this documentation worktree. Its final commit, test evidence, and acceptance result are unknown here.

## Next milestone rule

M3 is not authorized. It requires Planner acceptance of M2 first.

## Accepted evidence

- M0: `56cb8e04b3aefdbfe28e41f20794570a61751029` — `docs: freeze initial orchestrator specification` — ACCEPTED / PASS.
- M1: `b451408a57306cdb0c0cd9d4b41f76edd92c9395` — `feat(core): add configuration foundation` — ACCEPTED / PASS.
- M1 verification supplied by the Planner: tests `41/41 PASS`; typecheck PASS; aggregate check PASS; accepted worktree clean.
- M1 live impact: Pi configuration not modified; 9Router not contacted or modified; credentials not accessed; paid calls not made.

## Assumptions agents must not make

- Do not assume M2 passes or that its work is present in this checkout.
- Do not assume the live Pi installation has this extension installed.
- Do not assume a real 9Router inference or accepted live integration smoke has passed.
- Do not treat configured pools as runtime-operational.
- Do not assume a GitHub remote, tag, release, or stable package exists.
