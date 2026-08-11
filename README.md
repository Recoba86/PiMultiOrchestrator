# Pi Multi-Orchestrator

Pi Multi-Orchestrator is a planned Pi extension for coordinating a Boss model and bounded investigation, implementation, and verification workers across model routes exposed by 9Router.

## Status

M0 and M1 are complete. M1 provides the offline configuration foundation only: strict versioned schemas, safe defaults, migrations, deterministic resolution, atomic JSON persistence, bounded history, recovery, import/export, and process-local mutation serialization.

This is not a production Pi extension yet. It has no extension entrypoint, TUI, network client, model execution, workers, routing engine, health engine, SQLite runtime state, or analytics collection.

The implementation contract is split across:

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Acceptance tests](docs/ACCEPTANCE_TESTS.md)
- [Roadmap](docs/ROADMAP.md)
- [Decision log](docs/DECISIONS.md)

Future agents must read [AGENTS.md](AGENTS.md) before changing the repository.

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

Tests use Node's built-in test runner and temporary directories only. They do not use Pi, 9Router, credentials, network access, paid models, or the live agent directory.

## Scope boundary

M0 did not:

- modify `~/.pi/agent/` or project `.pi` settings;
- connect to or modify the user's 9Router deployment;
- read or store credentials;
- call a model API;
- create a GitHub repository or remote;
- implement the extension.

M1 also did not modify any live environment. The next authorized milestone is M2 only: the 9Router catalog and selective model manager, beginning with fake/local integration and explicit credential boundaries. See [Roadmap](docs/ROADMAP.md).
