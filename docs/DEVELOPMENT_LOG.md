# Development log

Last updated: 2026-08-15

This is an append-oriented record of meaningful milestone outcomes, not a daily diary. Do not rewrite accepted history to match later intentions; add an explicit correction when evidence changes.

## RC25 — Operational Boss / Orchestrator

- **Date/status:** 2026-08-15; `IMPLEMENTED / RELEASE CANDIDATE`, with RC24
  remaining the prior public prerelease until the RC25 closure gates pass.
- **Implementation:** Boss profiles now support multiple eligible routes with
  bounded integer weights and per-route Thinking Effort. One weighted Boss is
  selected and persisted per Mission, retained across all normal goal-loop
  cycles, and replaced only by an explicit unused infrastructure fallback.
  Explicit `@orchestrator` and Smart Routing Mission entry use the same
  plan→dispatch→M7→evaluate→repair/replan loop with bounded terminal states.
- **Analytics/recommendations:** assignment, fallback, terminal state, cycle,
  repair, quality, duration, and authoritative usage metadata are persisted as
  safe Mission analytics. Boss weight proposals use the existing
  RecommendationApplicationService and remain manual-only/stale-checked.
- **Coverage:** focused RC25 suites pass for migration, weighted distribution,
  multi-cycle reject→repair→pass, pinned fallback, UI weighted presentation,
  analytics persistence, and manual-only Boss recommendations. Full check,
  exact artifact, public registry, GitHub prerelease, and isolated public Pi
  runtime gates remain pending.

## RC24 — Model Router enablement hotfix

- **Date/status:** 2026-08-15; `IMPLEMENTED / RELEASE CANDIDATE`, preserving the
  RC23 weighted scheduling and Pool behavior.
- **Implementation:** the Model Router now prefixes canonical rows with `[x]`
  when PMO enablement is true and `[ ]` when a route is discovered but disabled.
  Enter still opens Inspect plus the existing Enable/Disable action, and
  Refresh Models re-reads the persisted state. Canonical remote IDs, duplicate
  suffixes, and hidden internal route IDs remain unchanged.
- **Coverage:** focused Pi `0.84.1` TUI/RPC acceptance covers the four RC24
  routes, duplicate disambiguation, action-menu selection, immediate redraw,
  refresh persistence, and display-only non-mutation. Full release evidence is
  bound to the final RC24 source commit and frozen artifact.

## RC22 — Canonical model selector presentation local candidate

- **Date/status:** 2026-08-15; `IMPLEMENTED / LOCAL CANDIDATE`, not accepted or
  public. RC21 remains the public prerelease.
- **Implementation:** introduced one shared canonical model-option presentation
  helper and routed all 11 PMO model/route selector prompts through it: Model
  Router, the three Pool editors, three Add Route flows, Route Health, Smart
  Routing Primary/Fallback, and Recommendation Analyst. Normal rows show one
  remote model ID, deterministic duplicate suffixes, and no internal route ID,
  `ACTIVE`, or Thinking metadata; exact route IDs remain available to Inspect
  and diagnostics.
- **Identity:** source commit
  `288c77cfac92dc7ffa8a0f0b16a69d140ada3aea`, tree
  `6bf89664015cee47c5ee2e98692666c94e030384`, source digest
  `fc06fa0e39d4ba7cf139a37ccd97d2d5a558dafc48fc844b077c2a85eade52e7`,
  artifact SHA-256
  `7d9b9451d1c2590d5b2632b6dd7aadd250bd2851af8dd79d79c25113693dbdea`, and
  bundle-root SHA-256
  `a81f34cf41709de5ebef4fe8e1733e883be8e5849dd7f371dc34070bff6170c3`.
- **Evidence:** detached release verification passed `250/250` tests across
  13 suites, typecheck/build, `20/20` integrity attacks, and worker-safety
  checks. Isolated Pi `0.84.1` install evidence passed with RC22 installed and
  verified; live calls and paid inference were zero.
- **Boundary:** pushed to `origin/main`; no npm publication, tag, GitHub
  release, live Pi configuration, provider account, credential store, or model
  request was performed. The artifact was not rebuilt after the source-bound
  release verification.

## RC21 — Model Router dogfood repair publication

- **Date/status:** 2026-08-15; `PUBLISHED / PRERELEASE` on npm and GitHub.
- **Identity:** package `pi-multi-orchestrator@0.1.0-rc.21`, source commit
  `68c0c0f82c5c82d7944512ea64aadd05a2e4569e`, tree
  `9baab4eb7d51c4598b8ea3aa4d5b12e9e2479512`, tag `v0.1.0-rc.21`, artifact
  SHA-256 `67e5fe663bc8ec05d3f02ec1183841552b3e70b13fd92901962fddbef8b6a266`,
  and bundle-root SHA-256
  `7e2fd35553fd46f232d5f8e286ef272c1c8a2d018037c0b6b3763e4fab89c017`.
- **Fixes:** host normalization now preserves nested catalog reasoning,
  thinking-level, vision, context, and max-output metadata; Pool effort choices
  no longer infer support from an unverified configured map; static external Pi
  providers use transient Pi auth for a bounded upstream `/v1/models` refresh
  without replacing or shrinking the provider; populated Model Router rows hide
  internal route IDs while Inspect retains them.
- **Release evidence:** clean `npm run check` passed `246/246` tests across 13
  suites with zero failed/cancelled/skipped/todo; typecheck/build and `20/20`
  integrity attacks passed. npm publication used `--tag next --access public
  --ignore-scripts`; registry version/tag checks passed, `latest` remained
  `0.1.0-rc.17`, and the downloaded registry tarball was byte-identical to the
  frozen artifact. GitHub release `v0.1.0-rc.21` is an explicit prerelease.
- **Public dogfood:** a disposable npm install loaded RC21 in Pi `0.84.2`,
  registered the Model Router commands, and completed offline `/9router-status`
  and `/9router-refresh`, including the visible refresh start and safe
  unconfigured/LKG failure feedback, with no provider call.
- **Boundary:** no live Pi configuration, provider catalog, credential store,
  or model request was modified/performed. Publication used the already-frozen
  artifact; no rebuild or repack occurred after freeze.

## RC20 — Thinking-aware Pool routing and live catalog refresh

- **Date/status:** 2026-08-15; `PUBLISHED / PRERELEASE` on npm and GitHub.
- **Identity:** package `pi-multi-orchestrator@0.1.0-rc.20`, source commit
  `8bcb4a61796623ea09bd1ed09c411656bd657138`, tag `v0.1.0-rc.20`, source
  tree `8c995d342fd95b1294be5066615bb8269b635617`, and artifact SHA-256
  `556de8db9bb661e3f82f47badd2b93f68b3145e29b056b6abc29bea15efda9bc`.
- **Implementation:** Pool route entries now carry independent Thinking Effort;
  legacy absence becomes `auto` at the ConfigStore write boundary. Auto omits
  Pi's `thinkingLevel` override, explicit levels are capability-validated, and
  attempts/analytics retain requested versus observed effective effort.
- **Model Router:** Models & 9Router exposes in-place Refresh Models, uses live
  PMO or external-Pi refresh paths, reports added/removed/changed rows, keeps a
  validated last-known-good catalog on failure, excludes disabled routes from
  Add Model, and preserves external provider ownership and Pool state.
- **Release evidence:** clean `npm run check` passed `242/242` tests across 13
  suites with zero failed/cancelled/skipped/todo; independent release
  verification passed Pi `0.84.1`, `20/20` integrity attacks, and public npm
  install. npm `next` points to RC20 while `latest` remains RC17; the GitHub
  release is explicitly a prerelease and carries the exact artifact/checksum.
- **Dogfood/boundary:** published RC20 loaded through Pi `0.84.1` in a
  read-only `--offline` catalog probe with 27 existing `9router` rows, using
  temporary PMO/session roots. No live Pi configuration, provider account,
  credential, refresh, or model request was modified/performed.
- **Scope:** periodic automatic sync, Benchmark Lab, automatic effort tuning,
  and autonomous Pool rewrites remain future work.

## RC19 public prerelease publication

- **Date/status:** 2026-08-15; `PUBLISHED / PRERELEASE`.
- **Identity:** package `pi-multi-orchestrator@0.1.0-rc.19`, source commit
  `717a20413fc22f7ca7fde8df8a841ebde05b0f1a`, tag `v0.1.0-rc.19`, and artifact
  SHA-256 `338d466a2308711e2c6befc838a29b77e6c1a5d1574350441bf9b5f46845a88e`.
