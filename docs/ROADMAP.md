# Roadmap

## Delivery rules

Each milestone is independently reviewable, migratable, and testable without paid model calls. A milestone may begin only when its dependencies and exit gate are satisfied. Later requirements do not justify speculative implementation in an earlier milestone.

## Current planning boundary

RC31 (`0.1.0-rc.31`) is the current LOCAL / UNPUBLISHED / DOGFOOD
development identity: Pi-native live Mission progress (ADR-051) and
feedback-driven M7 repair convergence (ADR-052). It is not tagged,
npm-published, or a GitHub Release. RC30 remains the current public
prerelease and adds autonomous Boss-led mutation recovery for local
observable Implementation worktree edits when `submit_agent_result` is
missing. RC29 (`0.1.0-rc.29`) remains a frozen unpublished verified
candidate after live Mission
`mission-23b92005-b7fd-4582-9517-09b5a6f05cbb` COMPLETED and was not
published. RC28 remains a prior public immutable prerelease. Public
identity: `0.1.0-rc.30`, source `ef344ad12abeace41e9ba4f88f552b6f67306107`,
tag `v0.1.0-rc.30`, artifact SHA-256
`46e9cf0e4d13bb8707551d4a602a8491b66cae6e3436bf4ed275f94ed0cd58dc`.
M10 remains the latest accepted development milestone; M11 remains
implemented but not accepted. Live `routing.fallback.enabled` is true.
Acceptance dogfood used `routing.maxAttempts=1`; ADR-049 adds non-mutating
result-capability fallback; ADR-050 adds Boss-led recovery for local
Implementation mutation without a structured result. See
[worker-retry-finalization-fallback-forensics.md](worker-retry-finalization-fallback-forensics.md)
and
[worker-infrastructure-fallback-forensics.md](worker-infrastructure-fallback-forensics.md).
Future ideas belong in [IDEAS_BACKLOG.md](IDEAS_BACKLOG.md),
whose presence does not authorize implementation.

## M0 — Specification freeze and repository foundation

Status: ACCEPTED / PASS.

Deliverables:

- authoritative product, architecture, acceptance, decision, and roadmap documents;
- Pi `0.84.1` API validation and named proof-of-concept gaps;
- local Git repository with no production code or remote.

Exit gate: all required documents exist, internal references and Markdown pass checks, no likely secret is committed, contradictions are resolved, and a local commit is created when identity is available.

## M1 — Foundation and configuration engine

Status: ACCEPTED / PASS.

Deliverables:

- TypeScript package skeleton using the installed/supported Pi package contract;
- versioned global configuration and trusted project override schemas;
- validation, defaults, deterministic merge rules, migration, atomic save, history, rollback, and corruption recovery;
- secret-reference types that cannot serialize resolved secret values;
- metadata-only analytics configuration controls, with no event collection or storage;
- fake clock/filesystem boundaries only where deterministic tests require them.

Exit gate: deterministic tests prove save/restore/migrate/recover/precedence/export-redaction behavior. No live Pi configuration is changed.

## M2 — 9Router Integration + Selective Model Manager + First Controlled Pi Runtime PoC

Status: ACCEPTED / PASS.

Deliverables:

- authenticated, timeout-bounded `GET /v1/models` discovery through the secret resolver;
- full catalog cache with freshness and last-known-good semantics;
- explicit enabled-route set and dynamic Pi provider exposing only enabled 9Router routes;
- minimal Models & 9Router TUI: refresh, search, inspect, enable, disable, connection setup, and catalog/provider diagnostics; live route-test UX remains deferred because it can consume quota;
- proof of route identity, observed metadata limits, and runtime provider refresh behavior against a fake 9Router and the installed Pi runtime. The optional live catalog probe remains credential-gated and was skipped when credentials were absent.

Exit gate: remote 36/enabled 5, new-disabled-by-default, stale-catalog, duplicate-underlying-model, and unavailable-gateway acceptance tests pass.

## M3 — Three Execution Pool Manager + Ordered Route Priorities + TUI Pool Editor

Status: ACCEPTED / PASS.

Deliverables:

- exactly three ordered execution pools;
- route add/remove, per-pool enable/disable, and reorder operations using the existing schema;
- persistent list-order priority with history and serialized same-process mutations;
- one generic Pi-native pool editor reused by all three pools;
- `/orchestrator` pool sections plus `/pool-models` and `/pool-status`; and
- management-only status for globally disabled, missing, and unavailable routes without deleting membership.

Role, Boss-profile, and operational-profile data defined in M1 remain compatible; M3 adds no profile scheduling, task routing, or role execution.

Exit gate: PASS — pool add/remove/reorder, cross-pool independence, global-disable/missing retention, same-model distinct-route, history/concurrency, Pi TUI/command, actual Pi with fake gateway, and M2 regression tests all passed (`70/70`).

## M4 — Routing, health, and infrastructure fallback

Status: ACCEPTED / PASS.

Deliverables:

- pure ordered eligibility/preview router using pool priority, enabled state, availability, health, attempt exclusions, and explicit diversity context;
- failure classifier and bounded same-route retry/fallback/stop decisions, including conservative 429, cancellation, invalid-request, protocol, and unknown semantics;
- injectable runtime `HealthStore` JSON with retry-after/cooldown, circuit state, success recovery, corruption quarantine, and manual reset, kept out of ConfigStore/export/history;
- Routing & Fallback and Health & Quotas flows in `/orchestrator`, plus `/routing-status`, `/route-health`, and `/routing-settings`;
- fake-clock/unit, fake-gateway, and Pi `0.84.1` integration evidence with the M2/M3 regressions intact; and
- explicit boundary with opaque 9Router account/combo fallback; M4 never executes a model request.

