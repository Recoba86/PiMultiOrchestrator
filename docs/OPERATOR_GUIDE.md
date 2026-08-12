# Pi Multi-Orchestrator operator guide

This guide describes the local development Control Center in Pi `0.84.1`.
It does not make live 9Router calls, install the extension into `~/.pi/agent/`,
or create a public release.

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

- **Models & 9Router** searches the catalog, shows exact remote and local route
  IDs, source/resource and projected/actual availability, refreshes the
  catalog, and confirms enable/disable changes. Credential values are never
  displayed.
- **Investigation Pool**, **Implementation Pool**, and **Verification Pool**
  share the same ordered editor. Add, inspect, remove, enable/disable, and
  move entries without changing provider registration. Implementation and
  other mutating actions retain their existing confirmation/idle gates.
- **Boss / Orchestrator Profiles** shows accepted profile configuration and
  explicitly says `Boss runtime not implemented yet`; profiles do not imply
  autonomous planning or scheduling.
- **Routing & Fallback** is a non-executing preview of policy, eligibility,
  diversity, cooldown, and no-route reasons. **Health & Quotas** shows observed
  route health and cooldowns. Provider quota remaining is `UNKNOWN` unless an
  authoritative value exists.
- **Budget / Quality Profiles** shows quality gates, metadata-only analytics
  collection, and configured reference billing profiles. Missing pricing or
  mixed-currency values remain `UNKNOWN`; this view does not enable budget-aware
  routing.
- **Context & Mission Settings** opens mission/task, packet, evidence,
  checkpoint, verification, repair, and quality-history controls. Operational
  completion, quality status, and canonical evidence admission remain separate.
- **Statistics & Analytics** provides the accepted Overview, Missions, Pools,
  Routes, Tokens, Cost, Quality, Fallbacks, Recommendations, and Recommendation
  Analyst views for 24h, 7d, 30d, all-time, or custom windows.
- **Diagnostics** displays sanitized provider and observed-health metadata,
  Mission/Analytics integrity state, local Security & Trust, and the
  permission matrix; it never prints prompts, transcripts, tool output,
  credentials, or stack traces. Unknown projects are untrusted by default.
- **Backup / Restore** exposes ConfigStore generation/history, safe export, and
  confirmation-gated restore. MissionStore and AnalyticsStore offer validated,
  confirmation-gated SQLite-native backup snapshots; invalid or corrupt
  snapshots are rejected rather than replaced with empty state.

## Recommendations and analyst

Deterministic M8 recommendations remain authoritative. Details, Ignore, and
Apply are explicit actions; Apply revalidates staleness and uses
RecommendationApplicationService → PoolManager → ConfigStore. There is no
automatic priority mutation.

The optional M8.5 Recommendation Analyst is under Statistics & Analytics. It
uses only a selected Verification Pool route, receives bounded analytics
metadata, and runs only after **Analyze Now** or **Re-analyze**. Its structured
SUPPORT, OPPOSE, or INSUFFICIENT_EVIDENCE result is advisory, bounded, and
fingerprinted; changed inputs mark it stale. Analyst failures leave the
deterministic recommendation usable.

## Direct commands

The direct M2–M8.5 commands remain available, including `/9router-models`,
`/pool-models`, `/pool-status`, `/routing-status`, `/route-health`,
`/routing-settings`, `/missions`, `/quality-status`, `/verify-task`,
`/analytics`, `/recommendations`, and `/recommendation-analyst`.

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
sandbox. M10 does not add background workers, automatic Apply, autonomous Boss
planning, parallel worktrees, live-provider access, or release tooling.