- **Publication:** npm publish completed with public access, `next` points to
  RC19, and `latest` remains `0.1.0-rc.17`. GitHub release `v0.1.0-rc.19` is
  explicitly marked prerelease and carries the exact artifact/checksum.
- **Verification:** the downloaded registry tarball is byte-identical to the
  local artifact; a clean public npm installation reports the exact package
  identity/version; and public-package Pi `0.84.1` dogfood matched 27/27
  existing `9router` rows with isolated PMO/session state.
- **Boundary:** RC19 is for real-world dogfooding, not stable production use.
  No live Pi credential or configuration was changed.

## RC19 — Pi 9Router onboarding and adoption

- **Date/status:** 2026-08-15; implementation complete as the
  `0.1.0-rc.19` public prerelease. Publication evidence is recorded above.
- **Existing Pi provider:** the host now consumes Pi `0.84.1`'s credential-blind
  `Provider.getModels()` catalog, exposes all bounded external 9Router models in
  Models & 9Router, and preserves external provider ownership across reconcile,
  reload, refresh, and disposal. Enabling an external model creates PMO route
  state only and does not assign a pool or copy credentials.
- **First-run setup:** the no-provider path offers TUI-only masked API-key input,
  explicit `Test & Save`, bounded `/v1/models` validation before persistence, and
  Pi auth API storage. PMO persists only `{store:"pi-auth",key:"9router"}`;
  RPC setup fails closed because Pi `0.84.1` has no masked RPC field.
- **Pi bridge:** provider registration leaves `apiKey` absent for Pi-auth-backed
  projections so Pi resolves the stored credential; env-backed projections keep
  their existing `$ENV_NAME` behavior. External refresh uses the bound Pi model
  registry rather than incorrectly requiring a PMO gateway.
- **Validation:** RC19 focused U/I/TUI/RPC tests, Pi auth-storage API probe,
  typecheck, build, full release gate, isolated Pi dogfood, and public-package
  verification passed.

## RC17 public prerelease publication

- **Date/status:** 2026-08-15; `PUBLISHED / PRERELEASE`. The immutable RC17
  artifact is public for dogfooding and is not a stable or production release.
- **Identity:** source commit `5def791b31a7ad940ed87f6e720aabb0228500e7`, tag
  `v0.1.0-rc.17`, package `pi-multi-orchestrator@0.1.0-rc.17`, and artifact
  SHA-256 `2a9343de7b456840ebdd596ef14c674a51abdad65e3e840b6a29b760e9aa5b62`.
- **Remote proof:** GitHub release `v0.1.0-rc.17` is explicitly marked
  prerelease; the remote tag peels to the source-bound commit. npm reports the
  exact package/version and `next` points to `0.1.0-rc.17`.
- **Artifact proof:** independently downloaded npm and GitHub tarballs are
  byte-identical and match the accepted SHA-256. No rebuild or repack was done.
- **Publication checkpoint:** npm already contained the exact immutable RC17
  version and byte-identical artifact, so no republish or repack was performed.
  The authenticated interactive npm flow moved only `next` from RC20 to RC17;
  `latest` remained `0.1.0-rc.17` before and after the checkpoint.

## RC18 — Real-world Pi/9Router compatibility repair

- **Date/status:** 2026-08-15; local source repair and dogfood PASS. The package
  remains `0.1.0-rc.17`; this work did not rebuild/repack or publish a package,
  create a tag, push, or modify source outside the repair.
- **Defects fixed:** RC17's factory-time two-model projection shadowed an
  existing user `9router` catalog because Pi `0.84.1` replaces supplied model
  lists. Reconcile/dispose could unregister a provider the host did not own.
  The parser also discarded current object-shaped `capabilities` metadata and
  the manager forced all projected models to `reasoning: false`.
- **Implementation:** commit `0af7b8e` adds credential-blind factory probing
  plus `ctx.modelRegistry` confirmation, explicit external/owned lifecycle
  handling, backward-compatible current/legacy capability parsing, cache-safe
  reasoning/vision/rich metadata, and focused tests for the 27-model external
  provider, owned standalone lifecycle, Gemini/GPT/Grok metadata, and legacy
  aliases. `ConfigV1` and public route schema are unchanged.
- **Validation:** focused suites passed; production build passed; full
  `npm run check` passed `234/234` across 13 suites with zero
  failed/cancelled/skipped/todo; `git diff --check` passed.
- **Runtime boundary:** baseline and explicit local-extension `--list-models`
  runs against the existing Pi model/auth configuration both exited 0, exposed
  exactly 27 `9router` rows, and matched byte-for-byte while PMO/session state
  was disposable. A bounded RPC load exited 0. No provider request, refresh,
  credential display, live Pi configuration mutation, npm action, tag, push,
  or release was performed.
- **Future requirement:** **Dynamic Route Catalog & Capability Sync** remains
  **PLANNED / NOT IMPLEMENTED**. It must add manual Refresh Now, configurable
  periodic sync, diffing, per-route caps, provenance, last-known-good, stale
  indicators, safe user overrides, and provider-advertised versus empirically
  observed capability distinction.

## M12 final Planner/manual acceptance — RC17 PASS

- **Date:** 2026-08-15.
- **Status:** `PMO_FINAL_PLANNER_ACCEPTANCE_PASS` for local candidate
  `0.1.0-rc.17`; M10 remains the latest accepted development milestone. RC17 is
  not public, production-ready, or published.
- **Source/release identity:** source commit
  `5def791b31a7ad940ed87f6e720aabb0228500e7`, tree
  `c23424f26600e988e6d96cbd794a0d22cc121ecd`, source digest
  `04935d63c419c56c4c9b92214abf06d4151bfe13ebc7a255b08475895c7d7f2c`, build
  digest `aaefde527e8f18a6accbd1dc79e9fffb87ae0f6df832c876911a4cd509373b58`,
  artifact SHA-256
  `2a9343de7b456840ebdd596ef14c674a51abdad65e3e840b6a29b760e9aa5b62`, and
  independent bundle root
  `f5f58cdf255580b4cdd772b0b5885fde531232fc4130b7e352972fe7be9b9bcf`.
- **Repair:** bounded reviewer instructions plus a deterministic provider-host
  assertion stopped exploratory `grep`/`find` failures from stranding the
  required structured M7 submission. The source fix was committed before the
  RC17 artifact; the later documentation handoff is docs-only.
- **Offline validation:** `npm run check` passed `231/231` across 13 suites
  with zero failed/cancelled/skipped/todo; typecheck/build, detached release
  verification, Pi `0.84.1` compatibility/install/upgrade/rollback/rescue,
  privacy, worker safety, and `20/20` integrity attacks passed.
- **Live canonical path:** Mission
  `mission-b5a2cc76-d2b1-41d4-9c31-a922e7727d53`, Task
  `task-2b48f5e6-d3d2-4282-8318-6259a1a4e399`, Implementation attempt
  `attempt-783ba966-d696-4dfd-9230-f7094c8bedae`, Verification
  `verification-f5ea93ba-deea-41c3-a6ae-8c9d009102a4`, reviewer run
  `run-msthhb41-1`, and pass decision
  `decision-30772023-ebec-4ce9-a2cf-ba90e4e191c1`. The run created exact
  `rc17-smoke.json`, satisfied all four criteria, and observed no reviewer
  mutation or fallback/repair/escalation.
- **Technical TUI/boundary:** isolated offline Pi `0.84.1` RPC passed dashboard,
  Routing & Fallback, Missions, Back, clean exit, and no credential text. No
  live Pi configuration, provider account, Keychain value, public tag, push,
  npm publication, GitHub release, or production installation was modified.

## Historical M12 final Planner/manual acceptance attempt — RC16 HARD BLOCKED

- **Date:** 2026-08-15.
- **Status:** `PMO_FINAL_PLANNER_ACCEPTANCE_HARD_BLOCK` (superseded by RC17);
  M10 remains the latest
  accepted milestone. RC16 is not accepted, public, or production-ready.
- **Identity:** all candidate claims remain bound to source commit
  `1ffcbed8d776c4d0379a6bf7f832967fae7dbb99`, tree
  `0e7e01ff02abf269891fc55556d57e64d5a1f111`, artifact SHA-256
  `72073e109df5a0d6b6e0f4be9f825932a768791d0752976c99aabc83eb4bcd7a`, and
  bundle-root SHA-256
  `6414f090c54caf4004fe62a6d51fe4e9d0df562b662a7091c9f68767901bb675`; the
  current handoff HEAD remains a separate docs-only state.
- **Offline validation:** current `npm run check` passed `231/231` across 13
  suites with zero failed/cancelled/skipped/todo; typecheck and build passed.