Exit gate: PASS — `86/86` tests, typecheck, build, aggregate check, fake-gateway, and real Pi `0.84.1` routing/health RPC checks passed. M5 was subsequently authorized and is recorded below.

## M5 — Routed Subagent Execution

Status: ACCEPTED / PASS.

Deliverables:

- direct Pi `0.84.1` SDK child sessions with in-memory session/runtime state and exact M4 route/model pinning;
- explicit role/pool/task request, per-pool tool allowlists, bounded `submit_agent_result`, tool observation, timeout, cancellation, and deterministic cleanup;
- M4 retry/fallback/health integration with automatic fallback blocked after `edit`, `write`, or `bash`;
- serial-by-cwd Implementation execution, parent-only `delegate_agent`, `/subagent-run`, and fake-gateway/actual-Pi parent→child proof.

Exit gate: PASS — `97/97` tests, typecheck, build, aggregate check, fake-gateway, and Pi `0.84.1` parent→child evidence prove tool boundaries, structured result protocol, exact model selection, safe fallback, mutation stop, cancellation, timeout, isolation, and M2–M4 regressions. Paid calls and live environment changes were zero/none.

## M6 — Context Broker + Canonical Mission State + Task Packets + Checkpoint/Resume Foundation

Status: ACCEPTED / PASS.

Deliverables:

- mission lifecycle, transactional revisions, checkpoints, lease/recovery, and resume primitives;
- a separate versioned Node `node:sqlite` MissionStore with bound SQL, foreign keys, busy timeout, and corruption checks;
- deterministic accepted-only Context Broker and immutable role/pool TaskPacketV1 with explicit size/content limits;
- proposed worker evidence with explicit acceptance/rejection and canonical provenance;
- `/missions`, Context & Mission Settings, and packet inspection while Pi session entries contain only mission pointers/status.

Exit gate: PASS — MissionStore/ContextBroker deterministic suites, restart/reopen and interrupted recovery, stale lease, context isolation, rejected/proposed evidence, checkpoint atomicity, packet lineage/digest, M2–M5 regressions, and the actual Pi/fake mission task/evidence/reopen flow passed (`111/111`, `npm run check`, Node `22.23.0`, Pi `0.84.1`). Accepted implementation commit `62282c1618f395b032e359005d018721e2b36868`; accepted evidence HEAD `df8cdfea547f1e0f1a39e8e7f3d48ba2b3124298`.

## M7 — Quality gates, review, and escalation

Status: ACCEPTED / PASS.

Deliverables:

- MissionStore schema v1→v2 migration preserving all M6 rows and defaulting quality to unverified;
- durable verification runs, quality decisions/status, reviewer findings, mechanical-check provenance, and escalation history;
- bounded `submit_verification_result` through the existing M4→M5 child boundary with read-only Verification tools;
- deterministic QualityGate PASS/REJECT/BLOCKED semantics and reviewer route diversity;
- explicit Verify/Re-verify and confirmation-gated bounded quality-loop host actions; and
- quality rejection kept separate from M4 health/fallback and canonical evidence admission.

Exit gate: PASS — `121/121` tests, typecheck/build/check, and actual Pi `0.84.1` + fake-gateway reviewer reject→routed repair→re-review pass with durable lineage. At the STATE-7 handoff, M8 was next planned and not started; STATE-8 later records M8 acceptance.

## M8 — Analytics + Statistics + Cost/Token Accounting + Quality/Value Metrics + Auto-Tuning Recommendations

Status: ACCEPTED / PASS by STATE-8.

Deliverables:

- privacy-minimal metadata collection, durable events, and query projections;
- mission, agent, token, cost, route, pool, Boss, and fallback reports;
- explainable, sample-size-aware pool-specific recommendations;
- explicit Apply/Ignore/Details actions with no silent mutation.
- local `analytics.sqlite` schema v1 with idempotent privacy-minimal events, Pi usage/latency capture, `/analytics`, and `/recommendations`.

Exit gate: PASS — `134/134` tests, `npm run check`, actual Pi 0.84.1 fake-gateway analytics/fallback/quality telemetry, token provenance/UNKNOWN handling, restart dedupe, ConfigV1→V2 billing migration/persistence, nine analytics detail views, and recommendation Details/Ignore/Apply/stale protection. STATE-8 records Planner acceptance; live/paid calls `0`.

## M8.5 — Manual AI Recommendation Analyst

Status: ACCEPTED / PASS by STATE-8.5.

Deliverables:

- optional manual-only AI reasoning over deterministic M8 recommendations;
- Verification Pool route selection with no hard-coded model and existing M4/M5 execution;
- bounded analytics input and structured SUPPORT/OPPOSE/INSUFFICIENT_EVIDENCE output;
- bounded audit metadata, deterministic input fingerprint, stale analysis detection, and privacy filtering;
- Recommendation Analyst UI/RPC with explicit Analyze Now/Re-analyze and no background execution or automatic Apply.

Evidence: `141/141` full tests, analyst/provider focused suites, typecheck/build/check PASS, and Pi `0.84.1` fake-gateway support/oppose/insufficient/failure-preserves-deterministic flows. Analyst execution is manual-only, deterministic recommendations remain authoritative, and explicit Apply remains the M8/M3 mutation path; paid calls `0`.

## M9 — Full TUI control center

Status: ACCEPTED / PASS by STATE-9.

Deliverables:

- all twelve control-center sections from the product specification;
- keyboard-accessible navigation, progress, error, stale-data, confirmation, and empty states;
- live mission/agent/route/review visibility without log inspection.

