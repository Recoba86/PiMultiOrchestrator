# Pi Multi-Orchestrator

Pi Multi-Orchestrator is a planned Pi extension for coordinating a Boss model and bounded investigation, implementation, and verification workers across model routes exposed by 9Router.

## Status

M0 is a specification freeze and repository foundation. This repository intentionally contains no production extension, package manifest, credentials, or live Pi configuration.

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

## Scope boundary

M0 did not:

- modify `~/.pi/agent/` or project `.pi` settings;
- connect to or modify the user's 9Router deployment;
- read or store credentials;
- call a model API;
- create a GitHub repository or remote;
- implement the extension.

The next mission is M1 only: configuration, persistence primitives, schemas, migrations, and deterministic tests. See [Roadmap](docs/ROADMAP.md).
