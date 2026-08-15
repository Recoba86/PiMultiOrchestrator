# Current project state

Last updated: 2026-08-15

Read this first for a fast operational snapshot. Git and verification evidence take precedence if this file is stale; see [Project state policy](PROJECT_STATE_POLICY.md).

## Identity

| Field | Current value |
|---|---|
| Product | Pi Multi-Orchestrator |
| Repository | `PiMultiOrchestrator` |
| Development phase | M10 remains the latest accepted development milestone; RC25 is the public Operational Boss prerelease, and it is not stable/production-ready |
| Last accepted milestone | M10 — Safety and hardening |
| Accepted M7 implementation commit | `db82ac141094db749835a0cc7f1f79dc780005e4` |
| Accepted M7 evidence HEAD | `d15dccfd3415e7c705600526a6ef7d634d8c90c5` |
| Accepted M8 implementation commit | `c5f741e65412dc4133e58962c314e2fae82f622e` |
| Accepted M8 evidence HEAD | `809394fdbc53c40ca86dbcd6f4dcd37573d5523f` |
| Accepted M8.5 implementation commit | `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1` |
| Accepted M8.5 evidence HEAD | `28b75bebb4c3fabd48d5c4ab6d3f37376b6c01d1` |
| Accepted M9 implementation commit | `2032a2b` — `feat(tui): add full orchestrator control center` |
| Accepted M9 evidence HEAD | `1200d3349506a1d414def0f3c1e044d712711d9d` |
| M10 implementation commit | `3a6990d` — `feat(safety): harden trust permissions and recovery` |
| M10 evidence | `159/159 PASS`; typecheck/build/check/package/diff/secret validation PASS |
| Accepted M10 evidence HEAD | `13bed07b6cbc7c9a600820b1f39d54400a9828ca` |
| M12.2 candidate | `0.1.0-rc.11` — local, not public; implementation commit `8219c083577bc21a31046ade4ee1f982fe28abc6`; RC.10 superseded |
| M12.3 candidate | `0.1.0-rc.12` — historical local candidate; superseded by RC13 |
| M12 final candidate | `0.1.0-rc.17` — public prerelease; exact artifact and bundle identity are bound by the detached verifier |
| RC17 final Planner attempt | 2026-08-15 — PASS after the bounded reviewer-handoff repair; source-bound artifact is public as a prerelease |
| RC18 compatibility repair | Local source repair at `0af7b8e`; package manifest remains `0.1.0-rc.17`; no package rebuild/release or publication is claimed |
| RC19 release | `0.1.0-rc.19` — public prerelease; commit `717a20413fc22f7ca7fde8df8a841ebde05b0f1a`, tag `v0.1.0-rc.19`, artifact SHA-256 `338d466a2308711e2c6befc838a29b77e6c1a5d1574350441bf9b5f46845a88e` |
| RC20 release | `0.1.0-rc.20` — prior public prerelease; source commit `8bcb4a61796623ea09bd1ed09c411656bd657138`, tag `v0.1.0-rc.20`, artifact SHA-256 `556de8db9bb661e3f82f47badd2b93f68b3145e29b056b6abc29bea15efda9bc` |
| RC21 release | `0.1.0-rc.21` — public prerelease; source commit `68c0c0f82c5c82d7944512ea64aadd05a2e4569e`, tag `v0.1.0-rc.21`, artifact SHA-256 `67e5fe663bc8ec05d3f02ec1183841552b3e70b13fd92901962fddbef8b6a266` |
| RC22 local candidate | `0.1.0-rc.22` — canonical model selector presentation; source commit `288c77cfac92dc7ffa8a0f0b16a69d140ada3aea`, artifact SHA-256 `7d9b9451d1c2590d5b2632b6dd7aadd250bd2851af8dd79d79c25113693dbdea`; local only, not published |
| RC25 release | `0.1.0-rc.25` — source commit `52b665f6ace6eec078cbe8a28c35cce36a9cb045`, tag `v0.1.0-rc.25`, artifact SHA-256 `32a8a9f1f968ff4bacf38385afd52869c4c793480e63f4335507ffd11a2a7ec5`; public prerelease |
| RC24 release line | `0.1.0-rc.24` — Model Router enablement status checkboxes layered over canonical rows; superseded public prerelease |
| M12 RC15 historical candidate | `0.1.0-rc.15` — local, superseded by RC16 repairs |
| M12 RC13 historical candidate | `0.1.0-rc.13` — local, superseded by RC15 and RC16 repairs |
| M12.1 historical candidate | `0.1.0-rc.9` — local, not public; explicit native Mission entry |
| M11 candidate | `0.1.0-rc.8` — historical local candidate; not public |
| M11-R2 historical candidate | `0.1.0-rc.1`, SHA-256 `48bd2762e3396eb1b274e8b2bff756ef6d107fa2ca6b89e3980c9c0e35679005`; rejected by Independent Review #2 for provenance, privacy, rescue, and integrated-worker safety gaps |
| M11-R4 historical release evidence | rc.2 artifact and `165/165 PASS`; rejected by Independent Review #3 for the custom-tool bypass |
| M11-R6 historical release evidence | rc.3 safety/remediation, release, compatibility, rescue, privacy, provenance, and bundle verification PASS; rejected by External Review #4 for release-evidence integrity defects |
| M11-R8 release evidence | rc.4 exact-Git build/test provenance, authentic M10 compatibility, privacy/no-symlink enforcement, `20/20` adversarial rejection, deterministic rebuild, and externally anchored recursive bundle verification PASS; External Review #5 pending |
| M11-R9/R10/R11 closeout evidence | rc.7; exact-Git `174/174 PASS`, `20/20` integrity attacks, artifact/review-bundle identity PASS, and real Stage 3 PASS on explicit supported routes; M11 acceptance remains pending |
| M11 Stage 4A closeout evidence | rc.8; exact-Git `175/175 PASS`, `20/20` integrity attacks, artifact SHA-256 `8fd4b233f7ee3d22ac0ac5703078ab165b55ba11a3978ae94a1f21039b746f28`, and autonomous Computer-Use real-route Implementation + M7 Verification PASS; human sanity and M11 acceptance remain pending |
| Configuration schema | Version 2 current; Version 1 imports migrate sequentially |
| Most recently validated Pi | `@earendil-works/pi-coding-agent@0.84.1` (`pi --version` `0.84.1`) |
| Most recently validated Node.js | `v22.23.0` |

## Development status

| Milestone | State |
|---|---|
| M0 — Specification Freeze | ACCEPTED / PASS |
| M1 — Configuration Foundation | ACCEPTED / PASS |
| M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC | ACCEPTED / PASS |
| M3 — Three Execution Pool Manager + Ordered Route Priorities + TUI Pool Editor | ACCEPTED / PASS |
| M4 — Routing + Health + Infrastructure Fallback Engine | ACCEPTED / PASS |
| M5 — Routed Subagent Execution | ACCEPTED / PASS |
| M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation | ACCEPTED / PASS |
| M7 — Quality Gates, Review, and Escalation | ACCEPTED / PASS |
| M8 — Analytics + Statistics + Cost/Token Accounting + Quality/Value Metrics + Auto-Tuning Recommendations | ACCEPTED / PASS |
| M8.5 — Manual AI Recommendation Analyst | ACCEPTED / PASS |
| M9 — Full TUI control center | ACCEPTED / PASS |
| M10 — Safety and hardening | ACCEPTED / PASS |
| M11 — Packaging, release, and dogfooding | IMPLEMENTED BUT NOT ACCEPTED |
| M12 — Smart Mission Entry, Hybrid Routing & Routing Memory | COMPLETE / LOCAL PLANNER ACCEPTANCE PASS; not public or production-ready |
| M12.1 — Frictionless Mission Entry | COMPLETE / LOCAL PASS; not accepted or public |
| M12.2 — Hybrid Smart Router | COMPLETE / LOCAL PASS; not accepted or public |
| M12.3 — Adaptive Routing Memory | COMPLETE / LOCAL PASS; not accepted or public |
| M12 Final Gate — Routing Dogfood | COMPLETE / LOCAL PLANNER ACCEPTANCE PASS; not public or production-ready |
| RC18 — Real-world Pi/9Router compatibility repair | IMPLEMENTED / LOCAL DOGFOOD PASS; not a package release or acceptance promotion |
| RC22 — Canonical model selector presentation | IMPLEMENTED / LOCAL CANDIDATE; exact detached verification PASS; not accepted or public |
| RC25 — Operational Boss / Orchestrator | PUBLIC PRERELEASE / RELEASE CLOSURE PASS; not stable or production-ready |
| RC24 — Model Router enablement hotfix | IMPLEMENTED / PRIOR PUBLIC PRERELEASE; superseded by the RC25 release candidate |