Acceptance evidence: exact twelve-section/dashboard and RPC/native selector suite `5/5 PASS`; existing provider suite `17/17 PASS`; full suite `146/146 PASS`; `npm run check`, typecheck, build, package dry-run, diff check, secret scan, and project-state consistency PASS. Human keyboard-driven TUI smoke remains pending because no authorized interactive keyboard session was available; this is open validation and not an M9 acceptance blocker. At the M9 boundary, Boss runtime, autonomous scheduling, background work, and automatic priority mutation were outside scope; RC25 later adds the bounded Boss runtime.

Exit gate: PASS — STATE-9 records Planner acceptance of implementation commit `2032a2b` with evidence HEAD `1200d3349506a1d414def0f3c1e044d712711d9d`; human keyboard smoke remains a separately open validation item.

## M10 — Safety and hardening

Status: ACCEPTED / PASS by STATE-10.

Deliverables:

- protected-path and destructive-command policy;
- project trust enforcement, secret filtering, permission review, database recovery, lock/lease hardening, and crash fault injection;
- import/export adversarial tests and privacy review.

Evidence: full suite `159/159 PASS` with loopback-capable fake Pi execution; TrustStore/path/command/privacy, lease/CAS, SQLite backup/restore, corruption degradation, and fault-injection tests PASS; typecheck/build/check/package/diff/secret validation PASS. Human keyboard smoke remains open validation but is not an M10 acceptance blocker. No live or paid calls were used.

Implementation commit: `3a6990d` — `feat(safety): harden trust permissions and recovery`.

Exit gate: PASS — STATE-10 records Planner acceptance of implementation commit `3a6990d` with evidence HEAD `13bed07b6cbc7c9a600820b1f39d54400a9828ca`. The safety boundary is application-level and does not claim an OS/kernel sandbox; human keyboard smoke remains separately open validation.

## M11 — Packaging, release, and dogfooding

Status: IMPLEMENTED BUT NOT ACCEPTED.

Deliverables:

- versioned Pi package and installation/upgrade/rollback documentation;
- compatibility matrix and controlled real-route smoke suite;
- release artifact and independent external review;
- staged dogfooding while Codex or another external harness remains a rescue path.

The rc.1 candidate and its R2 evidence were rejected by Independent Review #2 for release-provenance, privacy, rescue, and integrated-worker safety gaps. M11-R4 remediation added execution-time worker guards, trusted release executables, source/tree/build identity binding, strict evidence parsing, privacy/symlink coverage, a real M10 baseline, seeded-state preservation, and broken-candidate rescue; its rc.2 candidate was rejected by Independent Review #3 after the custom-tool bypass was reproduced. M11-R6 produced rc.3 by removing caller-supplied executable child tools and independently passed worker safety, but External Review #4 rejected its release-evidence integrity. M11-R8 produced rc.4 from exact Git content, independently reran the bound tests, rejected forged/zero evidence and symlinks, used version-correct M10 compatibility code, recursively hashed the full review bundle, and required an externally supplied root digest. M11-R9/R10/R11 produced rc.7: Verification no longer advertises categorically blocked shell tools, M7 finalization is atomic with normalized criteria and reviewer diversity, and the nested result schema matches the strict parser.

Stage 3 autonomous closeout is PASS on the explicit supported route `9router/ag/claude-opus-4-6-thinking` through the actual M7 path. Compatibility findings remain route-specific: Tabi produced a valid structured result but a quality REJECT after one failed exploratory mechanical check; DeepSeek Flash exhausted its explicit request cap without submission; DeepSeek Pro and cx/gpt-5.6-sol remain unproven. RC.8 Stage 4A autonomous Computer-Use dogfood is also PASS: a disposable-root Mission → Task → Implementation run created the requested fixture, and the normal Verify action completed a durable M7 `pass` decision on the same explicit route. Final human sanity, fully independent External Review #5, and Planner acceptance remain open. A local RC is not a public release; npm publish, GitHub release, tags, remotes, and live configuration require separate authorization.

Exit gate: RC.8 clean install, upgrade, rollback, package verification, Stage 4A autonomous dogfood, and canonical M7 evidence pass. Final human sanity, independent review, Planner acceptance, and authorized publication gates remain pending. Creating a GitHub repository, remote, tag, or release requires separate authorization.

## M12 — Smart Mission Entry, Hybrid Routing & Routing Memory

Status: COMPLETE / PUBLIC PRERELEASE (historical RC17 record). RC17 was the source-bound public candidate after the bounded reviewer-handoff repair; RC25 is the current public prerelease. M10 remains the latest accepted development milestone. RC18 remains local and was not included in the RC17 artifact.

### Historical M12 final Planner/manual acceptance — RC17

Exit evidence: `PMO_FINAL_PLANNER_ACCEPTANCE_PASS`; source-bound RC17 detached
verification and independent review passed; clean `npm run check` passed
`231/231` across 13 suites with zero failed/cancelled/skipped/todo; Pi
`0.84.1` compatibility, privacy, worker safety, and `20/20` integrity attacks
passed. A disposable live Mission → Task → Implementation → Verification Pool
→ `submit_verification_result` → M7 path passed at round 0 on the explicit ag
route, and the isolated offline technical TUI passed with clean Back/exit and
no credential text. The accepted candidate is published as a prerelease; no
live configuration mutation occurred.

### M12.1 — Frictionless Mission Entry

Status: COMPLETE / LOCAL PASS; not a public release or accepted development milestone.

Deliverables:

- explicit `@orchestrator <goal>` entry through Pi `0.84.1` native input handling;
- one shared canonical Mission creation operation for input and the existing New Mission menu;
- real MissionStore persistence with goal/status/Repository metadata and pointer-only Pi history;
- clear `Direct Workers` and canonical Mission/M7 terminology without changing `/verify-task` semantics; and
- deterministic parser, persistence, menu-equivalence, ordinary-input, and direct-worker regression coverage.

Exit gate: PASS — local typecheck/build/full tests, focused UX review, isolated offline Pi `0.84.1` checks, detached RC17 release verification, and the authorized public prerelease verification pass. Stable production release remains separate.

