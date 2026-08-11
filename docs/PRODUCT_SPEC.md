# Product specification

## 1. Authority and scope

This document is the product-behavior authority for Pi Multi-Orchestrator. `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative. Architecture may explain how but must not weaken these requirements. Conflicts are resolved by updating this document and the decision log before implementation.

M0 freezes behavior and boundaries only. It contains no production implementation.

## 2. User goals

The product MUST let one user operate Pi as a configurable multi-model orchestration system in which a Boss:

- understands the mission and owns the plan;
- creates only the roles needed for that mission;
- delegates bounded work to suitable model routes;
- validates evidence rather than trusting a worker's claim;
- controls retry, escalation, acceptance, and mission completion;
- balances quality, reliability, cost, subscription utilization, quota, speed, diversity, and context use;
- survives terminal, process, and machine interruption without reconstructing the mission from chat memory.

Normal administration MUST be possible from Pi's TUI. After installation, normal changes MUST NOT require TypeScript edits.

## 3. Terminology

| Term | Normative meaning |
|---|---|
| **Pi** | The initial coding-agent host, session, tools, and TUI runtime. |
| **9Router** | The initial gateway that exposes an OpenAI-compatible catalog and request surface and may perform provider/account/combo routing. |
| **Gateway catalog entry** | A row returned by 9Router discovery. It is not automatically enabled or authoritative route metadata. |
| **Underlying model** | A model family/version independent of how it is accessed. |
| **Resource** | A quota/cost/authentication source such as a subscription account, API account, or 9Router combo. |
| **Route** | A stable, locally identified way to invoke a remote model through a particular gateway resource. Two resources serving the same underlying model are distinct routes. |
| **Enabled route** | A discovered/configured route the user explicitly permits Pi Multi-Orchestrator to register and route to. |
| **Role** | A task persona and output contract, such as researcher, debugger, implementer, or reviewer. |
| **Execution class** | One of `investigation`, `implementation`, or `verification`. |
| **Pool** | The ordered eligible route set for one execution class. |
| **Boss** | The final planning and acceptance authority for a mission. |
| **Boss profile** | An ordered Boss route policy such as Premium, Balanced, Economy, or a user-defined profile. |
| **Budget/quality profile** | A mission policy preset influencing agent count, concurrency, routes, cost class, reviewers, diversity, escalation, and context budget. It is separate from the Boss profile. |
| **Task Packet** | A bounded, role-specific child input assembled by the Context Broker. |
| **Evidence** | A structured child result, artifact reference, diff, command result, or review finding proposed for validation. |
| **Canonical mission state** | The durable authoritative mission record controlled by the Boss. |
| **Infrastructure fallback** | Route reselection caused by quota, rate, auth, timeout, transport, or availability failure. |
| **Quality escalation** | A Boss decision after technically successful work fails tests, review, or acceptance. |
| **Checkpoint** | A durable state transition from which the mission can resume. |

## 4. Product invariants

1. Only the Boss MUST declare overall mission completion.
2. Worker output MUST NOT become canonical merely because it is well-formed or says `done`.
3. Infrastructure fallback MUST NOT be used for quality rejection.
4. The complete remote catalog MUST NOT be dumped into Pi's normal model choices.
5. A newly discovered route MUST remain disabled until explicit user action enables it.
6. Route identity MUST preserve distinct resources even when the underlying model is equal.
7. Recommendations MUST NOT mutate configuration without explicit Apply action.
8. Secrets MUST NOT enter ordinary configuration, history, exports, analytics, logs, Task Packets, or repository files.
9. Project-local policy MUST NOT load before Pi reports the project trusted.
10. Ordinary deterministic tests MUST NOT require paid or live model calls.

## 5. Configuration requirements

### 5.1 Data model and lifecycle

- **CFG-001:** Model names, route metadata, enabled state, priorities, pool membership, role mapping, Boss profiles, fallback policy, health thresholds, budgets, quality thresholds, and presets MUST be data.
- **CFG-002:** Configuration MUST carry a schema version and be validated before use.
- **CFG-003:** A schema change MUST provide a deterministic migration or reject the unsupported version without mutation.
- **CFG-004:** A significant save MUST execute `validate -> lock -> backup current -> atomic write -> activate -> record history`.
- **CFG-005:** Failed validation or write MUST leave the active configuration unchanged.
- **CFG-006:** On primary-file corruption, the engine MUST preserve the corrupt artifact, load the last known good version when available, and notify the user. It MUST NOT silently replace evidence of corruption.
- **CFG-007:** History MUST support inspecting and restoring a prior valid revision.
- **CFG-008:** Import MUST validate before activation. Export MUST omit secret values and runtime state.
- **CFG-009:** The TUI MUST show the effective source of an inherited/overridden value.
- **CFG-010:** Unknown fields MUST be rejected unless a schema explicitly reserves an extension namespace.

### 5.2 Scope and precedence

- **CFG-011:** Effective precedence MUST be schema defaults, global config, trusted project override, then explicit mission launch override.
- **CFG-012:** Project overrides MUST be ignored with a visible diagnostic when the project is untrusted.
- **CFG-013:** Arrays MUST replace as a whole unless a collection is explicitly keyed by stable ID. Implicit array concatenation is forbidden.
- **CFG-014:** Project overrides MAY tighten tools, verification, concurrency, routes, and safety policy for a repository.
- **CFG-015:** Config inspection MUST show the resolved effective value without showing resolved credentials.

## 6. TUI-first control center

The extension MUST register `/orchestrator`. In interactive Pi mode it MUST open a keyboard-operable Control Center with these sections:

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

- **TUI-001:** Normal create, inspect, edit, enable/disable, reorder, save, restore, and diagnostics operations MUST be possible without editing JSON.
- **TUI-002:** Destructive or cost-affecting actions MUST show their target and require confirmation when they cannot be trivially undone.
- **TUI-003:** Saves MUST show success, failure, pending activation, and validation details.
- **TUI-004:** Long operations MUST show progress and permit cancellation where the underlying operation supports it.
- **TUI-005:** The TUI MUST distinguish live, cached/stale, estimated, unknown, disabled, and unhealthy data.
- **TUI-006:** In non-interactive Pi modes the engine MAY expose command/tool or RPC equivalents, but MUST NOT pretend TUI prompts succeeded.

## 7. 9Router model management

- **MOD-001:** Discovery MUST fetch the full available catalog from 9Router with a bounded timeout and cancellation.
- **MOD-002:** Discovery MUST retain catalog freshness, source, and last-success metadata.
- **MOD-003:** The local enabled set MUST be explicit and independent of catalog membership.
- **MOD-004:** Pi MUST register/expose only enabled 9Router routes; unrelated native Pi providers are outside this count.
- **MOD-005:** Refresh MUST leave new entries disabled.
- **MOD-006:** A previously enabled route missing from a refresh MUST become unavailable/stale, not silently retargeted to a same-named entry.
- **MOD-007:** Models & 9Router MUST support refresh, search/filter, enable, disable, inspect, route test, health display, pool assignment, source/resource display when known, and priority editing.
- **MOD-008:** Add, Remove, Enable/Disable, Move Up, Move Down, Inspect, Test, and Edit Route Policy MUST persist through validated saves.
- **MOD-009:** Runtime changes SHOULD activate while Pi is idle without restart when the installed API safely permits it.
- **MOD-010:** An active route MUST NOT be removed mid-turn. Disable MUST be staged until idle and a valid replacement exists.
- **MOD-011:** If 9Router is unavailable and a valid cached enabled catalog exists, the product MAY register it as stale and MUST show that state. With no valid cache, it MUST expose no invented 9Router routes and show recovery guidance.
- **MOD-012:** Catalog data insufficient to distinguish resources MUST be marked ambiguous and MUST NOT be auto-merged.

## 8. Pools, roles, profiles, and policies

### 8.1 Execution pools

- **POOL-001:** There MUST be exactly three main pools: Investigation, Implementation, and Verification.
- **POOL-002:** Each pool MUST hold an ordered list of route IDs with enabled/disabled membership and route policy.
- **POOL-003:** An empty pool MUST produce an explicit no-eligible-route result; it MUST NOT borrow invisibly from another pool.
- **POOL-004:** Pool order and membership MUST be editable and persisted without source changes.

### 8.2 Roles

- **ROLE-001:** The Boss MUST decide which roles a mission needs; workflows MUST NOT always spawn a fixed set.
- **ROLE-002:** Every role MUST map to exactly one execution class for a given task.
- **ROLE-003:** Role configuration MUST define persona/instructions, allowed actions/tools, Task Packet shape, and structured result schema.
- **ROLE-004:** Adding or changing an ordinary role SHOULD require configuration, not a new pool or engine branch.

### 8.3 Boss profiles

- **BOSS-001:** The Boss MUST use a selectable profile containing an ordered fallback chain and policy.
- **BOSS-002:** Premium, Balanced, and Economy MAY ship as editable examples; their model names MUST NOT be hard-coded engine behavior.
- **BOSS-003:** Users MUST be able to create Custom profiles and switch from the TUI.
- **BOSS-004:** A profile switch during activity MUST take effect only at a safe idle/checkpoint boundary.
- **BOSS-005:** Boss infrastructure fallback MAY change model/route while retaining canonical mission continuity.
- **BOSS-006:** A failed Boss turn that executed tools or produced side effects MUST NOT be blindly replayed on another route.

### 8.4 Budget/quality profiles

- **POL-001:** Mission policy presets MUST be separate from Boss profiles.
- **POL-002:** A preset MAY influence agent count, allowed routes/pools, concurrency, cost class, reviewer count, diversity, escalation threshold, and context budget.
- **POL-003:** Economy, Balanced, Premium, Fast Fix, Deep Debug, High Assurance, and Cheap Exploration MAY be initial editable presets; the engine MUST interpret stable policy fields rather than preset names.

## 9. Routing, fallback, health, and diversity

### 9.1 Initial selection

- **ROUTE-001:** Initial routing MUST use ordered priority filtered by enabled state, pool membership, route eligibility, health, mission policy, and required capability.
- **ROUTE-002:** Future scoring MAY add latency, quality, cost, quota, and tag history without changing route identity or pool contracts.
- **ROUTE-003:** Capability tags MUST be extensible metadata. The engine MUST NOT branch on today's example labels.

### 9.2 Infrastructure fallback

- **FB-001:** The failure classifier MUST distinguish quota exhausted, rate limited, authentication failed, timeout, transport failure, model unavailable, provider unavailable, cancelled, and unknown.
- **FB-002:** Eligible infrastructure failures MAY automatically try the next route within attempt/budget policy.
- **FB-003:** Every fallback MUST record source, destination, failure class, reason, and timestamps.
- **FB-004:** Authentication failure MUST NOT expose credentials in diagnostics.
- **FB-005:** Cancellation, policy denial, malformed worker result, failed test, or review rejection MUST NOT be mislabeled as infrastructure fallback.

### 9.3 Quality escalation

- **QE-001:** Failed tests, reviewer rejection, unmet acceptance criteria, incomplete work, and regressions MUST return control to the Boss.
- **QE-002:** The Boss MAY retry another route, choose a stronger/different family, create an investigator, add a reviewer, or revise the plan.
- **QE-003:** Quality escalation count and outcome MUST be recorded separately from route fallback.

### 9.4 Health and circuit breaker

- **HLTH-001:** Route health MUST track failure class, consecutive failures, cooldown-until, retry-after, last success/failure, probe state, and manual override.
- **HLTH-002:** Repeated eligible failures MUST open a temporary circuit according to validated policy.
- **HLTH-003:** A valid `Retry-After` SHOULD bound cooldown subject to configured safety limits.
- **HLTH-004:** Recovery MUST occur through cooldown expiry plus a controlled probe or a manual reset; the route MUST NOT be hammered on every task.
- **HLTH-005:** Health & Quotas MUST show healthy, degraded, cooldown, probing, unavailable, disabled, stale, and unknown states.
- **HLTH-006:** If all eligible routes are unhealthy, the scheduler MUST stop and return an actionable Boss-visible result instead of looping.

### 9.5 Diversity

- **DIV-001:** Verification SHOULD prefer a different underlying model family and, secondarily, provider/resource from the implementer.
- **DIV-002:** Multiple same-role candidates SHOULD diversify where eligible routes exist.
- **DIV-003:** Diversity is a configurable preference unless a policy explicitly makes it a gate.
- **DIV-004:** An opaque 9Router combo whose actual route is unknown MUST NOT be claimed as independent evidence.

## 10. Orchestration lifecycle

### 10.1 Planning and delegation

- **ORCH-001:** The Boss MUST capture mission goal, constraints, acceptance criteria, repository/revision, and initial plan before accepting delegated work.
- **ORCH-002:** The Boss SHOULD delegate expensive search/implementation/review when policy and task shape justify it; it MAY perform small work directly.
- **ORCH-003:** A task assignment MUST identify mission, task, role, execution class, objective, constraints, allowed actions, acceptance criteria, and result schema.

### 10.2 Context Broker

- **CTX-001:** The system MUST NOT copy the whole Boss conversation into every worker.
- **CTX-002:** The Context Broker MUST build a bounded Task Packet from canonical state and approved evidence.
- **CTX-003:** Investigator packets SHOULD contain focused scope and unknowns; implementer packets MUST contain the approved plan/findings and relevant files; reviewer packets MUST contain acceptance criteria and actual artifacts/evidence while preserving useful independence.
- **CTX-004:** Prior failed attempts MUST be included only when relevant and labeled as untrusted or validated.
- **CTX-005:** Task Packet size/content policy MUST be inspectable and testable.

### 10.3 Structured results and evidence promotion

- **RES-001:** Investigator results MUST represent findings, evidence, confidence, relevant files, and unknowns.
- **RES-002:** Implementer results MUST represent changes, files, exact tests/results, and unresolved risks.
- **RES-003:** Reviewer results MUST represent pass/reject, severity, evidence, missing tests, and acceptance status.
- **RES-004:** Malformed results MUST be rejected or repaired within bounded policy; they MUST NOT be promoted.
- **RES-005:** The Boss MUST validate evidence against actual artifacts where practical before promotion.

### 10.4 Canonical mission state

- **STATE-001:** Canonical state MUST include goal, constraints, acceptance criteria, repository/revision, plan, approved decisions, validated findings, completed work, current change state, test/review evidence, unresolved issues, next steps, leases/active tasks, and mission status.
- **STATE-002:** State transitions MUST be transactional and auditable.
- **STATE-003:** Legal mission statuses MUST include at least draft, planned, running, awaiting-review, blocked, failed, cancelled, and completed.
- **STATE-004:** Child chats and Pi session history are evidence sources, not the mission database.
- **STATE-005:** A Pi session MAY store a mission ID/pointer and compact status, but MUST NOT duplicate full canonical state into LLM context.

### 10.5 Checkpoint/resume and cancellation

- **CP-001:** Checkpoints MUST occur after plan acceptance, task start/end, evidence promotion, fallback/escalation, gate evaluation, and terminal status changes.
- **CP-002:** Startup/resume MUST reconcile tasks left running by a dead process into an interrupted/unknown state; it MUST NOT assume success or launch duplicates silently.
- **CP-003:** One process MUST hold the mutation lease for a mission; stale lease recovery MUST be explicit and auditable.
- **CP-004:** Worker timeout and user cancellation MUST propagate to child processes and record the terminal attempt state.
- **CP-005:** Closing Pi, Termius, or the machine MUST not erase the last committed checkpoint.

### 10.6 Quality gates

- **GATE-001:** Configurable gates MAY require a diff, tests, reviewer passes, acceptance satisfaction, regression checks, and no unresolved critical finding.
- **GATE-002:** Every required gate MUST be pass, fail, or explicitly waived by an authorized user with reason. Missing evidence is not pass.
- **GATE-003:** Only the Boss may transition a mission to completed after all required gates pass or are validly waived.

## 11. Analytics and recommendations

### 11.1 Collection

- **AN-001:** M1 MUST define only the metadata-only analytics configuration boundary. Operational metadata collection and durable analytics begin with M8, before the dashboard exists; earlier milestones MUST NOT create an undeclared telemetry store.
- **AN-002:** Events SHOULD capture timestamp, mission, role, pool, route, underlying model, provider/resource, subscription/API classification, input/output/cache tokens, duration, outcome, failure class, fallback edge, reviewer/test result, first-pass outcome, escalation count, and calculable cost.
- **AN-003:** Unavailable provider metadata MUST remain `unknown`; the system MUST NOT invent actual route, token, cost, or quota values.
- **AN-004:** Full prompts, source code, secrets, credentials, and full conversations MUST NOT be persisted for analytics by default.
- **AN-005:** Estimated cost and avoided cost MUST be labeled estimates with formula/version; subscription use MUST not be reported as actual API spend.

### 11.2 Queries and TUI

Statistics & Analytics MUST support last 24 hours, 7 days, 30 days, all time, and custom range, covering:

- mission totals, success/failure, and success rate;
- runs by role and pool;
- token use including available cache categories;
- actual/estimated cost, subscription use, equivalent API estimate, and estimated avoided cost;
- route/model runs, success, latency, first-pass success, review acceptance, tests, escalation, and fallback;
- pool comparisons;
- Boss profile missions, success, agents, retries, review loops, and planning/review tokens;
- fallback class and destination analysis.

### 11.3 Scoring and recommendations

- **REC-001:** Quality/value scores MUST be pool-specific, formula-versioned, explainable, and show sample size/time range.
- **REC-002:** A recommendation MUST state evidence, comparison baseline, uncertainty/limitations, and proposed config diff.
- **REC-003:** Generating or viewing a recommendation MUST NOT mutate configuration.
- **REC-004:** Apply MUST use the normal validated, backed-up, atomic configuration save path. Ignore MUST be recorded without mutation.

## 12. Observability and diagnostics

- **OBS-001:** The TUI MUST show active Boss profile/route, 9Router status, pool route counts, unhealthy routes, active mission, agents, role/model/progress, fallback events, and review state where applicable.
- **OBS-002:** Normal operation MUST NOT require reading logs.
- **OBS-003:** Diagnostics MUST include correlation IDs and privacy-safe failure stages without prompt, source, header, or credential dumps.
- **OBS-004:** Logs MUST be bounded/rotated and treated as potentially sensitive.

## 13. Safety and security

- **SAFE-001:** Every worker MUST receive an explicit tool/action allowlist; absence means deny mutating actions.
- **SAFE-002:** Protected paths and destructive commands MUST be blockable before execution.
- **SAFE-003:** Shared-worktree mutation MUST default to one worker at a time.
- **SAFE-004:** Concurrency, timeouts, output size, retries, cost, and worker count MUST have validated limits.
- **SAFE-005:** Project-specific policy MAY tighten but MUST NOT silently loosen non-overridable global safety constraints.
- **SAFE-006:** Runtime state and SQLite files MUST use restrictive permissions and transaction/locking semantics.
- **SAFE-007:** Import data, gateway responses, worker results, and project overrides are trust-boundary inputs and MUST be schema/size validated.
- **SAFE-008:** Secret filtering MUST apply before logs, analytics, TUI errors, exports, Task Packets, and structured results are persisted.
- **SAFE-009:** Crash recovery MUST prefer duplicate prevention and explicit unknown state over optimistic continuation.

## 14. 9Router ownership boundary

9Router SHOULD own:

- provider protocol translation and streaming;
- provider credential/OAuth refresh it already manages;
- account selection/fallback inside a selected 9Router resource;
- combo execution and gateway-local request accounting.

Pi Multi-Orchestrator MUST own:

- catalog cache and explicit local enablement;
- route identity as consumed by missions;
- three pools, role mapping, Boss and budget policies;
- cross-route health/eligibility/diversity selection;
- Task Packets, worker lifecycle, canonical mission state, quality gates, escalation, and orchestration analytics.

When 9Router performs opaque internal fallback, Pi Multi-Orchestrator MUST treat it as one route unless authoritative response metadata identifies the actual resource. It MUST NOT duplicate 9Router's internal retries or claim resource diversity it cannot observe.

## 15. Import/export and backup/restore

- **XFER-001:** Export MAY contain route references/metadata, enabled state, pools, roles, profiles, policies, presets, and thresholds.
- **XFER-002:** Export MUST exclude resolved secrets, credential handles that reveal secret material, runtime health, mission data, and analytics unless a distinct explicit data-export flow is designed.
- **XFER-003:** Import MUST stage, validate version/references/policy, preview its changes, and activate only after confirmation.
- **XFER-004:** Restore MUST itself create a backup of the current valid configuration and an audit entry.

## 16. Testability

- Deterministic units MUST cover config, schema, pool operations, routing, fallback, health, diversity, mission state, Context Broker, analytics, and recommendations.
- Integration tests MUST use a fake 9Router and fake `pi` child executable for catalog change, quota/rate/auth/timeout, fallback, corruption, config reload, persistence, and worker lifecycle.
- Real Pi smoke tests MUST be small, explicitly authorized, and separately labeled. Real-provider tests MUST never be a normal CI requirement.
- Time, IDs, process execution, gateway I/O, and persistence MAY have narrow injectable boundaries when deterministic testing requires them; speculative general-purpose abstractions are forbidden.

## 17. Non-goals

### M0 non-goals

M0 MUST NOT implement the extension, install Pi extensions/subagents, modify live Pi/9Router settings, access credentials, create Keychain entries, call paid APIs, create/push a GitHub repository, or build UI code.

### Product non-goals unless separately specified

- replacing 9Router's provider translation/account management;
- training or fine-tuning models;
- silent autonomous configuration tuning;
- guaranteeing provider quota data when the provider exposes none;
- simultaneous mutation of one shared worktree by default;
- treating model output as proof without artifact/test evidence;
- hard-coding today's model names, providers, subscriptions, roles, or capability tags into engine branches.

## 18. Completion rule

Product behavior is accepted only through measurable cases in [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md). Milestone ordering and explicit exit gates are defined in [ROADMAP.md](ROADMAP.md).
