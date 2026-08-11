# Pi Multi-Orchestrator

Pi Multi-Orchestrator is a planned Pi extension for coordinating a Boss model and bounded investigation, implementation, and verification workers across model routes exposed by 9Router.

## Status

M0, M1, and M2 are accepted. M2 adds a real Pi `0.84.1` extension entrypoint, an environment-reference-only 9Router connection, bounded catalog discovery and last-known-good caching, explicit model enablement, dynamic provider registration, and the first Pi-native Models & 9Router control surface.

This is still an early development extension, not the complete multi-agent orchestrator or a stable public release. It has no pool editor, priority router, workers, Boss execution, health engine, SQLite runtime state, analytics collection, or full M9 control center.

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

Tests use Node's built-in runner, temporary directories, and a random loopback fake 9Router. They load the built extension into the installed Pi `0.84.1`, list only selected fake routes, and complete one deterministic fake streamed turn. They use no live credentials, paid models, external network, or live agent directory.

Development loading is explicit; the extension is not installed into the live Pi directory:

```sh
PI_MULTI_ORCH_CONFIG_ROOT=/path/to/isolated/root \
  pi --no-extensions -e ./dist/host/pi-extension.js
```

The M2 commands are `/orchestrator`, `/9router-models [filter]`, `/9router-refresh`, and `/9router-status`. Connection setup accepts an origin (normalized to `/v1`) or a `/v1` base URL and an environment reference such as `env:NINEROUTER_API_KEY`, never a raw key. Other URL paths are rejected.

## Scope boundary

M0 did not:

- modify `~/.pi/agent/` or project `.pi` settings;
- connect to or modify the user's 9Router deployment;
- read or store credentials;
- call a model API;
- create a GitHub repository or remote;
- implement the extension.

M1 and M2 did not modify any live environment. M3 is next planned but is not started or authorized until the Planner accepts the DOCS-2 handoff. See [Roadmap](docs/ROADMAP.md).