### M12.2 — Hybrid Smart Router

Status: COMPLETE / LOCAL PASS; not accepted, public, or production-ready.

M12.2 adds the bounded hybrid Smart Router for ordinary Pi input:

- deterministic bilingual local signals classify clear prompts as `NORMAL` or
  `SUGGEST_MISSION` without an AI call;
- ambiguous prompts optionally use a configured Primary Triage route and a
  capability-only Fallback, with strict JSON validation and local/user-choice
  degradation;
- the suggestion is one-shot and offers `Run as Mission` or `Run Normally`;
  explicit `@orchestrator <goal>` input remains the M12.1 bypass;
- settings live inside the existing Routing & Fallback section and persist in
  a versioned atomic/rollback-capable sidecar without changing ConfigV1 route
  semantics;
- routing telemetry stores bounded decision metadata only, never raw prompts,
  transcripts, credentials, or provider responses.

Local evidence: typecheck/build, the full test suite, focused Smart Router and
Pi host regression suites, isolated Pi `0.84.1` TUI dogfood, and bounded live
English/Persian Primary/Fallback/degradation dogfood pass in disposable roots.
No credential value or live Pi state was manufactured or modified. This M12.2
evidence is local-only and historical; RC16 supersedes its candidate and passes
detached release verification. Planner/manual acceptance remains separate.

### M12.3 — Adaptive Routing Memory

Status: COMPLETE / LOCAL PASS; not accepted, public, or production-ready.

M12.3 adds a bounded, versioned `routing-memory.json` sidecar containing
abstract bilingual routing signatures rather than prompt history. Explicit
`Always orchestrate similar tasks` rules create one canonical Mission and
learned Mission/Normal preferences require repeated consistent choices before
they can affect routing. Matching is conservative and language-neutral, with
explicit-rule precedence, provenance/confidence, conflict fallback, and a
complexity gate that prevents a learned Normal preference from suppressing a
materially escalated task.

The existing Routing & Fallback section exposes Routing Memory, Auto-Learn,
Learned Behaviors, and validated abstract-only backup/restore controls. Learned
rules can be inspected, enabled/disabled, deleted, forgotten separately, or
reset with explicit confirmation. Routing telemetry is allowlisted metadata;
raw prompts, transcripts, tool output, provider responses, and credentials are
excluded.

Local evidence: Analytics `9/9`, Routing Memory `14/14`, Smart Router `14/14`,
provider host `25/25`, and isolated Pi `0.84.1` RPC/TUI dogfood passed. The
detached RC13 verifier passed `214/214` tests, `20/20` integrity attacks, Pi
install/upgrade/rollback/rescue, privacy, and worker safety. Focused review of
the exact source commit found no unresolved blocker/high. This M12.3 evidence
is historical; RC16 supersedes its candidate and passes detached release
verification. Planner/manual acceptance and publication remain separate.

### M12 Final Gate — historical RC13 Routing Dogfood evidence

Status: COMPLETE / LOCAL PASS; not accepted, public, or production-ready.

Evidence:

- balanced deterministic English/Persian/mixed corpus: `360/360` expected
  classifications, with `120` cases per path and zero errors;
- isolated Pi `0.84.1` RPC/PTY dogfood covering explicit entry, normal-input
  isolation, Smart Routing, Routing Memory, restart, disable, stale routes,
  direct-worker/M7 labeling, and a composed Smart-routed Mission → Task → Run
  → M7 pass using a FakeNineRouter fixture;
- bounded real 9Router inference in disposable roots: ten ambiguous sessions,
  `20` triage calls, `9` fallback successes, `1` timeout degradation, and no
  raw prompt telemetry; no live Pi configuration was modified;
- RC13 `npm run check`: `214/214 PASS`; detached release verification:
  `20/20` integrity attacks, privacy, worker safety, and Pi `0.84.1`
  install/upgrade/rollback/rescue PASS;
- artifact SHA-256
  `abbfaf8580008a5f2d297a28a49fe3a0c962b1f3c512944b9f680c74e630085b`, source
  digest `0c5d0b49a2c637b592e039b31548bd549e31eee5c0854c20487a74324185d074`,
  review-bundle root `f3183574deed6dc96e6a15953a5949bdbb4858f34a9a26b5378437a81ca7075c`.

This RC13 final-gate record is historical and is not a public release or
acceptance handoff. At that time External Review #5 was
`EXTERNAL_REVIEW_PENDING`; RC16 supersedes that pending state and passes detached
verification. Planner/manual acceptance, human acceptance, tags, push, npm
publication, and GitHub release remain pending or unauthorized.

### Historical M12 Final External Release Review — RC16

Status: FINAL EXTERNAL REVIEW PASS on the exact detached local candidate. RC16
is not accepted, public, or production-ready.

The RC16 implementation adds the fresh M12.1/M7 and recovery repairs: explicit
entry failure preserves user input, completion is Boss-only and evidence-gated,
M7 verification is bound to succeeded attempts and unique decisions, corrupt
routing state is repairable, zero-width Unicode and oversized inputs are
bounded, worker timeouts honor route ceilings, and release builds use a
validated TypeScript launcher. Clean-checkout validation is `231/231 PASS`
across 13 suites with zero failed/cancelled/skipped/todo; typecheck and build
are PASS.

The final detached verifier and independently anchored review bundle passed for
RC16. No live Pi configuration, provider account, credential,
public tag, push, npm publication, or GitHub release is authorized by this local
candidate. Planner/manual acceptance and publication remain separate gates.

