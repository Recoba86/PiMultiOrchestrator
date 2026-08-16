# Architecture

## 1. Architectural intent

Pi Multi-Orchestrator is a package-loaded Pi extension with a small host adapter and a custom orchestration engine. Pi remains the interactive coding harness. 9Router remains the model gateway. This product supplies the policy, state, scheduling, evidence, and management layers neither host provides.

The design favors stable IDs, explicit state transitions, standard Node APIs, and deterministic fake boundaries. It does not define one class per noun or prebuild future scoring machinery.

## 2. Validated baseline and sources

M0 inspected, read-only, the installed runtime on 2026-08-12:

| Evidence | Result |
|---|---|
| `pi --version` | `0.84.1` |
| resolved binary | `@earendil-works/pi-coding-agent/dist/cli.js` |
| installed package | `@earendil-works/pi-coding-agent@0.84.1` |
| runtime | Node.js `v22.23.0` |
| SQLite probe | `node:sqlite` in-memory create/insert/select succeeded, with Node 22 experimental warning |

Inspected installed sources include `docs/extensions.md`, `docs/custom-provider.md`, `docs/sdk.md`, `docs/settings.md`, `docs/models.md`, `docs/session-format.md`, exported `.d.ts` files, and `examples/extensions/subagent/`.

Current public primary references checked during M0:

- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Pi custom providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)
- [Pi settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)
- [Pi subagent example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent)
- [9Router README/API](https://github.com/decolua/9router/blob/master/README.md)
- [9Router architecture](https://github.com/decolua/9router/blob/master/docs/ARCHITECTURE.md)

The installed `0.84.1` package is authoritative where search-indexed public pages lag or differ.

## 3. Capability ownership

| Capability | Pi-native | 9Router-native | Custom here |
|---|---:|---:|---:|
| Extension loading/package lifecycle | Yes | No | Packaging metadata only |
| `/orchestrator` command | Registration API | No | Handler and behavior |
| Custom terminal components | `ctx.ui.custom()` and Pi TUI | No | Control Center screens/state |
| Model registry and current model | Yes | Catalog source only | Selective provider bridge |
| Dynamic provider add/remove | `registerProvider` / `unregisterProvider` | No | Enabled-route projection |
| Dynamic provider model refresh | Native Provider `refreshModels` / registry refresh | `/v1/models` | Full-cache/filter/activation policy |
| Provider protocol translation/streaming | Pi provider APIs | Yes | Configuration only |
| Account/token refresh inside gateway | No | Yes | Observe result only |
| Gateway combo fallback | No | Yes | Treat as opaque route unless attributed |
| Three pools and role mapping | No | No | Yes |
| Boss planning and acceptance | LLM/session primitive | No | Prompts, policy, state machine, gates |
| Isolated worker process | Shipped example pattern | No | Executor/scheduler/result contract |
| Pi session persistence | Session JSONL / custom entry | No | Mission pointer only |
| Canonical mission/checkpoint state | No | No | Yes |
| Route health and cross-route fallback | Pi has request retry primitives | Partial internal fallback | Yes, without duplicating gateway internals |
| Analytics | Usage/events available | Gateway-local usage | Mission/route/pool metadata store |
| Recommendations | No | No | Yes, explicit apply only |
| Secret storage | Pi auth/env hooks | Gateway credentials | Secret references/resolver; no secret database |

Third-party subagent packages, UI frameworks, schema libraries, and SQLite packages are not assumed. A dependency is added only when a milestone proves the host/standard library cannot meet a requirement safely.

## 4. System context

```text
 User
   |
   v
 Pi TUI/session ── ExtensionAdapter ── Control Center
   |                    |
   |                    v
   |              Orchestration Engine
   |              /   |     |      \
   |        Config  Mission Router  Analytics
   |           |       |     |        |
   |           +-------+-----+--------+
   |                         |
   |              Worker child processes
   |                         |
   +── Pi Provider Bridge ───+──> 9Router ──> provider/accounts
```

Trust boundaries are Pi/project input, 9Router/network input, worker/model output, filesystem/import input, and child-process execution. Each is validated at entry.

## 5. Modules and dependencies

Dependencies point inward toward pure policy/state code. Only the named edge modules perform external I/O.

### 5.1 `host/pi-extension`

Responsibilities:

- register `/orchestrator`, lifecycle hooks, provider bridge, safe tool hooks, and compact status rendering;
- bind/unbind on Pi reload and session replacement;
- translate Pi events into internal events without copying prompts or headers;
- append only mission pointer/status entries to Pi session JSONL.

It MUST NOT contain pool priorities, model names, mission policies, or storage logic.

### 5.2 `config`

Responsibilities:

- schema/version validation and migrations;
- defaults/global/project/mission precedence;
- atomic save, last-known-good, history, rollback, import/export;
- immutable effective-config snapshots for a running decision.

Configuration I/O is serialized. Each save obtains an exclusive mutation lock, creates a history copy of the current valid revision, writes a same-directory temporary file with restrictive permissions, flushes, renames atomically, and only then publishes the new generation.

M1 implements this boundary under `src/core/config/`: `types` and `schema` own the strict data contract; `defaults`, `migrations`, `resolve`, and `serialize` are pure; `store`, `history`, and `transfer` own the injected-root filesystem boundary. Stored files wrap semantic `ConfigV1` in a storage envelope containing a monotonic generation and timestamp; exports contain only semantic configuration.

The mutation lock is a FIFO process-local promise queue with expected-generation conflict checks, extended by M10 with a short-lived cross-process O_EXCL lock and reread-under-lock before mutation. Active/history writes use mode `0600`, directories use `0700`, file contents are flushed before same-directory atomic rename, and parent-directory flush is best effort because supported filesystems differ. History retains the newest 20 prior valid generations. A successful rename may publish one optional no-content audit callback; M1 provides no event collection or durable sink. A normal load never mutates disk: if the active file is corrupt, it can expose the newest valid history snapshot in memory with `repairRequired`; explicit recovery copies the corrupt bytes to quarantine and activates a valid snapshot under a fresh generation.

Stable configuration IDs are lowercase kebab identifiers, start with a letter, contain only ASCII lowercase letters/digits/hyphens, and are at most 64 characters.

### 5.3 `secrets`

Responsibilities:

- validate opaque `SecretRef` values;
- resolve a reference only at the network-request boundary;
- return secret-bearing values in memory for the shortest practical lifetime;
- redact failures before they leave the module.

Approved stores may include Pi's auth provider, environment variables, and macOS Keychain. Configuration, history, SQLite, exports, analytics, and diagnostics store the reference/type only. M2 implements environment references, and RC19 uses Pi's public auth API for the explicit TUI setup path. Discovery resolves the value at the request boundary; env-backed Pi provider registration receives `$ENV_NAME`, never the resolved value. Pi-auth-backed registration omits `apiKey` so Pi resolves its stored credential; a placeholder is never passed as a literal key. Keychain resolution remains unavailable rather than falling back to plaintext.

### 5.4 `catalog` and `host/pi-provider-bridge`

`catalog` fetches and validates the full 9Router catalog, assigns a generation, preserves last-known-good data, and reconciles stable local route records without auto-enabling new rows.

M2 keeps `ConfigV1` at schema version 1: its existing gateway, route, exact remote ID, resource, enabled-state, and `SecretRef` fields already cover authoritative user choices. Catalog generations, freshness, failures, and missing status are runtime observations in a separately validated `catalog.json`; they are absent from config history and export. Each cache snapshot is bound to its normalized gateway base, so changing endpoints withholds old catalog rows until the new endpoint refreshes successfully.

The persistent gateway ID is `ninerouter` because all M1 stable IDs must begin with a letter. Its `kind` and Pi provider namespace are `9router`; these identifiers are deliberately distinct.

`pi-provider-bridge` registers one native Pi provider namespace for enabled 9Router routes. Its model refresh projection is:

```text
full catalog generation
    + explicit enabled route IDs
    + valid route metadata/auth availability
    = Pi model definitions for enabled routes only
```

The full catalog never becomes the Pi provider's model list. A TUI save that changes enabled routes publishes a new config generation and re-registers the provider model projection immediately when safe. Pi `0.84.1` replaces the supplied provider model list in place, so a failed validation leaves the prior registry intact. If activation fails, configuration remains saved and the UI reports the runtime error for a later reconciliation.

The RC18 bridge establishes ownership before applying that projection. At
factory time it performs a credential-blind, offline probe of Pi's
`models.json`; at `session_start` it confirms the bound `ctx.modelRegistry`.
When `9router` already exists, the provider is external: PMO supplies no
replacement model list and never unregisters it during reconcile, reload, or
dispose. When the namespace is absent, a successful PMO registration marks it
owned, and only that owned registration may be updated or removed. This keeps
standalone PMO registration and `--list-models` behavior when the namespace is
absent without changing the public route/config schema. Pi 0.84.1 has no
owner token, so a provider created dynamically by another extension after both
probes remains outside what this API can prove.

RC19 adds a source-aware adoption path. A bound external provider's complete
`getModels()` catalog is merged into the Models & 9Router view without asking
Pi's auth-filtered `getAvailable()` list to define visibility. Explicitly
enabled external rows create PMO route/config state but do not replace the
external provider or auto-assign a pool. External refresh delegates to the
bound Pi registry; PMO-owned/env-backed refresh continues through the PMO
catalog client. With no provider, the host offers a TUI-only masked key
component, tests `/v1/models` before saving, calls Pi `ModelRuntime.login`, and
stores only a fixed `pi-auth` reference. RPC setup fails closed because the
installed Pi contract has no sensitive input field.

### 5.5 `pools` and `policy`

M3 implements `core/pools` as the only pool-mutation service. It reads configured routes and the optional endpoint-bound catalog snapshot, then exposes the three ordered pool views and applies add/remove/per-pool-enable/reorder operations through `ConfigStore.update()`. Array position is the sole priority representation. Globally disabled or remotely missing routes retain membership and position, and pool-only edits never reconcile the Pi provider.

```text
Model Manager -> configured routes
Pool Manager  -> ordered memberships
M4 Router     -> eligibility, priority, diversity, and health-aware preview
```

The Pool Manager reports management state but does not decide eligibility or select a route.

Holds pure operations for:

- pool membership/order;
- roles and execution-class mapping;
- Boss profiles;
- budget/quality profiles;
- capability requirements;
- immutable global safety ceilings and project tightening.

Named presets are data rows. The engine branches on policy fields, never names like `Premium` or a specific model.

### 5.6 `routing`

Holds pure route eligibility, ordered selection, failure classification, cooldown calculation, and diversity preference. Initial selection is intentionally simple:

```text
configured pool order
 -> enabled and present
 -> policy/tool/capability eligible
 -> not open-circuit
 -> diversity preference as a stable tie-break/soft filter
 -> first eligible route
```

Historical scoring is not in the initial selection algorithm. A future scorer may supply a derived order without changing the selection contract.

M4's implemented data flow is deliberately non-executing:

```text
Pool Manager
    -> Router
       [availability, diversity, health, priority]
    -> Routing Decision

Execution Result metadata
    -> Failure Classifier
    -> Failure Policy [retry same | fallback next | stop]
    -> HealthStore
```

The router receives normalized status and never calls a model or infers a family from a model name. Stale last-known-good catalog entries remain selectable while positively missing/unavailable entries do not. 9Router account, credential, and combo fallback is opaque: one Pi route invocation produces one external result for M4.

### 5.7 `mission`

Owns the canonical mission state machine, checkpoints, attempt leases, evidence promotion, gates, and legal transitions. It is the sole authority allowed to write `completed` after Boss approval and gate evaluation.

### 5.8 `context-broker`

Builds role-specific Task Packets from an immutable canonical-state generation. It selects only approved findings and directly relevant artifacts. Packet construction enforces size, field, and sensitivity policy before launch.

### 5.9 `workers`

Owns direct Pi SDK child-session invocation, tool visibility, structured result submission, progress, timeout, cancellation, cleanup, and concurrency.

M5 constructs fresh `AgentSession` instances with `SessionManager.inMemory`, an extension/skills/context-free resource loader, an exact M4-selected model, and retry disabled. Investigation, Implementation, and Verification receive distinct allowlists; `edit`, `write`, and `bash` are conservatively treated as potentially mutating. Shared-worktree Implementation runs are serial by normalized cwd, and a mutation prevents automatic cross-route fallback. The shipped child-process example remains a portability reference, not a second executor.
M11-R4 adds an execution-time `WorkerSafetyGuard` to the same child-session boundary: active tools are clamped to the worker profile, and every tool call is authorized before Pi invokes it. Path, command, trust, and mutation policy therefore applies to real worker execution, not only diagnostics or capability metadata; the bounded result-submission tool remains the only non-filesystem protocol exception.

### 5.10 `analytics`

Accepts privacy-filtered internal events, persists metadata, creates query projections, and generates explainable recommendations. It cannot call configuration mutation directly; Apply flows through `config` after user confirmation.

M8.5 adds an optional manual Recommendation Analyst above the deterministic recommendation. It receives only a bounded analytics packet, uses an explicitly selected Verification Pool route through the existing M4/M5 boundary, persists bounded verdict metadata plus an input fingerprint, and never mutates metrics, pools, or configuration. Changed deterministic inputs make prior analyst records stale; analyst failure is advisory and does not invalidate the deterministic recommendation.

### 5.11 `security` and recovery boundaries

M10 keeps project trust separate from portable configuration in a local, restrictive TrustStore. Projects are untrusted by default; explicit trust/revoke is operator-controlled and is never imported from a backup. PathSafetyPolicy canonicalizes existing ancestors, confines workspace access, rejects protected/credential paths and symlink escapes, and is applied before mutating host flows. CommandSafetyPolicy is a pure conservative classifier: safe commands may run, destructive commands block, and ambiguous shell constructs require review. SecretSanitizer removes registered values and sensitive structures from diagnostics/errors; capability rows expose read-only Investigation/Verification versus trust-gated Implementation mutation.

ConfigStore mutations reread under a short cross-process lock. MissionStore leases carry owner tokens and expiry checks, while active attempts are race-safe and non-owner release/renewal is rejected. MissionStore and AnalyticsStore remain separate SQLite databases with validated native backup/restore and integrity diagnostics. Analytics corruption degrades to a diagnostic state instead of inventing empty history. These are application-level policies, not OS/kernel sandboxing; no autonomous approval or automatic rerun is implied.
M11-R4 verifies that this policy is installed on the Pi child-session `beforeToolCall` boundary and that unknown or role-expanding tools are denied before execution. This remains application-level enforcement, not an OS/kernel sandbox.

M11-R6 closes the adjacent custom-tool boundary. Child callers pass only a
declarative result-protocol specification; M5 constructs the model-visible
submission tool internally. The protocol executor validates and captures a
bounded in-memory payload and returns an acknowledgement; it has no caller
execute, transform, or callback path. A worker-tool registry classifies every
active entry as a guarded capability or a protocol submission, and rejects
unknown names and collisions with guarded or reserved Pi tools. This prevents
an untrusted caller from registering a `submit_evil` handler that can mutate
the workspace through Pi's child-session API.

### 5.12 `tui`

Renders the twelve Control Center sections using Pi TUI components and calls application operations. Components do not read files, query SQLite, resolve secrets, or call 9Router directly. Each screen receives view data plus explicit commands so non-TUI tests can exercise the same operations.

M9 implements this boundary in the host with one native selector shell and a
dashboard-first summary. The fixed top-level order is Models & 9Router,
Investigation Pool, Implementation Pool, Verification Pool, Boss / Orchestrator
Profiles, Routing & Fallback, Health & Quotas, Budget / Quality Profiles,
Context & Mission Settings, Statistics & Analytics, Diagnostics, and Backup /
Restore. Deferred runtime engines are shown as planned rather than exposed as
fake controls; ConfigStore backup uses its existing export/history/restore API.

## 6. Core data model

The following shapes are conceptual TypeScript contracts; exact syntax is an M1 deliverable.

```text
Gateway {
  id, kind="9router", baseUrl, secretRef?, enabled, timeoutMs
}

CatalogEntry {
  generation, gatewayId, remoteId, displayName?, rawCapabilities?, discoveredAt
}

Route {
  id, gatewayId, remoteModelId, resourceId,
  underlyingFamily?, underlyingVersion?, displayName,
  enabled, tags[], capabilities{}, costClass?, accessClass?,
  firstSeenAt, lastSeenAt, catalogStatus
}

Pool {
  executionClass, orderedRouteIds[]
}

Role {
  id, executionClass, instructionsRef,
  allowedTools[], allowedActions[], resultSchemaId
}

BossProfile {
  id, orderedRouteIds[], fallbackPolicy
}

MissionPolicy {
  id, maxAgents, maxConcurrency, allowedRouteIds?, costClass?,
  reviewerCount, diversity, escalationLimit, contextBudget, gates[]
}
```

`Route.id` is local and stable. `remoteModelId` is what is sent to 9Router. `resourceId` distinguishes subscription/API/combo resources. `underlyingFamily` is optional metadata for diversity, never identity. If discovery cannot populate resource identity, the row is marked ambiguous and remains disabled by default; an explicit user enable preserves the exact remote ID and an unknown-resource warning without merging it with another row.

No resolved credential field exists in these schemas.

## 7. Configuration and scope

M1 accepts an injected configuration root and never reads a live Pi directory. M2 derives the default root from Pi's `getAgentDir()` export and supports the explicit `PI_MULTI_ORCH_CONFIG_ROOT` test/development override; it does not hard-code `.pi`.

Conceptual locations:

```text
<agentDir>/pi-multi-orchestrator/
  config.json                  global human-portable config
  history/                     prior valid config generations
  catalog.json                 validated M2 runtime cache, not exported
  mission.sqlite               missions, quality, evidence, checkpoints (M6+)
  analytics.sqlite             metadata-only analytics and recommendations (M8+)
  backups/                     validated runtime database backups (M6+)

<project>/<CONFIG_DIR_NAME>/pi-multi-orchestrator.json
                               optional trusted, secret-free project override
```

Runtime database/history files are never project exports. Project overrides may be version controlled if the user chooses because they cannot contain secrets.

Merge algorithm:

1. validate each input independently against its declared version;
2. migrate in memory to the current version;
3. apply schema defaults;
4. overlay global values;
5. if `ctx.isProjectTrusted()`, overlay project values; otherwise record ignored-project diagnostic;
6. overlay the explicit mission launch patch;
7. validate cross-references and non-overridable safety ceilings;
8. publish an immutable effective-config generation.

Objects merge only through declared fields. Ordinary arrays replace wholesale. Pools/routes/roles/profiles are keyed only where the schema explicitly declares stable IDs. Duplicate IDs are errors.

## 8. Pi integration surface

### 8.1 Confirmed native APIs in installed `0.84.1`

- Extension factories may be async and Pi waits for initialization before startup events.
- `pi.registerCommand()` can register `/orchestrator`.
- `ctx.ui.custom()` can host focusable custom components/overlays.
- `pi.registerProvider()` accepts a complete Pi Provider or provider config; after startup it updates immediately.
- `pi.unregisterProvider()` removes an extension provider and restores overridden built-ins.
- Native providers can implement `refreshModels`; `ModelRegistry.refresh()` accepts cancellation.
- `ctx.modelRegistry` exposes available models/provider auth and model lookup.
- `pi.setModel()` changes the current model when auth is available.
- `ctx.scopedModels` reflects Pi's session model scope but is read-only and is not the orchestrator's enabled-route store.
- `pi.appendEntry()` persists extension state outside LLM context; SessionManager exposes session IDs/files/entries.
- Provider and agent lifecycle events expose response status/headers where transports permit and assistant messages carry usage when providers report it.
- `ctx.isProjectTrusted()` exposes the resolved trust state.
- The SDK creates AgentSession instances and controls models/tools/sessions.
- Pi's bundled subagent example launches separate `pi --mode json -p --no-session` child processes, streams JSON events, applies model/tool arguments, caps output, limits concurrency, and propagates abort.

M2 loads `dist/host/pi-extension.js` explicitly with `-e`. Its config root is `PI_MULTI_ORCH_CONFIG_ROOT` when set, otherwise `join(getAgentDir(), "pi-multi-orchestrator")`; no `.pi` path is hard-coded. Isolated acceptance also sets `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, and `PI_OFFLINE=1`.

RC18 additionally probes the existing `models.json` catalog with network and
credential resolution disabled before factory-time provider reconciliation;
the actual session registry remains the runtime authority once Pi binds the
extension.

### 8.2 Custom layers required

Pi does not natively provide:

- a full remote catalog kept separate from the model picker;
- route/resource identity for 9Router;
- three ordered pools or dynamic role mapping;
- Boss/budget policies and mission decomposition;
- cross-route health/circuit breaking;
- infrastructure-vs-quality state semantics;
- bounded Task Packets and evidence promotion;
- canonical mission state, leases, checkpoints, and gates;
- product analytics/recommendations;
- the twelve-section Control Center.

These are implemented here without modifying Pi internals or live Pi settings.

### 8.3 Why Pi `enabledModels` is insufficient

Pi's `enabledModels` scopes normal model cycling/session selection across its available catalog. It is stored in Pi settings and does not provide this product's route metadata, history, full remote catalog, resource identity, pools, or safe atomic orchestration configuration. Pi Multi-Orchestrator therefore owns its enabled-route set and registers only that projection under its provider namespace. Existing unrelated Pi providers remain available according to Pi's own settings.

### 8.4 Session continuity

The active Pi session remains the Boss conversation. A mission pointer custom entry lets the extension recover the canonical record after reload/resume. A Boss route/profile switch waits for idle, calls the supported model selection path, records the switch, and sends a bounded resume packet derived from canonical state when needed.

Pi session JSONL is not canonical mission storage because it is branch-oriented, may compact LLM context, and does not provide multi-worker transactional state.

## 9. 9Router integration surface

9Router's documented compatibility API includes authenticated `GET /v1/models` and model request endpoints under `/v1/*`. Discovery uses the compatibility catalog, not an undocumented static route list.

```text
GET <configured-v1-base>/models
  Authorization: resolved only at request boundary when required
  AbortSignal + configured timeout

POST <configured-v1-base>/chat/completions (through Pi provider)
  model: Route.remoteModelId
```

The configured base includes `/v1`; a bare origin is normalized to `/v1`, while other paths are rejected. Normalization removes trailing slashes and rejects credentials, query/fragment state, non-HTTP(S) schemes, and non-loopback plaintext HTTP. It never appends a second `/v1` or downgrades HTTPS.

The optional live M2 catalog probe was skipped because the required environment variables were absent. Fake acceptance proves exact model IDs and the supported compatibility shape only; subscription/account identity, underlying family, costs, health, combo membership, and actual member selection remain unknown until a documented live response exposes them.

Boundary rule:

- 9Router owns internal provider/account/combo traversal and credential refresh.
- The orchestrator sees a selected 9Router route as one resource.
- If 9Router reports an authoritative actual route, analytics may attribute it while preserving the selected route.
- If not, health/fallback are recorded at the selected route boundary and diversity cannot claim an unseen internal model.

## 10. Discovery and activation flow

```text
1. User selects Refresh
2. CatalogClient fetches /v1/models with secret resolver + timeout
3. Validate response size/schema and create catalog generation N
4. Reconcile by exact remote identity
   - known configured route: preserve local identity and enabled state
   - new catalog row: visible but not configured/enabled
   - missing configured route: derive unavailable/missing status; never retarget
5. Persist generation transactionally
6. TUI previews changes
7. User enables/disables and saves config generation C (pool order begins in M3)
8. ProviderBridge blocks removal of the active route; otherwise it projects enabled valid routes
9. Pi registry refresh/re-register occurs
10. Verify effective provider model IDs; mark C active or pending/error
```

Catalog refresh is not config mutation except for discovery metadata. It cannot silently enable, disable, reorder, or rewrite a pool.

## 11. Boss lifecycle

```text
create mission
  -> capture goal/constraints/acceptance/revision
  -> select Boss + mission policy
  -> Boss produces plan and needed roles
  -> checkpoint planned state
  -> schedule ready tasks
  -> validate/promote results
  -> evaluate gates
       | pass                         | quality fail
       v                              v
  Boss accepts completion       Boss revises/retries/escalates
```

Boss infrastructure failure before side effects may route to the next Boss route within policy. After tool side effects, the attempt becomes interrupted/unknown; canonical state and exact tool evidence are reconciled before another model continues. No automatic replay duplicates a tool call.

The Boss may decide direct execution is cheaper/safer for a tiny task. Delegation is policy-driven, not mandatory ceremony.

### 11.1 RC25 canonical goal loop and Boss assignment

RC25 persists a weighted Boss profile as route entries with route capability and
thinking policy. At Mission start the router selects one eligible Boss entry by
weight, records the assignment before the first Boss inference, and reuses it for
planning, task evaluation, replanning, repair, M7 result interpretation, and the
final goal decision. Normal Mission cycles never reselect the Boss.

The host owns the worker-pool and M7 execution boundaries; the Boss runtime owns
the loop around them:

```text
goal -> plan -> dispatch Investigation/Implementation -> consume evidence
     -> dispatch M7 Verification -> evaluate acceptance
     -> pass: terminal decision
     -> reject/failure: diagnose -> repair/replan -> verify again (bounded)
     -> user/AbortSignal cancellation: CANCELLED (MissionStatus cancelled)
     -> existing trust/path/command safety stop: SAFETY_STOP
       (MissionStatus blocked + orchestration.terminal = SAFETY_STOP)
```

Only a genuine infrastructure failure may invoke Boss fallback. Scheduling
eligibility, infrastructure fallback eligibility, and response protocol
validity are distinct predicates. Normal assignment uses enabled routes with
positive weight. Fallback uses `selectBossFallbackEntry`: enabled, available,
compatible, unused in this Mission's fallback history, and not the current pin.
Weight 0 excludes a route from weighted assignment but does not by itself
forbid infrastructure fallback. Protocol/quality failures, cancellation, and
safety-stop do not rotate the Boss.

The host normalizes Pi `completeSimple` `AssistantMessage` values through one
canonical layer before `normalizeBossDecision`. Pi's public contract exposes
`stopReason` values `pending | stop | length | toolUse | error | aborted | deferred`
and content blocks `text | thinking | toolCall`. User-visible decision text is
exactly the `type:"text"` blocks (Pi `contentText()`). Thinking/CoT is never
used as the decision. `length` with complete JSON is a usable completion;
empty user-visible text is an invocation delivery failure (`empty_response`)
and may infrastructure-fallback; truncated incomplete JSON, empty
`dispatch`/`replan` task arrays, and invalid BossDecision documents remain
protocol and must not fallback. Unsupported shape, refusal, cancellation, and
classified request/response failures remain distinct. Inspect persists only
safe stage/class/stopReason/hasText/fallback fields.

Before the first Boss inference, Goal and Mission acceptance criteria are
preflighted against worker capability. `git commit` is outside the command
allowlist (`COMMAND_NOT_ALLOWLISTED` / `REVIEW_REQUIRED`, which workers treat
as a block). `git push` and other network/publication commands are
`NETWORK_OR_PUBLICATION` and `BLOCK`. Workers never receive
`explicitlyAuthorized` for those commands. An impossible Goal terminals
`AWAITING_USER` with provenance `CAPABILITY_MISMATCH` instead of burning
Boss cycles.

Logical Tasks are resolved by explicit Mission `taskId` or by identity key
`executionClass` + normalized objective. Repair reuses that identity. M7
reviewer prompts are execution-class specific. Completion inspects **active**
Tasks (latest non-cancelled identity); historical cancelled or superseded rows
remain durable. The Boss prompt includes a bounded canonical Mission
projection. `lastFeedback` and the next cycle persist in
`plan.orchestration`. Terminal Missions do not resume.

Invocation-delivery exhaustion is `BLOCKED`. Decision-protocol exhaustion with
zero Tasks remains Inspectable `AWAITING_USER`. Productive
plan→execute→verify→evaluate iterations keep the existing cycle bound.

The fallback event records the original route, replacement route, failure class, and safe
reason, then pins the replacement for the remaining Mission. Quality rejection,
cancellation, and safety-stop do not rotate the Boss. The loop persists bounded
cycle/repair dimensions and terminal analytics, including `CANCELLED` and
`SAFETY_STOP`; it cannot mark completion from a single finished task or a
Boss completion claim without execution and verification evidence.

Executable `@orchestrator` Missions do not wait for a manual Task editor. The
Boss runtime validates inference JSON with `normalizeBossDecision` instead of
casting parsed objects. Plan-phase `dispatch` and `replan` require at least
one actionable task; an empty plan is a `BossProtocolError`, counts as an
actionable-plan failure, and retries on the same pinned Boss until the cycle
budget is exhausted. Exhaustion persists Inspectable `AWAITING_USER`
diagnostics (last action, protocol/actionable-plan failure counts, task count,
stop reason, pin, fallback). Goal-level acceptance criteria are resolved at
Mission creation (explicit, labelled, or derived) and are not overwritten when
the user already supplied them.

The Boss is not an Implementation Worker. The Boss owns Mission-level
planning, evaluation, and terminal decisions; Investigation, Implementation,
and Verification remain the only worker pools and keep their own per-task/run
scheduling. M4 route selection/infrastructure fallback and M7 quality
rejection/escalation are separate boundaries. Pool and Boss recommendation
surfaces read one canonical, sample/stale-safe recommendation record, and
normal model labels never replace the exact internal route identity.

## 12. Worker lifecycle

```text
planned task
  -> Context Broker builds packet at mission generation G
  -> router selects route and creates attempt
  -> transaction records lease/running checkpoint
  -> child Pi starts with role prompt, model route, cwd, tool allowlist
  -> JSON events stream progress/usage/tool evidence
  -> child submits role-schema result
  -> executor terminates and cleans temporary files/process
  -> validate result and artifacts against generation/revision
  -> proposed evidence
  -> Boss promotes/rejects
  -> checkpoint
```

Temporary prompt/result files, if required by Pi invocation, use OS temporary directories, mode `0600`, random names, and cleanup on success/failure. They contain bounded Task Packets, never credentials. A startup janitor may remove stale files matching this package's exact prefix and ownership; it must not scan/delete arbitrary temporary content.

Cancellation sends the normal termination signal, waits a bounded grace interval, then force-terminates only the owned child process. Descendant cleanup behavior is a platform PoC.

## 13. Context Broker and evidence

A Task Packet is a value object with:

```text
missionId, taskId, canonicalGeneration, repositoryRevision,
role, executionClass, objective, constraints,
approvedFindings[], relevantArtifactRefs[], relevantFiles[],
acceptanceCriteria[], allowedTools[], allowedActions[],
priorAttempts[], outputSchemaId, contextBudget
```

Rules:

- No field contains a raw secret or full Boss transcript.
- Findings include evidence references and validation status.
- Implementers receive only approved plan/findings relevant to their files.
- Reviewers receive the acceptance contract, actual diff/artifacts/test evidence, implementer identity metadata needed for diversity, and no instruction to agree.
- Artifact references are resolved under repository/path policy; children do not receive arbitrary host paths.
- A packet is immutable after launch. New canonical state creates a new task/attempt rather than mutating the in-flight packet.

Structured child results are validated at the trust boundary. File references are normalized and checked against allowed roots. Test evidence records argv/command label, exit code, timestamps, and bounded output or artifact hash. Confidence is evidence metadata, not a gate by itself.

## 14. Canonical mission state and persistence

### 14.1 State transition model

Allowed high-level transitions:

```text
draft -> planned -> running <-> awaiting-review -> completed
                    |   |             |
                    |   +-----------> failed
                    +---------------> blocked
                    +---------------> cancelled

blocked -> running only through explicit resume/recovery
```

Every transition checks expected prior status and canonical generation. Compare-and-swap prevents a stale worker/Boss result from overwriting newer state.

### 14.2 SQLite responsibility (M6+)

The logical store is SQLite with WAL/transactions and restrictive file permissions. Minimum tables/projections:

- `missions` — current canonical snapshot/generation/status/project key;
- `mission_events` — append-only transition/audit metadata;
- `tasks` and `attempts` — packets, selected route, lease, timing, terminal state;
- `evidence` and `gate_results` — structured validated metadata/artifact references;
- `catalog_generations` and `routes` — discovery/reconciliation;
- `route_health` — current circuit state;
- `analytics_events` — privacy-filtered immutable operational events;
- `recommendations` — formula/evidence/proposed diff/status.

A state-changing transaction writes the new snapshot and corresponding event together. Large source/output content is not copied into the database; bounded evidence or workspace artifact hashes/references are stored.

M6 proves `node:sqlite` in the supported Node `v22.23.0` runtime and the actual Pi `0.84.1` Node launch path; standalone/Bun is not a supported package target. The probe and MissionStore tests emit only Node's experimental warning. M1 uses only the JSON configuration store and does not open SQLite.

### 14.3 Recovery

- On startup, run lightweight schema/version checks and periodic integrity checks, not an expensive full check on every event.
- Use transactions and WAL; never edit the database file directly.
- Maintain versioned online backups according to retention policy before migrations and significant restores.
- A failed migration rolls back and retains the pre-migration backup.
- Corruption stops mutation, opens Diagnostics/Restore, and never invents successful task state.
- Running attempts whose lease heartbeat expired become `interrupted`, not failed or successful. The Boss/user chooses retry/reconcile.

## 15. Failure and fallback semantics

### 15.1 Classifier

The classifier accepts normalized provider/child/process evidence and returns:

```text
kind, retryable, opensCircuit, retryAfter?, safeMessage, rawEvidenceRef?
```

Classification precedence is explicit: user cancellation/policy denial first; auth/quota/rate/model/provider/timeout/transport next; malformed worker output and quality outcomes are non-infrastructure; otherwise unknown.

Unknown is conservative: it may count toward degradation but does not trigger unbounded automatic fallback.

### 15.2 Infrastructure fallback flow

```text
attempt fails before accepted result
 -> classify infrastructure failure
 -> update selected route health
 -> check mission attempt/budget limit
 -> select next eligible pool route excluding attempted/open routes
 -> record fallback edge
 -> launch new attempt with same immutable task packet
```

Authentication failure may mark only the resource unavailable until credentials are repaired. Rate/quota cooldown honors valid retry-after within policy. Timeout/transport failures use bounded exponential cooldown. No infinite cycling is allowed.

### 15.3 Quality escalation flow

```text
worker returned successfully
 -> validate result/artifacts
 -> tests or reviewer/gate reject
 -> record quality outcome (route remains infrastructure-healthy)
 -> Boss receives evidence
 -> Boss chooses new plan/route/role/reviewer or terminal failure
```

A bad implementation must not poison route transport health merely because the quality gate failed. Quality history feeds later pool-specific analytics.

## 16. Health model

Minimal circuit states are `unknown`, `healthy`, `degraded`, `open`, and `probing`. Disabled/stale/unavailable are eligibility states shown alongside health, not circuit states.

Policy includes failure threshold, rolling window, default cooldown, maximum cooldown, probe timeout, and manual reset permission. A route moves:

```text
unknown --success--> healthy
healthy --eligible failures--> degraded --threshold--> open
open --cooldown--> probing --success--> healthy
                         \--failure--> open with bounded cooldown
```

One probe is admitted at a time. Manual reset clears the circuit but not catalog absence, disabled state, or missing auth. M4 persists this runtime state as versioned atomic `health.json` under the injected runtime root; it is not part of ConfigStore, config history, export, analytics, prompts, completions, or secrets. Corrupt health is quarantined without changing user configuration. Cancellation and invalid-request outcomes stop conservatively; they do not cause uncontrolled fallback.

## 17. Analytics event flow

```text
Pi/provider/worker/mission event
 -> normalize identifiers and timings
 -> secret/content filter
 -> validate event version
 -> append analytics event in same transaction when tied to state change
 -> asynchronous projections/queries
 -> TUI statistics
 -> recommendation calculation
 -> user Apply
 -> normal config save/audit path
```

Required event families include mission lifecycle, task attempt, provider request result, fallback, quality escalation, test/review result, gate result, config change, and recommendation action.

Token/cost provenance is stored (`provider_reported`, `pi_reported`, `configured_estimate`, `unknown`). Missing data remains null. Equivalent/avoided cost uses a versioned formula and never appears as actual spend.

Analytics does not persist prompts, source, diffs, tool arguments/output, headers, or full model messages by default. Evidence needed for acceptance lives in the mission evidence layer under its own bounded retention policy.

## 18. TUI architecture

`/orchestrator` creates a root component with one navigation stack. Each section requests a view model from application operations and returns explicit user intents. The root owns cancellation and disposal so Pi reload/session replacement cannot leave listeners or child operations alive.

Model-management save example:

```text
ModelsScreen intent
 -> validate proposed config diff
 -> show preview/confirmation
 -> ConfigService.save()
 -> if Pi idle, ProviderBridge.activate(generation)
 -> ModelsScreen renders active/pending/error generation
```

Runtime screen data uses snapshots plus event notifications; it does not poll the database on every render. Logs remain a Diagnostics detail, not the normal UX.

Accessibility baseline includes keyboard-only operation, visible focus, non-color state labels, cancellation, readable error text, and stable ordering.

## 19. Security boundaries

### 19.1 Network

- Validate gateway scheme/host and apply explicit connect/overall timeouts.
- Never log authorization headers, secret-resolver commands, or raw provider bodies.
- Bound catalog and response sizes before JSON parsing/materialization where practical.
- Follow redirects only under explicit safe policy; do not leak auth to a different origin.

### 19.2 Project input

- Read project overrides only after `ctx.isProjectTrusted()`.
- Project policy cannot choose arbitrary executable paths, secret stores, or loosen global protected paths.
- Role instruction files referenced from project config are content sent to models and are treated as untrusted until policy allows them.

### 19.3 Worker process and tools

- Use argv execution with `shell: false`.
- Pass only allowed tool names and bounded Task Packet data.
- Intercept destructive/protected-path operations before execution.
- Do not put secrets in argv, environment copied to diagnostics, prompt files, or task results.
- Track owned PID/process group for cancellation and cleanup.
- Install the worker safety guard at the child-session tool boundary; never rely on a diagnostic capability matrix as enforcement.

### 19.4 Persistence/export

- Files use least-privilege modes.
- Writes are atomic/transactional with backups before migration/restore.
- Schemas exclude secret values structurally; redaction is an additional guard, not the primary design.
- Diagnostic bundles require preview and explicit inclusion rules in a later mission.

## 20. Testing strategy

### Unit

Pure tests use in-memory values and fixed clocks/IDs for config merge/migration, pool operations, selection, classifier, cooldown, diversity, mission transitions, Task Packet construction, analytics aggregation, and recommendation formulas.

### Integration

- Fake 9Router HTTP server returns catalog generations, malformed/oversized payloads, status classes, retry-after, and request metadata.
- Fake Pi child executable emits the documented JSON event shapes and simulates success, malformed result, failure, hang, cancellation, and output overflow.
- Temporary directories exercise real atomic file writes, history, process-local locks, migration rollback, and corruption recovery. SQLite transaction tests begin with M6.
- Pi provider bridge tests use the exported runtime types/fakes without credentials.

### Real Pi smoke

An explicitly loaded development package is loaded from the repository or a temporary project location, never copied into live global config implicitly. M2 acceptance loaded the extension into installed Pi `0.84.1` with isolated agent/session/config roots, listed exactly five enabled fake routes, exposed all four commands through RPC, and completed one OpenAI-compatible streamed fake turn with the exact result `PI_FAKE_9ROUTER_OK`. It made no live provider call.

Offline/integration evidence MUST be labeled as such and never reported as real-provider proof.

## 21. Proof-of-concept register

These unknowns do not weaken requirements; the named milestone must prove the implementation mechanism before relying on it.

| ID | Required proof | Milestone | Failure response |
|---|---|---|---|
| POC-01 | Dynamic native-provider refresh changes only this provider's enabled models in Pi `0.84.1`, including active-model disable behavior. | M2 | Proven for fake routes: in-place re-registration replaces this provider's models; active-route disable is blocked until the user switches. |
| POC-02 | Deployed 9Router `/v1/models` fields can distinguish model, provider/resource, aliases, and combos. | M2 | Live probe skipped without credentials; exact IDs are preserved, unproven resource fields remain unknown, and rows are never merged by name. |
| POC-03 | 9Router responses expose authoritative actual route/account after internal combo fallback. | M2/M4 | Treat combo as opaque and label actual route/cost/diversity unknown. |
| POC-04 | Provider status/headers and Pi events are sufficient to classify quota/rate/auth/timeout across supported transports. | M4 | Use conservative unknown classification and bounded Boss-visible recovery. |
| POC-05 | Packaged extension can execute an exact-model child, stream tool progress/results, cancel/cleanup it, and avoid recursive orchestrator loading. | M5 | Proven with the Pi 0.84.1 SDK child runner and isolated fake-gateway parent→child test; retain the shipped process pattern as a later portability option. |
| POC-06 | `node:sqlite` works in the supported Node/Pi launch path. | M6 | Node/Pi path is proven; a future standalone/Bun target would require a separate adapter check. |
| POC-07 | Custom component listeners/overlays dispose correctly across `/reload`, `/resume`, `/fork`, and shutdown. | M9 | Close the Control Center on lifecycle change and reopen from canonical state. |
| POC-08 | Approved credential source integrates with a native Pi provider without persisting plaintext in package config/history. | M2 | Proven with an environment reference and synthetic fake key; Pi receives `$ENV_NAME`, while unsupported stores remain unavailable with no literal fallback. |
| POC-09 | Actual token/cache/cost metadata available per supported 9Router/Pi route. | M8 | Persist null/unknown and avoid fabricated cost/quality comparisons. |

## 21.1 M6 canonical mission state and context boundary

M6 adds a separate, injected-root SQLite `MissionStore` (`mission.sqlite`) behind the mission adapter. It owns mission revisions, tasks/attempts, proposed/accepted/rejected evidence, canonical items, event journal, leases, and checkpoints; it is not ConfigStore, HealthStore, or Pi session history. SQLite writes use prepared statements, foreign keys, bounded JSON, transactions, and integrity checks. Pi session entries contain only a mission pointer/status.

`ContextBroker` reads accepted canonical items only by default, sorts deterministically, applies explicit scope/tag filters and character/item bounds, and emits immutable `TaskPacketV1` values with source revision, included IDs, omitted count, and a SHA-256 digest. Proposed/rejected evidence and transcripts are not normal packet context. M5 remains the execution authority; worker results enter MissionStore as proposed evidence and require explicit operator admission before canonical promotion. M6 does not add Boss planning, quality/reviewer acceptance, parallelism, worktrees, or analytics.

## 22. Deliberate limits

- Ordered routing precedes historical scoring; add scoring only after M8 data demonstrates value.
- Shared-worktree mutation is serial; add worktree isolation only when parallel implementation is explicitly required.
- One local runtime database is sufficient; split databases only if measured lock/contention or retention needs demand it.
- Capability tags are user/catalog metadata; no ontology engine is planned.
- 9Router combos are opaque unless proven otherwise; no duplicate gateway implementation is planned.

These limits reduce code while preserving an upgrade path and do not relax validation, safety, recovery, or acceptance gates.

## 23.1 M12.1 Mission entry and worker terminology

Pi `0.84.1` exposes raw user input through the extension `input` event before
agent processing. The host handles only an explicit `@orchestrator <goal>` at
the supported beginning position; ordinary or extension-originated input returns
`continue`, while a valid explicit entry is `handled` so the goal is not sent
to the model as an ordinary prompt.

`createCanonicalMission` is the one host-facing creation operation used by both
the input handler and the existing New Mission menu. It trims and validates the
goal, applies the normal draft/user/repository defaults, and delegates durable
persistence to MissionStore. Pi history receives only the existing mission
pointer/status/revision entry; the MissionStore remains authoritative.

`/subagent-run` is presented as Direct Workers. Its Investigation,
Implementation, and Verification choices are foreground/ad-hoc workers and do
not create a Mission task, M7 verification run, quality decision, or quality
history. The Verification Pool remains shared route configuration for direct
read-only workers and canonical Mission reviewers; `/verify-task` remains the
canonical Mission/Task/Run → M7 path. M12.1 does not add classification,
automatic routing, promotion, or scheduling.

## 23.2 M12.2 Hybrid Smart Router

The host's ordinary native Pi `input` path first preserves the explicit
M12.1 `@orchestrator <goal>` bypass, then evaluates Smart Routing. A small
deterministic local analyzer normalizes Unicode and emits bounded bilingual
structural signals. Clear simple input returns `NORMAL`; clear multi-stage
input returns `SUGGEST_MISSION`; only the ambiguous path can call the optional
triage client.

The triage client resolves the configured stable route ID through the current
provider projection and creates an isolated Pi model runtime without copying
resolved credentials. It sends only the current prompt and local signal
metadata, validates the exact JSON response, bounds latency, and tries the
configured fallback only for a capability failure. A disagreement is a valid
answer, not a fallback trigger. Any unavailable or malformed capability
returns the user-choice recommendation so the original prompt is never lost.

Smart Routing settings use a versioned `smart-routing.json` sidecar with
atomic writes, generation checks, bounded history, and restore support. This
keeps the legacy ConfigV1 route envelope and existing route-selection policy
unchanged while retaining stale IDs for user repair. The existing twelve
Control Center sections remain fixed; settings are nested in Routing &
Fallback. Routing telemetry is a typed metadata event with allowlisted reason
codes/actions and no prompt or provider-response field. M12.2 does not read or
write Routing Memory; its Smart Router context leaves the M12.3 memory boundary
explicit.

## 23.3 M12.3 Adaptive Routing Memory

The host keeps Routing Memory in a separate versioned `routing-memory.json`
sidecar under the configured application root. Its envelope has a storage
version, generation, timestamp, bounded rule list, atomic writes, cross-process
storage locking, and bounded generation history. A rule contains only an ID,
action, source (`explicit` or `learned`), confidence, observation count,
timestamps, enabled state, and a versioned `RoutingSignature`.

`RoutingSignature` is an abstract projection of the M12.2 local analyzer:
language (`en`, `fa`, or `mixed`), task family, project scope, investigation /
mutation / implementation / testing / verification / audit / research /
release flags, step/dependency/deliverable/role structure, sensitivity,
destructiveness, and bounded risk. There is intentionally no prompt, token,
embedding, source text, transcript, tool result, provider response, or
credential field. Similarity compares these concepts and rejects
explanation-vs-action, materially escalated, and keyword-only matches.

The ordinary Pi input flow preserves the priority `@orchestrator` → explicit
Mission rule → strong learned rule → M12.2 local/triage routing → normal
continuation. Explicit Mission rules can produce `AUTO_MISSION`; learned
Mission rules require repeated evidence and strong matching, and learned
Normal rules can suppress repetitive recommendations only when the current
signature is not materially more complex or sensitive. Same-tier Mission /
Normal conflicts never auto-route. Any AUTO_MISSION calls the existing
`createCanonicalMission` operation exactly once.

Routing Memory settings remain inside Routing & Fallback: global memory enable,
Auto-Learn enable, Learned Behaviors management, and confirmation-gated
abstract-only backup/restore. Rule deletion/disablement and learned-only/full
reset are durable operations. Corrupt rows are isolated, schema-version 0
records migrate per row, unsupported envelopes fail closed to ordinary routing,
and disabled memory retains state. Routing telemetry is an allowlisted bounded
metadata projection of hits, provenance, confidence, actions, conflicts, and
reset/management events.

## 23. M11 package and rescue boundary

M11 packages the compiled host entrypoint through Pi's supported `pi-package`
manifest. The release candidate uses a strict allowlist (`dist` JavaScript and
declarations plus README), declares Pi `0.84.x` as a peer, and has no runtime
npm dependencies or lifecycle hooks. `package-info` exposes version, release
status, the current development line keyed by that package version, the latest
accepted development milestone, Pi compatibility, and schema versions from
package metadata so an installed artifact does not shell out to Git. A package
version without a mapped development line fails closed as
`stale-development-line:<version>` rather than silently retaining an older RC
title. Public prerelease identity and accepted development milestone remain
distinct; `productionReady` stays false until an authorized production release.

The release workflow writes its immutable tarball, checksum, manifest,
artifact-derived extracted directory, machine-readable upgrade/rollback
evidence, and self-contained review bundle outside the source checkout. It
verifies the unpacked entrypoint without the checkout and rejects secrets,
local paths, `.git`, runtime databases, sessions, and development
dependencies. Pi install/remove/startup command evidence is sanitized at the
producer so persisted review files cannot contain local absolute machine
paths; the privacy scanner remains the rejecting gate and is not given an
allowlist exception. Pi `0.84.1` installs the checksum-verified extracted directory;
it does not load a `.tgz` directly. Install, upgrade, rollback, and rescue use
isolated Pi settings/runtime roots. A rescue harness can remove or disable the
package and restore a named M10 compatibility baseline without loading the
extension. A local RC is not a public release, and no live route or publication
is implied.

M11-R8 makes the clean Git commit, not the mutable developer filesystem, the
release-source authority. A detached local staging checkout of the exact
commit supplies both the build and an independent execution-time rerun of the
repository's bound `npm run check` definition. The manifest records commit,
tree, source digest, script definition, non-zero observed TAP totals, and
trusted Node/npm/TypeScript/Pi identities. Untracked and ignored developer
files are outside that source; tracked or staged changes fail closed.

Artifact, extracted source, compatibility trees, and review bundles are
recursively inspected without following symlinks. The bundle manifest covers
every regular file by deterministic relative path, size, and SHA-256, while an
expected root digest is supplied separately by the handoff/reviewer. The
bundle's internal claims are audit records and cannot authenticate coordinated
tampering by themselves. Compatibility state is created and read with M10
modules, then read with rc.4 modules, then read again with M10 modules after
rollback; equality and data-loss results are derived from the observed
machine-readable snapshots.

## 23.4 RC20 Thinking Effort and live catalog boundary

RC20 keeps five boundaries separate: Pi's provider/model catalog, PMO route
enablement, Pool membership, Pool-entry priority, and Pool-entry Thinking
Effort. `auto` is represented by omission of `thinkingLevel` in
`createAgentSession`; explicit effort is validated against the route's
allowlisted `thinkingLevelMap` and Pi reasoning metadata. A child attempt records
the requested policy and the session's observed effective level, or `unknown`.

Catalog refresh is source-aware. PMO-owned routes refresh through the bounded
9Router client and cache a validated last-known-good snapshot; external Pi
providers refresh through Pi's provider registry and are adopted credential-
blind. Refreshes produce added/removed/changed IDs, preserve enabled flags and
Pool order, keep removed Pool routes as missing, and never replace or unregister
an external provider. A stale explicit effort becomes unavailable rather than
being silently downgraded. Exact remote/resource/source identity is used for
reconciliation; only actual duplicate configured identities remain ambiguous.
Automatic periodic refresh and Benchmark Lab are deliberately deferred.

## 23.5 RC21 external refresh and metadata boundary

The host normalizes a domain `CatalogRow` from its nested `entry` first, so
rich catalog metadata is not lost when compact aliases such as
`remoteModelId` are also present. The normalization is presence-preserving:
reasoning, vision, context, max output, and thinking-level maps remain absent
when the source is absent.

Pi `0.84.1` static providers loaded from `models.json` have no
`refreshModels` hook. Refresh Models therefore obtains the current provider
auth result from the bound public Pi registry and passes a bounded, transient
auth object to the existing `NineRouterClient` for one `/v1/models` request.
The manager writes only validated catalog/LKG state, marks that runtime view
upstream-authoritative, and never registers or rewrites the external Pi
provider. A provider with a native refresh hook keeps Pi's existing path.

The populated picker is presentation-only: internal route IDs are retained in
the normalized row and Inspect/Diagnostics, but omitted from normal labels.
Refresh feedback is explicit and sanitized; failures leave the prior catalog
visible.
