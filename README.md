# Pi Multi-Orchestrator

Pi Multi-Orchestrator is a Pi extension for coordinating bounded investigation, implementation, and verification workers across model routes exposed by 9Router. Boss orchestration remains deferred.

## Status

The public release line is RC21 (`0.1.0-rc.21`), while the current source also
contains the RC22 (`0.1.0-rc.22`) local candidate. RC22 unifies model/route
selector presentation across the Model Router, all three Pool editors and Add
Route flows, Route Health, Smart Routing, and Recommendation Analyst: normal
rows show one remote model ID, hide internal route IDs and status/thinking
clutter, and preserve exact route identity internally. RC21 remains published
as a public prerelease on npm with `next`; `latest` remains `0.1.0-rc.17`.
RC22 is local-only and is not a stable or production release.

M0 through M10 are accepted. M11 remains implemented but not accepted. M12.1 adds explicit `@orchestrator <goal>` Mission entry from Pi's native input event, reusing the canonical MissionStore creation path, and clarifies Direct Workers versus canonical Mission/M7 verification. M12.2 adds bounded Hybrid Smart Routing: deterministic bilingual local signals, optional AI Triage for ambiguous prompts, and a user choice between a canonical Mission and the original normal prompt. M12.3 adds privacy-safe abstract Routing Memory, explicit Always rules, repeated-choice learning, conservative matching, AUTO_MISSION, NORMAL suppression, conflict/complexity safety, and Learned Behaviors management. RC13, RC15, and RC16 are historical; RC17 is the successor candidate after the final RC16 live M7 reviewer handoff blocked before structured submission. Routed workers consume packet-derived context, but worker and reviewer evidence are not automatically canonical truth.

This is still an early development extension, not the complete multi-agent orchestrator or a stable public release. 9Router's internal account/combo fallback remains opaque. Health is stored separately from ConfigStore/export/history. Quality rejection is separate from provider health. The accepted M8.5 analyst is optional, manual-only, cannot alter deterministic metrics, and cannot Apply recommendations. M9's Boss runtime remains explicitly deferred; the Control Center does not add autonomous planning, background work, or automatic priority changes. M10 safety policies are application-level and do not claim an OS sandbox. RC21 never replaces an external Pi provider, shrinks its catalog, silently maps Auto to Off, silently downgrades stale explicit effort, fabricates thinking capabilities, auto-assigns pools, or persists a raw API key; RPC raw-key setup fails closed. Periodic automatic catalog sync and Benchmark Lab remain future work. A quality PASS is not by itself mission completion, canonical evidence admission, or public release readiness.

The implementation contract is split across the repository files
`docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE_TESTS.md`,
`docs/ROADMAP.md`, and `docs/DECISIONS.md`. Future agents must read `AGENTS.md`
before changing the repository.

## Project state

For the authoritative current development snapshot, read `docs/CURRENT_STATE.md`
first. Release claims, milestone history, and policy are in
`docs/RELEASE_STATE.md`, `docs/DEVELOPMENT_LOG.md`, and
`docs/PROJECT_STATE_POLICY.md`. The packaged [Operator Guide](docs/OPERATOR_GUIDE.md)
covers Control Center navigation and safety boundaries.

## Validated host baseline

M0 inspected the installed runtime on 2026-08-12:

- `pi --version`: `0.84.1`
- package: `@earendil-works/pi-coding-agent@0.84.1`
- Node.js: `v22.23.0`
- Pi supports extension commands, custom TUI components, dynamic provider registration and removal, model/session APIs, provider lifecycle events, and an embeddable SDK.
- Pi's shipped subagent example creates isolated workers as child `pi` processes. Pi does not natively implement the Boss policy, three pools, canonical mission state, quality gates, or analytics required here.

Evidence and proof-of-concept boundaries are recorded in `docs/ARCHITECTURE.md`.

## Local checks

Requires Node.js `>=22.19.0` and npm.

## RC21 public prerelease install

The `.tgz` is the immutable release artifact. Pi `0.84.1` does not unpack a
local tarball passed directly to `pi install`; verify its checksum, extract it
to a fresh directory, and install the extracted `package/` directory in
isolated Pi settings. The source checkout is never the installed package. For
the public prerelease, use Pi's npm package source:

```sh
pi install npm:pi-multi-orchestrator@0.1.0-rc.21
```

Exact RC20 → RC21 upgrade pin:

```sh
pi install npm:pi-multi-orchestrator@0.1.0-rc.21
```

This is an early prerelease, not a stable or production release. After loading,
open `/orchestrator` → **Models & 9Router** → **Refresh Models**. Enable a PMO
route before adding it to a Pool; each Pool entry stores its own Thinking Effort
(`Auto`, `Low`, `Medium`, `High`, `XHigh`, or `Max` when supported). Auto omits
the PMO override and defers to Pi/provider defaults; it is not Off.

The published artifact is bound to commit
`68c0c0f82c5c82d7944512ea64aadd05a2e4569e`, tag `v0.1.0-rc.21`, and the
independent release-bundle root SHA-256
`7e2fd35553fd46f232d5f8e286ef272c1c8a2d018037c0b6b3763e4fab89c017`.

For the accepted RC17 publication, use the exact npm pin:

```sh
pi install npm:pi-multi-orchestrator@0.1.0-rc.17
```

The source-bound Git fallback is
`git:github.com/Recoba86/PiMultiOrchestrator@v0.1.0-rc.17`.

```sh
npm install
npm run typecheck
npm test
npm run check
```