- **Live Triage:** one captured ambiguous case in a disposable root returned a
  structured fallback recommendation after two bounded real-provider calls;
  no credential was displayed or persisted.
- **Canonical live path:** in a disposable canonical-smoke root, Mission
  `mission-c40f24a2-9b39-4340-9495-ca016d938eec` and Task
  `task-f6914ed1-61fc-4c48-8026-28b46379e029` used only
  `r9-ninerouter-ag-claude-opus-4-6-think-fe2f756e1d848cbb05ca`; the
  Implementation run succeeded and created exact `rc16-smoke.json` with no
  unexpected file. The two canonical M7 Verification runs stopped before a
  valid `submit_verification_result` capture, leaving M7 blocked with no
  quality decision and no observed reviewer mutation.
- **Technical TUI:** isolated offline Pi `0.84.1` RPC passed launch, nested
  Control Center, Smart Routing settings, Missions, Back navigation, clean
  exit, and credential-display checks.
- **Boundary:** no source/package/live Pi configuration/provider account/
  Keychain/public tag/push/npm publication/GitHub release/production install
  was modified. The blocker is current route/protocol compatibility; no
  source defect or successor release was established.

## M12.1 autonomous mission entry and RC16 candidate

- **Date:** 2026-08-14.
- **Status:** FINAL EXTERNAL REVIEW PASS on the exact detached RC16 local candidate; M10 remains the latest accepted milestone and RC16 is not production-ready.
- **Implementation:** explicit-entry failure preserves the original prompt; canonical Mission completion is Boss-only and requires completed/passed M7 evidence; verification, evidence, escalation, and backup validation enforce Mission/task identity and quality lineage.
- **Routing/recovery:** bounded input is checked before local analysis, zero-width Unicode cannot bypass NORMAL safety, corrupt Smart Routing and Routing Memory state can be repaired, malformed history is isolated, and direct worker timeouts cannot exceed the configured ceiling.
- **Release provenance:** build scripts invoke the validated TypeScript package directly and bind its launcher hash. Package version is `0.1.0-rc.16`.
- **Validation:** clean `npm run check` passed `231/231` tests across 13 suites with zero failed/cancelled/skipped/todo; typecheck and build passed. Fresh detached release verification passed artifact binding, privacy, Pi `0.84.1` compatibility, worker safety, `20/20` integrity attacks, and independent bundle-root verification.
- **Exact identity:** commit `1ffcbed8d776c4d0379a6bf7f832967fae7dbb99`, tree `0e7e01ff02abf269891fc55556d57e64d5a1f111`, source digest `7dd0e1c84ad6e980a19269eafddf1f1501cc1aa1f9cf330afca172584daa1b87`, artifact SHA-256 `72073e109df5a0d6b6e0f4be9f825932a768791d0752976c99aabc83eb4bcd7a`, bundle root `6414f090c54caf4004fe62a6d51fe4e9d0df562b662a7091c9f68767901bb675`.
- **Boundary:** no live Pi configuration, provider account, Keychain, credential value, public tag, push, npm publication, GitHub release, or production-ready claim was made. Planner/manual acceptance and publication remain separate.

## M12 Final External Release Review — RC15 candidate

- **Date:** 2026-08-14.
- **Status:** HISTORICAL FINAL EXTERNAL REVIEW PASS on the exact detached local candidate. RC16 supersedes RC15; M10 remains the latest accepted milestone.
- **Baseline:** source-review commit `3101fd7` followed the RC13/RC14 review surface. RC13 remains historical; RC15 is the next candidate identity.
- **Repairs:** in addition to the prior release, routing, recovery, and Mission/M7 fixes, the worker boundary now rejects shell expansion/globs and recursive shell reads, scans bounded recursive built-in reads for credential-like descendants and symlinks, removes npm lifecycle commands from the allowlist, and blocks worker Git content inspection.
- **Validation:** focused worker-safety tests `7/7 PASS`; clean-checkout full suite `227/227 PASS` across 13 suites with zero failed/cancelled/skipped/todo; typecheck and build PASS. The final detached verifier passed exact source/artifact binding, privacy, Pi `0.84.1` install/upgrade/rollback/rescue, worker safety, and `20/20` integrity attacks. The generated packet records the artifact and bundle identities; the embedded bundle marker remains audit-only `EXTERNAL_REVIEW_PENDING`.
- **Boundary:** no live Pi configuration, provider account, Keychain, credential value, public tag, push, npm publication, GitHub release, or production-ready claim was made. Planner/manual acceptance and publication remain separate and unauthorized.

## M12 Final Routing Gate — local RC13 pass

- **Date:** 2026-08-14.
- **Status:** COMPLETE / LOCAL PASS; M10 remains the latest accepted milestone.
  This is not M12 acceptance, a public release, or a Planner/manual handoff.
- **Starting baseline:** clean `main` at `ddd3ea727ca338ecbbab2b23401de733e8c18cde`,
  local candidate `0.1.0-rc.12`, Pi `0.84.1`.
- **Implementation:** corrected the shared local analyzer's informational
  question/explanation handling, bilingual uncertainty boundaries, API/UI and
  release-plus-verification complexity signals, and retry-policy false positive;
  added focused analyzer coverage and a composed Smart-routed Mission → Task →
  Run → M7 integration proof. Bumped the local candidate to `0.1.0-rc.13`.
- **Validation:** `npm run check` passed `214/214`; focused routing/provider,
  security, quality, memory, stale-route, and Pi suites passed; the balanced
  English/Persian/mixed corpus passed `360/360`; bounded adversarial input was
  `13/13` exception-free; focused review found no unresolved blocker/high.
- **Live boundary:** fresh disposable roots used real 9Router Triage for ten
  ambiguous sessions (`20` calls, `9` fallback successes, one timeout
  degradation). No live Pi configuration, provider account, Keychain value,
  source checkout, tag, push, npm publication, or GitHub release was modified.
- **Release evidence:** RC13 artifact SHA-256
  `abbfaf8580008a5f2d297a28a49fe3a0c962b1f3c512944b9f680c74e630085b`, source
  digest `0c5d0b49a2c637b592e039b31548bd549e31eee5c0854c20487a74324185d074`,
  and review-bundle root
  `f3183574deed6dc96e6a15953a5949bdbb4858f34a9a26b5378437a81ca7075c`.
- **Remaining gates:** External Review #5 is `EXTERNAL_REVIEW_PENDING`;
  Planner/manual acceptance and authorized publication remain pending.

## M12.3 — Adaptive Routing Memory

- **Status:** COMPLETE / LOCAL PASS; M10 remains the latest accepted milestone and M12.3 is not a public or production-ready release.
- **Candidate:** `0.1.0-rc.12`; local source candidate only. Focused independent review of the final source commit passed with no unresolved blocker/high. The M12 Final Routing Gate, external review, Planner/manual acceptance, and publication remain separate gates.
- **Purpose:** Make Smart Routing usefully personal without storing prompt history: explicit Always rules, repeated Mission/Normal learning, conservative matching, reversible controls, and safe cross-language behavior.
- **Major outcomes:** A versioned `routing-memory.json` sidecar stores abstract signatures, source/provenance, confidence, observations, enabled state, and bounded history. Explicit Always creates exactly one canonical Mission and durable explicit rule. Learned rules require three consistent choices; explicit rules outrank learned rules; conflicts, lexical-only overlap, and materially escalated current work fail safe. Strong explicit and learned Mission matches use canonical AUTO_MISSION; strong learned Normal matches continue without recommendation noise.
- **UX and recovery:** Routing & Fallback exposes Routing Memory, Auto-Learn, Learned Behaviors, and validated abstract-only backup/restore. Users can inspect, enable/disable, delete, forget learned rules separately, or reset all memory with confirmation. Disabling retains state; malformed rows are isolated and schema version 0 migrates per row.
- **Privacy:** No prompt, transcript, source text, tool result, provider response, credential, or secret is persisted in memory or routing telemetry. Telemetry is allowlisted bounded metadata only.
- **Evidence:** Analytics `9/9`, Routing Memory `14/14`, Smart Router `13/13`, provider host `25/25`, and isolated Pi `0.84.1` RPC/TUI dogfood `1/1` passed (`61/61` focused tests). The disposable run recorded first Mission `mission-dbf51b4d-e375-4d78-86d6-fd85360a20f0`, follow-up Mission `mission-ff22dc19-3b6e-4f2a-ac88-89a4fb5c70f2`, and explicit rule `rm-2440fb64-ab9f-4415-8ce7-4a204436caaf`; provider calls were zero and only abstract memory state remained.
- **Live boundary:** No live Pi configuration, provider account, credential value, public tag, push, npm publication, or GitHub release was modified. The detached RC.12 verifier passed `212/212` tests, `20/20` integrity attacks, Pi `0.84.1` install/upgrade/rollback/rescue, privacy, and worker safety. Artifact SHA-256: `84cabb6553a5599d548be15646c92fc872c6010778e4eaeda2e05c63a158dc30`; source commit: `56dbbb150fd184240db55e58e4bffc20efdd5c5f`; source digest: `4d417b1360cbb9b3a8a9e6f529470cf85f24bcbc37194f802d3c4b276f6ce8fd`; review-bundle root SHA-256: `69e55e37731c44d6540950056664e729fa56b7898eccadc8b417669cc1327ce8`. Focused review passed with no unresolved blocker/high; the M12 Final Routing Gate, external review, Planner/manual acceptance, and publication remain pending.