Evidence identity: commit `1ffcbed8d776c4d0379a6bf7f832967fae7dbb99`, tree
`0e7e01ff02abf269891fc55556d57e64d5a1f111`, source digest
`7dd0e1c84ad6e980a19269eafddf1f1501cc1aa1f9cf330afca172584daa1b87`,
artifact SHA-256
`72073e109df5a0d6b6e0f4be9f825932a768791d0752976c99aabc83eb4bcd7a`,
and bundle-root SHA-256
`6414f090c54caf4004fe62a6d51fe4e9d0df562b662a7091c9f68767901bb675`.

Final Planner/manual acceptance attempt on 2026-08-15: HISTORICAL HARD BLOCK,
superseded by RC17. The
disposable live canonical Mission Implementation leg succeeded on the pinned
`9router/ag/claude-opus-4-6-thinking` route and created the exact smoke JSON;
the same Verification route stopped before valid `submit_verification_result`
capture in two bounded attempts, leaving M7 blocked with no decision. The
isolated offline Pi `0.84.1` technical TUI path passed. RC17 is the accepted
public prerelease; stable production release remains a separate gate.

## Historical RC17 public prerelease closeout

Status: PUBLISHED / PRERELEASE. The exact source-bound tag is
`v0.1.0-rc.17` at `5def791b31a7ad940ed87f6e720aabb0228500e7`. GitHub marks the
release as a prerelease, and npm publishes
`pi-multi-orchestrator@0.1.0-rc.17` with `next` pointing to that version.
The registry tarball is byte-identical to the accepted GitHub asset and has
SHA-256 `2a9343de7b456840ebdd596ef14c674a51abdad65e3e840b6a29b760e9aa5b62`.
The existing `latest` tag was observed as `0.1.0-rc.17` before and after this
checkpoint. The exact immutable RC17 version and artifact were already present
in npm, so no republish or repack was performed; authenticated interactive npm
flow moved only `next` from RC20 to RC17.

## Historical RC18 — Real-world Pi/9Router compatibility repair

Status: IMPLEMENTED / LOCAL DOGFOOD PASS; not a package version, public release,
or acceptance promotion. The manifest remains `0.1.0-rc.17`.

RC18 repairs the RC17 dogfood defects at the shared provider bridge and catalog
boundary:

- preserve an existing user/Pi `9router` catalog and never unregister an
  external provider;
- register, update, and unregister only a PMO-owned provider namespace while
  retaining standalone registration and `--list-models` behavior when absent;
- parse current object-shaped and legacy `/v1/models` capability fields without
  fabricating unknown values, and keep richer metadata out of public config;
- prove the 27-model non-shadowing case, PMO-owned lifecycle, current
  Gemini/GPT/Grok metadata, legacy aliases, full check, and explicit local Pi
  dogfood.

Exit evidence: source/test commit `0af7b8e`; production build and
`npm run check` `234/234 PASS`; baseline and explicit local-extension Pi
`0.84.1` `--list-models 9router` both exited 0 with 27 exact matching rows;
bounded RPC exited 0. No refresh, model request, credential display, live Pi
configuration mutation, package rebuild/repack, publication, tag, push, or
GitHub release was performed.

### Future requirement — Dynamic Route Catalog & Capability Sync

Status: PLANNED / NOT IMPLEMENTED. Future work covers manual Refresh Now,
configurable periodic sync, route/capability diffs, per-route capabilities,
provenance, last-known-good state, stale indicators, safe user overrides, and
the distinction between provider-advertised and empirically observed
capabilities. This is explicitly outside RC18.

## RC25 — Operational Boss / Orchestrator

Status: PUBLIC PRERELEASE / RELEASE CLOSURE PASS; RC25 is not stable or
production-ready.

Deliverables:

- additive Boss profile entries with multiple eligible routes, per-route
  Thinking Effort, integer weights, canonical labels, and explicit enablement;
- deterministic weighted Boss selection once per Mission, durable assignment
  pinning across normal planning/evaluation/repair/reverification cycles, and
  explicit infrastructure-only fallback pinning;
- one bounded goal-oriented Mission loop shared by explicit `@orchestrator`
  and Smart Routing Run as Mission/AUTO_MISSION, with Investigation and
  Implementation dispatch through existing pools and M7 Verification through
  the existing quality path;
- terminal completion only after goal/acceptance/task/M7 gates pass, with
  recoverable failures causing repair/replan/reverify and bounded exhaustion
  ending in explicit BLOCKED/AWAITING_USER review state;
- Mission-keyed safe Boss assignment, fallback, cycle, repair, quality,
  duration, and authoritative usage analytics; and
- manual-only Boss weight recommendations using the existing recommendation
  architecture with stale-checked explicit Apply.

Acceptance evidence: focused migration, weighted-distribution, multi-cycle
reject→repair→pass, fallback, UI, analytics, and recommendation suites pass;
`npm run check` passed `263/263` across 14 suites; the exact frozen artifact
SHA-256 is
`32a8a9f1f968ff4bacf38385afd52869c4c793480e63f4335507ffd11a2a7ec5`; public
npm (`next=0.1.0-rc.25`, `latest=0.1.0-rc.17`), GitHub prerelease, detached
release verification (`20/20` integrity attacks), and isolated public Pi
`0.84.1` fresh-install/RC24→RC25 upgrade gates all pass. The release remains
a prerelease and is not a production-readiness claim.

## RC28 — Real Boss Invocation Compatibility, Failure Diagnostics & Fallback Semantics

Status: PUBLIC PRERELEASE / IMMUTABLE; not accepted, stable, or
production-ready. Identity: `0.1.0-rc.28`, source
`aad28c33260326665ec17e347d50fe985b18a953`, tag `v0.1.0-rc.28`, artifact
SHA-256 `9f516b23af13749148289c616298db0f48b1a51c8cb61e9814e09097db1a0fa3`.
The original source-handoff described pre-release readiness; that text is not
rewritten below.

