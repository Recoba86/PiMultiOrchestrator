# Release state

Last updated: 2026-08-14

This file records releasable product state. It does not promote development progress; see [Current state](CURRENT_STATE.md) for the operational snapshot.

## Current release snapshot

| Field | State |
|---|---|
| Latest accepted development milestone | M10 — Safety and hardening |
| Accepted development commit | `3a6990d` |
| Accepted evidence HEAD | `13bed07b6cbc7c9a600820b1f39d54400a9828ca` |
| Public stable release | NONE |
| Product version | NONE assigned |
| Development manifest version | `0.1.0-rc.9` — M12.1 local release candidate only |
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
| M11-R2 historical candidate | `0.1.0-rc.1`, SHA-256 `48bd2762e3396eb1b274e8b2bff756ef6d107fa2ca6b89e3980c9c0e35679005`; rejected by Independent Review #2 for release provenance, privacy, rescue, and integrated-worker safety gaps |
| M11-R4 historical candidate | `0.1.0-rc.2`; `165/165 PASS`, release subtests `4/4 PASS`, and compatibility/rescue evidence PASS; rejected by Independent Review #3 for the custom-tool bypass |
| M11-R6 historical candidate | `0.1.0-rc.3`; worker/custom-tool safety independently passed, but External Review #4 rejected the candidate for release-evidence integrity defects |
| M11-R8 candidate | `0.1.0-rc.4`; artifact SHA-256 `a1e14c83da374c5f6a1b849c589feb444002d46e8a0634c0bbd5d520a539572b`; exact-Git provenance, independent `169/169` rerun, `20/20` integrity attacks, Pi `0.84.1` install/upgrade/rollback/rescue, privacy, worker safety, deterministic rebuild, and external-root bundle verification PASS; External Review #5 pending |
| M11-R9/R10/R11 candidate | `0.1.0-rc.7`; source-bound release-verification commit `c177c2d70639c8fcfe5780a356c6b439bbc2f1fe`; artifact SHA-256 `3411e8bdbb5ab90769db32f30d4b0962a2fdefd47f22fd31d58d02716df6ff19`; exact-Git `174/174 PASS`, `20/20` integrity attacks, external bundle root `67706649266b09907c2a263fcd6556c3ed428b77a0455bc04db2227690509acf`, and real Stage 3 PASS on explicit supported routes; M11 acceptance pending |
| M11 Stage 4A candidate | `0.1.0-rc.8`; clean source commit `aa622eef7256b447b456699dd80e10697fe94dc5`, tree `8104b7e1d5e40e4e2011c017acbf1bfa35203fd9`, source digest `d4f8b76c88e3e606b528d57571cf08e0553a0d43686c23489cba84a14f8fc234`, artifact SHA-256 `8fd4b233f7ee3d22ac0ac5703078ab165b55ba11a3978ae94a1f21039b746f28`, `175/175 PASS`, `20/20` integrity attacks, and autonomous Computer-Use real-route Implementation + M7 Verification PASS; M11 acceptance pending |
| M12.1 local candidate | `0.1.0-rc.9`; explicit native `@orchestrator` Mission entry, shared canonical creation, Direct Worker/M7 UX distinction; final local verifier PASS, `177/177` tests, `20/20` integrity attacks, and isolated offline TUI evidence |
| Typecheck | PASS |
| Aggregate check | PASS |
| Tested Pi version | `0.84.1` |
| Tested Node.js version | `22.23.0`; package requires `>=22.19.0` |
| Fake gateway integration | PASS |
| Actual Pi with fake gateway | PASS — model list, completion, RPC commands, pool mutation/reload, routing preview, health reset, parent→child execution, mission→analytics telemetry, token provenance, fallback, quality reject→repair→re-review, recommendation controls, and native/RPC Control Center coverage |
| Real live 9Router catalog | Controlled preflight verified HTTP 200 and catalog count 29; RC.8 observed route health HEALTHY |
| Real provider inference | Stage 4A used two bounded real-route requests for the canonical Implementation and M7 Verification flows; no live configuration changed |

Fake-gateway behavior does not prove the live 9Router model count, metadata shape, resource/provider identity, subscription/account identity, or combo attribution.

## Known release blockers and limitations

- No public artifact, tag, GitHub release, npm publication, or production-ready install exists. The local M11 RC and its verification metadata are not a public release.
- The extension is loaded explicitly for development and is not installed into the user's live Pi configuration.
- Boss runtime, scheduled/autonomous tuning, cost/budget-aware routing, parallel orchestration, and public release remain incomplete. M10 is the latest Planner-accepted development state; M11 is implemented but not accepted.
- Human keyboard-driven TUI smoke remains pending as open validation, but is not an M10 acceptance blocker. M10 automated safety/recovery evidence is `159/159 PASS`; M12.1 isolated offline Pi TUI evidence passed separately.
- Autonomous RC.8 Computer-Use dogfood and canonical M7 real-route verification passed; final human sanity smoke, live metadata limits, fully independent External Review #5, and Planner acceptance remain open validation.
- M12.1 RC.9 changes are local-only. Its focused UX review, isolated offline TUI evidence, and final release verifier passed; independent review, Planner/manual acceptance, and publication remain separate gates. M12.2/M12.3 are not started.
- M10's application-level policy is not an OS/kernel sandbox. Stage 4A proves the bounded supported route and product path only; it does not promote M11 to accepted or production-ready.
- Pi `0.84.1` must be given the extracted `directory-source/` derived from the verified RC `.tgz`; direct `pi install <artifact>.tgz` is not a supported local workflow. The source checkout is never installed.
- Review #3 rejected rc.2 after reproducing arbitrary caller-supplied custom-tool execution. R6 closed that bypass, but Review #4 rejected rc.3 for evidence-integrity weaknesses. R8 builds rc.4 only from commit `ae39f24937988ef95975b2b45c018f4c45efd23c`, binds source/test/tool identities, preserves authentic M10 state across upgrade and rollback, rejects all 20 required attacks, and anchors the recursively hashed review bundle to a separately supplied root digest. It remains external-review evidence, not acceptance or publication.

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
