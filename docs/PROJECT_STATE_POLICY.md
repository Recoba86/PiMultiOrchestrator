# Project state policy

## Purpose and document responsibilities

This policy prevents planned work, implemented work, accepted milestones, and releases from being confused.

| Document | Responsibility |
|---|---|
| [Current state](CURRENT_STATE.md) | One-minute operational snapshot: accepted baseline, in-progress work, risks, and authorization boundary |
| [Release state](RELEASE_STATE.md) | Actual release, package, compatibility, and rollback claims |
| [Development log](DEVELOPMENT_LOG.md) | Append-oriented accepted milestone history and current milestone placeholder |
| [Roadmap](ROADMAP.md) | Planned milestone scope, order, and exit gates |
| [Ideas backlog](IDEAS_BACKLOG.md) | Non-authorizing future ideas and their discussion status |

These files may reference the same commit or milestone but must not duplicate each other's full content. `IDEAS_BACKLOG.md` is intentionally non-authoritative for implementation scope and cannot promote an idea to a requirement.

## Hierarchy of truth

When sources conflict, use this precedence and correct the weaker source:

1. actual repository state and Git history;
2. executable verification evidence and test results;
3. accepted milestone handoff from the Planner/reviewer;
4. `docs/CURRENT_STATE.md`;
5. architecture, specification, decision, acceptance, and roadmap summaries; and
6. README summaries.

Git presence alone proves that code exists, not that a milestone is accepted. Acceptance also requires the applicable evidence and authorized handoff.

## State vocabulary

- **PLANNED:** Scoped for possible future work; not started and not authorized merely by appearing in the roadmap.
- **IN PROGRESS:** Work is active; results and final evidence are not accepted.
- **IMPLEMENTED BUT NOT ACCEPTED:** Code or documentation exists, but required gates or authorized review remain incomplete.
- **ACCEPTED:** The milestone's required gates passed and the Planner/reviewer accepted the evidence and commit.
- **RELEASED:** An accepted release artifact/tag was actually published through an authorized release process.
- **DEPRECATED:** Previously supported behavior is explicitly retired, with replacement/migration status recorded.

A capability may appear under Stable / Accepted only after its owning milestone is ACCEPTED. Agents must not mark a milestone complete merely because code was written or a partial suite passed.

## Required evidence inspection

Before updating state, inspect:

- current HEAD, branch, worktree status, and relevant Git history;
- exact test/check evidence and its level (deterministic, fake integration, Pi smoke, or live route);
- the accepted Planner/reviewer handoff; and
- the relevant roadmap exit gate.

Never infer implementation or acceptance from the roadmap alone. If evidence is missing, record it as unknown or not accepted.

## Accepted milestone documentation gate

Every accepted milestone must update, where applicable:

- `docs/CURRENT_STATE.md`;
- `docs/RELEASE_STATE.md` when stability, compatibility, packaging, release, or rollback information changed;
- `docs/DEVELOPMENT_LOG.md`;
- `docs/ROADMAP.md`; and
- `docs/IDEAS_BACKLOG.md` when an idea is promoted, deferred, or rejected; and
- `README.md`.

Update these only when architectural or behavioral contracts change:

- `docs/ARCHITECTURE.md`;
- `docs/PRODUCT_SPEC.md`;
- `docs/DECISIONS.md`; and
- `docs/ACCEPTANCE_TESTS.md`.

Commit required state-document updates with the milestone unless the mission explicitly says otherwise. A milestone handoff is incomplete if its mandatory current-state update is missing.

## Accepted architecture guard

An ad-hoc implementation prompt does not silently override an accepted product
or architecture decision. If requested work conflicts with `PRODUCT_SPEC.md`,
`ARCHITECTURE.md`, `DECISIONS.md`, `ACCEPTANCE_TESTS.md`, or an accepted
invariant, the conflict must be identified before behavior changes; the
established contract must not be silently overridden; intentional changes
require explicit mission authorization; affected canonical design documents
must be updated; and migration/regression evidence must be added where
relevant.

## Canonical closure sequence

Before implementation, inspect Git state, current/release state, the accepted
handoff, the assigned roadmap gate, the contract documents, and the
non-authorizing ideas backlog. Before completion, reconcile code, tests,
release evidence, and canonical documentation. Never promote
`idea -> planned -> implemented -> accepted -> released` from intention alone.

## Freshness and release independence

`CURRENT_STATE.md` must carry a `Last updated` field and be refreshed whenever an accepted milestone closes. An accepted development milestone does not automatically create a release. `RELEASE_STATE.md` may claim RELEASED only from actual tag/artifact/publication evidence and must preserve known compatibility, limitations, and rollback information.

## Concurrent development

When another worktree or session is active:

- identify its mission as in progress, not accepted;
- do not use its uncommitted state as authoritative evidence;
- do not inspect or modify its uncommitted files; and
- do not reset, clean, stash, merge, or otherwise disturb that worktree.

## Corrections and history

Do not rewrite prior milestone history to make it cleaner. Correct factual mistakes explicitly, naming the correction evidence and date. Never update state files from intention alone or describe planned/in-progress capabilities as stable facts.

## Validation approach

Use direct required-file, relative-link, Markdown, secret-pattern, diff-scope, and Git-status checks during milestone closure. No prose-parsing state validator is maintained: acceptance meaning comes from evidence and authorized review, and fragile prose heuristics would create false confidence.