## RC25 public prerelease closure

- **Package identity:** `pi-multi-orchestrator@0.1.0-rc.25`, source commit
  `52b665f6ace6eec078cbe8a28c35cce36a9cb045`, tag `v0.1.0-rc.25`, and frozen
  artifact SHA-256
  `32a8a9f1f968ff4bacf38385afd52869c4c793480e63f4335507ffd11a2a7ec5`.
- **Repository verification:** `npm run check` passed `263/263` across 14
  suites; detached release verification passed with `20/20` integrity attacks,
  Pi `0.84.1`, and the same artifact hash. The verifier-only compatibility
  repair is `7406c3a`; it is outside the package allowlist.
- **Public registry:** version exists, `next=0.1.0-rc.25`,
  `latest=0.1.0-rc.17`; the public tarball SHA-256 and SHA-512 integrity match
  the frozen artifact and registry metadata.
- **Public Pi:** isolated fresh install and RC24→RC25 upgrade from npm both
  passed Pi `0.84.1` offline RPC loading, `@orchestrator`, all 12 Control
  Center sections, Diagnostics, package identity, and untrusted-by-default
  behavior. No live Pi configuration, credentials, or provider/model calls
  were used.
- **GitHub:** [v0.1.0-rc.25](https://github.com/Recoba86/PiMultiOrchestrator/releases/tag/v0.1.0-rc.25)
  is a non-draft prerelease carrying the exact artifact and checksum.

## RC18 real-world Pi/9Router compatibility repair

- **Date/status:** 2026-08-15; source repair complete and locally dogfooded. This
  is an RC18 repair gate, not a new package version: `package.json` remains
  `0.1.0-rc.17`, and no npm publication, tag, push, or release artifact was
  performed.
- **Root causes:** the RC17 host registered a two-model PMO projection before
  inspecting Pi's existing `9router` provider, and Pi `0.84.1` replaces a
  provider's model list when `models` is supplied. Reconcile/dispose also had
  no ownership distinction. The catalog parser accepted the old array schema
  but ignored current object-shaped capability metadata and the projection
  hard-coded `reasoning: false`.
- **Architecture:** the host now performs a credential-blind, offline probe of
  the existing Pi `models.json` provider catalog before factory registration,
  confirms the bound `ctx.modelRegistry` at `session_start`, and tracks
  `unknown`/`external`/`owned` state. An existing `9router` catalog is never
  replaced or unregistered; only a provider registered by this host may be
  updated or removed. Standalone PMO registration and `--list-models` remain
  available when the namespace is absent. Current and legacy catalog aliases
  now preserve reasoning, vision/input, context, max-output, and bounded
  tools/search/audio/video/thinking metadata in the domain/cache layer without
  changing `ConfigV1`.
- **Offline evidence:** implementation/test commit `0af7b8e`; focused parser,
  manager, and host suites passed; production build passed; `npm run check`
  passed `234/234` tests across 13 suites with zero failed/cancelled/skipped/
  todo; `git diff --check` passed.
- **Runtime evidence:** with the existing Pi model/auth configuration left
  untouched and only PMO/session state copied to a disposable root, baseline
  `pi --offline --no-extensions --list-models 9router` and the explicit local
  `dist/host/pi-extension.js` load both exited 0, listed 27 `9router` models,
  and matched exactly. The bounded RPC load also exited 0. No refresh, model
  request, credential display, or live Pi configuration mutation occurred.
- **Known boundary:** Pi `0.84.1` exposes no ownership token. The factory probe
  covers user `models.json` state and the session-bound registry confirms the
  actual runtime; a provider dynamically created by another extension after
  both observations remains outside the public API's provable ownership model.

### Future requirement — Dynamic Route Catalog & Capability Sync

**PLANNED / NOT IMPLEMENTED.** Future work must provide manual **Refresh Now**,
configurable periodic sync, catalog/capability diffing, per-route capability
views, provenance, last-known-good snapshots, stale indicators, safe user
overrides, and a clear distinction between provider-advertised capabilities and
empirically observed capabilities. RC18 does not implement this requirement.

## RC25 — Operational Boss / Orchestrator candidate

- **Status:** `IMPLEMENTED / RELEASE CANDIDATE`; RC24 remains the prior public
  prerelease until RC25 release closure. RC25 is not stable or
  production-ready.
- **Configuration:** Boss profiles retain additive RC24 `routeIds` compatibility
  and now persist multiple route entries with enablement, Thinking Effort,
  integer weights, and weighted scheduling. The Control Center uses canonical
  model labels and shows route IDs only through Inspect.
- **Mission runtime:** explicit `@orchestrator <goal>` and Smart Routing
  Run-as-Mission/AUTO_MISSION share one bounded canonical goal loop. Weighted
  Boss assignment happens once per Mission and is persisted/pinned through
  planning, worker dispatch, repair/replan cycles, M7 interpretation, and the
  final decision. Only infrastructure failure can select an unused configured
  fallback; quality rejection never rotates the Boss.
- **Evidence:** focused RC25 tests cover additive migration, 5/3/2 weighted
  routes, reject→repair→M7 pass, pinned assignment, fallback pinning without
  reusing failed routes, UI presentation, Mission analytics persistence with
  observed usage, and manual-only Boss recommendations. Full release and
  public registry/Pi evidence remain pending.
- **Boundary:** no source checkout claim is a public release until the exact
  artifact is frozen, published under `next`, registry/GitHub/Pi checks pass,
  and the final release report is recorded.

## RC22 — Canonical model selector presentation

- **Status:** `IMPLEMENTED / LOCAL CANDIDATE`; package
  `pi-multi-orchestrator@0.1.0-rc.22`. RC21 remains the public npm/GitHub
  prerelease; RC22 is not stable or production-ready.
- **Implementation:** one shared canonical model-option presentation helper is
  used by the Model Router, Investigation/Implementation/Verification Pool
  editors and Add Route flows, Route Health, Smart Routing Primary/Fallback,
  and Recommendation Analyst. Normal rows show the remote model ID once;
  duplicate visible names receive deterministic `#1`/`#2` suffixes while
  preserving distinct internal route values. Inspect and diagnostics retain
  exact route IDs for identity and troubleshooting.
- **Release identity:** code commit
  `288c77cfac92dc7ffa8a0f0b16a69d140ada3aea`, tree
  `6bf89664015cee47c5ee2e98692666c94e030384`, source digest
  `fc06fa0e39d4ba7cf139a37ccd97d2d5a558dafc48fc844b077c2a85eade52e7`,
  artifact `pi-multi-orchestrator-0.1.0-rc.22.tgz`, artifact SHA-256
  `7d9b9451d1c2590d5b2632b6dd7aadd250bd2851af8dd79d79c25113693dbdea`, and
  independent bundle-root SHA-256
  `a81f34cf41709de5ebef4fe8e1733e883be8e5849dd7f371dc34070bff6170c3`.
- **Verification:** exact detached release verification passed `250/250`
  tests across 13 suites, typecheck/build, `20/20` integrity attacks, and
  worker-safety checks. The isolated Pi install evidence is bound to Pi
  `0.84.1` and reports RC22 installed and verified; live calls and paid
  inference were both zero.
- **Boundary:** the artifact was frozen from the code commit above and pushed
  to `origin/main`. No npm publication, immutable tag, GitHub release, live
  Pi configuration, provider account, credential store, or model request was
  performed. This documentation update is a separate state-record commit and
  does not rebuild or repack the artifact.

## RC21 — Model Router dogfood repair

- **Status:** `PUBLISHED / PRERELEASE`; RC21 is public on npm and GitHub with
  `next`, not stable or production-ready. `latest` remains `0.1.0-rc.17`.
- **Release identity:** package `pi-multi-orchestrator@0.1.0-rc.21`, source
  commit `68c0c0f82c5c82d7944512ea64aadd05a2e4569e`, tree
  `9baab4eb7d51c4598b8ea3aa4d5b12e9e2479512`, tag `v0.1.0-rc.21`, artifact
  SHA-256 `67e5fe663bc8ec05d3f02ec1183841552b3e70b13fd92901962fddbef8b6a266`,
  and independent bundle-root SHA-256
  `7e2fd35553fd46f232d5f8e286ef272c1c8a2d018037c0b6b3763e4fab89c017`.
- **Implementation:** nested `CatalogRow.entry` metadata survives host
  normalization; Pool Thinking Effort remains true/false/unknown without
  fabricated capabilities; static external Pi providers use transient Pi auth
  for bounded upstream `GET /v1/models`; LKG, PMO state, and external provider
  ownership remain intact; populated picker rows hide internal route IDs while
  Inspect/Diagnostics retain them.
- **Verification:** clean `npm run check` passed `246/246` tests across 13
  suites with zero failed/cancelled/skipped/todo; typecheck/build passed;
  `20/20` release-integrity attacks passed; the exact registry tarball is
  byte-identical to the frozen artifact. Public install in disposable Pi
  `0.84.2` loaded RC21 from npm, registered the Model Router commands, and
  completed offline `/9router-status` and `/9router-refresh`; refresh emitted
  the expected start and safe unconfigured/LKG failure feedback without a
  provider call.
- **Boundary:** no live Pi configuration, provider catalog, credential store,
  or model request was modified/performed. The docs follow-up is separate from
  the immutable artifact commit and did not rebuild or repack it.

## RC20 — Thinking-aware Pool routing and live catalog refresh

- **Status:** `PUBLISHED / PRERELEASE`; RC20 is public on npm and GitHub, not
  stable or production-ready. The later RC17 publication checkpoint currently
  points npm `next` to RC17.
- **Thinking Effort:** each Pool route entry stores `auto`, `low`, `medium`,
  `high`, `xhigh`, or `max` when the route advertises that level. Auto omits
  the Pi override and is not Off. Legacy missing fields migrate to Auto at the
  ConfigStore write boundary; explicit stale values become unavailable rather
  than being silently downgraded. Attempts and analytics keep requested and
  observed effective effort separate.
- **Model Router:** discovered catalog rows, PMO enablement, Pool membership,
  and external Pi provider ownership remain separate. Refresh Models reads the
  authoritative PMO-owned or external-Pi source, reports added/removed/changed
  entries, preserves last-known-good data on failure, excludes disabled routes
  from Add Model, and retains missing Pool routes/order/effort.
- **Release identity:** source commit `8bcb4a61796623ea09bd1ed09c411656bd657138`,
  tree `8c995d342fd95b1294be5066615bb8269b635617`, source digest
  `32ff52f43ea808d48bab62cb54033e5e1e6a43af454e6388d4b7dcb7ca005252`, build
  digest `40032ddcb65a8878c8339a8cbe405c3b6cf54411ebcd3011aba72221b7bd1055`,
  tag `v0.1.0-rc.20`, and artifact SHA-256
  `556de8db9bb661e3f82f47badd2b93f68b3145e29b056b6abc29bea15efda9bc`.
- **Release evidence:** clean `npm run check` passed `242/242`; independent
  release verification passed Pi `0.84.1`, privacy/worker-safety checks, and
  `20/20` integrity attacks. At RC20 publication, npm `next` pointed to RC20
  and `latest` was RC17; the later RC17 checkpoint intentionally repointed
  only `next` to RC17. The public registry tarball matches the local artifact
  byte-for-byte. GitHub release `v0.1.0-rc.20` is a prerelease.
- **Boundary:** no periodic automatic sync or Benchmark Lab is included. The
  final live check was read-only/offline with 27 catalog rows and temporary
  PMO/session roots; no live Pi configuration, provider account, credential,
  refresh, or model request was modified/performed.

## RC19 — Pi 9Router onboarding and adoption

- **Status:** PUBLISHED / PRERELEASE; package version `0.1.0-rc.19` is public on
  npm under `next` and is not stable or production-ready.
- **Existing-provider path:** after `session_start`, PMO reads Pi's public
  `9router` provider catalog through `getModels()`, adopts the bounded visible
  model metadata, and never registers, replaces, or unregisters an external
  provider. Enabling an adopted model creates only PMO route/config state; it
  does not copy a credential or auto-assign a pool.
- **First-run path:** with no provider, Models & 9Router offers a TUI-only
  masked API-key component and explicit `Test & Save`. The key is tested before
  persistence, then stored through Pi's auth API; PMO stores only the fixed
  `pi-auth` reference. RPC setup fails closed because its installed Pi `0.84.1`
  contract has no sensitive-input field.
- **Compatibility boundary:** provider registration omits `apiKey` for Pi-auth
  references so Pi resolves the stored credential rather than treating a
  placeholder as a literal key. External refresh uses Pi's registry refresh;
  PMO refresh remains the path for PMO-owned/env-backed configuration.
- **Evidence:** the full clean gate passed `237/237` tests across 13 suites with
  zero failed/cancelled/skipped/todo; typecheck and build passed; isolated
  project-Pi `0.84.1` dogfood matched 27/27 existing `9router` rows; and the
  public npm-installed extension matched the same 27/27 rows. No live Pi
  credential or configuration was changed.
- **Release identity:** commit `717a20413fc22f7ca7fde8df8a841ebde05b0f1a`,
  tag `v0.1.0-rc.19`, package `pi-multi-orchestrator@0.1.0-rc.19`, and artifact
  SHA-256 `338d466a2308711e2c6befc838a29b77e6c1a5d1574350441bf9b5f46845a88e`.
  The GitHub release is explicitly a prerelease. The downloaded registry
  tarball is byte-identical to the accepted local artifact.
- **Registry boundary:** npm `next` points to `0.1.0-rc.19`; npm `latest`
  remains `0.1.0-rc.17`. A clean public npm installation reports the exact
  package name and version.

## RC17 public prerelease publication

- **Status:** `PUBLISHED / PRERELEASE`; RC17 is public for dogfooding only. It is
  not stable or production-ready, and RC18 is not included in this artifact.
- **Identity:** source commit `5def791b31a7ad940ed87f6e720aabb0228500e7`, tag
  `v0.1.0-rc.17`, package `pi-multi-orchestrator@0.1.0-rc.17`, and artifact
  SHA-256 `2a9343de7b456840ebdd596ef14c674a51abdad65e3e840b6a29b760e9aa5b62`.
- **Registry proof:** the npm tarball and GitHub release tarball were fetched
  independently and were byte-identical with the accepted SHA-256. npm
  `next` points to `0.1.0-rc.17`.
- **Tag/release proof:** the remote tag peels to `5def791b31a7ad940ed87f6e720aabb0228500e7`, and GitHub marks the release as a prerelease with the accepted artifact and manifest assets.
- **Latest boundary:** `latest` was observed as `0.1.0-rc.17` before and after
  this checkpoint. The exact RC17 version and bytes were already present in the
  public registry, so no republish or repack was performed; the authenticated
  interactive npm flow moved only `next` from RC20 to RC17.

## RC17 final Planner/manual acceptance — PASS

- **Terminal status:** `PMO_FINAL_PLANNER_ACCEPTANCE_PASS`. RC17 supersedes the
  RC16 live M7 block after a source-bound reviewer-handoff repair; the candidate
  is now the public prerelease recorded above, not a production installation.
  M10 remains the latest accepted development milestone.
- **Source and release identity:** source commit `5def791b31a7ad940ed87f6e720aabb0228500e7`, tree `c23424f26600e988e6d96cbd794a0d22cc121ecd`, source digest `04935d63c419c56c4c9b92214abf06d4151bfe13ebc7a255b08475895c7d7f2c`, build digest `aaefde527e8f18a6accbd1dc79e9fffb87ae0f6df832c876911a4cd509373b58`, artifact SHA-256 `2a9343de7b456840ebdd596ef14c674a51abdad65e3e840b6a29b760e9aa5b62`, and independently verified bundle-root SHA-256 `f5f58cdf255580b4cdd772b0b5885fde531232fc4130b7e352972fe7be9b9bcf`.
- **Offline/release gates:** clean `npm run check` passed `231/231` tests across 13 suites with zero failed/cancelled/skipped/todo; typecheck/build passed; the detached release verifier and independent review passed Pi `0.84.1` compatibility/install/upgrade/rollback/rescue, privacy, worker safety, and `20/20` integrity attacks.
- **Live canonical Mission:** Mission `mission-b5a2cc76-d2b1-41d4-9c31-a922e7727d53`, Task `task-2b48f5e6-d3d2-4282-8318-6259a1a4e399`, and Implementation attempt `attempt-783ba966-d696-4dfd-9230-f7094c8bedae` completed on `r9-ninerouter-ag-claude-opus-4-6-think-fe2f756e1d848cbb05ca` / `ag/claude-opus-4-6-thinking`. The disposable project contained only its README and exact `rc17-smoke.json` content `{"status":"ok","candidate":"rc17"}`.
- **Live M7:** Verification `verification-f5ea93ba-deea-41c3-a6ae-8c9d009102a4` used reviewer run `run-msthhb41-1`; the ag Verification Pool route captured one valid submission, and decision `decision-30772023-ebec-4ce9-a2cf-ba90e4e191c1` was `pass` at round 0. All four criteria were satisfied; mechanical `ls`/`read` checks passed; reviewer mutation was false; no fallback, repair, escalation, or quality blocker occurred.
- **Technical TUI and boundary:** isolated offline Pi `0.84.1` RPC passed the dashboard, Routing & Fallback, Context & Mission Settings → Missions, Back navigation, and clean exit without credential text. No live Pi configuration, provider account, Keychain value, public tag, push, npm publication, GitHub release, or production installation was modified. Disposable evidence paths are intentionally omitted.

## RC16 final external-review candidate — historical, superseded by RC17

- **Status:** final external review PASS on the exact detached local candidate;
  M10 remains the latest accepted milestone. The 2026-08-15 final Planner/manual
  acceptance attempt is HARD-BLOCKED at live canonical M7 structured-result
  submission. RC16 is not accepted, public, or production-ready.
- **Implementation:** explicit-entry failure now preserves the original prompt;
  canonical Mission completion is Boss-only and requires completed/passed M7
  evidence; verification, evidence, escalation, and backup rows are bound to
  their Mission/task identity.
- **Recovery and safety:** corrupt Smart Routing and Routing Memory state can
  be repaired, zero-width Unicode cannot bypass NORMAL safety, local routing
  input is bounded before analysis, direct worker timeouts cannot exceed the
  configured ceiling, and release builds use a validated TypeScript launcher.
- **Validation:** clean `npm run check` passed `231/231` tests across 13
  suites with zero failed/cancelled/skipped/todo; typecheck and build passed.
  The fresh detached release verifier and independently anchored review bundle
  passed.
- **Exact identity:** source commit `1ffcbed8d776c4d0379a6bf7f832967fae7dbb99`,
  tree `0e7e01ff02abf269891fc55556d57e64d5a1f111`, source digest
  `7dd0e1c84ad6e980a19269eafddf1f1501cc1aa1f9cf330afca172584daa1b87`,
  build digest `3c7cc151497cb596fe01fe1075d97e3534d418707b250e9bd8edd3b655a5a756`,
  artifact SHA-256 `72073e109df5a0d6b6e0f4be9f825932a768791d0752976c99aabc83eb4bcd7a`,
  and independently verified bundle-root SHA-256
  `6414f090c54caf4004fe62a6d51fe4e9d0df562b662a7091c9f68767901bb675`.
- **Evidence paths:** release directory and review bundle were disposable
  temporary outputs; their exact paths are intentionally omitted from tracked
  documentation.
- **Boundary:** no live Pi configuration, provider account, credential,
  public tag, push, npm publication, or GitHub release was modified.

## RC16 final Planner/manual acceptance attempt — historical HARD BLOCK

- **Date and authority:** 2026-08-15 autonomous final-acceptance mission; this
  record is the Planner handoff result for the requested scope. No source or
  package files changed. The immutable RC16 evidence remains bound to source
  commit `1ffcbed8d776c4d0379a6bf7f832967fae7dbb99`, not the docs-only handoff
  HEAD `23fe5c49bbd134bd97e60abf0434d365bb521db6`.
- **Offline gates:** current `npm run check` passed `231/231` across 13 suites
  with zero failed/cancelled/skipped/todo; typecheck and build passed. The
  detached RC16 verifier, artifact SHA-256
  `72073e109df5a0d6b6e0f4be9f825932a768791d0752976c99aabc83eb4bcd7a`, and
  independently verified bundle root
  `6414f090c54caf4004fe62a6d51fe4e9d0df562b662a7091c9f68767901bb675` remain
  valid.
- **Live AI Triage:** PASS in a disposable triage root: one captured
  ambiguous case produced a structured fallback recommendation after two
  bounded real-provider calls at a temporary 256-token cap; no credential was
  displayed and no prompt/provider response was persisted.
- **Live canonical Mission:** disposable canonical-smoke root; Mission
  `mission-c40f24a2-9b39-4340-9495-ca016d938eec`, Task
  `task-f6914ed1-61fc-4c48-8026-28b46379e029`. The single configured
  Implementation/Verification route was
  `r9-ninerouter-ag-claude-opus-4-6-think-fe2f756e1d848cbb05ca`, with no
  fallback route shopping. The Implementation run
  `attempt-d3a6e6a0-d4e1-4681-888e-ea4c1753d210` succeeded and created exactly
  `rc16-smoke.json` with `{"status":"ok","candidate":"rc16"}`; the
  disposable project contained only its pre-existing README and that file.
- **M7 blocker:** Verification runs
  `verification-030da271-4533-4c90-9eb4-cbeaba21d736` and
  `verification-c5245893-ec10-407c-861f-12c6be9e516c` both used the same
  already-proven reviewer route, at temporary 1,024- and 2,048-token caps,
  and both stopped before a valid `submit_verification_result` capture. Both
  were `blocked`, `potentialMutationObserved=false`, and produced no quality
  decision. This is a current route/protocol compatibility blocker; no source
  defect was established and no alternate route was tested.
- **Technical TUI:** PASS in isolated offline Pi `0.84.1` RPC: launch/main
  surface, nested Control Center, Routing & Fallback → Smart Routing settings,
  Context & Mission Settings → Missions, Back navigation, clean exit, and no
  credential display.
- **Disposition:** M12 remains in progress and M10 remains the latest accepted
  milestone. RC16 is technically verified locally but not Planner-accepted;
  publication, tagging, pushing, npm/GitHub release, production installation,
  and live configuration mutation were not performed. Application safety
  remains an application-level policy, not an OS/kernel sandbox.

## RC15 historical final external-review candidate

- **Status:** historical final external review PASS on the exact detached local
  candidate; RC16 supersedes it. M10 remains the latest accepted milestone.
- **Source-review baseline:** commit `3101fd7` closes the residual worker
  safety paths for shell expansion, recursive built-in reads, npm lifecycle
  commands, and Git content inspection. Recursive reads scan bounded
  descendants and reject credential-like paths and symlinks.
- **Local validation:** focused worker-safety tests `7/7 PASS`; clean-checkout
  full suite `227/227 PASS` across 13 suites; zero failed/cancelled/skipped/
  todo; typecheck and build PASS. No live Pi configuration, provider account,
  credential, public tag, push, npm publication, or GitHub release was
  modified.
- **Release boundary:** the detached verifier bound the exact candidate and
  passed. Planner/manual acceptance, publication, and production gates remain
  separate and require authorization.

## M12.3 current implementation

- Routing Memory is a versioned `routing-memory.json` sidecar with bounded
  history and abstract signatures only: language, task family, project scope,
  structural work flags, deliverable count, roles, and risk. It stores no
  prompt, transcript, source text, tool result, provider response, or secret.
- Explicit `Always orchestrate similar tasks` creates one canonical Mission
  and a durable explicit Mission rule. Repeated `Run as Mission` or `Run
  Normally` choices learn only after three consistent observations; learned
  rules carry source, confidence, observations, and enabled state.
- Matching is bilingual and cross-language, conservative around lexical-only
  overlap, conflicts, high-risk changes, and materially more complex current
  work. Explicit rules outrank learned rules; explicit `@orchestrator` remains
  first; strong memory hits bypass unnecessary AI Triage. Conflicts return to
  user choice and learned Normal cannot suppress a materially escalated task.
- Routing & Fallback contains Smart Routing, Routing Memory, Auto-Learn, and
  Learned Behaviors controls. The user can inspect abstract metadata, enable or
  disable a rule, delete a rule, forget learned rules, reset all memory, and
  create/restore validated abstract-only backups. Disabling retains state.
- Local evidence: analytics `9/9`, Routing Memory `14/14`, Smart Router `13/13`,
  provider host `25/25`, and isolated Pi `0.84.1` M12.3 RPC/TUI dogfood `1/1`
  pass (`61/61` focused tests). The real
  disposable run created first Mission
  `mission-dbf51b4d-e375-4d78-86d6-fd85360a20f0`, follow-up Mission
  `mission-ff22dc19-3b6e-4f2a-ac88-89a4fb5c70f2`, and explicit rule
  `rm-2440fb64-ab9f-4415-8ce7-4a204436caaf`; the run verified cross-language
  auto-routing, disable, restart persistence, abstract-only storage, and zero
  provider calls. The detached RC.12 verifier passed `212/212` tests, `20/20`
  integrity attacks, Pi `0.84.1` install/upgrade/rollback/rescue, privacy, and
  worker safety; artifact SHA-256 is
  `84cabb6553a5599d548be15646c92fc872c6010778e4eaeda2e05c63a158dc30`,
  source tree is `7f795881954033d75618a57e9dba30b9b0314dc2`, source digest is
  `4d417b1360cbb9b3a8a9e6f529470cf85f24bcbc37194f802d3c4b276f6ce8fd`, and
  review-bundle root SHA-256 is
  `69e55e37731c44d6540950056664e729fa56b7898eccadc8b417669cc1327ce8`.
  Focused review of this historical RC12 source found no unresolved
  blocker/high. RC16 supersedes that candidate and its verifier; the M12 Final
  Routing Gate remains local evidence; RC16 detached verification passes. Planner/manual
  acceptance and publication remain separate.
- No live Pi configuration, provider account, credential, public tag, push,
  npm publication, or GitHub release was modified. M10 remains the latest
  accepted milestone; M12.3 and the M12 final gate remain local-only pending
  Planner/manual acceptance and publication gates. RC15 external review is
  historical and RC16 detached verification passes.

## M12 Final Routing Gate — historical RC13 local pass; superseded by RC16

- This section preserves RC13 evidence only; RC16 is the current exact local
  candidate and detached external-review result passes.
- **Candidate/source:** RC13 `0.1.0-rc.13`, source commit
  `8d8e36a9526c6edd106d36fa8cb5069cda517405`; worktree clean after the
  documentation closeout. M10 remains the latest accepted milestone.
- **Deterministic coverage:** balanced English/Persian/mixed corpus of `360`
  cases (`120` simple, `120` complex, `120` ambiguous), with zero
  misclassifications; bounded adversarial inputs were `13/13` exception-free.
  Analyzer latency probe was sub-3 ms maximum over the corpus.
- **Isolated Pi/TUI-equivalent path:** current Pi `0.84.1` RPC/PTY proof passed
  explicit entry, normal-input isolation, Smart Routing recommendation,
  Routing Memory persistence/disable/restart, and the composed Smart-routed
  Mission → Task → Run → M7 lifecycle. The composed M7 proof uses a local
  FakeNineRouter fixture; it is not claimed as current live-provider M7.
- **Current live 9Router dogfood:** ten disposable-root ambiguous sessions
  completed without child failure: `20` bounded triage calls, `7` suggestions,
  `3` normal decisions, `9` capability-only fallback successes, and one
  timeout degradation. Routing durations were approximately `6.3–10.7 s`;
  telemetry inspection was allowlisted and contained no raw prompts. A
  Primary-only probe degraded without invoking fallback when no Fallback was
  configured. Credentials were resolved in process memory only.
- **Safety/release:** TrustStore, WorkerToolSafetyGuard, protected paths,
  direct-worker/M7 distinction, backup/restore/corruption/migration, and stale
  route handling passed their focused suites. `npm run check` passed `214/214`
  tests; the detached RC13 verifier passed `20/20` integrity attacks, privacy,
  worker safety, and Pi `0.84.1` install/upgrade/rollback/rescue.
- **Release identity:** artifact `pi-multi-orchestrator-0.1.0-rc.13.tgz`,
  SHA-256 `abbfaf8580008a5f2d297a28a49fe3a0c962b1f3c512944b9f680c74e630085b`;
  source tree `d5d06e16e4a2266d9b04d3afd79c6dd181df9345`; source digest
  `0c5d0b49a2c637b592e039b31548bd549e31eee5c0854c20487a74324185d074`;
  review-bundle root `f3183574deed6dc96e6a15953a5949bdbb4858f34a9a26b5378437a81ca7075c`.
- **Historical boundary:** focused review found no unresolved blocker/high.
  At the time of RC13, External Review #5 remained
  `EXTERNAL_REVIEW_PENDING`; RC16 supersedes that pending state and passes detached
  verification. Planner/manual
  acceptance, publication, tags, push, and live Pi configuration changes remain
  outside this local pass.

## M12.2 current implementation

- Smart Routing runs on ordinary native Pi input after the explicit M12.1
  `@orchestrator <goal>` bypass. Clear explanations/questions and narrow
  one-step changes continue as `NORMAL`; clear multi-stage work produces a
  one-shot Mission-or-normal choice.
- The local analyzer is deterministic, bilingual (English/Persian/mixed), and
  uses structural signals for repository scope, mutation, investigation,
  multi-step work, tests, independent verification, audit/review,
  release/deployment, sensitive changes, multiple roles, and research plus
  implementation. Length alone is not a routing rule.
- Ambiguous prompts use AI Triage only when enabled with an available Primary
  route. The response is strict `{recommendedMode, confidence, reasons}` JSON;
  a configured Fallback is used only for capability failure. Low confidence,
  unavailable routes, malformed responses, timeout, auth, quota, and transport
  failures degrade to the user-choice recommendation without dropping the
  original prompt.
- Settings are stored in versioned `smart-routing.json` plus bounded history,
  separate from the legacy ConfigV1 route envelope. The existing twelve-section
  Control Center remains unchanged; Smart Routing appears inside Routing &
  Fallback. Stale route IDs remain visible and do not silently remap.
- Routing telemetry is bounded metadata only: decision, local path, reason
  codes, triage call/fallback counts, selected stable route ID, action, and
  failure class. No raw prompt, transcript, tool output, provider response, or
  credential is persisted.
- Local evidence: focused Smart Router `9/9`, provider host `24/24`, analyst
  `4/4`, Control Center `6/6`, isolated Pi `0.84.1` TUI normal/no-banner and
  complex/banner/Mission flows, full `npm run check` `190/190`, detached release
  verification `190/190`, release-integrity attacks `20/20`, and Pi release
  install/rollback evidence PASS. The bounded live audit also passed English
  and Persian ambiguous triage, fallback success, and both-route-unavailable
  degradation in disposable roots. RC.11 artifact SHA-256 is
  `17e9feb871708ff08312bc27ab56cf0b35ce2cf47669b69db31fda7c6a396b74`; review
  bundle root SHA-256 is
  `2e514696b113a4728d2f3b47a392b84255c9cdb7e29f50260640ea6f759ec3f7`.
  No live Pi configuration or provider account was modified; M12.2 remains
  local-only and unpublished.

## M12.1 current implementation

- Pi `0.84.1` native `input` events recognize an explicit `@orchestrator <goal>` entry; ordinary input continues unchanged.
- The entry and `/orchestrator` → Context & Mission Settings → Create mission menu call the shared `createCanonicalMission` operation and persist through the real MissionStore.
- Empty entry is handled with `Add a goal after @orchestrator.`; no empty Mission is written. Direct Workers are labeled separately from canonical Mission/M7 verification.
- No routing memory was included in M12.2. M12.2 Smart Routing is documented above; M12.3 Adaptive Routing Memory is documented separately above.
- Local evidence: typecheck/build/check and the full `231/231` test suite passed; RC16 detached release verification passed with `20/20` integrity evidence. The bundle marker remains `EXTERNAL_REVIEW_PENDING` by design even after its root was independently checked.
- Offline Pi `0.84.1` TUI evidence used disposable roots: English Mission `mission-68626594-683d-4b3a-a273-b9e1a9b83df5`, Persian Mission `mission-40224d4f-55d5-4cb6-9cad-0fe7c8eca6ea`, empty warning, ordinary-input isolation, `/missions` persistence, and Control Center `Direct Workers`/Back navigation all passed. No live provider, credential, or user Pi configuration was used.
- M10 remains the latest accepted milestone. RC16 is local-only; Planner acceptance, human/manual acceptance, and publication remain separate gates. The RC13 local final-gate live triage was performed only in disposable roots.

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

M3 adds accepted, configuration-only pool management:

- exactly three canonical Investigation, Implementation, and Verification pools;
- ConfigStore-backed add/remove membership and independent per-pool enable state;
- ordered route priorities with move-up, move-down, and arbitrary-index reorder;
- exact ordering persistence, history, and serialized same-process mutations;
- cross-pool membership without deduplication;
- retained globally disabled, missing, stale, and provider-unavailable memberships;
- distinct same-model routes preserved by stable route identity;
- one Pi-native editor reused by all three `/orchestrator` pool sections;
- `/pool-models` and `/pool-status`; and
- actual Pi/fake-gateway pool mutation, reload, and provider-regression proof.

These capabilities do not implement runtime routing, worker execution, or full multi-agent orchestration. Pool order is configuration priority only.

## M4 accepted capabilities

M4 adds the accepted pure, non-executing routing boundary and runtime health state:

- deterministic ordered eligibility and preview selection for the three pools;
- explicit `none`, `prefer`, and `require` diversity inputs with no model-name inference;
- bounded same-route retry, fallback, cancellation/invalid-request stop semantics, and loop-free attempt chains;
- structured quota, rate-limit, authentication, timeout, transport, provider/model, protocol, cancellation, and unknown failure classes;
- injectable `HealthStore` runtime JSON with atomic persistence, cooldown/retry-after, circuit state, success recovery, corruption quarantine, and manual reset;
- `/routing-status`, `/route-health`, and `/routing-settings`, plus Routing & Fallback and Health & Quotas sections in `/orchestrator`;
- fake-clock deterministic tests and isolated Pi `0.84.1` fake-gateway RPC/reset evidence.

M4 does not implement actual child/subagent execution, Boss runtime, Task Packet or Context Broker runtime, canonical mission state, quality review/escalation, analytics, auto-tuning, or full cost/budget-aware routing. It does not persist health in ConfigStore/export/history or reconstruct opaque 9Router account/combo fallback.

## M5 accepted capabilities

M5 adds direct Pi `0.84.1` SDK child-session execution with exact M4-selected route/model pinning, fresh isolated in-memory sessions, no automatic parent-history copy, and parent-only `delegate_agent` plus `/subagent-run`. Child recursion is prevented. Investigation, Implementation, and Verification use explicit profiles: Investigation and Verification have no edit/write tools; Implementation may use edit/write/bash. Each child receives one bounded `submit_agent_result`; missing or invalid results are not accepted. Tool calls are observed, potential mutations are detected, and safe infrastructure retry/fallback is available before mutation. Read-only fallback is supported; edit/write/bash failure stops automatic fallback, with bash treated conservatively. External cancellation aborts without fallback, timeout handling is bounded, cleanup is deterministic, HealthStore receives success/failure feedback, and mutating runs serialize per cwd. The actual Pi parent → delegate tool → routed child proof passed. Boss/planner runtime, automatic role generation, parallel subagents, worktree isolation, analytics, and auto-tuning remain deferred; M6 mission/context and M7 quality capabilities are recorded below.

## M6 accepted capabilities

M6 adds durable Canonical Mission State in a separate versioned SQLite MissionStore behind an adapter; its Mission DB schema is independent from ConfigStore. It stores missions, tasks/runs, evidence, canonical items, checkpoints, events, revisions, and conflict protection independently from ConfigStore, HealthStore, and Pi session history. Worker output enters as proposed evidence; explicit accept/reject controls canonical promotion and provenance, while ingestion preserves route/run/packet provenance. The deterministic ContextBroker admits accepted state only by default and emits immutable, bounded TaskPacketV1 values with SHA-256 digests, mission-revision lineage, and omitted-item counts. M5 consumes packet-derived context; mutation-risk recovery does not auto-rerun, and operational completion remains distinct from quality acceptance. Mission Control exposes `/missions`, Context & Mission Settings, packet/task inspection, evidence/checkpoint actions, restart/resume, and interrupted-task recovery while Pi session entries remain pointers only.

M6 does not implement Boss/planner runtime, automatic decomposition or scheduling, parallel workers, worktree isolation, analytics, or auto-tuning. M7 quality state and reviewer/repair boundary are recorded below.

## M7 accepted capabilities

M7 adds a separate MissionStore schema v2 quality layer with transactional v1→v2 migration, durable verification runs, immutable QualityDecision history, task quality status separate from execution and M4 infrastructure health, bounded structured reviewer results, criterion-level mechanical evidence/provenance, deterministic QualityGate `PASS`/`REJECT`/`BLOCKED` outcomes, reviewer route-diversity preference, and durable `QualityEscalationRequest` records. Verification Pool reviewers execute through M4→M5; quality rejection does not penalize implementation-route health, while reviewer infrastructure failure still uses M4 health/fallback. The bounded repair/re-review loop applies implementation-route exclusion where required, enforces a maximum round count, preserves round/packet provenance and immutable history, and survives MissionStore reopen/restart. Re-verification creates new immutable history rather than rewriting prior decisions. Mission Control exposes quality-status UI/RPC, history, and confirmation-gated Verify/Re-verify/quality-loop actions; quality results remain non-canonical until explicit M6 evidence admission. Quality PASS alone is not Planner/product milestone acceptance.

| M7 implementation evidence | Result |
|---|---|
| QualityGate, structured-result, service, migration, worker-protocol, host, and Pi quality-loop suites | `121/121 PASS` |
| Typecheck and build | PASS |
| Mission DB v1→v2 fixture migration and reopen | PASS |
| Actual Pi/fake quality reviewer loop | `[P][fixture-v1] PASS` — reviewer reject → routed repair → re-review pass; durable lineage reopened |
| Planner acceptance / STATE-7 | ACCEPTED / PASS |
| Paid calls / live environment changes | `0` / NONE |

| M6 accepted evidence | Result |
|---|---|
| Context Broker focused tests | `6/6 PASS` |
| MissionStore focused tests | `5/5 PASS` |
| Host/provider focused tests | `14/14 PASS` |
| Full deterministic/fake/actual-Pi regression suite | `111/111 PASS` |
| Typecheck and build | PASS |
| Dedicated Pi/fake mission task execution, evidence admission, and reopen/resume flow | `[P][fixture-v1] PASS` — real Pi 0.84.1, fake SSE/tool flow, proposed→accepted evidence, reopened MissionStore |
| Paid calls / live environment changes | `0` / NONE |

| M5 accepted evidence | Result |
|---|---|
| Full deterministic, fake integration, and actual Pi suite | `97/97 PASS` |
| Typecheck, build, and aggregate check | PASS |
| Actual Pi `0.84.1` fake parent→child flow | PASS — exact parent/child model, child read + submit tools, no delegate recursion |
| Exact M4 route/model pinning, tool profiles, mutation-safe fallback, timeout/cancellation cleanup, HealthStore feedback, M2/M3/M4 regressions | PASS |
| Paid calls / live environment changes | `0` / NONE |

| M3 acceptance evidence | Result |
|---|---|
| Deterministic, fake integration, and actual Pi suite | `70/70 PASS` |
| Typecheck and build | PASS |
| Actual Pi pool editor over RPC | PASS — add, reorder, status, save, reload |
| M2 provider regression after pool edit | PASS — expected fake routes: `5`; Pi exposed: `5` |
| Paid calls / live environment changes | `0` / NONE |

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

### MissionStore runtime compatibility

The Node `node:sqlite` API is experimental; the adapter boundary isolates that compatibility risk from the rest of the product.

### Human TUI smoke

Automated Pi-native dialog callback and RPC tests passed for the M2 model manager and M3 pool editor. Authorized autonomous Computer-Use dogfood of the RC.8 TUI and canonical Mission → Task → Implementation → M7 Verification flow passed on 2026-08-14. M12.1's isolated offline Pi `0.84.1` TUI check also passed on 2026-08-14; the Computer Use connector could not target Terminal, so the same disposable PTY flow was used without live state. A final human keyboard sanity smoke has not yet been performed and remains explicit open validation.

M12.2's isolated offline Pi `0.84.1` PTY check passed on 2026-08-14: a clear
explanation reached the editor with no recommendation banner, and a complex
implementation request showed the recommendation and created exactly one
canonical Mission with the exact goal. Live ambiguous triage and real fallback
were not called because no secure 9Router route/credential was available.

### Deferred capabilities

- Boss/planner runtime;
- automatic broad mission decomposition and task scheduling;
- general role generation;
- parallel workers and worktree isolation/fan-out;
- autonomous/scheduled tuning and autonomous priority mutation;
- automatic pool reordering and budget-aware routing;
- public publication, tag, and GitHub release;
- Keychain credential adapter.

## Next milestone rule

M6 is accepted by STATE-6, M7 is accepted by STATE-7, M8 is accepted by STATE-8, M8.5 is accepted by STATE-8.5, M9 is accepted by STATE-9, and M10 is accepted by STATE-10. M11 is implemented but not accepted; Planner review and the release gates below remain open.

## M8 implementation snapshot

M8 is accepted by STATE-8. It adds a separate local AnalyticsStore with idempotent telemetry and restart dedupe; route, pool, mission, fallback, and quality statistics; actual Pi token provenance with UNKNOWN preservation; ConfigV1→V2 billing/reference profiles; cost provenance, fixed-point reference estimates, and multi-currency safety; Quality/Value metrics with insufficient-data behavior; deterministic recommendations; explicit Details/Ignore/Apply; stale recommendation protection; no automatic priority mutation; and Apply through PoolManager with ConfigStore history. Analytics remains disabled by default and prompts, transcripts, tool arguments, source, headers, and secrets are not persisted.

| M8 accepted evidence | Result |
|---|---|
| Full deterministic, fake integration, and actual Pi suite | `134/134 PASS` |
| Typecheck, build, and aggregate check | PASS |
| Actual Pi 0.84.1 fake-gateway mission→analytics, token provenance, fallback, quality reject→repair→re-verification | PASS |
| Restart dedupe and ConfigV1→V2 billing-profile migration/persistence | PASS |
| Nine analytics detail views | PASS |
| Recommendation Details/Ignore/Apply/stale protection; PoolManager + ConfigStore history; automatic Apply | PASS / NO |
| Paid calls / live environment changes | `0` / NONE |

## M8.5 accepted capability snapshot

M8.5 is accepted by STATE-8.5. It adds an optional, manual-only Recommendation Analyst over the deterministic M8 candidate: the analyst is selected only from enabled Verification Pool routes, uses no hard-coded model, receives a bounded analytics-only packet with no source/transcript/secret input, returns one bounded SUPPORT/OPPOSE/INSUFFICIENT_EVIDENCE result, and cannot change metrics, pools, ConfigStore, or Apply state. Results persist only bounded audit metadata and become stale when the deterministic input fingerprint changes. The Statistics & Analytics → Recommendation Analyst UI exposes Deterministic only/AI-assisted mode, route selection, Analyze Now, Re-analyze, status, and last-analysis details; there is no periodic or background execution. Analyst infrastructure failure leaves the deterministic recommendation usable, and explicit Apply remains the existing RecommendationApplicationService → PoolManager → ConfigStore path. No AI transcript/source/prompt/tool output/secret is persisted.

| M8.5 implementation evidence | Result |
|---|---|
| Analyst protocol, bounds, verdicts, privacy, stale detection | `3/3 PASS` focused analyst suite |
| Host/TUI/RPC Recommendation Analyst surface | `17/17 PASS` focused provider suite |
| Pi 0.84.1 + fake-gateway manual analyst flow and M8 regressions | `141/141 PASS` full suite; fake support/oppose/insufficient and failure-preserves-deterministic flows PASS |
| Typecheck, build, aggregate check, and diff check | PASS |
| Planner acceptance / STATE-8.5 | ACCEPTED / PASS |
| Paid calls / live environment changes | `0` / NONE |

## M9 accepted capability snapshot

M9 adds the unified `/orchestrator` Control Center with exactly twelve top-level sections: Models & 9Router; Investigation Pool; Implementation Pool; Verification Pool; Boss / Orchestrator Profiles; Routing & Fallback; Health & Quotas; Budget / Quality Profiles; Context & Mission Settings; Statistics & Analytics; Diagnostics; and Backup / Restore. It provides a dashboard-first home, consistent keyboard/native TUI and RPC navigation, textual loading/error/stale/empty states, model and pool management, routing/health controls, mission/quality workflows, analytics/recommendations/Recommendation Analyst views, diagnostics, and safe ConfigStore backup/restore controls. Live operational status is visible without normal log inspection, and the Operator Guide documents the surface. Boss runtime, autonomous mission decomposition/scheduling, parallel workers/worktree isolation, and automatic recommendation Apply remain deferred. M10 hardening is recorded in the implementation snapshot below. Human keyboard-driven TUI smoke remains open validation, not an M9 acceptance blocker.

| M9 accepted evidence | Result |
|---|---|
| Exact twelve-section Control Center and dashboard contract | `5/5 PASS` focused M9 suite |
| Existing host/provider regressions | `17/17 PASS` focused provider suite |
| Full deterministic, fake integration, and actual Pi regression suite | `146/146 PASS`; `npm run check` PASS |
| Typecheck, build, and diff check | PASS |
| Human keyboard-driven TUI smoke | PENDING — no authorized interactive keyboard session in this run; RPC/native selector coverage passed |
| Planner acceptance / STATE-9 | ACCEPTED / PASS |
| Paid calls / live environment changes | `0` / NONE |

## M10 accepted capability snapshot

M10 implements a conservative application-level safety and recovery boundary without claiming an OS sandbox. A separate local TrustStore defaults projects to untrusted and supports explicit trust/revoke; trust is not portable configuration. Central PathSafetyPolicy and CommandSafetyPolicy canonicalize workspace paths, protect credentials and runtime databases, detect symlink/traversal escapes, classify destructive or ambiguous commands, and require review or block before mutation. Existing M5 tool profiles remain the upper permission bound; the capability matrix makes Investigation/Verification read-only while Implementation mutation requires trust. SecretSanitizer redacts resolved values and sensitive structures before diagnostics/errors or persistence.

Config mutations now use a cross-process lock and reread-under-lock CAS path. Mission leases have owner tokens, expiry/renewal/non-owner checks, and race-safe active-attempt guards. MissionStore and AnalyticsStore provide validated SQLite-native backup/restore and integrity diagnostics; corrupt AnalyticsStore state degrades to diagnostics rather than silently becoming empty data. Fault injection and adversarial policy tests cover crash/recovery, privacy, protected paths, and import/backup boundaries.

| M10 implementation evidence | Result |
|---|---|
| Trust, path/command policy, sanitizer, and capability tests | `5/5 PASS` |
| Lease, cross-process config, backup/restore, corruption, and fault tests | `7/7 PASS` |
| Provider/host regression suite | `18/18 PASS` |
| Full deterministic/fake/actual-Pi regression suite | `159/159 PASS` |
| Typecheck, build, aggregate check, package dry-run, diff check, secret scan | PASS |
| Human keyboard-driven TUI smoke | PENDING — no authorized interactive session; automated native/RPC coverage remains PASS |
| Implementation commit | `3a6990d` — `feat(safety): harden trust permissions and recovery` |
| Planner acceptance / STATE-10 | ACCEPTED / PASS |
| Paid calls / live environment changes | `0` / NONE |

M10 does not provide kernel/OS sandboxing, autonomous approval, automatic rerun after mutation-risk failure, or live-provider verification. Review #2 found that the accepted M10 evidence did not exercise policy at the integrated real worker tool boundary; M11-R4 adds that pre-tool enforcement without changing M10's accepted status. Human keyboard-driven TUI smoke remains open validation and is not an M10 acceptance blocker. M11 is implemented but not accepted and is not production-ready.

## M11 implementation snapshot — acceptance pending

M11 packages the compiled Pi extension as local release candidate
`0.1.0-rc.4` using Pi's `pi-package` manifest and explicit
`dist/host/pi-extension.js` entrypoint. The allowlist contains compiled
JavaScript/declarations, README, and the small operator guide; runtime
databases, sessions, source checkout paths, `.git`, dependencies, and secrets
are excluded. Pi remains a peer dependency and the package has no runtime npm
dependencies. The candidate workflow creates a detached staging checkout from
exact clean Git content, builds there with bound tool identities and
repository-defined scripts, emits an immutable `.tgz` plus checksum, copies an
exact artifact-derived `directory-source/`, and verifies the unpacked
entrypoint, privacy boundary, source-map policy, file records, and absence of
symlinks.

Pi `0.84.1` does not support installing a local `.tgz` directly. The supported
RC workflow is checksum verification, fresh extraction, and `pi install
<directory-source> --no-approve` in isolated roots; the source checkout is
never installed. `run-release-verification.mjs` records actual check/test
evidence, Pi startup/Diagnostics/all-twelve-section results, remove/reinstall,
M10 compatibility-baseline upgrade, rollback, state hashes, and rescue in a
self-contained review bundle. R8 evidence is complete: the artifact-derived
directory-source workflow passed on Pi `0.84.1`, the actual Pi `submit_evil`
regression passed, and the full release/compatibility/rescue workflow passed
with `169/169` tests plus `20/20` integrity attacks rejected. Direct `.tgz`
installation is explicitly recorded as unsupported. The release manifest binds
commit `ae39f24937988ef95975b2b45c018f4c45efd23c`, source digest
`b91432b23b9fa44b3f1e750ff852ca78369f4f3d4808242841124364a510868b`,
trusted Node/npm/TypeScript/Pi identities, independently rerun test evidence,
artifact SHA-256 `a1e14c83da374c5f6a1b849c589feb444002d46e8a0634c0bbd5d520a539572b`,
and worker-safety evidence. A recursive no-symlink bundle manifest is checked
against a separately supplied root digest. The bundle remains
`EXTERNAL_REVIEW_PENDING`. No real-route smoke was authorized or performed.
M10 remains the last Planner-accepted milestone.

### M11-R9/R10/R11 autonomous Stage 3 closeout

- **Status:** Stage 3 autonomous closeout PASS; M11 remains IMPLEMENTED BUT NOT ACCEPTED.
- **Final candidate and identity:** `0.1.0-rc.7`, source-bound release-verification commit `c177c2d70639c8fcfe5780a356c6b439bbc2f1fe`, tree `986362e4fadb277cfca6c999b52bb42166c355bb`, source digest `d46177f3e9b13093ca9b53fdb7b961b05023599df4effc73379ad3aede777cdf`, artifact SHA-256 `3411e8bdbb5ab90769db32f30d4b0962a2fdefd47f22fd31d58d02716df6ff19`, external review-bundle root `67706649266b09907c2a263fcd6556c3ed428b77a0455bc04db2227690509acf`. The subsequent closeout commit is documentation-only.
- **Offline evidence:** RC.7 release verification passed `174/174` tests and `20/20` integrity attacks; typecheck, build, Pi compatibility/install/rollback/rescue, worker safety, and privacy/provenance checks passed.
- **Real-route matrix:** Investigation PASS on historical `9router/cx/gpt-5.6-luna`; Implementation PASS on historical `9router/ag/claude-opus-4-6-thinking`; M7 Verification PASS on RC.7 `9router/ag/claude-opus-4-6-thinking` with 3 provider requests, valid structured submission, M7 `passed`, and no mutation. Tabi was schema-valid but rejected one reported failed exploratory mechanical check; DeepSeek Flash stopped at the explicit 8-request cap without submission; prior DeepSeek Pro and cx/gpt-5.6-sol compatibility remain unproven.
- **Safety boundary:** Verification exposed only `read`, `grep`, `find`, `ls`, and `submit_verification_result`; no fallback, retry, repair, analyst, hidden inference, credential persistence, or live Pi configuration mutation was observed.
- **Remaining gates:** External Review #5/Planner acceptance, human/manual Stage 4 dogfood, and any publication remain separate. M11 is not accepted or production-ready.

### M11 Stage 4A — autonomous Computer-Use dogfood and final M7 evidence closeout

- **Status:** Stage 4A autonomous closeout PASS; M11 remains IMPLEMENTED BUT NOT ACCEPTED.
- **Final candidate and identity:** artifact-derived `0.1.0-rc.8`, built from clean tracked Git commit `aa622eef7256b447b456699dd80e10697fe94dc5`, tree `8104b7e1d5e40e4e2011c017acbf1bfa35203fd9`, source digest `d4f8b76c88e3e606b528d57571cf08e0553a0d43686c23489cba84a14f8fc234`, artifact SHA-256 `8fd4b233f7ee3d22ac0ac5703078ab165b55ba11a3978ae94a1f21039b746f28`.
- **Offline evidence:** RC.8 release evidence records `175/175 PASS`, `20/20` integrity attacks, typecheck/build/check, Pi `0.84.1` compatibility/install/rollback/rescue, worker safety, privacy, and provenance. No source or package change was required during this closeout.
- **Canonical Computer-Use flow:** in a disposable Stage 4A root, Mission `mission-049cbd67-01d6-40bf-a103-3c31267d71ec` created Task `task-e44240e9-a662-45fc-9a48-2e7c9dab31e1`; the real Implementation run `attempt-8c6df7fb-68c9-471b-9246-33e038af3a34` completed on route `r9-ninerouter-ag-claude-opus-4-6-think-fe2f756e1d848cbb05ca` / model `ag/claude-opus-4-6-thinking` and created only the requested `m7-dogfood.json` fixture change.
- **M7 evidence:** the normal task Verify action completed `verification-a4855595-3a1f-4d10-925c-d30d523d98eb` at round 0, persisted `decision-e87d80b4-8654-4368-86af-987465bbe521` with verdict `pass`, and left task quality status `passed`. The reviewer used the same explicit route/model, submitted the bounded structured verification result, and reported all six criteria satisfied with no unexpected mutation.
- **Safety and observability:** the project root was TRUSTED only inside the disposable root; application-level protected-path and command policy remained active; Verification exposed only read-only inspection plus `submit_verification_result`; no fallback, retry, repair, analyst, hidden inference, credential persistence, main Pi configuration mutation, source-code change, or unrelated project mutation occurred during dogfood. The visible TUI showed the quality PASS and Diagnostics showed RC.8, Pi `0.84.1`, trusted project, healthy Mission/Analytics DBs, and healthy observed route.
- **Remaining gates:** final human sanity smoke, fully independent External Review #5, Planner acceptance, and any publication remain separate. M11 is not accepted or production-ready.

## Accepted evidence history

- M0: `56cb8e04b3aefdbfe28e41f20794570a61751029` — `docs: freeze initial orchestrator specification` — ACCEPTED / PASS.
- M1: `b451408a57306cdb0c0cd9d4b41f76edd92c9395` — `feat(core): add configuration foundation` — ACCEPTED / PASS; `41/41` tests, typecheck, and aggregate check passed.
- M2: `43f810cc9c6fbda50abd69b94d5f8aad1597756a` — `feat(pi): add selective 9Router model manager` — ACCEPTED / PASS; evidence recorded above.
- M3: `e2efde838d84197f1fbe289e3e8ded090bdd2d87` — `feat(pools): add execution pool manager` — ACCEPTED / PASS; `70/70` tests, typecheck/build, and actual Pi/fake-gateway pool mutation/reload evidence passed.
- M4: `cae53b220e4cb78ec8b1f4f0400c9be4bb5a9697` — `feat(routing): add health-aware fallback engine` — ACCEPTED / PASS; evidence HEAD `f5e25e21bbebe7995a9cc050efea3ed20d94f18c`, `86/86` tests, and isolated Pi/fake-gateway routing/health evidence passed.
- M5: `80b00a65da0a922633d9809b8520983f90038118` — `feat(agents): add routed subagent execution` — ACCEPTED / PASS by STATE-5; evidence HEAD `c2e431aaf3384fc73acb2e7cd6201aa406d5266f`, `97/97` tests, typecheck/build/check, and isolated Pi `0.84.1` parent→child evidence passed.

- M6: `62282c1618f395b032e359005d018721e2b36868` — `feat(missions): add canonical mission state and context broker` — ACCEPTED / PASS by STATE-6; evidence HEAD `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298`, `111/111` tests, typecheck/build/check, and isolated Pi `0.84.1` mission flow passed.

- M7: `db82ac141094db749835a0cc7f1f79dc780005e4` — ACCEPTED / PASS by STATE-7; evidence HEAD `d15dccfd3415e7c705600526a6ef7d634d8c90c5`, `121/121` tests, typecheck/build/check, and actual Pi/fake reviewer reject→repair→re-review lineage passed.

- M8: `c5f741e` implementation accepted by STATE-8 with evidence HEAD `809394f`; `134/134` and actual Pi/fake analytics evidence passed.
- M8.5: `28b75be` implementation accepted by STATE-8.5 with evidence HEAD `28b75be`; `141/141`, actual Pi/fake analyst evidence, and manual-only/stale/privacy/explicit-Apply checks passed.
- M9: `2032a2b` — `feat(tui): add full orchestrator control center` — ACCEPTED / PASS by STATE-9; evidence HEAD `1200d3349506a1d414def0f3c1e044d712711d9d`, `146/146`, typecheck/build/check/package/diff/secret/state validation PASS.
- M10: `3a6990d` — `feat(safety): harden trust permissions and recovery` — ACCEPTED / PASS by STATE-10; evidence HEAD `13bed07b6cbc7c9a600820b1f39d54400a9828ca`, `159/159`, typecheck/build/check/package/diff/secret validation PASS; human keyboard smoke remains pending open validation.
- M11: rc.1 historical candidate was rejected by Independent Review #2. M11-R4 remediation commits `50ee46f` (integrated worker safety) and `55a15cc` (trusted release provenance/privacy/bundle) produce rc.2 evidence; `165/165`, isolated Pi directory-source/upgrade/rollback/rescue, seeded-state preservation, and self-contained bundle verification PASS. Exact artifact/source/build identities are in the generated manifest. External review and Planner acceptance remain pending.
- M11-R6: External Review #3 found that caller-supplied `submit_evil` custom-tool handlers could execute in an untrusted Pi child session. rc.3 replaced caller-supplied executable result tools with declarative capture-only protocols and passed its local gates, but External Review #4 rejected it for release-evidence integrity defects.
- M11-R8: commits `9c5b29e` and `ae39f24` produce rc.4 from exact Git content, independently rerun the bound `npm run check`, reject zero/forged evidence and all symlinks, recursively bind the review bundle to an external root digest, seed and read compatibility state with version-correct M10/candidate modules, assert actual `pi list` identity, and pass `169/169`, `20/20` attacks, Pi install/upgrade/rollback/rescue, worker-safety, privacy, and deterministic rebuild gates. M11 remains implemented but not accepted; External Review #5 and Planner acceptance remain pending.

## Assumptions agents must not make

- Do not assume this extension is installed in the live Pi configuration.
- Do not treat fake-gateway evidence as live 9Router proof.
- Do not treat configured pools as runtime routing or worker execution.
- M10 acceptance does not imply OS sandboxing, autonomous approval, Boss/planner runtime, scheduled tuning, automatic priority mutation, parallel/worktree orchestration, or release readiness.
- Do not treat accepted pool management as runtime routing or worker execution.
- Do not assume a GitHub remote, tag, public release, or stable package exists.