## M12.2 — Hybrid Smart Router

- **Status:** COMPLETE / LOCAL PASS; M10 remains the latest accepted milestone and M12.2 is not a public or production-ready release.
- **Candidate:** `0.1.0-rc.11`; M12.1 RC.9 and superseded M12.2 RC.10 remain historical local evidence.
- **Purpose:** Add frictionless ordinary-prompt routing with deterministic bilingual local signals, bounded optional AI Triage for ambiguity, and an explicit Mission-or-normal user choice.
- **Major outcomes:** Clear simple prompts continue with no AI/banner; clear multi-stage prompts offer `Run as Mission` or `Run Normally`; ambiguous prompts use only configured Primary/optional capability-only Fallback routes; strict triage JSON, stale route visibility, local degradation, and original-prompt preservation are enforced.
- **Persistence and privacy:** Smart Routing uses a versioned atomic rollback-capable `smart-routing.json` sidecar separate from legacy ConfigV1 route semantics. Typed routing telemetry stores only decision/path/reason/action/call/fallback/selected-route/failure metadata; raw prompts, transcripts, tool output, provider responses, and secrets are excluded. Analyst persistence was bounded at the same trust boundary.
- **UX boundary:** No new Control Center section was added. Smart Routing lives in Routing & Fallback. Explicit `@orchestrator <goal>` remains the M12.1 bypass; Routing Memory, AUTO_MISSION, mid-run promotion, and learned routing remain out of scope.
- **Evidence:** Smart Router `9/9`, Pi provider host `24/24`, analyst `4/4`, and Control Center `6/6` focused suites passed. Isolated Pi `0.84.1` TUI dogfood passed for normal/no-banner and complex/banner/canonical-Mission flows. Exact-Git `npm run check` and detached release verification both passed `190/190`; release-integrity attacks passed `20/20`; Pi release install/rollback evidence passed. RC.11 artifact source commit is `8219c083577bc21a31046ade4ee1f982fe28abc6`; artifact SHA-256: `17e9feb871708ff08312bc27ab56cf0b35ce2cf47669b69db31fda7c6a396b74`. Review-bundle root SHA-256: `2e514696b113a4728d2f3b47a392b84255c9cdb7e29f50260640ea6f759ec3f7`.
- **Live dogfood:** In disposable roots, the secure auth bridge and catalog were ready; a direct strict structured probe passed; real English and Persian ambiguous TUI prompts showed the recommendation UI; persisted events recorded two triage calls, capability-only fallback, selected fallback route, and the user actions `run_as_mission` and `run_normally`; a missing-route configuration recorded two bounded unavailable checks and preserved the original prompt on cancel. No raw prompt or provider response was persisted.
- **Live boundary:** No live Pi configuration, provider account, credential value, public tag, push, npm publication, or GitHub release was modified. M12.2 is a local milestone result; independent review, Planner/manual acceptance, M12.3, and publication remain separate gates.

## M12.1 — Frictionless Mission Entry

- **Status:** COMPLETE / LOCAL PASS; M10 remains the latest accepted milestone and M12.1 is not a public or production-ready release.
- **Starting HEAD/candidate:** `22c6df3bd23b9c325a6e665af5da6de160a63f62`, `0.1.0-rc.8`; implementation commit `ad39a8f`, candidate `0.1.0-rc.9`.
- **Purpose:** Make explicit Mission entry available from normal Pi input while preserving ordinary prompts and clarifying Direct Workers versus canonical Mission/M7 verification.
- **Major outcomes:** Pi `0.84.1` native `input` handling recognizes `@orchestrator <goal>`; empty/ordinary/extension input is bounded; English, Persian, mixed, whitespace, case, quoted, and embedded forms are covered; input and the existing New Mission menu reuse `createCanonicalMission`; MissionStore persistence and pointer-only session history remain canonical.
- **UX boundary:** `/subagent-run` is labeled Direct Workers, including Direct Verification Worker; its UI and completion feedback state that no canonical Mission task, M7 verification run, quality decision, or quality history is created. Canonical `/verify-task` status/history are labeled Mission quality (M7) without changing their persistence or confirmation semantics.
- **Evidence:** Focused provider tests passed for real temporary SQLite persistence, menu equivalence, ordinary-input isolation, empty input, and direct-worker labeling. Final typecheck/build/check and the full `177/177` suite passed; release verification passed with `20/20` integrity attacks; bounded focused UX/release audits reported no blocking finding.
- **Offline TUI evidence:** In disposable temporary roots, Pi `0.84.1` created English Mission `mission-68626594-683d-4b3a-a273-b9e1a9b83df5` and Persian Mission `mission-40224d4f-55d5-4cb6-9cad-0fe7c8eca6ea`, preserved ordinary-input behavior, showed `Add a goal after @orchestrator.`, rendered `/missions` state, and exposed `Direct Workers` with Back navigation. No live provider, credential, or user Pi configuration was used.
- **Scope boundary:** No smart routing, automatic classification, Routing Memory, live Pi configuration, provider account, credential, public tag, push, npm publication, or GitHub release.

## M0 — Specification Freeze

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** No prior repository commit
- **Accepted/final HEAD:** `56cb8e04b3aefdbfe28e41f20794570a61751029`
- **Commit:** `docs: freeze initial orchestrator specification`
- **Purpose:** Freeze product behavior, architecture, acceptance cases, decisions, and delivery order before implementation.
- **Major outcomes:** Authoritative specification set; Pi `0.84.1` and Node.js `v22.23.0` baseline; host/9Router/custom ownership boundaries; proof-of-concept register; no production implementation.
- **Important decisions:** Pi as host; 9Router as gateway; exactly three execution pools; stable route/resource identity; infrastructure fallback separated from quality escalation; canonical mission state outside chat; secret references only; serial shared-worktree mutation.
- **Tests/evidence:** M0 repository, link/Markdown, scope/secret, baseline, and cross-document acceptance; accepted commit above.
- **Deferred work:** All production implementation, integration, runtime state, TUI, workers, analytics, hardening, and packaging.
- **Live environment impact:** No Pi configuration or 9Router modification; no credentials, paid calls, GitHub remote, or release.
- **Next authorized milestone:** M1 — Configuration Foundation.

## M1 — Configuration Foundation

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `56cb8e04b3aefdbfe28e41f20794570a61751029`
- **Accepted/final HEAD:** `b451408a57306cdb0c0cd9d4b41f76edd92c9395`
- **Commit:** `feat(core): add configuration foundation`
- **Purpose:** Implement the smallest deterministic, offline configuration boundary needed by later milestones.
- **Major outcomes:** TypeScript package; strict schema version 1; defaults and validation; exactly three configured pools; route/resource, role, Boss-profile, operational-profile, safety, quality, routing, and analytics policy data; migrations; deterministic resolution/serialization; atomic persistence; bounded history; explicit corruption recovery; import/export.
- **Major semantics:** Defaults < global < trusted project < mission precedence; arrays replace unless explicitly keyed; resolved secrets are structurally absent; writes use expected generations and a FIFO same-process mutation queue; load does not silently repair corrupt disk state.
- **Tests/evidence:** Planner-supplied accepted evidence: `41/41 PASS`; typecheck PASS; aggregate check PASS; accepted worktree clean.
- **Important decisions:** ADR-017 adopted a strict standard-library configuration engine with injected storage root and no runtime telemetry sink.
- **Deferred work:** Cross-process locking; guaranteed parent-directory `fsync`; SQLite/runtime portability proof; Pi runtime, 9Router, model manager, TUI, routing, workers, mission state, analytics, and release work.
- **Live environment impact:** Pi configuration unchanged; 9Router not contacted or modified; credentials not accessed; no paid calls.
- **Next authorized milestone:** M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC.