Deliverables:

- canonical Boss-response normalization over Pi `completeSimple`
  `AssistantMessage` (`stop | length | toolUse | error | aborted | pending | deferred`,
  text-only extraction, never thinking/CoT);
- classified invocation diagnostics (stage, class, stopReason, hasText,
  fallback) without secrets or raw provider payloads;
- `selectBossFallbackEntry` independent of weighted scheduling; weight 0 may
  still infrastructure-fallback; protocol/quality still must not;
- Boss Profile UI distinguishes scheduled Boss, editor selection, scheduling
  eligibility, and fallback eligibility;
- recorded public RC27 dogfood: Missions
  `mission-89d5e163-17ee-4218-b06c-dea5fa4b480b` and
  `mission-aa30ed69-3213-4cf0-882a-a60be426412d` as observed route/runtime
  compatibility failures.

Exit evidence: focused Boss response/fallback/UI suites plus `npm run check`
and detached release verification. Publication, tagging, npm dist-tags, GitHub
Release, and live Pi install remain operator-owned. RC27 is not mutated.

## RC29 — Mission Runtime Convergence (delivery, identity, capability, active completion)

Status: UNPUBLISHED CANDIDATE / LIVE MISSION COMPLETED. Development identity:
`0.1.0-rc.29`. Not public, accepted, tagged, npm-published, or production-ready.
Public RC28 remains immutable.

Deliverables:

- treat empty/thinking-only Boss completions as invocation delivery
  (`empty_response` infrastructure) with fallback then `BLOCKED`, not four
  protocol cycles labelled `AWAITING_USER`;
- capability preflight for Goal/criteria that require `git commit` / `git push`
  / network publication, terminal `CAPABILITY_MISMATCH`;
- idempotent Task identity (`executionClass` + normalized objective) and
  active-only completion;
- bounded Boss canonical projection, persisted `lastFeedback`, class-specific
  M7 prompts, terminal Missions do not resume;
- host-shaped Goal→Task→M7→COMPLETED harness that inspects durable store
  rows, including reject→repair and resume.

Exit evidence: `docs/mission-runtime-root-cause.md`, ADR-046, ADR-049,
RC29-01/02/03 acceptance tests, `npm run check` `367/367`, live isolated Pi
Mission `mission-23b92005-b7fd-4582-9517-09b5a6f05cbb` COMPLETED, and
detached unpublished candidate SHA-256
`fec5a819fd6ae149296bd4328924862abde3defe35893505ba8fbb046dc29f7b`
(source `d975a5d2987df7116d07d6a15a9ed6a51269f1d3`). Publication remains
operator-owned. RC29 is an unpublished candidate.

## RC31 — Live Mission Progress and M7 Repair Convergence

Status: LOCAL / UNPUBLISHED / DOGFOOD; not accepted, stable, public, or
production-ready. Identity: `0.1.0-rc.31`. Public RC30 remains immutable.

Deliverables:

- Pi-native live Mission progress from canonical events via
  `ctx.ui.setWidget` (ADR-051), including heartbeat, resume reconstruction,
  safe tool/event projection, and a terminal summary;
- feedback-driven M7 repair: normalized criterion matching, investigation
  no-mod contract, synthesized requiredFixes, Boss complete precondition,
  repair packets with rejection context, identical-fingerprint anti-repeat
  (ADR-052).

Exit evidence: `test/mission-progress.test.ts`, `test/rc31-convergence.test.ts`,
ADR-051, ADR-052, RC31-01/02, `npm test` / `npm run check`, local unpublished
candidate, and live dogfood. Publication, tagging, and GitHub Release are
not authorized.

## RC30 — Autonomous Boss-Led Mutation Recovery

Status: PUBLIC PRERELEASE / IMMUTABLE; not accepted, stable, or
production-ready. Identity: `0.1.0-rc.30`, source
`ef344ad12abeace41e9ba4f88f552b6f67306107`, tag `v0.1.0-rc.30`, artifact
SHA-256 `46e9cf0e4d13bb8707551d4a602a8491b66cae6e3436bf4ed275f94ed0cd58dc`.
The frozen RC29 artifact `pi-multi-orchestrator-0.1.0-rc.29.tgz` was not
published. Controlled recovery dogfood and one real implementation Mission
reached durable COMPLETED.

Deliverables:

- CLASS A (`mutation=false`) keeps ADR-049 result-capability fallback;
- CLASS B local observable Implementation mutation without a structured
  result enters Boss-led autonomous recovery on the same Task;
- read-only `submit_recovery_assessment` plus Boss `submit_recovery_decision`;
- continuation from the current worktree (`CONTINUE_EXISTING_WORK` /
  `REPAIR_EXISTING_WORK`); `ROLLBACK_AND_RETRY` only when a safe local
  rollback is proven; `REQUEST_HUMAN` for CLASS C / unknown / failed
  inspection / exhausted budget;
- one autonomous recovery sequence per logical Task;
- SAFETY_STOP and CANCELLED remain non-recoverable.

Exit evidence: `test/mutation-recovery.test.ts`, ADR-050, RC30-01, `npm test`
/ `npm run check`, controlled sandbox recovery dogfood, one normal
implementation Mission COMPLETED, and public prerelease `0.1.0-rc.30`.

## RC27 — Autonomous Mission Bootstrap & Zero-Task Boss Loop Repair

Status: PUBLIC PRERELEASE / IMMUTABLE; not accepted, stable, or
production-ready. Identity: `0.1.0-rc.27`, source
`267612d15dcc0784856e7dafd6704d2f802272b9`, artifact SHA-256
`d8589943434a6ea1796f2c908fa2123464f7c8accca0557bb6547338bea83a55`.
The original source-handoff described pre-release readiness; that text is not
rewritten below.

