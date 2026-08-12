# Release state

Last updated: 2026-08-12

This file records releasable product state. It does not promote development progress; see [Current state](CURRENT_STATE.md) for the operational snapshot.

## Current release snapshot

| Field | State |
|---|---|
| Latest accepted development milestone | M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation |
| Accepted development commit | `62282c1618f395b032e359005d018721e2b36868` |
| Accepted evidence HEAD | `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298` |
| Public stable release | NONE |
| Product version | NONE assigned |
| Development manifest version | `0.0.0-development` — not a release version |
| Release tag | NONE |
| Release commit | NONE |
| GitHub release | NONE |
| Installable production release | NONE |
| Production-ready | NO |
| Release rollback target | NONE; no release exists |
| Accepted development recovery reference | M6 implementation commit `62282c1618f395b032e359005d018721e2b36868`; evidence HEAD `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298` |

Milestone acceptance does not itself create a product release.

## Compatibility and verification evidence

| Evidence | Current result |
|---|---|
| Configuration schema | Version 1 |
| M6 accepted deterministic/fake baseline | `111/111 PASS` |
| M7 development verification suite | `121/121 PASS`; typecheck/build/check PASS; Pi/fake quality-loop proof PASS |
| Typecheck | PASS |
| Aggregate check | PASS |
| Tested Pi version | `0.84.1` |
| Tested Node.js version | `22.23.0`; package requires `>=22.19.0` |
| Fake gateway integration | PASS |
| Actual Pi with fake gateway | PASS — model list, completion, RPC commands, pool mutation/reload, routing preview, health reset, parent→child execution, mission→packet→proposed→accepted→reopen flow, and M7 reviewer reject→repair→re-review lineage |
| Real live 9Router catalog | NOT VERIFIED — credential-gated probe was skipped |
| Real paid inference | NOT PERFORMED |

Fake-gateway behavior does not prove the live 9Router model count, metadata shape, resource/provider identity, subscription/account identity, or combo attribution.

## Known release blockers and limitations

- No public artifact, tag, GitHub release, installable production package, compatibility matrix, installation guide, or verified release rollback exists.
- The extension is loaded explicitly for development and is not installed into the user's live Pi configuration.
- Boss runtime, M7 planner acceptance, analytics, hardening, cost/budget-aware routing, parallel orchestration, and packaging remain incomplete. M6 MissionStore/ContextBroker remains accepted development state; M7 implementation commit `db82ac141094db749835a0cc7f1f79dc780005e4` still awaits STATE-7 acceptance. No stable release is implied.
- A human keyboard-driven TUI smoke and live 9Router metadata verification remain open validation.

## Future release record

Fill these fields only from accepted release evidence; do not invent values:

- Product version:
- Release tag:
- Release commit:
- Accepted milestone baseline:
- Tested Pi versions:
- Tested Node.js versions:
- Schema version:
- Verification command/count summary:
- Fake gateway validation:
- Real gateway validation:
- Known limitations:
- Rollback target and verified procedure:
- GitHub release/artifact:
