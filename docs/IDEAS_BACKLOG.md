# Ideas backlog

This file records future product ideas that are already supported by project
direction. Presence in IDEAS_BACKLOG does **NOT** authorize implementation.
It does not create a milestone or promote an idea to a requirement.
Implementation requires an explicit mission and the state/acceptance gates in
[PROJECT_STATE_POLICY.md](PROJECT_STATE_POLICY.md).

## Status vocabulary

- `PROPOSED` — recorded for discussion; not authorized work.
- `UNDER DISCUSSION` — shaped by existing design or evidence, but not an
  authorized milestone.
- `PROMOTED TO ROADMAP` — an authorized future direction is already named in
  the roadmap; this entry still does not authorize implementation by itself.
- `DEFERRED` — explicitly kept out of the current release/milestone scope.
- `REJECTED` — explicitly declined; retain the reason when known.

## Metadata-only worker finalization Attempt diagnostics

**Status:** `PROPOSED`

`WorkerFinalizationReport` (`required` / `attempted` / `succeeded` /
`outcome` / optional `toolsExposed` / `stopReason`) is currently
in-memory on the executor Attempt and is lost when the Pi process exits.
MissionStore `finishAttempt` persists `terminalState`, mutation, and
result only. Live diagnosis of whether the bounded finalization turn ran
therefore cannot be done from the durable store.

A later mission may persist those metadata-only fields on the Attempt or
as an analytics event. It must not persist raw completions, transcripts,
or hidden reasoning. Presence here does not authorize implementation.

Evidence: [worker-retry-finalization-fallback-forensics.md](worker-retry-finalization-fallback-forensics.md),
ADR-048.

## Mission Cockpit / live Mission observability

**Status:** `UNDER DISCUSSION`

A richer live Mission view for the current stage, Boss, workers, elapsed time,
authoritative tokens/cost when available, verification state, repair/replan
cycle, and route/provider activity. Existing observability requirements and
the RC25 Mission analytics boundary support the idea; the backlog entry does
not claim that a full cockpit is shipped.

Evidence: [PRODUCT_SPEC.md](PRODUCT_SPEC.md) `OBS-001`,
[ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) `OBS-01`, and the existing
Control Center/analytics sections.

## Dynamic Route Catalog & Capability Sync

**Status:** `PROMOTED TO ROADMAP`

The existing future requirement covers manual **Refresh Now**, configurable
periodic refresh, added/removed/changed diffs, route-specific capabilities and
provenance, last-known-good snapshots, stale/missing state, provider-advertised
versus empirically observed capability, and safe user overrides.

Evidence: [CURRENT_STATE.md](CURRENT_STATE.md),
[ROADMAP.md](ROADMAP.md), and RC18/RC20 route-refresh boundaries.

## Controlled Route Benchmark & Compatibility Lab

**Status:** `DEFERRED`

Compare routes/models/Thinking Effort on the same task and repository snapshot
using quality, protocol/tool behavior, reliability, latency, and cost evidence.
This must remain distinct from observational production analytics and must not
select or rewrite routes implicitly.

Evidence: the RC20 decision and architecture explicitly defer Benchmark Lab
work.

## Data-driven Profile Builder

**Status:** `PROPOSED`

Use observed Mission, Pool, Boss, quality, cost, and reliability evidence to
help construct candidate profiles. Any generated profile remains a proposed
diff and requires the existing explicit, stale-safe Apply path.

Evidence: configurable profiles and sample-gated recommendations in
[PRODUCT_SPEC.md](PRODUCT_SPEC.md) and [DECISIONS.md](DECISIONS.md).

## Passive Procedural Skill Learning

**Status:** `DEFERRED`

Learn reusable workflows only from verified outcomes, with inspect, disable,
and forget controls. Stored material must exclude raw secrets, prompts,
transcripts, source/private paths, and provider responses.

Evidence: the project already separates privacy-safe Routing Memory from the
explicitly deferred procedural-skill direction.

## Richer cost / quality intelligence

**Status:** `PROPOSED`

Extend the existing metadata-only cost, token, quality, review, and repair
analytics with clearer comparisons, uncertainty, provenance, and decision
support without fabricating provider values.

Evidence: M8 analytics, quality metrics, and RC25 authoritative-usage rules.

## Advanced Health & Quota intelligence

**Status:** `PROPOSED`

Provide more useful health, quota, cooldown, and provider/resource visibility
while preserving `UNKNOWN` when no authoritative value exists and keeping
health/fallback separate from quality rejection.

Evidence: the existing Health & Quotas surface, M4 failure policy, and RC25
analytics boundaries.

## Future Explore / Exploit scheduling

**Status:** `PROPOSED`

Consider bounded exploration of eligible routes against exploitation of known
reliable routes, without changing stable route identity, pool ownership, or
the explicit fallback and quality-escalation boundaries.

Evidence: the current deterministic ordered scheduler and the documented
future scoring/tuning boundary.

## Boss performance comparison and Boss weight recommendations

**Status:** `UNDER DISCUSSION`

RC25 already records manual-only, sample/stale-safe Boss weight proposals.
Future work may make cross-Mission Boss performance comparison and
recommendation evidence richer; it must not auto-apply or rotate a pinned Boss
during a Mission.

Evidence: RC25 analytics/recommendation requirements and `ADR-042`.

## Richer route compatibility / capability validation

**Status:** `UNDER DISCUSSION`

Improve exact-route compatibility checks across context, Thinking Effort,
tools, resources, providers, and observed behavior. A shared visible model
family must not collapse materially different routes, and advertised
capabilities must remain distinct from empirical observations.

Evidence: the route-identity decisions, RC18 capability-sync requirement, and
RC20/RC21 catalog boundaries.

## Git push / npm publish as in-band Mission acceptance

**Status:** `REJECTED`

Using `git commit`, `git push`, or npm publication as a worker-executed
Mission acceptance criterion is rejected. Implementation workers never receive
`explicitlyAuthorized`; `git commit` is outside the allowlist and `git push` is
`NETWORK_OR_PUBLICATION`. Authorized RC29 / ADR-046 terminals such Goals as
`CAPABILITY_MISMATCH` instead of dispatching workers. Publication remains an
operator-owned step outside the Mission runtime.
