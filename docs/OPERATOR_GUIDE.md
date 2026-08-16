# Pi Multi-Orchestrator operator guide

This guide describes the Control Center in Pi `0.84.1`. RC28 is the current
public `next`-tagged prerelease; RC27 is superseded. Source currently also
prepares RC30 (`0.1.0-rc.30`) as a local unpublished candidate. RC29
(`0.1.0-rc.29`) remains a frozen unpublished verified candidate after a
live Mission COMPLETED and must not be modified. None of these are public
tags, npm publications, accepted milestones, or a GitHub Release for RC30.
Public RC28 is immutable. None of these are a
stable or production release. Local validation
uses isolated roots and never installs into
`~/.pi/agent/` unless the operator explicitly chooses the pinned package.

## Open the Control Center

Run `/orchestrator` from a Pi session with the extension loaded. The Home view
shows safe metadata first: provider/catalog state, enabled routes, the three
pool counts, observed health, mission/evidence and quality availability,
analytics/recommendation state, analyst state, and the accepted milestone.

The top-level menu has exactly these sections, in this order:

1. Models & 9Router
2. Investigation Pool
3. Implementation Pool
4. Verification Pool
5. Boss / Orchestrator Profiles
6. Routing & Fallback
7. Health & Quotas
8. Budget / Quality Profiles
9. Context & Mission Settings
10. Statistics & Analytics
11. Diagnostics
12. Backup / Restore

Pi's native selectors provide keyboard navigation: Up/Down (or `j`/`k`),
Enter, and Esc/Back. Selectors are also available through Pi RPC UI mode.
Long values are shown in detail notifications rather than being treated as
status colors. Every list has an explicit empty, unavailable, stale, or error
message where applicable.

## Section guide

- **Models & 9Router** searches the discovered catalog, shows exact remote IDs,
  source/resource and projected/actual availability, and has a
  visible **Refresh Models** action that performs a live provider/9Router
  refresh and reports added, removed, and changed entries. An existing Pi-owned 9Router
  provider is browsed in place and is never replaced or unregistered. If no
  provider exists, choose **Set Up 9Router**, enter the base URL, enter the key
  in the masked TUI prompt, and confirm **Test & Save**. The catalog is tested
  first; Pi auth stores the key and PMO stores only a `pi-auth` reference.
  Credential values are never displayed. Normal model rows hide internal local
  route IDs; **Inspect** and Diagnostics retain exact route IDs for support. The
  Model Router prefixes enabled rows with `[x]` and discovered-but-disabled
  rows with `[ ]`; Enter opens Inspect plus the existing Enable/Disable action,
  rather than toggling the checkbox directly.
  RPC setup fails closed because Pi `0.84.1` has no masked secret-input field.
- **Investigation Pool**, **Implementation Pool**, and **Verification Pool**
  share the same ordered editor. Add, inspect, remove, enable/disable, and
  move entries without changing provider registration. Add Model offers only
  PMO-enabled routes and then asks for the supported Thinking Effort. Each
  pool entry stores its own `Auto`, `Low`, `Medium`, `High`, `XHigh`, or `Max`
  value; Auto omits the Pi override and is not Off. A stale explicit effort is
  shown as invalid and is unavailable until changed. Implementation and
  other mutating actions retain their existing confirmation/idle gates. The
  Scheduling Policy action selects Priority (the legacy ordered behavior) or
  Weighted Rotation. Weighted entries use integer weights from 0 to 1000000;
  zero-weight entries are excluded only by Weighted Rotation, and the editor
  shows each route's effective share. **View Recommendation** is available
  for weighted pools when analytics has at least 10 origin-tagged attempts per
  comparable route; Apply and Ignore are explicit and stale-safe.
  Verification Pool is shared route configuration: Direct Verification Workers
  are standalone, while canonical Mission reviewers use it for M7. Use
  `/subagent-run` for the former and `/verify-task` for the latter.
- **Boss / Orchestrator Profiles** edits the active Boss profile. Select
  multiple available chat routes, set each route's Thinking Effort and integer
  weight, and enable/disable the profile. The view shows the profile name,
  the Boss that weighted scheduling would actually select, the current editor
  selection, and each route's scheduling vs fallback eligibility. A stored
  default name of `Unconfigured Boss` is not shown after routes exist.
  Normal rows show canonical remote
  model labels; exact route IDs are available only through Inspect. Shares are
  calculated from positive weights. A Mission selects one eligible Boss route
  once using deterministic weighted assignment and persists that pin across
  planning, worker-task evaluation, repair/replan cycles, M7 interpretation,
  and the terminal decision. Weight 0 excludes a route from that assignment
  but does not by itself forbid infrastructure fallback. Infrastructure failure
  may use one explicit unused fallback, including a weight-0 enabled route,
  and records the original/replacement route, failure class, and reason;
  protocol or quality rejection never rotates the Boss. Inspect reports the
  classified invocation stage and class rather than a black-box infrastructure
  sentence.
