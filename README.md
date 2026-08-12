# Pi Multi-Orchestrator

Pi Multi-Orchestrator is a Pi extension for coordinating bounded investigation, implementation, and verification workers across model routes exposed by 9Router. Boss orchestration remains deferred.

## Status

M0 through M7 are accepted. M8 is implemented but not accepted pending Planner review. M2 adds a real Pi `0.84.1` extension entrypoint, an environment-reference-only 9Router connection, bounded catalog discovery and last-known-good caching, explicit model enablement, dynamic provider registration, and the first Pi-native Models & 9Router control surface. M3 adds configuration-only management for the ordered Investigation, Implementation, and Verification pools. M4 adds pure routing preview/eligibility, bounded infrastructure fallback decisions, and separate runtime health state. M5 adds a foreground routed subagent executor using fresh in-memory Pi SDK child sessions, exact M4 route/model pinning, strict per-pool tools, bounded structured results, cancellation, and mutation-safe fallback. M6 adds a separate SQLite MissionStore, accepted-only Context Broker, immutable bounded TaskPacketV1 values, evidence admission, checkpoints, recovery, and `/missions` controls. M7 adds durable verification runs, quality decisions/status, conservative mechanical gates, reviewer diversity, bounded repair/re-review state, and `/quality-status` plus confirmation-gated `/verify-task`; M8 adds local metadata-only analytics, token/latency summaries, persistent reference billing profiles, pool-specific scores, nine drill-down views, and explicit recommendation actions; routed workers consume packet-derived context, but worker and reviewer evidence are not automatically canonical truth.

This is still an early development extension, not the complete multi-agent orchestrator or a stable public release. 9Router's internal account/combo fallback remains opaque. Health is stored separately from ConfigStore/export/history. Quality rejection is separate from provider health. Boss/planner runtime, cost/budget-aware routing, parallel workers, autonomous tuning, and full M9 control center remain deferred. A quality PASS is not by itself Planner acceptance, mission completion, canonical evidence admission, or release readiness; M8 remains pending Planner review.

The implementation contract is split across:

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Acceptance tests](docs/ACCEPTANCE_TESTS.md)
- [Roadmap](docs/ROADMAP.md)
- [Decision log](docs/DECISIONS.md)

Future agents must read [AGENTS.md](AGENTS.md) before changing the repository.

## Project state

For the authoritative current development snapshot, read [Current state](docs/CURRENT_STATE.md) first.

- [Release state](docs/RELEASE_STATE.md) — actual stability, packaging, compatibility, and release claims
- [Development log](docs/DEVELOPMENT_LOG.md) — milestone outcomes and accepted evidence
- [Project state policy](docs/PROJECT_STATE_POLICY.md) — truth hierarchy and update rules

## Validated host baseline

M0 inspected the installed runtime on 2026-08-12:

- `pi --version`: `0.84.1`
- package: `@earendil-works/pi-coding-agent@0.84.1`
- Node.js: `v22.23.0`
- Pi supports extension commands, custom TUI components, dynamic provider registration and removal, model/session APIs, provider lifecycle events, and an embeddable SDK.
- Pi's shipped subagent example creates isolated workers as child `pi` processes. Pi does not natively implement the Boss policy, three pools, canonical mission state, quality gates, or analytics required here.

Evidence and proof-of-concept boundaries are recorded in [Architecture](docs/ARCHITECTURE.md).

## Local checks

Requires Node.js `>=22.19.0` and npm.

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

The M2 commands are `/orchestrator`, `/9router-models [filter]`, `/9router-refresh`, and `/9router-status`. M3 adds `/pool-models [investigation|implementation|verification]` and `/pool-status`; the same three pool editors are available from `/orchestrator`. M4 adds `/routing-status [pool]`, `/route-health [filter]`, and `/routing-settings`, plus Routing & Fallback and Health & Quotas sections in `/orchestrator`. M5 adds parent-only `delegate_agent` and foreground `/subagent-run`; role and pool are explicit, while M4 selects the exact route/model. M6 adds `/missions` and `/mission-packet <mission-id> <task-id>` plus Context & Mission Settings in `/orchestrator`. M7 adds `/quality-status [mission-id] [task-id]` and confirmation-gated `/verify-task <mission-id> <task-id> [target-run-id]`; M8 adds `/analytics [24h|7d|30d|custom FROM TO]` and `/recommendations [pool]` with explicit details/apply/ignore actions. Task detail exposes verification history and bounded repair/re-review when reviewer and repair services are configured. Pool edits change validated configuration only and never select a route or launch a subagent. Routing status is a non-mutating preview; health reset changes only runtime health. Connection setup accepts an origin (normalized to `/v1`) or a `/v1` base URL and an environment reference such as `env:NINEROUTER_API_KEY`, never a raw key. Other URL paths are rejected.

## Scope boundary

M0 did not:

- modify `~/.pi/agent/` or project `.pi` settings;
- connect to or modify the user's 9Router deployment;
- read or store credentials;
- call a model API;
- create a GitHub repository or remote;
- implement the extension.

M1 through M7 implementation work did not modify any live environment. M7 is the latest accepted milestone; M8 implementation is pending Planner acceptance. See [Roadmap](docs/ROADMAP.md).
