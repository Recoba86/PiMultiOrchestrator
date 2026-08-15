# Repository instructions for coding agents

## Startup gate

Before implementation work:

1. Read this file and `docs/CURRENT_STATE.md`.
2. Verify `git status`, current branch, HEAD, and worktree ownership.
3. Read `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE_TESTS.md`, `docs/DECISIONS.md`, and the assigned milestone in `docs/ROADMAP.md`.
4. Read `docs/IDEAS_BACKLOG.md` to distinguish non-authorizing future ideas from the assigned mission.
5. Verify that the requested mission is authorized and that its dependencies are accepted.
6. Do not assume in-progress capabilities are stable.
7. Inspect the installed Pi version and types before relying on a Pi API; M0's `0.84.1` baseline may be stale.

Project-state rules and source precedence are defined in `docs/PROJECT_STATE_POLICY.md`.

## Scope discipline

- Implement only the assigned milestone and explicit mission scope.
- Do not add speculative abstractions, workflows, UI, providers, or model-specific defaults.
- Keep model names, routes, pools, profiles, priorities, and thresholds in validated configuration rather than TypeScript logic.
- Preserve configuration compatibility. Schema changes require versioning, migration, rollback coverage, and an updated decision/specification when semantics change.
- Add the smallest deterministic test that proves each behavior change. Real-provider smoke tests are separate, explicit, and never an ordinary CI prerequisite.
- Do not declare the whole product complete because one milestone or test suite passes.
- Do not make optimistic completion claims or rewrite project-state documents from intention alone.
- Do not treat `CURRENT_STATE.md` as stronger evidence than Git, tests, and the accepted handoff.

## Accepted architecture guard

An ad-hoc implementation prompt does not silently override an accepted product
or architecture decision.

If requested work conflicts with `PRODUCT_SPEC.md`, `ARCHITECTURE.md`,
`DECISIONS.md`, `ACCEPTANCE_TESTS.md`, or an accepted invariant, the agent
must:

1. detect and explicitly identify the conflict before changing behavior;
2. not silently override the established contract;
3. require explicit mission authorization for an intentional design change;
4. update the applicable canonical design documents; and
5. add or update migration and regression evidence where relevant.

A vague or new prompt is not implicit authorization to break an established
invariant.

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

Before completing an authorized milestone:

1. Run the required tests and checks and record exact results.
2. Determine accepted state from Git, verification evidence, and the authorized handoff.
3. Update `docs/CURRENT_STATE.md`.
4. Update `docs/RELEASE_STATE.md` if release, compatibility, stability, or rollback information changed.
5. Append or update `docs/DEVELOPMENT_LOG.md` and update `docs/ROADMAP.md`.
6. Update `README.md`; update architecture, specification, decisions, and acceptance tests only when warranted.
7. Commit the documentation with the milestone unless the mission says otherwise.

Never modify live Pi configuration unless explicitly authorized, and never claim release or acceptance based only on planned scope or implementation intent.

## Canonical project-memory closure

Before implementation, reconcile the requested scope with Git, verification
evidence, the accepted handoff, the canonical contract documents, and the
non-authorizing `IDEAS_BACKLOG.md`.

Before completion, update the applicable `CURRENT_STATE.md`, `RELEASE_STATE.md`,
`DEVELOPMENT_LOG.md`, `ROADMAP.md`, and `IDEAS_BACKLOG.md`; update
`PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `DECISIONS.md`, or `ACCEPTANCE_TESTS.md`
when their contract changes. Code and canonical documentation must agree.
Never promote idea → planned → implemented → accepted → released without the
evidence and authorization required by `PROJECT_STATE_POLICY.md`.
