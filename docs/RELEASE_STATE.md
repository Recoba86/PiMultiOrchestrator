# Release state

Last updated: 2026-08-12

This file records releasable product state. It does not promote development progress; see [Current state](CURRENT_STATE.md) for the operational snapshot.

## Current release snapshot

| Field | State |
|---|---|
| Latest accepted development milestone | M8.5 — Manual AI Recommendation Analyst |
| Accepted development commit | `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1` |
| Accepted evidence HEAD | `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1` |
| Public stable release | NONE |
| Product version | NONE assigned |
| Development manifest version | `0.0.0-development` — not a release version |
| Release tag | NONE |
| Release commit | NONE |
| GitHub release | NONE |
| Installable production release | NONE |
| Production-ready | NO |
| Release rollback target | NONE; no release exists |
| Accepted development recovery reference | M8.5 implementation commit `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1`; evidence HEAD `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1` |

Milestone acceptance does not itself create a product release.

## Compatibility and verification evidence

| Evidence | Current result |
|---|---|
| Configuration schema | Version 2 current; Version 1 imports migrate sequentially |
| M6 accepted deterministic/fake baseline | `111/111 PASS` |
| M7 accepted verification suite | `121/121 PASS`; typecheck/build/check PASS; Pi/fake quality-loop proof PASS |
| M8 accepted verification suite | `134/134 PASS`; typecheck/build/check PASS; Pi/fake analytics/fallback/quality/billing/recommendation proof PASS |
| M8.5 accepted verification suite | `141/141 PASS`; analyst/provider focused suites, typecheck/build/check, and Pi/fake manual analyst flows PASS |
| Typecheck | PASS |
| Aggregate check | PASS |
| Tested Pi version | `0.84.1` |
| Tested Node.js version | `22.23.0`; package requires `>=22.19.0` |
| Fake gateway integration | PASS |
| Actual Pi with fake gateway | PASS — model list, completion, RPC commands, pool mutation/reload, routing preview, health reset, parent→child execution, mission→analytics telemetry, token provenance, fallback, quality reject→repair→re-review, and recommendation controls |
| Real live 9Router catalog | NOT VERIFIED — credential-gated probe was skipped |
| Real paid inference | NOT PERFORMED |

Fake-gateway behavior does not prove the live 9Router model count, metadata shape, resource/provider identity, subscription/account identity, or combo attribution.

## Known release blockers and limitations

- No public artifact, tag, GitHub release, installable production package, compatibility matrix, installation guide, or verified release rollback exists.
- The extension is loaded explicitly for development and is not installed into the user's live Pi configuration.
- Boss runtime, scheduled/autonomous tuning, hardening, cost/budget-aware routing, parallel orchestration, and packaging remain incomplete. M8.5 is the latest accepted development state; no stable release is implied.
- M9 Control Center implementation exists at `2032a2b` but is not Planner-accepted; human keyboard TUI smoke remains pending. M8.5 remains the latest accepted development state.
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
