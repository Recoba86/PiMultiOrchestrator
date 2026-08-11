# Release state

Last updated: 2026-08-12

This file records releasable product state. It does not promote development progress; see [Current state](CURRENT_STATE.md) for active work.

## Current release snapshot

| Field | State |
|---|---|
| Development HEAD | Branch-dependent; inspect Git. The documentation worktree started from accepted M1, while unaccepted M2 development is elsewhere. |
| Last accepted milestone | M1 — Configuration Foundation |
| Last accepted commit | `b451408a57306cdb0c0cd9d4b41f76edd92c9395` |
| Current development milestone | M2 — IN PROGRESS / NOT ACCEPTED |
| Latest stable product release | None |
| Product version | None assigned |
| Development manifest version | `0.0.0-development` — not a release version |
| Release tag | None |
| Release commit | None |
| GitHub remote/release | None as of the accepted M1 state |
| Stable installable Pi package | None claimed |
| Production-ready | NO |
| Release rollback target | None; no release exists |
| Accepted development recovery reference | M1 commit `b451408a57306cdb0c0cd9d4b41f76edd92c9395` |

Milestone acceptance does not itself create a product release.

## Compatibility and verification evidence

| Evidence | Current result |
|---|---|
| Configuration schema | Version 1 |
| M1 deterministic tests | `41/41 PASS` (Planner-supplied accepted evidence) |
| M1 typecheck | PASS |
| M1 aggregate check | PASS |
| Tested Pi versions | `0.84.1` API/types inspected read-only during M0; no production extension runtime claimed |
| Tested Node.js versions | `v22.23.0` most recently validated baseline; package requires `>=22.19.0` |
| Fake gateway validation | Not accepted yet; M2 responsibility |
| Real gateway validation | None accepted |
| Real inference validation | None accepted |

## Known release blockers and limitations

- The accepted implementation is an offline configuration foundation, not a Pi orchestration runtime.
- M2 catalog, provider bridge, TUI, resource-identity, and controlled runtime proofs are unaccepted.
- Later routing, workers, durable mission state, quality gates, analytics, hardening, packaging, install, upgrade, and rollback milestones are not complete.
- No public artifact, tag, compatibility matrix, installation guide, or independent release review exists.

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
