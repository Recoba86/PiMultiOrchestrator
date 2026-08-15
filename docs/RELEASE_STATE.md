# Release state

Last updated: 2026-08-15

This file records releasable product state. It does not promote development progress; see [Current state](CURRENT_STATE.md) for the operational snapshot.

## Current release snapshot

| Field | State |
|---|---|
| Latest accepted development milestone | M10 — Safety and hardening |
| Accepted development commit | `3a6990d` |
| Accepted evidence HEAD | `13bed07b6cbc7c9a600820b1f39d54400a9828ca` |
| Public stable release | NONE |
| Public prerelease | `pi-multi-orchestrator@0.1.0-rc.17` — npm `next`; RC21 publication is pending |
| Product version | NONE assigned |
| Development manifest version | `0.1.0-rc.21` — RC21 release candidate |
| RC20 release | `0.1.0-rc.20` — Thinking-aware Pool routing and live catalog refresh; published prerelease |
| RC18 compatibility repair | Source/test commit `0af7b8e`; local dogfood PASS; no package version or publication change |
| RC19 onboarding/adoption release | Pi `0.84.1` external-provider adoption, secure TUI Test & Save, Pi-auth bridge, U/I/TUI/RPC coverage, and public npm/Pi dogfood PASS |
| Final Planner/manual acceptance | PASS — `PMO_FINAL_PLANNER_ACCEPTANCE_PASS` for RC17 |
| Local technical release readiness | RC21 implementation and focused gates pass; full release, registry, GitHub, and public Pi dogfood pending; not stable/production-ready |
| Release tag | `v0.1.0-rc.20` → `8bcb4a61796623ea09bd1ed09c411656bd657138` |
| Release commit | `8bcb4a61796623ea09bd1ed09c411656bd657138` |
| GitHub release | [v0.1.0-rc.20](https://github.com/Recoba86/PiMultiOrchestrator/releases/tag/v0.1.0-rc.20) — prerelease |
| Installable production release | NONE; RC20 is a prerelease |
| Production-ready | NO |
| Release rollback target | Prior M10 accepted package representation; isolated rollback procedure documented, not a public release |
| Accepted development recovery reference | M10 implementation commit `3a6990d`; evidence HEAD `13bed07b6cbc7c9a600820b1f39d54400a9828ca` |

Milestone acceptance does not itself create a product release.

## RC21 Model Router dogfood repair candidate

RC21 is the current release candidate. It repairs nested catalog metadata
normalization, conservative true/false/unknown thinking semantics, static Pi
provider upstream refresh through Pi's existing auth bridge, LKG preservation,
picker feedback/order, and normal-row route-ID privacy. The exact Git commit,
immutable artifact SHA-256, npm `next`/`latest` verification, GitHub prerelease,
and public Pi dogfood are recorded only after their respective gates pass.

## RC20 public prerelease publication

RC20 is the current public prerelease. It adds independent Pool-entry
Thinking Effort with omission-based Auto semantics, capability-aware explicit
levels, requested/effective run metadata, manual live Refresh Models, catalog
diff/LKG safety, disabled-route gating, and deterministic route identity
handling. It remains prerelease-only; `latest` must not move.

- **Package:** `pi-multi-orchestrator@0.1.0-rc.20`, published with npm access
  `public`, dist-tag `next`, and `--ignore-scripts`.
- **Source binding:** commit
  `8bcb4a61796623ea09bd1ed09c411656bd657138`; tag `v0.1.0-rc.20` peels to
  that commit.
- **Artifact:** `pi-multi-orchestrator-0.1.0-rc.20.tgz`, SHA-256
  `556de8db9bb661e3f82f47badd2b93f68b3145e29b056b6abc29bea15efda9bc`.
- **Verification:** `242/242` tests, Pi `0.84.1`, `20/20` integrity attacks,
  exact package identity, byte-identical registry tarball, and isolated public
  npm install all passed. npm `next` points to RC20 and `latest` remains
  `0.1.0-rc.17`.
- **GitHub:** [v0.1.0-rc.20](https://github.com/Recoba86/PiMultiOrchestrator/releases/tag/v0.1.0-rc.20)
  is an explicit prerelease with the exact artifact and checksum assets.
- **Boundary:** no live Pi configuration, provider account, credential,
  refresh, or model request was modified/performed; the final Pi probe was
  read-only/offline with temporary PMO/session roots.

## RC19 public prerelease publication

- **Package:** `pi-multi-orchestrator@0.1.0-rc.19`, published with npm access
  `public` and dist-tag `next` using `--ignore-scripts`.
- **Source binding:** tag `v0.1.0-rc.19` peels to commit
  `717a20413fc22f7ca7fde8df8a841ebde05b0f1a`.
- **Artifact:** `pi-multi-orchestrator-0.1.0-rc.19.tgz`, SHA-256
  `338d466a2308711e2c6befc838a29b77e6c1a5d1574350441bf9b5f46845a88e`.
- **Registry verification:** npm reports the exact name/version, `next` points
  to RC19, `latest` remains `0.1.0-rc.17`, and the directly downloaded registry
  tarball matches the local artifact byte-for-byte.
- **Public install verification:** a clean isolated npm prefix installed
  `pi-multi-orchestrator@0.1.0-rc.19`; project Pi `0.84.1` loaded that public
  extension and matched the existing 27-model `9router` catalog exactly.
- **Boundary:** this is a public prerelease for dogfooding, not a stable or
  production release. No live Pi configuration or credential was modified.

## RC17 public prerelease publication

- **Package:** `pi-multi-orchestrator@0.1.0-rc.17`.
- **Artifact:** `pi-multi-orchestrator-0.1.0-rc.17.tgz`, SHA-256
  `2a9343de7b456840ebdd596ef14c674a51abdad65e3e840b6a29b760e9aa5b62`.
- **Source binding:** tag `v0.1.0-rc.17` peels to source commit
  `5def791b31a7ad940ed87f6e720aabb0228500e7`.
- **Registry verification:** npm reports version `0.1.0-rc.17` and `next`
  points to it. The downloaded npm tarball is byte-identical to the accepted
  GitHub release asset.
- **Latest boundary:** `latest` was `0.1.0-rc.17` before and after the
  checkpoint. The exact RC17 version and accepted bytes were already present in
  npm, so no republish or repack was performed; authenticated interactive npm
  flow moved only `next` from RC20 to RC17.

## RC17 final Planner/manual acceptance

- **Disposition:** `PMO_FINAL_PLANNER_ACCEPTANCE_PASS`. RC17 is the successor
  candidate after RC16's live reviewer handoff block. It is publicly published
  as a prerelease, not a production installation.
- **Identity:** source commit `5def791b31a7ad940ed87f6e720aabb0228500e7`, tree `c23424f26600e988e6d96cbd794a0d22cc121ecd`, source digest `04935d63c419c56c4c9b92214abf06d4151bfe13ebc7a255b08475895c7d7f2c`, build digest `aaefde527e8f18a6accbd1dc79e9fffb87ae0f6df832c876911a4cd509373b58`, artifact SHA-256 `2a9343de7b456840ebdd596ef14c674a51abdad65e3e840b6a29b760e9aa5b62`, and independent bundle-root SHA-256 `f5f58cdf255580b4cdd772b0b5885fde531232fc4130b7e352972fe7be9b9bcf`.
- **Offline evidence:** `231/231` tests across 13 suites, zero failed/cancelled/skipped/todo, typecheck/build, detached release verification, Pi `0.84.1` compatibility/install/upgrade/rollback/rescue, privacy, worker safety, and `20/20` integrity attacks all passed.
- **Live evidence:** Mission `mission-b5a2cc76-d2b1-41d4-9c31-a922e7727d53` → Task `task-2b48f5e6-d3d2-4282-8318-6259a1a4e399` → Implementation attempt `attempt-783ba966-d696-4dfd-9230-f7094c8bedae` → Verification `verification-f5ea93ba-deea-41c3-a6ae-8c9d009102a4` → pass decision `decision-30772023-ebec-4ce9-a2cf-ba90e4e191c1`, all on the explicitly configured ag route. The reviewer captured one valid `submit_verification_result` with four satisfied criteria and no mutation.
- **TUI/boundary:** isolated offline Pi `0.84.1` RPC passed dashboard, Routing & Fallback, Missions, Back, clean exit, and no credential text. No live Pi configuration, provider account, Keychain value, public tag, push, npm publication, GitHub release, or production installation was modified. Disposable evidence paths are omitted.

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
| M12.3 focused evidence | Analytics `9/9`, Routing Memory `14/14`, Smart Router `13/13`, provider host `25/25`, and isolated Pi `0.84.1` RPC/TUI dogfood `1/1` (`61/61` focused tests); first Mission `mission-dbf51b4d-e375-4d78-86d6-fd85360a20f0`, follow-up Mission `mission-ff22dc19-3b6e-4f2a-ac88-89a4fb5c70f2`, explicit rule `rm-2440fb64-ab9f-4415-8ce7-4a204436caaf` |
| M12.3 RC.12 detached verifier | Source commit `56dbbb150fd184240db55e58e4bffc20efdd5c5f`; tree `7f795881954033d75618a57e9dba30b9b0314dc2`; source digest `4d417b1360cbb9b3a8a9e6f529470cf85f24bcbc37194f802d3c4b276f6ce8fd`; `212/212 PASS`; `20/20` integrity attacks; Pi `0.84.1` install/upgrade/rollback/rescue, privacy, and worker safety PASS; artifact SHA-256 `84cabb6553a5599d548be15646c92fc872c6010778e4eaeda2e05c63a158dc30`; review-bundle root SHA-256 `69e55e37731c44d6540950056664e729fa56b7898eccadc8b417669cc1327ce8` |
| M12.3 focused independent review | Exact source commit `56dbbb150fd184240db55e58e4bffc20efdd5c5f`; PASS with no unresolved blocker/high findings; optional medium/low limitations recorded separately and do not block local evidence |
| M12 final routing gate local evidence | RC13 source commit `8d8e36a9526c6edd106d36fa8cb5069cda517405`; `214/214 PASS`, `20/20` integrity attacks, balanced `360`-case bilingual corpus, isolated Pi lifecycle dogfood, bounded real 9Router Triage, privacy, worker safety, latency, and clean worktree; local-only |
| M12 final RC13 verifier | Artifact SHA-256 `abbfaf8580008a5f2d297a28a49fe3a0c962b1f3c512944b9f680c74e630085b`; source tree `d5d06e16e4a2266d9b04d3afd79c6dd181df9345`; source digest `0c5d0b49a2c637b592e039b31548bd549e31eee5c0854c20487a74324185d074`; review-bundle root `f3183574deed6dc96e6a15953a5949bdbb4858f34a9a26b5378437a81ca7075c`; External Review #5 remains pending |
| M12 RC15 historical final-review candidate | Historical final external review PASS; superseded by RC16 |
| M12 RC16 final-review candidate | Historical detached verifier PASS; superseded by RC17 after the live M7 handoff block |
| M12 RC17 final-review candidate | Exact detached verifier PASS on commit `5def791b31a7ad940ed87f6e720aabb0228500e7`, tree `c23424f26600e988e6d96cbd794a0d22cc121ecd`; source digest `04935d63c419c56c4c9b92214abf06d4151bfe13ebc7a255b08475895c7d7f2c`; artifact SHA-256 `2a9343de7b456840ebdd596ef14c674a51abdad65e3e840b6a29b760e9aa5b62`; bundle root `f5f58cdf255580b4cdd772b0b5885fde531232fc4130b7e352972fe7be9b9bcf`; clean `npm run check` `231/231 PASS`, Pi `0.84.1`, privacy, worker-safety, and `20/20` integrity PASS |
| RC18 compatibility repair evidence | Commit `0af7b8e`; `npm run check` `234/234 PASS`; production build and Pi `0.84.1` baseline/local 27-model exact-match dogfood PASS; local-only, not a release artifact |
| RC17 final Planner/manual attempt | PASS: disposable Mission → Task → Implementation → Verification Pool → `submit_verification_result` → M7 decision; technical TUI PASS; no live configuration mutation |
| Typecheck | PASS |
| Aggregate check | PASS — `231/231`; exact detached release verification PASS |
| Tested Pi version | `0.84.1` |
| Tested Node.js version | `22.23.0`; package requires `>=22.19.0` |
| Fake gateway integration | PASS |
| Actual Pi with fake gateway | PASS — model list, completion, RPC commands, pool mutation/reload, routing preview, health reset, parent→child execution, mission→analytics telemetry, token provenance, fallback, quality reject→repair→re-review, recommendation controls, and native/RPC Control Center coverage |
| Real live 9Router catalog | Controlled preflight verified HTTP 200 and catalog count 29; RC.8 observed route health HEALTHY |
| M12.2 real provider inference | PASS in disposable roots: secure auth bridge ready; direct strict structured probe; real English and Persian ambiguous TUI triage; capability-only fallback success; both-route-unavailable degradation; no live configuration changed |
| M12 final real provider inference | Historical RC13 triage evidence remains PASS; current RC16 final attempt had one structured AI-Triage fallback PASS, but canonical live M7 reviewer submission was blocked twice on the same route; no raw prompt telemetry and no live Pi configuration change |
| Historical M11 real provider inference | Stage 4A used two bounded real-route requests for the canonical Implementation and M7 Verification flows; no live configuration changed |

Fake-gateway behavior does not prove the live 9Router model count, metadata shape, resource/provider identity, subscription/account identity, or combo attribution.

## Known release blockers and limitations

- RC17 has a public artifact, immutable tag, GitHub prerelease, and npm version. No stable or production-ready install exists.
- RC16 addresses the M12.1/M7 and recovery findings carried forward from RC15 review: explicit-entry failure preserves the original prompt, completion requires Boss authorization and passed M7 evidence, cross-Mission evidence is rejected, corrupt routing state is repairable, Unicode and input sizes are bounded, worker timeouts honor route ceilings, and the TypeScript launcher is provenance-bound. Detached release evidence passes; final development acceptance remains separate.
- The 2026-08-15 RC16 acceptance attempt is historical and was hard-blocked at the live canonical M7 reviewer handoff. RC17 resolved that handoff with the smallest source-bound reviewer instruction and a regression assertion; the RC17 live Verification Pool run captured one valid submission and passed M7.
- The extension is loaded explicitly for development and is not installed into the user's live Pi configuration.
- Boss runtime, scheduled/autonomous tuning, cost/budget-aware routing, parallel orchestration, and stable production release remain incomplete. M10 is the latest Planner-accepted development state; M11 is implemented but not accepted.
- RC17 technical TUI smoke passed in isolated offline Pi `0.84.1` RPC, including dashboard, Routing & Fallback, Missions, Back, clean exit, and no credential text. This is a local candidate gate, not a claim of public installation or live keyboard acceptance.
- Historical M11 RC.8 Computer-Use dogfood and canonical M7 real-route verification passed; final human sanity smoke, live metadata limits, and Planner acceptance remain open validation. RC15 is historical; RC16 detached verification passed.
- M12.1 RC.9 changes are historical local evidence. RC17 is the public prerelease for the combined M12 final acceptance; M12.2 RC.11 and M12.3 RC.12 remain historical local candidates, and M10 remains the latest accepted development milestone.
- M12.2 and M12 final live-route triage were executed only through the secure auth bridge and disposable roots. The user Pi configuration, provider account, Keychain, credential values, and source checkout were not modified. The M12 final routing gate passed locally on RC13; RC16 carries the follow-on M12.1/M7/recovery repairs. Stable production release remains separate.
- Residual low-risk notes accepted for the supported local workflow: local Smart Router signal analysis runs over the supplied Pi prompt before the separately bounded Triage payload, and numbered internal Routing Memory history is retention-bounded but not independently byte-capped. These are application-level resource limits; supported restore paths fail closed and no release-blocking finding remains open.
- M10's application-level policy is not an OS/kernel sandbox. Stage 4A proves the bounded supported route and product path only; it does not promote M11 to accepted or production-ready.
- Pi `0.84.1` must be given the extracted `directory-source/` derived from the verified RC `.tgz`; direct `pi install <artifact>.tgz` is not a supported local workflow. The source checkout is never installed.
- RC18 repairs Pi/provider compatibility in source only. The manifest remains
  `0.1.0-rc.17`; no accepted artifact was rebuilt or repacked, and no npm
  publication, tag, push, or GitHub release was performed for this repair.
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