## M2 — 9Router Integration + Selective Model Manager

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `b451408a57306cdb0c0cd9d4b41f76edd92c9395`
- **Accepted/final HEAD:** `43f810cc9c6fbda50abd69b94d5f8aad1597756a`
- **Commit:** `feat(pi): add selective 9Router model manager`
- **Purpose:** Prove catalog discovery, selective route exposure, minimal model management, stable resource identity, and controlled Pi runtime behavior within the authorized M2 boundaries.
- **Major outcomes:** Real Pi extension entrypoint; 9Router client; `SecretResolver` boundary; selective model manager; catalog/runtime separation; provider reconciliation; TUI commands; fake 9Router integration; actual Pi runtime proof.
- **Tests/evidence:** `58/58` tests PASS; typecheck PASS; aggregate check PASS; real Pi fake model-list PASS with `5` expected and `5` exposed routes; real Pi fake completion PASS with `PI_FAKE_9ROUTER_OK`; actual Pi RPC command PASS; zero paid calls.
- **Important decisions:** `ConfigV1` remains schema version 1; gateway config ID is `ninerouter`; Pi provider namespace is `9router`; M2 supports environment `SecretRef` only; cache is bound to the normalized endpoint; an active route cannot be disabled while active; newly discovered models remain disabled; missing models remain configured but unavailable.
- **Deferred work:** M3 pool management; routing/workers; live metadata verification; human keyboard-driven TUI smoke; Keychain support; analytics.
- **Live environment impact:** Pi configuration unchanged; 9Router configuration unchanged; no credentials persisted; Keychain unchanged; no paid calls.
- **Next authorized milestone:** None. M3 requires Planner acceptance of the DOCS-2 handoff.

## M3 — Three Execution Pool Manager

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `9535af998d434fa179781bc350a27fde1201d8e9`
- **Accepted/final HEAD:** `e2efde838d84197f1fbe289e3e8ded090bdd2d87`
- **Commit:** `feat(pools): add execution pool manager`
- **Purpose:** Manage the three canonical pool memberships and list-order priorities as configuration without implementing runtime routing or workers.
- **Major outcomes:** One pool service; add/remove/per-pool-enable/reorder operations; retained disabled/missing memberships; generic Pi-native pool editor; `/orchestrator` pool sections; `/pool-models`; `/pool-status`; actual Pi with fake-gateway proof.
- **Tests/evidence:** `npm install` PASS; typecheck/build PASS; canonical suite `70/70 PASS`; actual Pi `0.84.1` fake-gateway pool command/mutation/reload PASS; M2 provider regression `5/5` routes PASS; package dry-run and diff checks PASS; paid calls `0`.
- **Important decisions:** ConfigV1 stays at version 1; array order is the sole priority; global enabled state, pool membership, and per-pool enabled state remain separate; pool-only edits never reconcile the Pi provider.
- **Deferred work:** M4 routing, eligibility, health, fallback, and diversity; workers/subagents; live 9Router validation; human keyboard-driven TUI smoke unless separately performed.
- **Live environment impact:** Pi configuration unchanged; real 9Router unchanged; credentials and Keychain unchanged; no paid calls.
- **Next authorized milestone at M3 handoff:** M4 — Routing, health, and infrastructure fallback (subsequently authorized; see the appended M4 entry below).

## M4 — Routing + Health + Infrastructure Fallback Engine

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `e01456ed21be345b33176ae49fec365a534e7554`
- **Implementation commit:** `cae53b220e4cb78ec8b1f4f0400c9be4bb5a9697`
- **Accepted evidence HEAD:** `f5e25e21bbebe7995a9cc050efea3ed20d94f18c`
- **Commit:** `feat(routing): add health-aware fallback engine`
- **Purpose:** Add a pure ordered routing preview/decision boundary, explicit infrastructure failure actions, and reload-safe runtime route health without starting execution workers.
- **Major outcomes:** ConfigV1 remains schema version 1; pool array order remains canonical priority; `none`/`prefer`/`require` diversity is explicit; bounded retry/fallback chains stop conservatively for cancellation, invalid request, protocol, and unknown failures; 429 is rate-limited unless explicit quota evidence exists; `HealthStore` persists only sanitized runtime state in atomic `health.json`; health never mutates ConfigStore, history, or export; Routing & Fallback and Health & Quotas host flows plus direct status/settings/health commands are wired through Pi `0.84.1`.
- **Tests/evidence:** `86/86` tests PASS; typecheck/build/aggregate check PASS; fake-clock routing/health tests, corruption/separation tests, fake 9Router, Pi RPC health reset, M2/M3 provider/completion/pool regressions; paid calls `0`.
- **Important decisions:** 9Router account/combo fallback remains opaque; stale last-known-good catalog entries remain usable while missing/unavailable entries do not; health does not reorder pools; cancellation and invalid request do not trigger uncontrolled fallback; no SQLite, analytics, workers, mission state, or model execution in M4.
- **Deferred work:** human keyboard TUI smoke, live 9Router metadata/inference, cross-process runtime locking, workers/subagents, canonical mission state, quality gates, analytics, and M5 execution.
- **Live environment impact:** Pi configuration unchanged; 9Router unchanged; no credentials or Keychain access; fake localhost only; no paid calls.
- **Next authorized milestone at this handoff:** M5 — Routed Subagent Execution. Subsequent M5 implementation and acceptance state are recorded below.

**Correction to the prior M3 handoff:** the attached M4 mission subsequently authorized this implementation. STATE-4 now records M4 as accepted; M3 remains accepted. M5 was later authorized and its implementation and STATE-5 acceptance are recorded below.

## M5 — Routed Subagent Execution

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `e184858c0632881ef2acde33738ce0a08183e168`
- **Implementation commit:** `80b00a65da0a922633d9809b8520983f90038118` — `feat(agents): add routed subagent execution`.
- **Accepted evidence HEAD:** `c2e431aaf3384fc73acb2e7cd6201aa406d5266f`
- **Purpose:** Execute one bounded role/pool/task through M4-selected routes using isolated Pi SDK child sessions.
- **Major outcomes:** Added `src/core/workers` with exact route/model resolution, fresh in-memory child sessions, disabled Pi retries, per-pool tool allowlists, bounded one-shot `submit_agent_result`, tool-side-effect observation, timeout/cancellation cleanup, M4 retry/fallback/health callbacks, mutation-safe fallback, cwd serialization, parent-only `delegate_agent`, and `/subagent-run`.
- **Tests/evidence:** `97/97` tests PASS; typecheck, build, aggregate check, fake 9Router, and isolated Pi `0.84.1` parent→child evidence pass. The parent uses the exact route/model, the child exposes read/submit tools without delegate recursion, and temporary Pi/config/session roots are isolated. Built-in child tool execution, pool-specific allowlists, mutation-safe fallback, timeout/cancellation cleanup, HealthStore feedback, and M2/M3/M4 regressions passed.
- **Important decisions:** ConfigV1 remains version 1; M4 remains routing authority; role does not select model; child sessions do not inherit parent history/extensions/context; implementation mutation blocks automatic fallback; no child run state is persisted.
- **Deferred work:** M6 Context Broker/canonical mission state, Boss scheduling, parallel workers, worktree isolation, quality review, analytics, and live-provider proof.
- **Live environment impact:** Pi configuration unchanged; 9Router unchanged; credentials/Keychain unchanged; fake localhost only; paid calls `0`.
- **Next authorized milestone at this handoff:** M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation. M6 was subsequently accepted by STATE-6; M7 is next planned and not started.

## M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `8695bacab826c9829028c2b9fe97c4aa03285b7f`
- **Implementation commit:** `62282c1618f395b032e359005d018721e2b36868` — `feat(missions): add canonical mission state and context broker`.
- **Accepted evidence HEAD:** `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298`
- **Purpose:** Add the durable mission boundary and deterministic context/packet boundary consumed by future quality/reviewer work.
- **Major outcomes:** Node `node:sqlite` MissionStore with schema metadata, foreign keys, busy timeout, transactional revisions, tasks/attempts, proposed/accepted/rejected evidence, canonical items, event journal, checkpoints, leases, corruption checks, and interrupted-task recovery. ContextBroker emits accepted-only immutable bounded TaskPacketV1 values with deterministic ordering, omission counts, digest, and M5 child-request adaptation. Pi host exposes `/missions`, Context & Mission Settings, packet/task inspection, evidence accept/reject, and manual checkpoint actions while keeping session entries as pointers.
- **Tests/evidence:** Context Broker focused suite `6/6 PASS`; MissionStore focused suite `5/5 PASS`; provider host suite `14/14 PASS`; escalated canonical aggregate suite `111/111 PASS`; `npm run check` PASS; Node `22.23.0` `node:sqlite` PoC PASS; actual Pi `0.84.1` + fake gateway mission task flow passed packet generation, built-in read, proposed evidence, explicit acceptance, future-packet update, restart/resume, interrupted recovery, and MissionStore reopen.
- **Important decisions:** Config schema remains version 1; MissionStore schema is separate; worker results remain proposed until explicit admission; accepted canonical state is the only normal packet input; no transcript is persisted; operational completion is not quality acceptance; M7 quality/reviewer/Boss work is deferred.
- **Deferred work:** Boss/planner runtime, automatic decomposition/scheduling, quality/reviewer loop and gates, parallelism/worktrees, analytics, live-provider validation, and release work.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network were used.
- **Next authorized milestone:** M7 — Verification + Quality Gates + Reviewer Loop + Quality Escalation. Next planned; not started. Do not start M7.