- **Routing & Fallback** is a non-executing preview of policy, eligibility,
  diversity, cooldown, and no-route reasons. Its settings also contain Smart
  Routing. Smart Routing is ON by default: clear explanations/questions and
  narrow one-step changes continue normally; clear multi-stage work shows a
  one-shot `Run as Mission` / `Run Normally` choice; and ambiguous prompts use
  AI Triage only when an available Primary route is explicitly configured.
  Triage runs are bounded, return strict JSON, and may use the configured
  Fallback only for a capability failure. If triage is unavailable, the user
  still receives the Mission-or-normal choice. Settings are stored in the
  versioned, atomic, rollback-capable `smart-routing.json` sidecar; stale route
  IDs remain visible and never silently select a replacement. Routing Memory is
  also ON by default and stores only abstract bilingual signatures. The Mission
  recommendation includes `Always orchestrate similar tasks`, which creates
  one canonical Mission and an explicit durable rule. Repeated Mission or
  Normal choices learn only after consistent observations; strong authorized
  matches can use AUTO_MISSION, while conflicts and materially more complex or
  sensitive work return to a safe user choice. **Learned Behaviors** lets the
  user inspect provenance, confidence, observations, language, task family,
  risk, and enabled state, then enable/disable/delete rules, forget learned
  rules, or reset all memory. Prompts, transcripts, source text, tool output,
  provider responses, and credentials are never displayed or persisted. **Health &
  Quotas** shows observed route health and cooldowns. Provider quota remaining
  is `UNKNOWN` unless an authoritative value exists.
- **Budget / Quality Profiles** shows quality gates, metadata-only analytics
  collection, and configured reference billing profiles. Missing pricing or
  mixed-currency values remain `UNKNOWN`; this view does not enable budget-aware
  routing.
- **Context & Mission Settings** opens mission/task, packet, evidence,
  checkpoint, verification, repair, and quality-history controls. Operational
  completion, quality status, and canonical evidence admission remain separate.
- **Statistics & Analytics** provides the accepted Overview, Missions, Pools,
  Routes, Tokens, Cost, Quality, Fallbacks, Recommendations, and Recommendation
  Analyst views for 24h, 7d, 30d, all-time, or custom windows. The Pools view
  includes scheduler origin, thinking-effort, and observed-weight metadata;
  unknown cost remains unknown and is never fabricated.
- **Diagnostics** displays sanitized provider and observed-health metadata,
  Mission/Analytics integrity state, local Security & Trust, and the
  permission matrix; it never prints prompts, transcripts, tool output,
  credentials, or stack traces. Unknown projects are untrusted by default.
- **Backup / Restore** exposes ConfigStore generation/history, safe export, and
  confirmation-gated restore. MissionStore and AnalyticsStore offer validated,
  confirmation-gated SQLite-native backup snapshots; Routing Memory offers a
  validated abstract-only JSON backup/restore. Invalid or corrupt snapshots
  are rejected rather than replaced with empty state.

## Recommendations and analyst

Deterministic M8 recommendations remain authoritative. Details, Ignore, and
Apply are explicit actions; Apply revalidates staleness and uses
RecommendationApplicationService → PoolManager → ConfigStore. There is no
automatic priority or weight mutation. `/recommendations boss` creates a
sample-gated Boss weight proposal for the active profile; it remains proposed
until the user explicitly Applies it. Weighted recommendations are
deterministic heuristics over reliability, quality decisions, latency, and
repair rate; they preserve the current positive-weight total and record their
baseline/suggested maps. Insufficient or origin-unknown evidence returns no
recommendation.

The optional M8.5 Recommendation Analyst is under Statistics & Analytics. It
uses only a selected Verification Pool route, receives bounded analytics
metadata, and runs only after **Analyze Now** or **Re-analyze**. Its structured
SUPPORT, OPPOSE, or INSUFFICIENT_EVIDENCE result is advisory, bounded, and
fingerprinted; changed inputs mark it stale. Analyst failures leave the
deterministic recommendation usable.

## Direct commands