Tests use Node's built-in runner, temporary directories, and a random loopback fake 9Router. They load the built extension into the installed Pi `0.84.1`, list only selected fake routes, complete one deterministic fake streamed turn, and exercise a pool edit/save/reload through Pi's RPC UI protocol. They use no live credentials, paid models, external network, or live agent directory.

Development loading is explicit; the extension is not installed into the live Pi directory:

```sh
RC21_ROOT="$(mktemp -d)"
mkdir -p "$RC21_ROOT/pmo" "$RC21_ROOT/sessions"
PI_MULTI_ORCH_CONFIG_ROOT="$RC21_ROOT/pmo" \
PI_CODING_AGENT_SESSION_DIR="$RC21_ROOT/sessions" \
PI_OFFLINE=1 \
  pi --no-extensions -e "$PWD/dist/host/pi-extension.js" \
  --no-session --no-context-files
```

This keeps PMO/session state disposable while the normal Pi model/auth
catalog remains the operator's existing configuration. Do not run refreshes or
model requests during a compatibility check.

The M2 commands are `/orchestrator`, `/9router-models [filter]`, `/9router-refresh`, and `/9router-status`. M3 adds `/pool-models [investigation|implementation|verification]` and `/pool-status`; the same three pool editors are available from `/orchestrator`. M4 adds `/routing-status [pool]`, `/route-health [filter]`, and `/routing-settings`, plus Routing & Fallback and Health & Quotas sections in `/orchestrator`. M5 adds parent-only `delegate_agent` and Direct Worker `/subagent-run`; role and pool are explicit, while M4 selects the exact route/model. M6 adds `/missions` and `/mission-packet <mission-id> <task-id>` plus Context & Mission Settings in `/orchestrator`. M7 adds `/quality-status [mission-id] [task-id]` and confirmation-gated `/verify-task <mission-id> <task-id> [target-run-id]`; M8 adds `/analytics [24h|7d|30d|custom FROM TO]` and `/recommendations [pool]` with explicit details/apply/ignore actions. M8.5 adds `/recommendation-analyst` and the Statistics & Analytics → Recommendation Analyst menu with Deterministic only/AI-assisted mode, Verification Pool route selection, Analyze Now/Re-analyze, status, and last-analysis details. M9 makes `/orchestrator` the twelve-section Control Center; see the [operator guide](docs/OPERATOR_GUIDE.md). M12.1 adds `@orchestrator <goal>` at the beginning (surrounding whitespace allowed) of a normal Pi input; ordinary prompts are unchanged, and empty entry reports `Add a goal after @orchestrator.` M12.2 adds Smart Routing inside Routing & Fallback: clear prompts stay normal, clear multi-stage prompts show a Run as Mission/Run Normally choice, and ambiguous prompts may use only a configured triage route. M12.3 adds Routing Memory controls in that same section, `Always orchestrate similar tasks`, learned Mission/Normal preferences, and abstract-only Learned Behaviors/backup management. RC19 adds existing-Pi 9Router catalog adoption and TUI-only masked Test & Save setup through Pi auth; RC20 adds manual live Refresh Models, discovered-versus-enabled route gating, and per-Pool-route Thinking Effort with capability-aware choices; RC21 makes static external-provider Refresh Models query upstream `/v1/models`, preserves nested capability metadata, and hides internal route IDs from normal picker rows. Direct Workers are foreground/ad-hoc execution; use `/verify-task` for canonical Mission/M7 verification. Analyst execution is explicit and never applies a recommendation. Task detail exposes verification history and bounded repair/re-review when reviewer and repair services are configured. Pool edits change validated configuration only and never select a route or launch a subagent. Routing status is a non-mutating preview; health reset changes only runtime health. Connection setup accepts an origin (normalized to `/v1`) or a `/v1` base URL and an environment reference such as `env:NINEROUTER_API_KEY`, never a raw key; the TUI-only setup flow tests a raw key in memory before delegating storage to Pi auth. Other URL paths are rejected.

## Scope boundary

M0 did not:

- modify `~/.pi/agent/` or project `.pi` settings;
- connect to or modify the user's 9Router deployment;
- read or store credentials;
- call a model API;
- create a GitHub repository or remote;
- implement the extension.

M1 through M12 final-gate work did not modify any live environment. M10 remains the latest accepted development milestone; RC21 is a public prerelease, not a stable or production release. See `docs/ROADMAP.md` for the release state.

## M9 accepted capability snapshot

M9 adds the unified `/orchestrator` Control Center with exactly twelve top-level sections, dashboard-first safe metadata, consistent native Pi selector/RPC navigation, textual loading/error/stale/empty states, model and pool management, routing/health controls, mission/quality workflows, analytics/recommendations/AI Analyst views, diagnostics, and safe ConfigStore backup/restore. M10 adds application-level trust/path/command policy, secret sanitization, cross-process locks and leases, validated SQLite recovery, integrity diagnostics, and fault-injection coverage. M11 adds the local `0.1.0-rc.4` package candidate, strict artifact verification, declarative capture-only worker result protocols, exact-Git source and test binding, compatibility/install/upgrade/rollback/rescue documentation, package Diagnostics, and staged dogfood/review records; it is not a public release. The Operator Guide documents the surface. Boss runtime, autonomous mission decomposition/scheduling, parallel workers/worktree isolation, and automatic recommendation Apply remain deferred. Human keyboard-driven TUI smoke remains open validation; STATE-9 records M9 acceptance on `2032a2b` with evidence HEAD `1200d3349506a1d414def0f3c1e044d712711d9d` and `146/146 PASS`; STATE-10 records M10 acceptance on `3a6990d` with `159/159 PASS`.
