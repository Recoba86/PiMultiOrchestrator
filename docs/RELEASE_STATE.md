# Release state

Last updated: 2026-08-16

This file records releasable product state. It does not promote development progress; see [Current state](CURRENT_STATE.md) for the operational snapshot.

## Current release snapshot

| Field | State |
|---|---|
| Latest accepted development milestone | M10 — Safety and hardening |
| Accepted development commit | `3a6990d` |
| Accepted evidence HEAD | `13bed07b6cbc7c9a600820b1f39d54400a9828ca` |
| Public stable release | NONE |
| Public prerelease | `pi-multi-orchestrator@0.1.0-rc.28` — npm `next`; `latest` remains `0.1.0-rc.17` |
| Product version | `0.1.0-rc.28` public prerelease |
| Development manifest version | `0.1.0-rc.29` — RC29 Mission Runtime Convergence; UNPUBLISHED CANDIDATE / LIVE MISSION COMPLETED; not public |
| RC29 development line | ADR-046/048/049 plus live Mission COMPLETED; `0.1.0-rc.29`; unpublished candidate SHA-256 `fec5a819fd6ae149296bd4328924862abde3defe35893505ba8fbb046dc29f7b`; source `d975a5d2987df7116d07d6a15a9ed6a51269f1d3`; not tagged or npm-published |
| RC28 release line | Canonical Pi Boss-response normalization, classified invocation diagnostics, scheduling vs infrastructure-fallback eligibility, and truthful Boss Profile UI; public immutable prerelease; source `aad28c33260326665ec17e347d50fe985b18a953`, tag `v0.1.0-rc.28`, artifact SHA-256 `9f516b23af13749148289c616298db0f48b1a51c8cb61e9814e09097db1a0fa3` |
| RC27 release line | Autonomous Mission Task bootstrap, Boss protocol validation, zero-task loop repair, Goal acceptance-criteria durability, and Inspect diagnostics; public immutable prerelease; source `267612d15dcc0784856e7dafd6704d2f802272b9`; artifact SHA-256 `d8589943434a6ea1796f2c908fa2123464f7c8accca0557bb6547338bea83a55` |
| RC26 release line | Goal terminal CANCELLED/SAFETY_STOP plus truthful runtime package metadata; public prerelease; immutable |
| RC25 release line | Weighted multi-route Boss profiles, one pinned Boss per Mission, bounded goal-loop repair/replan, explicit infrastructure fallback, Mission analytics, and manual-only Boss weight recommendations |
| RC24 release line | Model Router rows show `[x]` for enabled PMO routes and `[ ]` for discovered-but-disabled routes; Enter opens the existing action menu and persistence path |
| RC22 local candidate | Canonical model selector presentation; source commit `288c77cfac92dc7ffa8a0f0b16a69d140ada3aea`; artifact SHA-256 `7d9b9451d1c2590d5b2632b6dd7aadd250bd2851af8dd79d79c25113693dbdea`; not published |
| RC20 release | `0.1.0-rc.20` — Thinking-aware Pool routing and live catalog refresh; published prerelease |
| RC18 compatibility repair | Source/test commit `0af7b8e`; local dogfood PASS; no package version or publication change |
| RC19 onboarding/adoption release | Pi `0.84.1` external-provider adoption, secure TUI Test & Save, Pi-auth bridge, U/I/TUI/RPC coverage, and public npm/Pi dogfood PASS |
| Final Planner/manual acceptance | PASS — `PMO_FINAL_PLANNER_ACCEPTANCE_PASS` for RC17 |
| Local technical release readiness | RC29 unpublished verified candidate on `0.1.0-rc.29` after live Mission COMPLETED and detached `release:verify` PASS; RC28 remains the verified public prerelease |
| Release tag | `v0.1.0-rc.28` → `aad28c33260326665ec17e347d50fe985b18a953` |
| Release commit | `aad28c33260326665ec17e347d50fe985b18a953` |
| Release artifact | `pi-multi-orchestrator-0.1.0-rc.28.tgz`; SHA-256 `9f516b23af13749148289c616298db0f48b1a51c8cb61e9814e09097db1a0fa3` |
| GitHub release | `v0.1.0-rc.28` — public prerelease; RC28 is immutable |
| Installable production release | NONE; RC28 is a prerelease |
| Production-ready | NO |
| Release rollback target | Prior M10 accepted package representation; isolated rollback procedure documented, not a public release |
| Accepted development recovery reference | M10 implementation commit `3a6990d`; evidence HEAD `13bed07b6cbc7c9a600820b1f39d54400a9828ca` |

