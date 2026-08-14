# Pi Multi-Orchestrator

Pi Multi-Orchestrator is a Pi extension for coordinating bounded investigation, implementation, and verification workers across model routes exposed by 9Router. Boss orchestration remains deferred.

## Status

The current local candidate is `0.1.0-rc.11`; rc.1 through rc.10 are historical
candidates. rc.11 builds only from exact Git content,
independently reruns the bound test definition, recursively authenticates the
review bundle against an externally supplied root digest, and retains rc.3's
independently passing worker-safety boundary. It remains local, not public or
production-ready. M12.1 and M12.2 local verification pass; External Review #5,
Planner/manual acceptance, and M12.2 live-route gates remain pending.

M0 through M10 are accepted. M11 remains implemented but not accepted. M12.1 adds explicit `@orchestrator <goal>` Mission entry from Pi's native input event, reusing the canonical MissionStore creation path, and clarifies Direct Workers versus canonical Mission/M7 verification. M12.2 adds bounded Hybrid Smart Routing: deterministic bilingual local signals, optional AI Triage for ambiguous prompts, and a user choice between a canonical Mission and the original normal prompt. M12.3 and the M12 final routing gate are not started. Routed workers consume packet-derived context, but worker and reviewer evidence are not automatically canonical truth.

This is still an early development extension, not the complete multi-agent orchestrator or a stable public release. 9Router's internal account/combo fallback remains opaque. Health is stored separately from ConfigStore/export/history. Quality rejection is separate from provider health. The accepted M8.5 analyst is optional, manual-only, cannot alter deterministic metrics, and cannot Apply recommendations. M9's Boss runtime remains explicitly deferred; the Control Center does not add autonomous planning, background work, or automatic priority changes. M10 safety policies are application-level and do not claim an OS sandbox; M12.1 and M12.2 isolated offline TUI smoke passed, while human/manual acceptance remains open validation. M11's local RC and M12.1/M12.2 local candidates are not public or production-ready; independent review, Planner/manual acceptance, and applicable real-route acceptance remain open. A quality PASS is not by itself mission completion, canonical evidence admission, or release readiness.

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

## Local release candidate install

The `.tgz` is the immutable release artifact. Pi `0.84.1` does not unpack a
local tarball passed directly to `pi install`; verify its checksum, extract it
to a fresh directory, and install the extracted `package/` directory in
isolated Pi settings. The source checkout is never the installed package. The
candidate is local-only and not a public or production release.

```sh
npm install
npm run typecheck
npm test
npm run check
```

Tests use Node's built-in runner, temporary directories, and a random loopback fake 9Router. They load the built extension into the installed Pi `0.84.1`, list only selected fake routes, complete one deterministic fake streamed turn, and exercise a pool edit/save/reload through Pi's RPC UI protocol. They use no live credentials, paid models, external network, or live agent directory.

Development loading is explicit; the extension is not installed into the live Pi directory:

```sh
PI_MULTI_ORCH_CONFIG_ROOT=/path/to/isolated/root \
  pi --no-extensions -e ./dist/host/pi-extension.js
```

The M2 commands are `/orchestrator`, `/9router-models [filter]`, `/9router-refresh`, and `/9router-status`. M3 adds `/pool-models [investigation|implementation|verification]` and `/pool-status`; the same three pool editors are available from `/orchestrator`. M4 adds `/routing-status [pool]`, `/route-health [filter]`, and `/routing-settings`, plus Routing & Fallback and Health & Quotas sections in `/orchestrator`. M5 adds parent-only `delegate_agent` and Direct Worker `/subagent-run`; role and pool are explicit, while M4 selects the exact route/model. M6 adds `/missions` and `/mission-packet <mission-id> <task-id>` plus Context & Mission Settings in `/orchestrator`. M7 adds `/quality-status [mission-id] [task-id]` and confirmation-gated `/verify-task <mission-id> <task-id> [target-run-id]`; M8 adds `/analytics [24h|7d|30d|custom FROM TO]` and `/recommendations [pool]` with explicit details/apply/ignore actions. M8.5 adds `/recommendation-analyst` and the Statistics & Analytics → Recommendation Analyst menu with Deterministic only/AI-assisted mode, Verification Pool route selection, Analyze Now/Re-analyze, status, and last-analysis details. M9 makes `/orchestrator` the twelve-section Control Center; see the [operator guide](docs/OPERATOR_GUIDE.md). M12.1 adds `@orchestrator <goal>` at the beginning (surrounding whitespace allowed) of a normal Pi input; ordinary prompts are unchanged, and empty entry reports `Add a goal after @orchestrator.` M12.2 adds Smart Routing inside Routing & Fallback: clear prompts stay normal, clear multi-stage prompts show a Run as Mission/Run Normally choice, and ambiguous prompts may use only a configured triage route. Direct Workers are foreground/ad-hoc execution; use `/verify-task` for canonical Mission/M7 verification. Analyst execution is explicit and never applies a recommendation. Task detail exposes verification history and bounded repair/re-review when reviewer and repair services are configured. Pool edits change validated configuration only and never select a route or launch a subagent. Routing status is a non-mutating preview; health reset changes only runtime health. Connection setup accepts an origin (normalized to `/v1`) or a `/v1` base URL and an environment reference such as `env:NINEROUTER_API_KEY`, never a raw key. Other URL paths are rejected.

## Scope boundary

M0 did not:

- modify `~/.pi/agent/` or project `.pi` settings;
- connect to or modify the user's 9Router deployment;
- read or store credentials;
- call a model API;
- create a GitHub repository or remote;
- implement the extension.

M1 through M12.2 implementation work did not modify any live environment. M10 is the latest accepted milestone; M11, M12.1, and M12.2 are local, implemented-but-not-accepted work. See `docs/ROADMAP.md` for the release gate.

## M9 accepted capability snapshot

M9 adds the unified `/orchestrator` Control Center with exactly twelve top-level sections, dashboard-first safe metadata, consistent native Pi selector/RPC navigation, textual loading/error/stale/empty states, model and pool management, routing/health controls, mission/quality workflows, analytics/recommendations/AI Analyst views, diagnostics, and safe ConfigStore backup/restore. M10 adds application-level trust/path/command policy, secret sanitization, cross-process locks and leases, validated SQLite recovery, integrity diagnostics, and fault-injection coverage. M11 adds the local `0.1.0-rc.4` package candidate, strict artifact verification, declarative capture-only worker result protocols, exact-Git source and test binding, compatibility/install/upgrade/rollback/rescue documentation, package Diagnostics, and staged dogfood/review records; it is not a public release. The Operator Guide documents the surface. Boss runtime, autonomous mission decomposition/scheduling, parallel workers/worktree isolation, and automatic recommendation Apply remain deferred. Human keyboard-driven TUI smoke remains open validation; STATE-9 records M9 acceptance on `2032a2b` with evidence HEAD `1200d3349506a1d414def0f3c1e044d712711d9d` and `146/146 PASS`; STATE-10 records M10 acceptance on `3a6990d` with `159/159 PASS`.