## M7 — Verification + Quality Gates + Reviewer Loop + Quality Escalation

- **Status:** ACCEPTED / PASS
- **Starting HEAD:** `e4014730caf709b2ae2ceae4823583c14c810c1e`
- **Implementation commit:** `db82ac141094db749835a0cc7f1f79dc780005e4` — `feat(quality): add verification gates and bounded review loop`.
- **Accepted evidence HEAD:** `d15dccfd3415e7c705600526a6ef7d634d8c90c5` — `docs(m7): record implementation evidence`; accepted by STATE-7.
- **Purpose:** Add a durable, bounded quality-control boundary above M5 execution and M6 mission state without conflating quality judgment with M4 infrastructure health or canonical evidence.
- **Major outcomes:** Mission DB schema 1→2 migration; durable verification runs, quality decisions/status, mechanical provenance, escalations, interrupted-verification recovery, reviewer diversity, deterministic QualityGate semantics, caller-supplied `submit_verification_result` through M5, explicit quality host commands/history, and bounded verification→repair→re-review orchestration.
- **Tests/evidence:** `121/121` tests PASS; typecheck/build/check PASS; real Pi `0.84.1` + fake gateway `[P][fixture-v1]` reviewer reject→routed repair→re-review pass and MissionStore reopen lineage PASS; paid calls `0`.
- **Important decisions:** Config schema remains version 1; MissionStore quality schema is version 2; quality is separate from execution completion and M4 infrastructure health; quality rejection never updates M4 health or triggers infrastructure fallback; reviewer infrastructure failure still uses M4 health/fallback; reviewer/repair claims remain non-canonical until explicit M6 evidence admission; the quality loop is bounded and preserves immutable historical decisions; quality PASS alone is not Planner acceptance or mission completion.
- **Deferred work:** Boss/planner runtime, analytics, parallel/worktree orchestration, live-provider validation, and release work remain deferred. M8 was subsequently implemented and is pending Planner acceptance.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network were used.
- **Historical acceptance boundary:** At the STATE-7 handoff, M8 implementation was recorded below and remained pending Planner acceptance; STATE-8 later records M8 acceptance.

## M8 — Analytics + Statistics + Cost/Token Accounting + Quality/Value Metrics + Auto-Tuning Recommendations

- **Status:** ACCEPTED / PASS by STATE-8
- **Starting HEAD:** `809394fdbc53c40ca86dbcd6f4dcd37573d5523f`
- **Implementation commit:** `c5f741e65412dc4133e58962c314e2fae82f622e`
- **Accepted evidence HEAD:** `809394fdbc53c40ca86dbcd6f4dcd37573d5523f`
- **Implementation:** separate local AnalyticsStore schema v1, bounded idempotent metadata events, Pi usage/latency fields, summaries, cost provenance, pool-specific recommendations, `/analytics`, and `/recommendations`.
- **Evidence:** `npm test` and `npm run check` `134/134 PASS`; typecheck/build PASS; actual Pi 0.84.1 fake-gateway mission analytics, token provenance/UNKNOWN handling, fallback, quality reject→repair→re-verification, billing migration/persistence, nine detail views, and recommendation controls PASS; paid/live calls `0`.
- **Decisions:** analytics remains separate from MissionStore and HealthStore; ConfigV1 imports migrate sequentially to ConfigV2 reference billing profiles; disabled collection keeps history and rejects new rows; unknown cost is not zero; recommendation generation does not mutate configuration and Apply uses PoolManager with stale protection.
- **Live impact:** no live Pi/provider configuration, credentials, Keychain, paid calls, or external network used.
- **Next at that historical handoff:** M9 was the next milestone; STATE-9 later records its acceptance.

**STATE-8 correction (historical):** M8 is accepted / PASS. At that handoff the analyst milestone and M9 were deferred, and AI-assisted recommendation analysis remained deferred; later entries record their implementation and acceptance without changing STATE-8 acceptance.

## M8.5 — Manual AI Recommendation Analyst

- **Status:** ACCEPTED / PASS by STATE-8.5.
- **Starting HEAD:** `5ba8c5276d1125138ce90ed9cc60021af5bab5bc` (accepted M8 state).
- **Implementation commit:** `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1` — `feat(analytics): add manual AI recommendation analyst`.
- **Accepted evidence HEAD:** `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1`.
- **Implementation:** optional manual-only Recommendation Analyst over deterministic M8 candidates; Verification Pool route selection; bounded analytics packet and structured SUPPORT/OPPOSE/INSUFFICIENT_EVIDENCE result; bounded audit metadata with deterministic input fingerprint and stale detection; no transcript/source/prompt/tool-output/secret persistence; no pool/config mutation or automatic Apply.
- **Host surface:** Statistics & Analytics → Recommendation Analyst and `/recommendation-analyst` with Deterministic only/AI-assisted mode, Verification Pool route selector, Analyze Now, Re-analyze, status, and last-analysis details. Execution is explicit only; no timer or background polling.
- **Evidence:** analyst suite `3/3 PASS`; provider/TUI suite `17/17 PASS`; full `npm test` `141/141 PASS`; typecheck, build, and aggregate check PASS; Pi `0.84.1` + fake-gateway support/oppose/insufficient and infrastructure-failure-preserves-deterministic flows PASS; paid/live calls `0`.
- **Decisions:** deterministic metrics remain authoritative; analyst output is advisory and may disagree; route failures use existing M4/M5 behavior without breaking deterministic recommendations; explicit Apply remains RecommendationApplicationService → PoolManager → ConfigStore; previous analyses remain auditable and stale when fingerprints change.
- **Deferred work:** Boss/planner runtime, scheduled/autonomous tuning, M9, live-provider validation, and release work.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network used.
- **Next at that historical handoff:** M9 was the next milestone; STATE-9 later records its acceptance.

**STATE-8.5 acceptance:** M8.5 is accepted / PASS. The analyst remains optional, manual-only, advisory, Verification-Pool-bound, and unable to mutate deterministic facts or Apply recommendations automatically.

## M9 — Full TUI control center

- **Status:** ACCEPTED / PASS by STATE-9.
- **Starting HEAD:** `20f1854fcc5f0901652ce8ada9918605f912b4a3`.
- **Implementation commit:** `2032a2b` — `feat(tui): add full orchestrator control center`.
- **Purpose:** Unify the accepted M2–M8.5 capabilities behind one keyboard-accessible Pi Control Center without reimplementing domain engines.
- **Major outcomes:** Exact twelve top-level sections in the required order; dashboard-first safe metadata; native TUI/RPC selector navigation; textual loading, error, stale, empty, busy, and deferred states; accepted Models, Pools, Routing, Health, Context/Mission, Analytics, Recommendation Analyst, Budget/Quality, Diagnostics, and ConfigStore backup/history views; direct command compatibility; Boss runtime remains explicitly unimplemented.
- **Tests/evidence:** Focused M9 suite `5/5 PASS`; provider suite `17/17 PASS`; full deterministic/fake/actual-Pi regression suite `146/146 PASS`; `npm run check`, typecheck, build, package dry-run, diff check, secret scan, and project-state consistency PASS. Human keyboard-driven TUI smoke is pending because no authorized interactive keyboard session was available; this remains open validation, not an M9 acceptance blocker. RPC/native selector coverage passed.
- **Important decisions:** The twelve top-level labels are fixed; nested actions reuse existing services; dashboard and diagnostics expose safe metadata only; Backup/Restore uses ConfigStore export/history/restore while MissionStore/AnalyticsStore backup remains explicitly unavailable; M9 adds no autonomous Boss, background worker, or automatic priority mutation.
- **Deferred work:** Human keyboard TUI smoke, Boss/planner runtime, autonomous scheduling/tuning, M10 safety/hardening, packaging, and live-provider validation.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network used.
- **Next authorized milestone:** M10 — Safety and hardening, planned/not started. Do not start M10.

