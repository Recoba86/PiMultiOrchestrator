# Release state

Last updated: 2026-08-12

This file records releasable product state. It does not promote development progress; see [Current state](CURRENT_STATE.md) for the operational snapshot.

## Current release snapshot

| Field | State |
|---|---|
| Latest accepted development milestone | M5 — Routed Subagent Execution |
| Accepted development commit | `80b00a65da0a922633d9809b8520983f90038118` |
| Accepted evidence HEAD | `c2e431aaf3384fc73acb2e7cd6201aa406d5266f` |
| Public stable release | NONE |
| Product version | NONE assigned |
| Development manifest version | `0.0.0-development` — not a release version |
| Release tag | NONE |
| Release commit | NONE |
| GitHub release | NONE |
| Installable production release | NONE |
| Production-ready | NO |
| Release rollback target | NONE; no release exists |
| Accepted development recovery reference | M5 implementation commit `80b00a65da0a922633d9809b8520983f90038118`; evidence HEAD `c2e431aaf3384fc73acb2e7cd6201aa406d5266f` |

Milestone acceptance does not itself create a product release.

## Compatibility and verification evidence

| Evidence | Current result |
|---|---|
| Configuration schema | Version 1 |
| Deterministic and fake integration suite | `97/97 PASS` |
| Typecheck | PASS |
| Aggregate check | PASS |
| Tested Pi version | `0.84.1` |
| Tested Node.js version | `22.23.0`; package requires `>=22.19.0` |
| Fake gateway integration | PASS |
| Actual Pi with fake gateway | PASS — model list, completion, RPC commands, pool mutation/reload, routing preview, health reset, and parent→child execution |
| Real live 9Router catalog | NOT VERIFIED — credential-gated probe was skipped |
| Real paid inference | NOT PERFORMED |

Fake-gateway behavior does not prove the live 9Router model count, metadata shape, resource/provider identity, subscription/account identity, or combo attribution.

## Known release blockers and limitations

- No public artifact, tag, GitHub release, installable production package, compatibility matrix, installation guide, or verified release rollback exists.
- The extension is loaded explicitly for development and is not installed into the user's live Pi configuration.
- Boss runtime, durable mission state, Context Broker, quality escalation, analytics, hardening, cost/budget-aware routing, and packaging milestones remain incomplete. M5 routed child execution is accepted; M6 is next planned and not started.
- A human keyboard-driven TUI smoke and live 9Router metadata verification remain open validation.

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