Milestone acceptance does not itself create a product release.

## RC29 Mission runtime convergence (UNPUBLISHED CANDIDATE / LIVE MISSION COMPLETED)

RC29 is the current unpublished candidate at `0.1.0-rc.29`. Live Mission
`mission-23b92005-b7fd-4582-9517-09b5a6f05cbb` reached durable `COMPLETED`.
It is **not** tagged, npm-published, a GitHub Release, or accepted.
Public RC28 is immutable. Artifact
`/Users/amin/Documents/Witamin-Game/pi-multi-orchestrator-release-rc29-final/pi-multi-orchestrator-0.1.0-rc.29.tgz`,
SHA-256 `fec5a819fd6ae149296bd4328924862abde3defe35893505ba8fbb046dc29f7b`,
source `d975a5d2987df7116d07d6a15a9ed6a51269f1d3`. Detached
`npm run release:verify` PASS (`367/367`, `20/20` integrity).

- **Delivery vs protocol:** thinking-only / empty assistant text is
  invocation delivery (`empty_response`) and may infrastructure-fallback, then
  `BLOCKED`. Empty `dispatch` JSON and truncated incomplete JSON remain
  protocol.
- **Capability:** Goal/criteria that require `git commit` / `git push` /
  network publication terminal `AWAITING_USER` / `CAPABILITY_MISMATCH` before
  Boss inference.
- **Identity and completion:** reuse Tasks by class+objective; complete on
  **active** Tasks only; persist Boss feedback; class-specific M7 prompts.
- **Dogfood recorded:** public RC28 Mission
  `mission-04452706-5486-4131-8565-dcec84f52beb` as hollow-delivery
  `AWAITING_USER` with 0 Tasks. Host-shaped harness COMPLETED is not live Pi
  COMPLETED. Prior source verification: `npm test` `313/313`, `npm run check`
  PASS.

## RC28 Real Boss Invocation Compatibility (public immutable prerelease)

Correction 2026-08-16: RC28 is public and immutable. Package
`pi-multi-orchestrator@0.1.0-rc.28`, tag `v0.1.0-rc.28`, source
`aad28c33260326665ec17e347d50fe985b18a953`, artifact SHA-256
`9f516b23af13749148289c616298db0f48b1a51c8cb61e9814e09097db1a0fa3`.
npm `next=0.1.0-rc.28`; `latest` remains `0.1.0-rc.17`. Do not retag or
republish. The original source-handoff paragraph below is retained.

## RC28 Real Boss Invocation Compatibility (unpublished candidate)

RC28 is implemented in source and prepared as `0.1.0-rc.28`. It is **not**
tagged, npm-published, or a GitHub Release. Public RC27 is immutable.

- **Normalization:** live Boss inference uses one canonical adapter over Pi
  `completeSimple` `AssistantMessage` values. User-visible text is only
  `type:"text"`. `stop` and `length` are usable when a complete BossDecision
  exists. Thinking/CoT is never the decision.
- **Diagnostics:** request/response/protocol failures persist safe stage, class,
  stopReason, hasText, and fallback fields. Terminal reasons keep the classified
  failure instead of a black-box infrastructure sentence. Secrets and raw
  provider payloads are not persisted.
- **Fallback:** scheduling eligibility ≠ infrastructure fallback eligibility ≠
  protocol validity. Weight 0 is excluded from normal assignment and may still
  fallback. Protocol/quality still does not fallback. Successful fallback remains
  the Mission pin.
- **UI:** configured Boss profiles are not labelled `Unconfigured Boss`;
  scheduled Boss is distinct from editor selection and fallback eligibility.
- **Dogfood recorded:** RC27 Missions
  `mission-89d5e163-17ee-4218-b06c-dea5fa4b480b` and
  `mission-aa30ed69-3213-4cf0-882a-a60be426412d` as observed route/runtime
  compatibility failures, not provider blame.