**STATE-9 acceptance:** M9 is accepted / PASS. Accepted implementation commit is `2032a2b`; accepted evidence HEAD is `1200d3349506a1d414def0f3c1e044d712711d9d`. The human keyboard-driven TUI smoke remains pending as an explicitly open validation item; no live or paid environment was used.

## M10 — Safety and hardening

- **Status:** ACCEPTED / PASS by STATE-10.
- **Starting HEAD:** `79ce6728ef068d2ce598dc1fce8e09d594d47323` (STATE-9 accepted baseline).
- **Implementation commit:** `3a6990d` — `feat(safety): harden trust permissions and recovery`.
- **Accepted evidence HEAD:** `13bed07b6cbc7c9a600820b1f39d54400a9828ca` (`docs: record M10 implementation state`).
- **Purpose:** Add the smallest application-level trust, path, command, privacy, locking, lease, integrity, backup/restore, and crash-recovery boundary without claiming an OS sandbox or autonomous approval.
- **Major outcomes:** Separate local TrustStore with untrusted-by-default trust/revoke; canonical PathSafetyPolicy and CommandSafetyPolicy; bounded SecretSanitizer and capability matrix; cross-process ConfigStore lock/re-read CAS; owner-token mission leases and race-safe attempts; validated SQLite MissionStore/AnalyticsStore backup/restore and integrity diagnostics; degraded analytics corruption handling; host Diagnostics and Backup/Restore visibility; Implementation trust gating.
- **Tests/evidence:** Trust/security suite `5/5 PASS`; recovery/lease/backup/fault suite `7/7 PASS`; provider suite `18/18 PASS`; full deterministic/fake/actual-Pi suite `159/159 PASS`; typecheck, build, `npm run check`, package dry-run, diff check, secret scan, and project-state consistency PASS. Human keyboard smoke remains pending because no authorized interactive session was available.
- **Important decisions:** Trust state is local and never portable configuration; policies are application-level and must not be mistaken for kernel isolation; secrets are redacted structurally and by registered value; database restore requires validated SQLite snapshots and explicit operator action; analytics corruption degrades to diagnostics rather than inventing an empty history; M4/M5 routing and M6/M7 state remain authoritative.
- **Deferred work:** Human keyboard TUI smoke, OS sandboxing, Boss/planner runtime, autonomous scheduling/tuning, parallel/worktree orchestration, live-provider validation, packaging, and release work.
- **Live environment impact:** No live Pi configuration, 9Router deployment, credentials, Keychain, paid calls, or external network were used.
- **Next authorized milestone at this historical STATE-10 handoff:** M11 — Packaging, release, and dogfooding. It was subsequently implemented and remains pending Planner acceptance.

**STATE-10 acceptance:** M10 is accepted / PASS. The Planner accepted the local trust, path/command, privacy, concurrency, integrity, backup/restore, and fault-recovery evidence above. Human keyboard-driven TUI smoke remains an explicitly open validation item; it is not an M10 acceptance blocker. No live or paid environment was used.

## M11 — Packaging, release, and dogfooding

- **Status:** IMPLEMENTED BUT NOT ACCEPTED.
- **Implementation commit:** `4cebcce` — `feat(release): package and validate release candidate`.
- **Purpose:** Package the compiled extension as a reproducible local Pi `pi-package` release candidate with an explicit entrypoint, strict allowlist, artifact verification, compatibility/install/upgrade/rollback/rescue procedures, staged dogfooding, and an independent-review bundle.
- **Major outcomes:** Version `0.1.0-rc.1`; Pi `0.84.1` peer compatibility; no runtime npm dependencies; package Diagnostics exposes version/schema metadata; release workflow emits checksum, file list, machine-readable manifest, unpacked source-independent entrypoint checks, and `EXTERNAL_REVIEW_PENDING` review material.
- **Tests/evidence:** The prior `161/161` candidate record and direct-`.tgz` install claim were superseded by Review #1. R2 now records `163/163 PASS`, release-candidate subtests `4/4 PASS`, typecheck/build/check/package dry-run, diff/secret/state checks PASS, and a fresh `0.1.0-rc.1` artifact of 103 files/155072 bytes with SHA-256 `48bd2762e3396eb1b274e8b2bff756ef6d107fa2ca6b89e3980c9c0e35679005`; manifest `dirty: false`, Pi `0.84.1`, schemas `2/2/1`, live calls `0`. The checksum-derived directory-source Pi harness passed all-twelve Control Center, Diagnostics/dashboard, baseline upgrade, rollback, rescue, and state-hash preservation; direct `.tgz` remains unsupported. No real-route smoke was authorized.
- **Important decisions:** A local RC is not a public release. No npm publish, GitHub release, tag, remote, live Pi settings, credentials, or paid inference is allowed. Pi core remains a peer dependency, and no lifecycle script or bundled runtime state is added.
- **Deferred work:** Independent external review, authorized real-route smoke, human keyboard smoke when available, Planner acceptance, and any public publication gates.
- **Next authorized milestone:** None is recorded after M11 in the current roadmap; do not start a new milestone.

### M11-R2 — independent release-review remediation (complete; external review pending)

- **Status:** M11 remains IMPLEMENTED BUT NOT ACCEPTED; independent Review #1 result was FAIL, and R2 remediation evidence is PASS. A new independent clean-context Review #2 is still required.
- **Correction:** Pi `0.84.1` does not support `pi install <artifact>.tgz`; the supported local RC source is a checksum-verified fresh directory extracted from that exact immutable artifact. The source checkout is not an install source.
- **Remediation scope:** fresh ignored-`dist` replacement/build provenance, stale runtime milestone projection, stronger secret/private-key/path/runtime-state scanning, self-contained artifact/checksum/review evidence, deterministic bundle verification, and reproducible upgrade/rollback/rescue harnesses.
- **Evidence:** Corrective commits are `82fa48b` and `5cdc305`. The self-contained bundle includes the exact artifact/checksum, artifact-derived directory source, `test-evidence.json` (`163/163`, check/package PASS), `pi-install-evidence.json` (Pi `0.84.1`, all-twelve/dashboard/Diagnostics, install/remove/reinstall, upgrade/rollback hashes, rescue, UNTRUSTED default), and `REVIEW_EVIDENCE.json` with `EXTERNAL_REVIEW_PENDING`.
- **Boundary:** no real-route smoke, publication, tag, push, live Pi configuration, credentials, or paid inference. Planner acceptance remains open pending a new independent clean-context M11 review.

### M11-R4 — release provenance and integrated worker safety remediation

- **Status:** IMPLEMENTED / REMEDIATED; M11 remains NOT ACCEPTED.
- **Implementation commits:** `50ee46f` — `fix(safety): enforce worker tool safety at execution`; `55a15cc` — `fix(release): bind rc evidence to trusted provenance`.
- **Purpose:** Close Independent Review #2 findings without changing M10 acceptance: enforce M10 path/command/trust policy at the real Pi child-session tool boundary, prevent role/profile tool expansion, bind release evidence to trusted executables and clean source/build identity, strengthen privacy/symlink checks, use the real M10 baseline, preserve seeded state, and exercise extension-independent rescue.
- **Evidence:** local `0.1.0-rc.2`; exact artifact checksum/source/build identities in the generated release manifest; `165/165 PASS`; release-candidate `4/4 PASS`; typecheck/build/check/package dry-run/diff/secret/state checks PASS; Pi `0.84.1` directory-source install, all twelve Control Center sections, trusted M10 baseline upgrade/rollback, seeded Config/Mission/Analytics/Trust preservation, broken-candidate rescue, clean privacy report, and self-contained bundle verification PASS.
- **Release provenance:** manifest records clean Git commit/tree, source digest, build digest, trusted Node/npm/Pi identities, artifact file records, checksum, and machine-neutral evidence. A fake `PATH` executable cannot supply release totals or Pi identity.
- **Boundary:** no real-route smoke, publication, tag, push, live Pi configuration, credentials, or paid inference. Review bundle status remains `EXTERNAL_REVIEW_PENDING`; human keyboard smoke and Planner acceptance remain open.

### M11-R6 — close custom worker-tool bypass and build rc.3

