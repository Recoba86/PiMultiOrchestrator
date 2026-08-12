# Release state

Last updated: 2026-08-12

This file records releasable product state. It does not promote development progress; see [Current state](CURRENT_STATE.md) for the operational snapshot.

## Current release snapshot

| Field | State |
|---|---|
| Latest accepted development milestone | M10 — Safety and hardening |
| Accepted development commit | `3a6990d` |
| Accepted evidence HEAD | `13bed07b6cbc7c9a600820b1f39d54400a9828ca` |
| Public stable release | NONE |
| Product version | NONE assigned |
| Development manifest version | `0.1.0-rc.1` — local release candidate only |
| Release tag | NONE |
| Release commit | NONE |
| GitHub release | NONE |
| Installable production release | NONE |
| Production-ready | NO |
| Release rollback target | Prior M10 accepted package representation; isolated rollback procedure documented, not a public release |
| Accepted development recovery reference | M10 implementation commit `3a6990d`; evidence HEAD `13bed07b6cbc7c9a600820b1f39d54400a9828ca` |

Milestone acceptance does not itself create a product release.

## Compatibility and verification evidence

| Evidence | Current result |
|---|---|
| Configuration schema | Version 2 current; Version 1 imports migrate sequentially |
| M6 accepted deterministic/fake baseline | `111/111 PASS` |
| M7 accepted verification suite | `121/121 PASS`; typecheck/build/check PASS; Pi/fake quality-loop proof PASS |
| M8 accepted verification suite | `134/134 PASS`; typecheck/build/check PASS; Pi/fake analytics/fallback/quality/billing/recommendation proof PASS |
| M8.5 accepted verification suite | `141/141 PASS`; analyst/provider focused suites, typecheck/build/check, and Pi/fake manual analyst flows PASS |
| M9 accepted verification suite | `146/146 PASS`; Control Center sections/navigation, typecheck/build/check, package dry-run, diff/secret/state validation PASS |
| M10 accepted verification | `3a6990d`; `159/159 PASS`; typecheck/build/check/package/diff/secret validation PASS |
| M11 implementation candidate | `4cebcce`; `0.1.0-rc.1`; artifact SHA-256 `b048a0c9a50c2283ffc69f52f728ac8abb3afd8150ab8bfe683a8a46a7c5fab2`; clean manifest, allowlist, isolated install/upgrade/rollback/rescue evidence, compatibility matrix, dogfood log, and review bundle present; acceptance pending |
| Typecheck | PASS |
| Aggregate check | PASS |
| Tested Pi version | `0.84.1` |
| Tested Node.js version | `22.23.0`; package requires `>=22.19.0` |
| Fake gateway integration | PASS |
| Actual Pi with fake gateway | PASS — model list, completion, RPC commands, pool mutation/reload, routing preview, health reset, parent→child execution, mission→analytics telemetry, token provenance, fallback, quality reject→repair→re-review, recommendation controls, and native/RPC Control Center coverage |
| Real live 9Router catalog | NOT VERIFIED — credential-gated probe was skipped |
| Real paid inference | NOT PERFORMED |

Fake-gateway behavior does not prove the live 9Router model count, metadata shape, resource/provider identity, subscription/account identity, or combo attribution.

## Known release blockers and limitations

- No public artifact, tag, GitHub release, npm publication, or production-ready install exists. The local M11 RC and its verification metadata are not a public release.
- The extension is loaded explicitly for development and is not installed into the user's live Pi configuration.
- Boss runtime, scheduled/autonomous tuning, cost/budget-aware routing, parallel orchestration, and public release remain incomplete. M10 is the latest Planner-accepted development state; M11 is implemented but not accepted.
- Human keyboard-driven TUI smoke remains pending as open validation, but is not an M10 acceptance blocker. M10 automated safety/recovery evidence is `159/159 PASS`.
- A human keyboard-driven TUI smoke and live 9Router metadata verification remain open validation.
- M10's application-level policy is not an OS/kernel sandbox. M11 package/install/rollback/review/dogfood gates remain pending Planner acceptance; real-route smoke is unauthorized.

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
