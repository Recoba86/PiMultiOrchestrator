# RC25 Operational Boss / Orchestrator Design

## Scope

RC25 turns the existing Boss profile placeholder into persistent configuration
and wires it into the canonical Mission path. Boss remains a Mission-level
planner and evaluator; Investigation, Implementation, and Verification remain
the only worker pools and keep their existing routing and weighted rotation.

## Configuration

Boss profiles retain the RC24 `routeIds` shape for import compatibility and gain
additive `entries` plus `schedulingPolicy` fields. Each entry stores the stable
route ID, enabled state, thinking effort, and numeric weight. A pure runtime
migration derives entries from old route IDs, defaults missing effort and
weights, and keeps empty profiles explicitly unconfigured. The active profile
may be disabled; no route is selected implicitly.

The Control Center editor uses the existing canonical model presentation. Normal
labels expose only the clean remote model identity; stable route IDs remain the
persistent value and are shown only by Inspect. Eligible choices are PMO-enabled
chat routes with an available catalog/model projection. The editor persists
route identity, per-route effort/weight, and profile enablement through
`ConfigStore.update`, and nested actions return to the editor.

## Mission lifecycle

One bounded Mission goal-loop is shared by explicit `@orchestrator` input and
Smart Routing/AUTO_MISSION. At the first cycle it selects one eligible Boss
entry with deterministic weighted rendezvous keyed by Mission ID and persists
the assignment before inference. Every subsequent Boss plan, repair/replan,
verification interpretation, and terminal decision uses that assignment.

Only an infrastructure failure can trigger fallback. Fallback selects an
explicitly configured eligible alternative, records the original route,
replacement, and bounded reason, and pins the replacement for the remainder of
the Mission. Quality rejection never rotates the Boss.

Each cycle may create Investigation or Implementation tasks, execute them via
the existing worker path, invoke M7 Verification through the existing quality
service, and return bounded evidence to the Boss. Completion requires the goal
and acceptance criteria to be satisfied plus required verification gates. A
rejection, failed worker, or recoverable provider failure replans while budget
and loop bounds remain. Exhaustion is explicit BLOCKED/AWAITING_USER evidence,
never COMPLETED.

## Analytics and recommendations

Boss assignment, cycle, repair, verification, fallback, duration, and
authoritative usage metadata are emitted as metadata-only analytics events
keyed by Mission and route. The existing recommendation architecture generates
Boss weight proposals without applying them. Applying a Boss proposal is an
explicit user action and is stale-checked against the current profile.

## Verification

Focused tests cover additive migration, UI persistence/restart, privacy,
weighted distribution, assignment pinning, infrastructure fallback, a
reject-then-repair multi-cycle Mission, equivalence of both Mission entrypoints,
analytics/recommendation persistence, and independence from worker-pool
scheduling. The full project check and release verifier remain required before
the RC25 artifact is frozen.