The direct M2–M8.5 commands remain available, including `/9router-models`,
`/pool-models`, `/pool-status`, `/routing-status`, `/route-health`,
`/routing-settings`, `/subagent-run`, `/missions`, `/quality-status`, `/verify-task`,
`/analytics`, `/recommendations [pool|boss]`, and `/recommendation-analyst`.

## RC25 Boss Mission and analytics safety

Boss route weights are independent from Investigation, Implementation, and
Verification Pool weights. Configure at least one enabled route in **Boss /
Orchestrator Profiles**; three routes can use weights such as 5/3/2, shown as
50%/30%/20% shares. Weighted Boss selection happens once when a Mission starts,
then the assignment is persisted in the Mission's orchestration plan. It does
not rotate between normal Boss inferences or repair cycles.

Both `@orchestrator <goal>` and Smart Routing → Run as Mission/AUTO_MISSION use
the same canonical loop. The Boss plans, automatically creates canonical Tasks,
dispatches existing worker pools,
consumes bounded results, invokes M7 Verification, and evaluates the goal and
acceptance criteria. You do not need to add a Task by hand for that automatic
path. Rejection or recoverable failure causes bounded
replan/repair/reverification. A safety bound ends in explicit
`AWAITING_USER`/review evidence rather than a false completion. User or
AbortSignal cancellation ends as `cancelled` and does not complete, fall back,
or continue repair. A trust/path/command safety stop keeps the Mission
`blocked` but records a distinct `SAFETY_STOP` orchestration terminal so it is
not mistaken for a business dependency block. Only a genuine
Boss infrastructure failure can select an unused configured fallback; the
replacement remains pinned and the original/replacement/reason is recorded.

Boss assignment, terminal state, cycles, repair cycles, quality outcomes,
fallback edges, duration, and authoritative token usage are metadata-only
analytics keyed by Mission. Use `/analytics` to inspect the evidence and
`/recommendations boss` to create a manual-only weight proposal. A suggestion
never changes configuration until the user explicitly Applies it, and Apply
stale-checks the active Boss profile first.

## Historical RC24 catalog, scheduling, effort, and refresh safety

Discovery is separate from PMO enablement, and enablement is separate from
Pool membership. A newly discovered route is disabled until explicitly enabled;
disabling a route preserves existing Pool entries but makes them unavailable.
Refresh failure preserves the last-known-good catalog and marks it stale. A
removed route remains visible as missing, with its Pool order and effort intact.
Capability changes never silently downgrade an explicit effort. Route identity
is based on the gateway, exact remote model ID, and available resource/source
identity; genuine duplicate configured identities remain ambiguous and are not
guessed.

`@orchestrator <goal>` is the explicit Mission entry from Pi's normal input
surface. With a configured Boss profile it enters the same canonical goal loop
as Smart Routing → Run as Mission/AUTO_MISSION: plan/decompose, automatically
create canonical Tasks, dispatch
Investigation/Implementation tasks through their existing pools, run M7
Verification, evaluate acceptance, and repair/replan/reverify while bounded
budgets remain. The user does not need to open `/missions` and add a Task for
that automatic path. Ordinary prompts remain ordinary Pi prompts; the marker must be
at the beginning (surrounding whitespace is allowed), and an empty marker asks
for a goal.

`/subagent-run` opens **Direct Workers**: Direct Investigation Worker, Direct
Implementation Worker, or Direct Verification Worker. These are foreground,
ad-hoc workers and do not create a canonical Mission task, M7 verification run,
quality decision, or quality history. Use `/verify-task` for canonical Mission
verification (M7).

## Safety boundary

Use isolated temporary roots for fake-gateway verification. Never paste a raw
API key into configuration, prompts, diagnostics, exports, or issue reports.
M10 adds application-level PathSafetyPolicy and CommandSafetyPolicy. Workspace
escapes, symlink escapes, protected databases, credentials, and private keys
are blocked; destructive commands are blocked and ambiguous shell constructs
require review. Implementation mutations require explicit local project trust;
revoke trust immediately blocks future mutating runs. Config mutations use a
cross-process lock, MissionStore leases require owner tokens, and analytics
corruption degrades to diagnostics. These controls are not an OS/kernel
sandbox. RC25 does not add background workers or parallel worktrees; Boss
execution and Boss weight Apply remain explicit and bounded. The RC25 public
prerelease is installed only into isolated temporary Pi settings for local
validation. If the extension fails, remove or disable the candidate and
restore the prior pinned package, or use an external Codex/harness to inspect
the repository without importing the extension.