## RC25 Operational Boss / Orchestrator public prerelease

RC25 is the published public prerelease under `next`. It is not stable or
production-ready; `latest` remains `0.1.0-rc.17`.

- **Configuration:** Boss profiles retain `routeIds` import compatibility and
  add multiple enabled route entries with Thinking Effort, integer weights, and
  weighted policy. The Control Center displays canonical model labels and
  keeps stable route IDs in Inspect/configuration.
- **Canonical lifecycle:** explicit `@orchestrator <goal>` and Smart Routing
  Run as Mission/AUTO_MISSION call the same bounded Boss goal loop. It selects
  one weighted Boss per Mission, persists the assignment, dispatches existing
  Investigation/Implementation work, consumes M7 Verification, and replans or
  repairs after rejection/failure. Completion requires acceptance plus durable
  task execution and M7 pass evidence; bounds end in explicit review/user or
  blocked state.
- **Fallback/analytics:** only genuine Boss infrastructure failure may select
  an unused configured fallback, which remains pinned and records the original,
  replacement, and reason. Mission analytics persist assignment, fallback,
  terminal state, cycles, repair cycles, quality outcomes, elapsed time, and
  observed Boss usage without prompts or secrets.
- **Recommendations:** the existing recommendation architecture can generate
  sample-gated Boss weight proposals. No proposal auto-applies; the user must
  explicitly Apply, and the active profile is stale-checked first.
- **Release evidence:** `npm run check` passed `263/263` tests across 14 suites
  with zero failed/cancelled/skipped/todo tests. The detached release verifier
  passed with `20/20` integrity attacks, Pi `0.84.1` compatibility, and the
  same artifact SHA-256. A verifier-only RC25 compatibility projection repair
  was committed as `7406c3a`; the package allowlist and frozen public artifact
  remained unchanged.
