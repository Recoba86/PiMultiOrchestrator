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
  other mutating actions retain their existing confirmation/idle gates. The
  Verification Pool is shared route configuration: Direct Verification Workers
  are standalone, while canonical Mission reviewers use it for M7. Use
  `/subagent-run` for the former and `/verify-task` for the latter.
- **Boss / Orchestrator Profiles** shows accepted profile configuration and
  explicitly says `Boss runtime not implemented yet`; profiles do not imply
  autonomous planning or scheduling.
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
  Analyst views for 24h, 7d, 30d, all-time, or custom windows.
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
`/routing-settings`, `/subagent-run`, `/missions`, `/quality-status`, `/verify-task`,
`/analytics`, `/recommendations`, and `/recommendation-analyst`.

`@orchestrator <goal>` is the explicit one-step Mission entry from Pi's normal
input surface. It creates a canonical draft Mission and shows the Goal, Status,
and next action. Ordinary prompts remain ordinary Pi prompts; the marker must be
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
sandbox. M10 does not add background workers, automatic Apply, autonomous Boss
planning, parallel worktrees, or live-provider access. The M12 RC16 local
candidate is installed only into isolated temporary Pi settings; it is not a
public release. If the extension fails, remove or disable the candidate and
restore the prior pinned package, or use an external Codex/harness to inspect
the repository without importing the extension.