- **Status:** IMPLEMENTED / REMEDIATED; M11 remains NOT ACCEPTED.
- **Starting HEAD:** `6e4498c6e4c0b64b1d02f4a167438e2856904bfb`.
- **Trigger:** Independent Review #3 reproduced a HIGH-severity Pi `0.84.1` bypass in which a caller-supplied `submit_evil` result-tool handler mutated a fixture while project trust was false.
- **Remediation:** Replace caller-supplied executable child result tools with declarative, bounded capture-only protocol specifications. M5 owns protocol-tool construction; protocol execution validates and captures in memory only. Guarded capabilities and protocol submissions have explicit classifications; unknown tools and collisions fail closed. Existing agent, verification, repair, and recommendation protocols retain their bounded schemas and duplicate handling.
- **Implementation commits:** `e9aab31` (`fix(safety): close custom worker tool bypass`), `6d438a9` (`fix(release): bind rc3 safety evidence`), and `e6b9807` (`fix(release): guard RPC teardown writes`).
- **Release evidence:** Version `0.1.0-rc.3` was the local R6 candidate. Its clean release pipeline passed `169/169`, actual Pi `0.84.1` `submit_evil` regression, provenance/privacy, M10 compatibility upgrade/rollback, broken-candidate rescue, and self-contained `EXTERNAL_REVIEW_PENDING` bundle verification outside the checkout; External Review #4 subsequently rejected its release-evidence integrity.
- **Boundary:** no live route, provider call, publication, tag, push, live Pi configuration, credentials, or paid inference. Stage 3 remains NOT AUTHORIZED / NOT PERFORMED; next required action is a clean-parent plus clean-reviewer External Review #4.

### M11-R8 — harden release evidence integrity and build rc.4

- **Status:** IMPLEMENTED / REMEDIATED; M11 remains NOT ACCEPTED. External Review #4 result was FAIL; rc.3 is rejected and External Review #5 is next.
- **Starting HEAD:** `2277cec7bdec9a694121c781f9c36811651df694`.
- **Implementation commits:** `9c5b29e` (`fix(release): harden evidence integrity and source provenance`) and `ae39f24` (`fix(release): build rc4 candidate`).
- **Remediation:** release source and the independent `npm run check` now come from a detached exact-Git staging checkout; test scripts/results and trusted Node/npm/TypeScript/Pi identities are bound to the source; zero/forged totals fail; assignment/JSON private paths are detected; artifacts and bundles reject all symlinks; every bundle file is recursively hashed and checked against an explicitly supplied external root digest; M10 state is created/read with M10 modules and candidate state with rc.4 modules; semantic equality/data-loss results are observed; actual `pi list` package identity/version/source is asserted.
- **Evidence:** local `0.1.0-rc.4`; build commit `ae39f24937988ef95975b2b45c018f4c45efd23c`; source digest `b91432b23b9fa44b3f1e750ff852ca78369f4f3d4808242841124364a510868b`; artifact SHA-256 `a1e14c83da374c5f6a1b849c589feb444002d46e8a0634c0bbd5d520a539572b`; independent `169/169 PASS`; mandatory attacks `20/20 PASS`; deterministic second build SHA equal; Pi `0.84.1` directory-source install, `/orchestrator`, Diagnostics, twelve sections, authentic M10 upgrade/rollback, non-empty Config/Mission/Analytics/Trust equality, broken-candidate rescue, privacy, and worker-safety regression PASS.
- **Boundary:** fake gateway and temporary roots only; live calls `0`, paid inference `0`; no real-route smoke, publication, tag, push, live Pi configuration, or credentials. Stage 3 is NOT AUTHORIZED / NOT PERFORMED; Stage 4 remains pending.

### M11-R9/R10/R11 — autonomous Stage 3 closeout and RC.7

- **Status:** IMPLEMENTED BUT NOT ACCEPTED; autonomous Stage 3 closeout PASS.
- **Starting HEAD:** `e536045b2c74dcd233ebba484574a65a8d3ccdde` (RC.6).
- **Production source commit:** `d460319040a66a43016912034a9284225cc3d5a5` (`Fix verification result schema contract`); the source-bound final release verification ran at `c177c2d70639c8fcfe5780a356c6b439bbc2f1fe` after the docs-only closeout commit.
- **Purpose:** Resolve the real-route M7 blocker while preserving fail-closed safety, then establish a defensible real-route compatibility conclusion.
- **Production changes:** RC.5 removed non-executable `bash` from Verification visibility; RC.6 made M7 finalization atomic, normalized criteria, and preserved reviewer route diversity; RC.7 aligned nested `submit_verification_result` schema requirements with the strict parser and stated the exact payload contract in the reviewer prompt.
- **Offline evidence:** RC.7 release verification passed `174/174` tests, `20/20` integrity attacks, typecheck/build, Pi `0.84.1` compatibility/install/rollback/rescue, worker safety, privacy, provenance, artifact SHA-256 `3411e8bdbb5ab90769db32f30d4b0962a2fdefd47f22fd31d58d02716df6ff19`, and external bundle root `67706649266b09907c2a263fcd6556c3ed428b77a0455bc04db2227690509acf`.
- **Real-route evidence:** historical Investigation PASS `9router/cx/gpt-5.6-luna`; historical Implementation PASS `9router/ag/claude-opus-4-6-thinking`; RC.7 M7 Verification PASS on explicit `9router/ag/claude-opus-4-6-thinking` with 3 provider requests, valid structured submission, M7 decision `pass`, and no mutation. Tabi became schema-valid but rejected after reporting one failed exploratory mechanical check. DeepSeek Flash stopped at the explicit 8-request cap without submission. Prior DeepSeek Pro and cx/gpt-5.6-sol compatibility remain unproven.
- **Safety and boundary:** fallback, retry, repair, analyst, and hidden inference were disabled; credentials remained in-memory only; main Pi config, models/auth files, fixtures, and source repository were unchanged by real-route runs. M11 remains local, not accepted, not production-ready, and unpublished; Planner/External Review #5 and Stage 4 human/manual dogfood remain separate gates.

### M11 Stage 4A — autonomous Computer-Use dogfood and final M7 evidence closeout

- **Status:** IMPLEMENTED BUT NOT ACCEPTED; Stage 4A autonomous closeout PASS.
- **Starting/final HEAD:** RC.8 was already installed from clean tracked commit `aa622eef7256b447b456699dd80e10697fe94dc5`; no production source change was needed. The documentation closeout is the only change in this entry.
- **Purpose:** Prove the real product path end to end after the earlier non-M7 dogfood blocker: normal Mission creation, Task creation, real Implementation execution, and normal M7 Verification with durable structured quality evidence.
- **Major outcomes:** In a disposable Stage 4A root, Mission `mission-049cbd67-01d6-40bf-a103-3c31267d71ec` and Task `task-e44240e9-a662-45fc-9a48-2e7c9dab31e1` were created through the visible Pi TUI. Implementation attempt `attempt-8c6df7fb-68c9-471b-9246-33e038af3a34` completed on the explicit `ag/claude-opus-4-6-thinking` route and created the requested deterministic JSON fixture. Normal Verify then completed verification `verification-a4855595-3a1f-4d10-925c-d30d523d98eb` and persisted pass decision `decision-e87d80b4-8654-4368-86af-987465bbe521`.
- **Tests/evidence:** RC.8 manifest evidence remains `175/175 PASS`, `20/20` integrity attacks, artifact SHA-256 `8fd4b233f7ee3d22ac0ac5703078ab165b55ba11a3978ae94a1f21039b746f28`; deterministic fixture validation passed; MissionStore showed one succeeded attempt, one completed verification, one pass decision, zero escalations; visible task detail/Quality history/Diagnostics reflected the same state.
- **Important decisions:** No source repair or RC.9 was justified. Trust, WorkerToolSafetyGuard, protected-path/command policy, Verification read-only tool filtering, bounded structured submission, and M7 persistence were preserved. The route result is scoped to the explicitly tested `9router/ag/claude-opus-4-6-thinking` path.
- **Deferred work:** final human keyboard sanity smoke, fully independent External Review #5, Planner acceptance, and any publication.
- **Live environment impact:** Two bounded real provider requests were made through Termius/Pi using the disposable root; during dogfood no live Pi configuration, source code, personal files, credentials, Keychain, 9Router configuration, tag, remote, npm publication, or GitHub release was modified. The only post-run change is this tracked documentation closeout.
- **Next authorized milestone:** Human sanity and independent acceptance gates only; do not publish or claim M11 accepted without those gates.

- **Milestone:**
- **Status:** PLANNED / IN PROGRESS / IMPLEMENTED BUT NOT ACCEPTED / ACCEPTED / RELEASED / DEPRECATED
- **Starting HEAD:**
- **Accepted/final HEAD:**
- **Commit:**
- **Purpose:**
- **Major outcomes:**
- **Tests/evidence:**
- **Important decisions:**
- **Deferred work:**
- **Live environment impact:**
- **Next authorized milestone:**

## Future milestone entry template
