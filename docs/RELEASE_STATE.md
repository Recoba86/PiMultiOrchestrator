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
| Development manifest version | `0.1.0-rc.12` — M12.3 local release candidate only |
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
| M12.2 local candidate | `0.1.0-rc.11`; deterministic bilingual local Smart Router, strict optional AI Triage policy, one-shot Mission-or-normal UX, versioned sidecar settings, bounded routing telemetry with selected-route metadata, live English/Persian/fallback/degradation dogfood, and isolated Pi `0.84.1` TUI evidence; local-only and unpublished |
| M12.2 RC.11 final local verifier | Exact-Git commit `8219c083577bc21a31046ade4ee1f982fe28abc6`; detached `190/190` tests; release-integrity `20/20`; Pi `0.84.1` install/rollback PASS; artifact SHA-256 `17e9feb871708ff08312bc27ab56cf0b35ce2cf47669b69db31fda7c6a396b74`; review-bundle root SHA-256 `2e514696b113a4728d2f3b47a392b84255c9cdb7e29f50260640ea6f759ec3f7` |
| M12.3 local candidate | `0.1.0-rc.12`; versioned abstract Routing Memory, explicit Always Mission rules, repeated Mission/Normal learning, conservative bilingual/cross-language matching, AUTO_MISSION/NORMAL safety gates, conflict handling, Learned Behaviors controls, backup/restore, and privacy-safe telemetry; local-only and unpublished |
| M12.3 focused evidence | Routing Memory `14/14`, Smart Router `28/28`, provider host `25/25`, and isolated Pi `0.84.1` RPC/TUI dogfood `1/1`; first Mission `mission-76f2c61b-859c-4b1a-8d86-a3e5a8bd4e4c`, follow-up Mission `mission-97a73bf2-6ea4-4e83-9c49-531b41f49846`, explicit rule `rm-1e0969ac-6c27-4597-82af-d218789cf787` |
| M12.3 RC.12 detached verifier | Source commit `601e8f90e2086f252516d9d9dcbc8ad0bf130bdd`; tree `8c0481934ed6adecc015926ee77b3c12ed00cfbd`; source digest `5b1cc3af2fe2885bbc58dbecb7eb14513c3d2178a18dec6e8b23d020b744123c`; `211/211 PASS`; `20/20` integrity attacks; Pi `0.84.1` install/upgrade/rollback, privacy, and worker safety PASS; artifact SHA-256 `d0c1db8637b753e3d21638c13a811be71c451744209c577e63d5a7f188ab7816`; review-bundle root SHA-256 `6ce725205a55d55abbf2d014daa63d508f59f75b2bb37048d872280cccfa9d81` |
| Typecheck | PASS |
| Aggregate check | PASS |
| Tested Pi version | `0.84.1` |
| Tested Node.js version | `22.23.0`; package requires `>=22.19.0` |
| Fake gateway integration | PASS |
| Actual Pi with fake gateway | PASS — model list, completion, RPC commands, pool mutation/reload, routing preview, health reset, parent→child execution, mission→analytics telemetry, token provenance, fallback, quality reject→repair→re-review, recommendation controls, and native/RPC Control Center coverage |
| Real live 9Router catalog | Controlled preflight verified HTTP 200 and catalog count 29; RC.8 observed route health HEALTHY |
| M12.2 real provider inference | PASS in disposable roots: secure auth bridge ready; direct strict structured probe; real English and Persian ambiguous TUI triage; capability-only fallback success; both-route-unavailable degradation; no live configuration changed |
| Historical M11 real provider inference | Stage 4A used two bounded real-route requests for the canonical Implementation and M7 Verification flows; no live configuration changed |

Fake-gateway behavior does not prove the live 9Router model count, metadata shape, resource/provider identity, subscription/account identity, or combo attribution.

## Known release blockers and limitations

- No public artifact, tag, GitHub release, npm publication, or production-ready install exists. The local M11 RC and its verification metadata are not a public release.
- The extension is loaded explicitly for development and is not installed into the user's live Pi configuration.
- Boss runtime, scheduled/autonomous tuning, cost/budget-aware routing, parallel orchestration, and public release remain incomplete. M10 is the latest Planner-accepted development state; M11 is implemented but not accepted.
- Human keyboard-driven TUI smoke remains pending as open validation, but is not an M10 acceptance blocker. M10 automated safety/recovery evidence is `159/159 PASS`; M12.1 isolated offline Pi TUI evidence passed separately.
- Autonomous RC.8 Computer-Use dogfood and canonical M7 real-route verification passed; final human sanity smoke, live metadata limits, fully independent External Review #5, and Planner acceptance remain open validation.
- M12.1 RC.9 changes are local-only. Its focused UX review, isolated offline TUI evidence, and final release verifier passed; independent review, Planner/manual acceptance, and publication remain separate gates. M12.2 RC.11 and M12.3 RC.12 are local-only and keep M10 as the latest accepted milestone. RC.10 exposed an additive empty analytics summary field and was superseded before final verification.
- M12.2 live-route triage was executed only through the secure auth bridge and disposable roots. The user Pi configuration, provider account, Keychain, credential values, and source checkout were not modified. M12.2 remains a local milestone result pending independent review and Planner/manual acceptance; M12.3's detached verifier passed, while focused review and the M12 Final Routing Gate remain pending.
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