Deliverables:

- runtime validation of Boss inference JSON against the BossDecision protocol
  (`normalizeBossDecision`); malformed objects become `BossProtocolError` and
  enter bounded repair on the pinned Boss rather than TypeScript casts;
- plan-phase `dispatch`/`replan` with zero tasks is an actionable-plan failure,
  never a silent no-op and never false `COMPLETED`;
- autonomous `@orchestrator` / Smart Routing / AUTO_MISSION Missions create
  their own canonical Tasks; `/missions` Add Task is not required for those
  entrypoints and remains available for explicit manual Missions;
- durable Goal-level acceptance criteria: explicit structured values outrank
  labelled goal sections, which outrank bounded derived criteria;
- Inspect diagnostics for safety-budget `AWAITING_USER`: last action, protocol
  and actionable-plan failure counts, task count, stop reason, pinned Boss,
  and whether fallback occurred;
- recorded public RC26 dogfood: Mission
  `mission-5f02627a-f84b-4ecb-95c1-a900dacfa5a8` burned 4 Boss cycles with
  0 tasks / 0 evidence / acceptance criteria 0 / awaiting-review.

Exit evidence: focused Boss protocol, zero-task, criteria, UX, pin/fallback,
CANCELLED, and SAFETY_STOP suites plus `npm run check`. Publication, tagging,
npm dist-tags, and GitHub Release remain operator-owned. RC26 is not mutated.

## RC26 — Goal Terminal Semantics & Runtime Metadata Correctness


Status: PUBLIC PRERELEASE / IMMUTABLE; not accepted, stable, or
production-ready. Identity: `0.1.0-rc.26`, tag `v0.1.0-rc.26`, source
`11153f0587634bcba732a5b214c95319c305f9e6`, artifact SHA-256
`1b20c048e91f8665cb8cfc31982c56c472b270a0bfbf5432ad91ec899aacd69a`.
The original source-handoff described pre-release readiness; that text is not
rewritten below.


Deliverables:

- first-class Boss-loop terminals for `CANCELLED` and `SAFETY_STOP` alongside
  existing `COMPLETED`, `BLOCKED`, and `AWAITING_USER`, without redesigning the
  RC25 goal loop or weighted once-per-Mission Boss pinning;
- cancellation as a real terminal path during planning, worker progression,
  verification, and evaluation: durable MissionStatus `cancelled`, no false
  completion, no ordinary BLOCKED, no infrastructure fallback, no quality
  escalation, and no repair/replan continuation;
- `SAFETY_STOP` distinguished from business BLOCKED via orchestration
  `terminal: "SAFETY_STOP"` metadata while preserving MissionStatus `blocked`
  (no new persistent MissionStatus); uses the existing trust/path/command
  safety boundary;
- truthful runtime package metadata keyed by `package.json` version `0.1.0-rc.26`,
  with `latestAcceptedMilestone` remaining M10 and `productionReady` remaining
  false; unknown versions fail closed as `stale-development-line:*`;
- retained entrypoint convergence for `@orchestrator` and Smart Routing
  Run as Mission/AUTO_MISSION into the same canonical Boss loop;
- producer-side sanitization of persisted Pi install/remove/startup evidence
  so review-bundle privacy scanning cannot observe local absolute machine
  paths; package version remains `0.1.0-rc.26`.

Exit evidence: focused Boss terminal, package-info, entrypoint, and
release-evidence privacy suites plus the repository `npm run check` gate and
detached release/review-bundle verification. Publication, tagging, npm
dist-tags, and GitHub Release remain operator-owned.

## Historical RC24 — Model Router enablement hotfix

Status: IMPLEMENTED / RELEASE CANDIDATE; preserves RC23 weighted scheduling and
Pool behavior.

RC24 restores the Model Router's visible enablement state without changing the
canonical presentation helper or provider/catalog state. Enabled PMO routes
show `[x]`, discovered-but-disabled routes show `[ ]`, Enter opens the existing
Inspect plus Enable/Disable action menu, and Refresh Models preserves the
authoritative persisted state. Duplicate labels remain deterministically
disambiguated and internal route IDs remain hidden from normal rows.

Exit evidence: focused TUI/RPC acceptance, full repository check, independent
release verification, frozen-artifact registry comparison, GitHub prerelease,
and isolated public npm Pi runtime verification.

## Historical RC22 — Canonical model selector presentation

Status: IMPLEMENTED / LOCAL CANDIDATE; not accepted, public, stable, or
production-ready. RC21 remains the public prerelease.

RC22 adds one shared canonical model-option presentation helper and applies it
to the Model Router, Investigation/Implementation/Verification Pool editors
and Add Route flows, Route Health, Smart Routing Primary/Fallback, and
Recommendation Analyst. Normal rows use the remote model ID once; duplicate
visible names receive deterministic suffixes while distinct route values stay
distinct. Internal route IDs, `ACTIVE`, and Thinking metadata are removed from
normal selectors; Inspect and diagnostics retain exact route identity.

Exit evidence: source commit `288c77cfac92dc7ffa8a0f0b16a69d140ada3aea`;
detached `250/250 PASS` across 13 suites; typecheck/build; `20/20` integrity
attacks; worker-safety PASS; and isolated Pi `0.84.1` install evidence PASS
for `0.1.0-rc.22`. Artifact SHA-256 is
`7d9b9451d1c2590d5b2632b6dd7aadd250bd2851af8dd79d79c25113693dbdea` and the
bundle-root SHA-256 is
`a81f34cf41709de5ebef4fe8e1733e883be8e5849dd7f371dc34070bff6170c3`.
No npm publication, tag, GitHub release, live Pi configuration, provider
account, credential store, or model request was performed.

## Historical RC21 — Model Router dogfood repair

