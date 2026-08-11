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

### 5.3 `secrets`

Responsibilities:

- validate opaque `SecretRef` values;
- resolve a reference only at the network-request boundary;
- return secret-bearing values in memory for the shortest practical lifetime;
- redact failures before they leave the module.

Approved stores may include Pi's auth provider, environment variables, and macOS Keychain. Configuration, history, SQLite, exports, analytics, and diagnostics store the reference/type only. M2 chooses the first store after an authorized integration proof.

### 5.4 `catalog` and `host/pi-provider-bridge`

`catalog` fetches and validates the full 9Router catalog, assigns a generation, preserves last-known-good data, and reconciles stable local route records without auto-enabling new rows.

`pi-provider-bridge` registers one native Pi provider namespace for enabled 9Router routes. Its model refresh projection is:

```text
full catalog generation
    + explicit enabled route IDs
    + valid route metadata/auth availability
    = Pi model definitions for enabled routes only
```

The full catalog never becomes the Pi provider's model list. A TUI save that changes enabled routes publishes a new config generation, refreshes/re-registers the provider while Pi is idle, verifies the effective model set, and then reports activation. If activation fails, configuration remains saved but is marked pending/error; the previous safe registry generation remains active.

### 5.5 `policy`

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

### 5.7 `mission`

Owns the canonical mission state machine, checkpoints, attempt leases, evidence promotion, gates, and legal transitions. It is the sole authority allowed to write `completed` after Boss approval and gate evaluation.

### 5.8 `context-broker`

Builds role-specific Task Packets from an immutable canonical-state generation. It selects only approved findings and directly relevant artifacts. Packet construction enforces size, field, and sensitivity policy before launch.

### 5.9 `workers`

Owns child `pi` invocation, JSON event parsing, progress, output bounds, structured result submission, timeout, cancellation, cleanup, and concurrency.

The first implementation uses `node:child_process.spawn` with argv arrays and `shell: false`, matching Pi's installed example. It invokes the current Pi executable rather than assuming a global binary path. Read-only tasks may run concurrently within configured limits. Shared-worktree mutation is serial by default.

### 5.10 `analytics`

Accepts privacy-filtered internal events, persists metadata, creates query projections, and generates explainable recommendations. It cannot call configuration mutation directly; Apply flows through `config` after user confirmation.

### 5.11 `tui`

Renders the twelve Control Center sections using Pi TUI components and calls application operations. Components do not read files, query SQLite, resolve secrets, or call 9Router directly. Each screen receives view data plus explicit commands so non-TUI tests can exercise the same operations.

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

`Route.id` is local and stable. `remoteModelId` is what is sent to 9Router. `resourceId` distinguishes subscription/API/combo resources. `underlyingFamily` is optional metadata for diversity, never identity. If discovery cannot populate resource identity, the route is ambiguous until user configuration or a richer 9Router API resolves it.

No resolved credential field exists in these schemas.

## 7. Configuration and scope

Use Pi exports such as `getAgentDir()` and `CONFIG_DIR_NAME`; do not hard-code `.pi` in implementation.

Conceptual locations:

```text
<agentDir>/pi-multi-orchestrator/
  config.json                  global human-portable config
  history/                     prior valid config generations
  runtime.sqlite               missions, health, catalog, analytics, audit
  backups/                     validated runtime database backups

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
GET <gateway base>/v1/models
  Authorization: resolved only at request boundary when required
  AbortSignal + configured timeout

POST <gateway base>/v1/chat/completions (through Pi provider)
  model: Route.remoteModelId
```

M2 must validate the deployed version without printing its URL, headers, or credentials. The compatibility catalog is sufficient for model IDs but may not expose subscription/account identity, underlying family, context limits, costs, health, or the actual member chosen by a combo. Those fields remain unknown until a documented management endpoint, response metadata, or explicit user mapping supplies them.

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
4. Reconcile by stable remote/resource identity
   - known route: update last-seen metadata
   - new route: create disabled
   - missing route: mark unavailable/stale; never retarget
5. Persist generation transactionally
6. TUI previews changes
7. User enables/disables/reorders and saves config generation C
8. At Pi idle boundary, ProviderBridge projects enabled valid routes
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

### 14.2 SQLite responsibility

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

M1 must prove `node:sqlite` in the supported Node runtime and Pi's standalone/Bun distribution. The local Node `v22.23.0` probe passed but emitted an experimental warning. If the supported standalone host cannot load it, M1 selects one compatible SQLite driver while preserving the logical schema. This is the only open physical persistence choice.

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

One probe is admitted at a time. Manual reset clears the circuit but not catalog absence, disabled state, or missing auth.

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
- Temporary directories exercise real atomic file writes, history, locks, SQLite transactions, migration rollback, and corruption recovery.
- Pi provider bridge tests use the exported runtime types/fakes without credentials.

### Real Pi smoke

An explicitly authorized smoke package is loaded from the repository or a temporary project location, never copied into live global config implicitly. It verifies command registration, custom component open/close, provider register/refresh/remove, session reload, model switch boundary, and one selected real 9Router route only when credentials/fixture authorization is present.

Offline/integration evidence MUST be labeled as such and never reported as real-provider proof.

## 21. Proof-of-concept register

These unknowns do not weaken requirements; the named milestone must prove the implementation mechanism before relying on it.

| ID | Required proof | Milestone | Failure response |
|---|---|---|---|
| POC-01 | Dynamic native-provider refresh changes only this provider's enabled models in Pi `0.84.1`, including active-model disable behavior. | M2 | Use safe unregister/register at idle; never edit Pi settings automatically. |
| POC-02 | Deployed 9Router `/v1/models` fields can distinguish model, provider/resource, aliases, and combos. | M2 | Require explicit local resource mapping and mark ambiguous entries disabled. |
| POC-03 | 9Router responses expose authoritative actual route/account after internal combo fallback. | M2/M4 | Treat combo as opaque and label actual route/cost/diversity unknown. |
| POC-04 | Provider status/headers and Pi events are sufficient to classify quota/rate/auth/timeout across supported transports. | M4 | Use conservative unknown classification and bounded Boss-visible recovery. |
| POC-05 | Packaged extension can launch the same current Pi executable, stream JSON, terminate its process tree, and avoid recursive orchestrator loading. | M5 | Use a narrowly configured SDK child runner if process invocation is not portable. |
| POC-06 | `node:sqlite` works under all supported Pi launch modes, including standalone/Bun if supported. | M1 | Select one compatible SQLite driver; keep logical schema and tests unchanged. |
| POC-07 | Custom component listeners/overlays dispose correctly across `/reload`, `/resume`, `/fork`, and shutdown. | M9 | Close the Control Center on lifecycle change and reopen from canonical state. |
| POC-08 | Approved credential source integrates with a native Pi provider without persisting plaintext in package config/history. | M2 | Route remains unavailable with setup guidance; no literal-secret fallback. |
| POC-09 | Actual token/cache/cost metadata available per supported 9Router/Pi route. | M8 | Persist null/unknown and avoid fabricated cost/quality comparisons. |

## 22. Deliberate limits

- Ordered routing precedes historical scoring; add scoring only after M8 data demonstrates value.
- Shared-worktree mutation is serial; add worktree isolation only when parallel implementation is explicitly required.
- One local runtime database is sufficient; split databases only if measured lock/contention or retention needs demand it.
- Capability tags are user/catalog metadata; no ontology engine is planned.
- 9Router combos are opaque unless proven otherwise; no duplicate gateway implementation is planned.

These limits reduce code while preserving an upgrade path and do not relax validation, safety, recovery, or acceptance gates.
