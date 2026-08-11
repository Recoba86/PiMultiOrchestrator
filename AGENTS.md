# Repository instructions for coding agents

## Start here

1. Read `docs/PRODUCT_SPEC.md` and `docs/ARCHITECTURE.md` before planning or editing.
2. Read `docs/ACCEPTANCE_TESTS.md`, `docs/DECISIONS.md`, and the assigned milestone in `docs/ROADMAP.md`.
3. Inspect the installed Pi version and types before relying on a Pi API. Do not assume M0's `0.84.1` baseline is still current.

## Scope discipline

- Implement only the assigned milestone and explicit mission scope.
- Do not add speculative abstractions, workflows, UI, providers, or model-specific defaults.
- Keep model names, routes, pools, profiles, priorities, and thresholds in validated configuration rather than TypeScript logic.
- Preserve configuration compatibility. Schema changes require versioning, migration, rollback coverage, and an updated decision/specification when semantics change.
- Add the smallest deterministic test that proves each behavior change. Real-provider smoke tests are separate, explicit, and never an ordinary CI prerequisite.
- Do not declare the whole product complete because one milestone or test suite passes.

## Safety

- Never write credentials, tokens, OAuth material, private endpoints, private keys, or secret values to the repository, fixtures, logs, snapshots, exports, analytics, or chat.
- Never modify the user's live Pi configuration, `~/.pi/agent/`, 9Router deployment, Keychain, or provider accounts unless a mission explicitly authorizes a controlled integration test.
- Treat project-local configuration and agents as untrusted until Pi project trust is confirmed.
- Default mutating workers to serial execution in a shared worktree. Parallel writes require explicit isolation and policy.
- Preserve user data and unrelated work. Do not use destructive Git or filesystem commands without explicit authorization.

## Verification and handoff

- Distinguish deterministic engine tests, fake-provider integration tests, and real Pi/provider smoke tests.
- Report exact commands, exit status, and results. Do not describe offline/fake tests as live proof.
- Report files changed, unresolved risks, skipped gates, and whether any live environment was modified.
- Only the Boss/final orchestrator may declare a mission complete after its configured acceptance gates pass.