Status: PUBLISHED / PRERELEASE; public npm and GitHub dogfood release, not
stable or production-ready. npm `next` points to RC21 and `latest` remains
`0.1.0-rc.17`.

RC21 repairs the RC20 dogfood boundary: nested `CatalogRow.entry` metadata is
preserved through host normalization; Pool Thinking Effort remains supported,
not-supported, or unknown without fabricated capabilities; static external Pi
`0.84.1` providers refresh their upstream `/v1/models` endpoint through Pi's
existing auth result using transient in-memory auth; PMO cache/LKG, enabled
routes, Pool order, and external provider ownership remain intact; and the
populated Model Router picker puts Refresh Models first with explicit feedback
while hiding internal route IDs from normal rows.

Release evidence: package `pi-multi-orchestrator@0.1.0-rc.21` was published
with `--tag next --access public --ignore-scripts` from the frozen artifact
SHA-256 `67e5fe663bc8ec05d3f02ec1183841552b3e70b13fd92901962fddbef8b6a266`.
The source binding is commit `68c0c0f82c5c82d7944512ea64aadd05a2e4569e`, tree
`9baab4eb7d51c4598b8ea3aa4d5b12e9e2479512`, tag `v0.1.0-rc.21`, and
independent bundle-root SHA-256
`7e2fd35553fd46f232d5f8e286ef272c1c8a2d018037c0b6b3763e4fab89c017`.

Verification: clean `npm run check` passed `246/246` tests across 13 suites
with zero failed/cancelled/skipped/todo; typecheck/build and `20/20` integrity
attacks passed. The registry tarball is byte-identical to the frozen artifact,
GitHub release [v0.1.0-rc.21](https://github.com/Recoba86/PiMultiOrchestrator/releases/tag/v0.1.0-rc.21)
is an explicit prerelease, and a disposable public npm install loaded RC21 in
Pi `0.84.2` and completed offline `/9router-status` and `/9router-refresh`,
including safe unconfigured/LKG failure feedback. No live Pi configuration,
provider credential, or model request was modified/performed; no rebuild or
repack occurred after artifact freeze.

## Historical RC20 — Thinking-aware Pool routing and live catalog refresh

Status: IMPLEMENTED / PUBLIC PRERELEASE; manifest `0.1.0-rc.20` is the
`next`-tagged prerelease and is not stable or production-ready.

RC20 adds per-Pool-route Thinking Effort (`Auto`, `Low`, `Medium`, `High`,
`XHigh`, `Max` when supported), omission-based Auto semantics, capability-aware
validation, requested/effective run metadata, and stale explicit-effort
blocking. Models & 9Router has a visible manual Refresh Models action that
refreshes the authoritative PMO-owned 9Router client or the existing external
Pi provider, reports added/removed/changed entries, preserves last-known-good
state on failure, and keeps PMO enablement separate from external provider
ownership. New discovered routes are disabled, Pool order/effort survive
refresh, and removed Pool routes remain missing/unavailable. True duplicate
route identities remain ambiguous; deterministic exact matches are not marked
ambiguous merely because a resource field is unknown.

RC20 intentionally does not implement periodic automatic catalog sync,
Benchmark Lab, automatic effort optimization, or autonomous Pool rewrites.

Exit evidence: source commit `8bcb4a61796623ea09bd1ed09c411656bd657138`, tag
`v0.1.0-rc.20`, clean `npm run check` with `242/242` tests across 13 suites,
independent Pi `0.84.1` release verification, `20/20` integrity attacks, and
public npm/GitHub prerelease verification passed. Artifact SHA-256 is
`556de8db9bb661e3f82f47badd2b93f68b3145e29b056b6abc29bea15efda9bc`; npm
`next` points to RC20 and `latest` remains RC17. The final published-extension
Pi probe was read-only/offline with 27 existing catalog rows and temporary
PMO/session roots; no live configuration or model request was used.

## Historical RC19 — Pi 9Router onboarding and adoption

Status: PUBLISHED / PRERELEASE; manifest `0.1.0-rc.19`; public npm and GitHub
release gates passed. RC19 is not stable or production-ready.

RC19 closes the first-run and existing-provider compatibility gap identified by
RC18 dogfood:

- adopt the exact bounded `9router` model catalog already exposed by Pi
  `0.84.1`, using `Provider.getModels()` without resolving or copying keys;
- keep external provider ownership external across reconciliation, refresh,
  reload, and disposal, while retaining explicit PMO route enablement and pool
  assignment;
- offer a neutral no-provider state and TUI-only masked `Test & Save` setup;
  validate `/v1/models` before writing config, then store the key through Pi's
  auth API and persist only a fixed `pi-auth` reference;
- omit `apiKey` from Pi-auth provider registration so Pi resolves its stored
  credential, preserve env-backed registration, and fail closed for raw-key RPC
  setup;
- verify the existing PMO path, external 27-model path, setup success/failure,
  TUI/RPC boundaries, Pi auth storage, full checks, exact artifact identity,
  `next`-only npm publication, and public install.

No automatic pool assignment, PMO provider replacement, credential copy, or
plaintext secret persistence is part of RC19. Dynamic Route Catalog &
Capability Sync remains a future requirement.

Exit evidence: clean `npm run check` passed `237/237` across 13 suites with zero
failed/cancelled/skipped/todo; typecheck and build passed; project Pi `0.84.1`
dogfood matched 27/27 existing `9router` rows; the public npm-installed
extension matched the same 27/27 rows; artifact SHA-256 is
`338d466a2308711e2c6befc838a29b77e6c1a5d1574350441bf9b5f46845a88e`; tag
`v0.1.0-rc.19` and the GitHub prerelease resolve to the release commit; npm
`next` points to RC19 while `latest` remains RC17. No live Pi configuration or
credential was modified.