- **Registry/GitHub:** npm reports `0.1.0-rc.25`, `next` points to RC25,
  `latest` remains RC17, and the downloaded registry tarball matches the
  frozen SHA-256 and registry SHA-512 integrity. GitHub prerelease
  [v0.1.0-rc.25](https://github.com/Recoba86/PiMultiOrchestrator/releases/tag/v0.1.0-rc.25)
  carries the exact tarball and checksum.
- **Public Pi evidence:** fresh isolated `pi install
  npm:pi-multi-orchestrator@0.1.0-rc.25` and an RC24→RC25 upgrade both loaded
  the public package in Pi `0.84.1`; `@orchestrator`, all twelve Control Center
  sections, Diagnostics, candidate identity, and untrusted-by-default state
  passed through offline RPC. No live Pi configuration or provider/model call
  was used.

## RC27 Autonomous Mission Bootstrap & Zero-Task Boss Loop Repair — pre-release ready

RC27 is implemented in source and prepared as `0.1.0-rc.27`. It is **not**
public, tagged, npm-published, or a GitHub Release. Public RC26 remains
immutable until the operator performs a later explicit publication of RC27.

- **Autonomous bootstrap:** `@orchestrator`, Smart Routing Run as Mission, and
  AUTO_MISSION create a canonical Mission and start the Boss loop. The Boss
  must produce an actionable plan and create canonical Task(s) without a
  manual `/missions` Add Task step. Manual Mission creation may still offer
  the Task editor.
- **Protocol:** `normalizeBossDecision` validates Boss JSON at runtime. Wrong
  actions, missing summary, non-array tasks, invalid task fields, and invalid
  `acceptanceSatisfied`/`requiredFixes` types become `BossProtocolError`.
- **Zero-task invariant:** plan-phase `dispatch` or `replan` with `tasks=[]`
  is an actionable-plan failure. It feeds bounded corrective feedback to the
  same pinned Boss. It is never false `COMPLETED`. After the safety budget,
  `AWAITING_USER` includes task count, protocol/actionable-plan failures, last
  action, pin, and fallback metadata.
- **Goal criteria:** explicit structured criteria outrank labelled goal
  sections, which outrank bounded derived Goal criteria. Goal criteria stay
  distinct from per-Task criteria.
- **UX:** automatic Mission creation says `Boss execution starting
  automatically...` and does not tell the user to add a Task.
- **Publication:** none for RC27. RC26 was not mutated, retagged, rebuilt, or
  republished.

## RC26 Goal Terminal Semantics & Runtime Metadata Correctness — public prerelease

Public identity is immutable: `pi-multi-orchestrator@0.1.0-rc.26`, tag
`v0.1.0-rc.26`, source `11153f0587634bcba732a5b214c95319c305f9e6`, artifact
SHA-256 `1b20c048e91f8665cb8cfc31982c56c472b270a0bfbf5432ad91ec899aacd69a`.
Do not mutate, retag, rebuild, or republish it.

The following bullets are the original RC26 source-handoff snapshot and are
not rewritten. Operator publication later made RC26 public.

RC26 is implemented in source and prepared as `0.1.0-rc.26`. It is **not**
public, tagged, npm-published, or a GitHub Release. RC25 remains the current
public prerelease until the operator performs publication from a later explicit
procedure.

- **Terminals:** `runMissionGoalLoop` now returns a first-class `terminal` of
  `COMPLETED`, `BLOCKED`, `AWAITING_USER`, `CANCELLED`, or `SAFETY_STOP`.
  Cancellation persists MissionStatus `cancelled`. `SAFETY_STOP` preserves
  MissionStatus `blocked` and records orchestration `terminal: "SAFETY_STOP"`
  with a bounded sanitized provenance from the existing trust/path/command
  safety boundary. Cancellation and safety-stop never complete, never fall
  back, and never continue repair/replan or quality escalation.
- **Metadata:** runtime `package-info` walks to the authoritative
  `pi-multi-orchestrator` package.json. The RC26 development line is keyed by
  `0.1.0-rc.26`; unknown versions fail closed as `stale-development-line:*`.
  `latestAcceptedMilestone` remains M10; `productionReady` remains false.
- **Publication:** none. No `v0.1.0-rc.26` tag, npm dist-tag, or GitHub Release
  exists for this candidate at handoff.
- **Evidence privacy:** `verify-pi-release` persists only sanitized command
  results. Local absolute machine paths are replaced with `<release-dir>`,
  `<temp-path>`, or `<local-path>` before `pi-install-evidence.json` is written.
  Review-bundle `scanPrivacy` still rejects unsanitized `/Users` paths; there
  is no scanner exception for this file.

## Historical RC22 local candidate — Canonical model selector presentation

At that time, RC22 was an implemented local candidate. RC21 remained the
public prerelease; RC22 was not stable or production-ready.

- **Source binding:** code commit
  `288c77cfac92dc7ffa8a0f0b16a69d140ada3aea`, tree
  `6bf89664015cee47c5ee2e98692666c94e030384`, source digest
  `fc06fa0e39d4ba7cf139a37ccd97d2d5a558dafc48fc844b077c2a85eade52e7`.
- **Artifact:** `pi-multi-orchestrator-0.1.0-rc.22.tgz`, SHA-256
  `7d9b9451d1c2590d5b2632b6dd7aadd250bd2851af8dd79d79c25113693dbdea`;
  independent bundle-root SHA-256
  `a81f34cf41709de5ebef4fe8e1733e883be8e5849dd7f371dc34070bff6170c3`.
- **Verification:** detached release verification passed `250/250` tests
  across 13 suites, typecheck/build, `20/20` integrity attacks, and
  worker-safety checks. Isolated Pi `0.84.1` installation evidence reports
  RC22 installed and verified, with zero live calls and zero paid inference.
- **Boundary:** no npm publication, tag, GitHub release, live Pi
  configuration, provider account, credential store, or model request was
  performed. The artifact remains bound to the source commit above; this
  state-record update is separate and does not rebuild or repack it.

## Historical RC21 Model Router dogfood repair publication

At publication time, RC21 was the current public prerelease. It repaired nested catalog metadata
normalization, conservative true/false/unknown thinking semantics, static Pi
provider upstream refresh through Pi's existing auth bridge, LKG preservation,
picker feedback/order, and normal-row route-ID privacy.

- **Package:** `pi-multi-orchestrator@0.1.0-rc.21`, published with
  `--tag next --access public --ignore-scripts`.
- **Source binding:** commit
  `68c0c0f82c5c82d7944512ea64aadd05a2e4569e`, tree
  `9baab4eb7d51c4598b8ea3aa4d5b12e9e2479512`, tag `v0.1.0-rc.21`.
- **Artifact:** SHA-256
  `67e5fe663bc8ec05d3f02ec1183841552b3e70b13fd92901962fddbef8b6a266`;
  independent bundle-root SHA-256
  `7e2fd35553fd46f232d5f8e286ef272c1c8a2d018037c0b6b3763e4fab89c017`.
- **Registry:** npm reports version `0.1.0-rc.21`, `next` points to RC21,
  `latest` remains `0.1.0-rc.17`, and the downloaded registry tarball matches
  the frozen artifact byte-for-byte.
- **GitHub:** [v0.1.0-rc.21](https://github.com/Recoba86/PiMultiOrchestrator/releases/tag/v0.1.0-rc.21)
  is an explicit prerelease carrying the artifact and checksum.
- **Verification:** `246/246` tests across 13 suites, zero
  failed/cancelled/skipped/todo, typecheck/build, `20/20` integrity attacks,
  and disposable public npm/Pi `0.84.2` install plus offline Model Router
  command/status/refresh smoke all passed, including start and safe
  unconfigured/LKG failure feedback.
- **Boundary:** no live Pi configuration, provider account, credential, or
  model request was modified/performed. The publication used the frozen
  artifact; no rebuild or repack occurred after freeze.

## Historical RC20 public prerelease publication

At publication time, RC20 was the current public prerelease. It added independent Pool-entry
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

## Historical RC19 public prerelease publication

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

## Historical RC17 public prerelease publication

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

## Historical RC17 final Planner/manual acceptance

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
| RC22 local candidate | Source commit `288c77cfac92dc7ffa8a0f0b16a69d140ada3aea`; detached `250/250 PASS`; `20/20` integrity attacks; Pi `0.84.1` isolated install evidence PASS; artifact SHA-256 `7d9b9451d1c2590d5b2632b6dd7aadd250bd2851af8dd79d79c25113693dbdea`; bundle root `a81f34cf41709de5ebef4fe8e1733e883be8e5849dd7f371dc34070bff6170c3`; local-only |
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

- RC25 has a public artifact, immutable tag, GitHub prerelease, and npm version. No stable or production-ready install exists.
- RC16 addresses the M12.1/M7 and recovery findings carried forward from RC15 review: explicit-entry failure preserves the original prompt, completion requires Boss authorization and passed M7 evidence, cross-Mission evidence is rejected, corrupt routing state is repairable, Unicode and input sizes are bounded, worker timeouts honor route ceilings, and the TypeScript launcher is provenance-bound. Detached release evidence passes; final development acceptance remains separate.
- The 2026-08-15 RC16 acceptance attempt is historical and was hard-blocked at the live canonical M7 reviewer handoff. RC17 resolved that handoff with the smallest source-bound reviewer instruction and a regression assertion; the RC17 live Verification Pool run captured one valid submission and passed M7.
- The extension is loaded explicitly for development and is not installed into the user's live Pi configuration.
- Broader autonomous mission decomposition/scheduling beyond the bounded RC25 loop, scheduled/autonomous tuning, cost/budget-aware routing, parallel orchestration, and stable production release remain incomplete. M10 is the latest Planner-accepted development state; M11 is implemented but not accepted.
- RC25 public Pi evidence passed in isolated offline Pi `0.84.1` RPC, including the dashboard, all twelve Control Center sections, Diagnostics, package identity, and untrusted-by-default behavior. This is prerelease evidence, not a stable or production-ready claim.
- RC25 public evidence did not include a distinct Boss-loop `CANCELLED`/`SAFETY_STOP` path. RC26 source now implements those terminals and truthful runtime package metadata; RC26 is pre-release ready and not public. The published RC25 package is unchanged.
- Historical M11 RC.8 Computer-Use dogfood and canonical M7 real-route verification passed; final human sanity smoke, live metadata limits, and Planner acceptance remain open validation. RC15 is historical; RC16 detached verification passed.
- M12.1 RC.9 changes are historical local evidence. RC17 was the public prerelease for the combined M12 final acceptance; RC25 is the current public prerelease. M12.2 RC.11 and M12.3 RC.12 remain historical local candidates, and M10 remains the latest accepted development milestone.
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
