# Architecture decision log

All records are accepted for M0 unless marked otherwise. A later milestone may supersede a record only with a new decision entry and migration impact.

## ADR-001 — Pi is the initial host harness

- **Decision:** Ship as a Pi extension/package and use supported extension and SDK surfaces.
- **Rationale:** Pi already supplies the terminal session, tools, model registry, lifecycle events, custom commands, and TUI primitives.
- **Alternatives:** A standalone orchestrator or a fork of Pi.
- **Consequences:** Host-version compatibility must be tested; orchestration state remains ours rather than modifying Pi internals.

## ADR-002 — 9Router is the initial model gateway

- **Decision:** Discover and invoke remote routes through 9Router's OpenAI-compatible API. Compose with 9Router account/combo fallback instead of copying it.
- **Rationale:** It is the user's existing aggregation and subscription-routing layer.
- **Alternatives:** Direct integrations for every provider or replacing 9Router.
- **Consequences:** Catalog/resource metadata and actual-route response attribution require M2 proof of concept.

## ADR-003 — Configuration is data-driven and TUI-managed

- **Decision:** Ordinary model, pool, route, profile, budget, threshold, and policy changes are validated data edited through `/orchestrator`.
- **Rationale:** Source edits are unsafe and block routine operation.
- **Alternatives:** TypeScript constants or manual JSON as the primary UX.
- **Consequences:** Schema versioning, migration, history, rollback, and corruption recovery are product requirements.

## ADR-004 — There are exactly three execution pools

- **Decision:** Investigation, Implementation, and Verification are the only main worker pools.
- **Rationale:** They express materially different cost/tool/independence needs without proliferating per-persona pools.
- **Alternatives:** One global pool or one pool per role.
- **Consequences:** New roles map to one execution class; adding a fourth main pool requires a specification change.

## ADR-005 — Roles map dynamically to pools

- **Decision:** The Boss chooses role/persona; configuration maps each role to an execution class.
- **Rationale:** `debugger` and `coder` may share implementation routes while retaining different instructions and result schemas.
- **Alternatives:** Binding each role directly to a model or dedicated pool.
- **Consequences:** Task Packets carry both role and execution class, and routing never infers the class from a model name.

## ADR-006 — Route identity includes resource identity

- **Decision:** A route is a stable local `routeId` plus gateway, remote model identifier, and source/resource discriminator; underlying model family is separate metadata.
- **Rationale:** The same model through two subscriptions or APIs represents distinct quota, cost, health, and fallback resources.
- **Alternatives:** Deduplicate only by model name or Pi provider/model pair.
- **Consequences:** 9Router must expose or be configured with a stable discriminator; ambiguous catalog rows cannot be silently merged.

## ADR-007 — Infrastructure fallback and quality escalation are separate state transitions

- **Decision:** Transport/quota/auth/availability failures may select another eligible route. Successful-but-unacceptable work returns to the Boss for a new decision.
- **Rationale:** Retrying a rejected implementation is mission planning, not network resilience.
- **Alternatives:** One generic retry/fallback loop.
- **Consequences:** Events, counters, policies, and acceptance tests remain distinct.

## ADR-008 — Canonical mission state is authoritative

- **Decision:** Persist a validated mission snapshot and evidence records outside chat history. Child output is proposed evidence until the Boss promotes it.
- **Rationale:** Chat-to-chat summaries create context fragmentation and a telephone game.
- **Alternatives:** Rely on the Boss transcript or forward every prior child result.
- **Consequences:** Task Packets are bounded projections; reviewers inspect artifacts and exact evidence when available.

## ADR-009 — Recommendations never auto-apply by default

- **Decision:** Analytics may create explainable recommendations with Apply, Ignore, and Details; only explicit Apply mutates configuration.
- **Rationale:** Historical correlations are uncertain and configuration changes affect cost and quality.
- **Alternatives:** Silent priority tuning or no recommendations.
- **Consequences:** Recommendation generation and configuration mutation are separate audited actions.

## ADR-010 — Privacy-minimal analytics begins in M1

- **Decision:** Record operational metadata from the first engine milestone, but not prompts, source, secrets, or full conversations by default.
- **Rationale:** Later optimization needs baseline history without creating a content archive.
- **Alternatives:** Add telemetry late or persist full traces.
- **Consequences:** Unknown fields remain unknown; estimated cost and route attribution are explicitly labeled.

## ADR-011 — Workers initially use isolated child Pi processes

- **Decision:** M5 follows Pi's shipped subagent pattern and launches bounded child `pi` processes in JSON mode.
- **Rationale:** Process isolation, cancellation, per-agent model/tool selection, and context isolation already have a verified host precedent.
- **Alternatives:** Multiple in-process SDK sessions or installing `pi-subagents`.
- **Consequences:** We own scheduling, structured-result validation, process cleanup, and resume semantics; no third-party subagent extension is installed.

## ADR-012 — Persistence is split by responsibility

- **Decision:** Human-editable configuration remains versioned JSON; transactional mission/health/analytics data uses SQLite; Pi session entries store only a mission pointer/status.
- **Rationale:** JSON is portable for import/export, while concurrent event/query data needs transactions and indexes.
- **Alternatives:** All JSON files, all SQLite, or storing everything in Pi session JSONL.
- **Consequences:** M1 must prove the SQLite driver under supported Node and standalone Pi launch modes before freezing the physical driver.

## ADR-013 — Secrets are references, never ordinary configuration

- **Decision:** Persist only a secret-store reference. Resolve credentials at request time from an approved store such as Pi auth, environment, or macOS Keychain.
- **Rationale:** Config history, project overrides, backups, exports, and diagnostics are not secret stores.
- **Alternatives:** Literal API keys in config or silently copying 9Router credentials.
- **Consequences:** Missing credentials produce an explicit unavailable route; export needs no heuristic redaction of allowed fields.

## ADR-014 — Global/project precedence is explicit

- **Decision:** Schema defaults < global config < trusted project override < mission launch override. Objects merge by declared keys; arrays replace as a whole; identities are merged by stable ID only where the schema declares keyed collections.
- **Rationale:** Generic deep merge creates surprising pool order and partial secret-bearing objects.
- **Alternatives:** Pi settings merge semantics, project-only config, or implicit array concatenation.
- **Consequences:** Untrusted project overrides are ignored with diagnostics, and the effective configuration is inspectable.

## ADR-015 — Shared-worktree mutation is serial by default

- **Decision:** At most one implementation worker may mutate a shared worktree. Read-only investigation/verification may run concurrently; parallel mutators require explicit isolated worktrees later.
- **Rationale:** Concurrent edits are a smaller reliability win than deterministic ownership and conflict avoidance.
- **Alternatives:** Unrestricted parallel workers or mandatory worktree management in M5.
- **Consequences:** Initial throughput is bounded but safe; add worktree orchestration only when measured demand justifies it.

## ADR-016 — Active model and Boss switches occur only at safe boundaries

- **Decision:** Disabling an active route or changing a Boss profile is staged until Pi is idle and a valid replacement is selected. Failed Boss turns with completed tool side effects are never blindly replayed.
- **Rationale:** A model change can preserve transcript context, but replaying a side-effecting turn can duplicate changes.
- **Alternatives:** Immediate removal/switch or automatic whole-turn replay.
- **Consequences:** The TUI shows pending activation and recovery choices; canonical state, not hidden model state, carries continuity.
