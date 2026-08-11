# Acceptance test plan

## 1. Test contract

Every implementation test MUST record its level, fixture versions, action, expected state/output, and pass/fail result. A test passes only when every listed assertion holds. Network/model tests are never inferred from unit or fake-provider evidence.

Levels:

- **U — Unit:** pure or temporary-local deterministic test; no network/model call.
- **I — Integration:** fake 9Router, fake Pi child, real temp filesystem/SQLite; no paid/live provider.
- **P — Real Pi smoke:** installed Pi runtime with no provider call unless stated.
- **L — Authorized live route:** real 9Router/provider. Optional for ordinary CI and run only with explicit credentials/fixture authorization.

Unless a case says otherwise, tests use fixed time/IDs, a temporary agent directory, a trusted temporary project, no inherited live configuration, and no credentials. They MUST NOT read or write `~/.pi/agent/`.

## 2. M0 repository acceptance

### M0-01 — Required repository content

- **Level:** U
- **Action:** list tracked/worktree files.
- **Pass:** `README.md`, `AGENTS.md`, `.gitignore`, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE_TESTS.md`, `docs/ROADMAP.md`, and `docs/DECISIONS.md` exist and are non-empty; no production `.ts`/`.js` extension or package manifest exists.

### M0-02 — Pi baseline evidence

- **Level:** P, read-only
- **Action:** run `pi --version`; resolve its installed package; inspect exported docs/types.
- **Pass:** the exact version/package is recorded in README/architecture; confirmed and PoC capabilities are separated; no Pi configuration timestamp/content changes.

### M0-03 — Internal links and Markdown

- **Level:** U
- **Action:** parse relative Markdown links and basic fence balance.
- **Pass:** every relative file/anchor target resolves; every fenced block is closed; files end with a newline; no malformed headings are reported by the selected checker.

### M0-04 — Scope and secret check

- **Level:** U
- **Action:** inspect diff/file list and run a likely-secret pattern scan that reports paths/line numbers only.
- **Pass:** no credentials/private keys/tokens or private endpoint values are present; no live Pi/9Router config, GitHub remote, production code, dependency install, or model call occurred.

### M0-05 — Cross-document consistency

- **Level:** U/manual review
- **Action:** compare product invariants, architecture, tests, decisions, and roadmap.
- **Pass:** pool count, route identity, fallback/quality semantics, ownership, persistence, scope precedence, privacy, and milestone boundaries agree; every PoC uncertainty is named and does not silently weaken a core requirement.

## 3. Configuration and persistence

### CFG-01 — Atomic valid save

- **Level:** I
- **Setup:** valid generation 7 exists; instrument storage fault points.
- **Action:** save a valid change to generation 8.
- **Pass:** current generation is 8; generation 7 is in history; readers see either complete 7 or complete 8, never partial JSON; permissions meet policy; one audit event exists.

### CFG-02 — Validation failure is non-mutating

- **Level:** U/I
- **Setup:** valid current config; proposed pool references a nonexistent route.
- **Action:** save.
- **Pass:** save returns validation error naming the reference; current bytes/generation/history/active runtime are unchanged.

### CFG-03 — Mid-write failure preserves current

- **Level:** I
- **Setup:** inject failure after temporary-file flush and before rename.
- **Action:** save a valid config.
- **Pass:** old primary remains valid/active; failure is reported; temp artifact is safely recoverable/cleanable; no false success audit exists.

### CFG-04 — Migration and rollback

- **Level:** U/I
- **Setup:** supported older schema fixture and migration fault fixture.
- **Action:** load/migrate both.
- **Pass:** supported fixture produces the exact current semantic value; fault fixture leaves original intact and recoverable, with no partially activated version.

### CFG-05 — Corrupt config recovery

- **Level:** I
- **Setup:** corrupt primary, valid last-known-good, older history.
- **Action:** start config service.
- **Pass:** last-known-good becomes effective; corrupt bytes are retained for diagnosis; TUI state says recovered/stale; primary is not silently overwritten; mutation requires explicit repair/save.

### CFG-06 — Corrupt config without recovery

- **Level:** I
- **Setup:** corrupt primary and no valid backup/default-compatible state.
- **Action:** start.
- **Pass:** engine enters configuration-error/read-only diagnostics state; it does not start workers or fabricate config.

### CFG-07 — Pool reorder persists

- **Level:** U/I
- **Setup:** Implementation order `[r1,r2,r3]`.
- **Action:** move `r3` up twice, save, create a fresh service instance.
- **Pass:** effective order is exactly `[r3,r1,r2]`; routing selects `r3` when all are eligible; no other pool changes.

### CFG-08 — History restore is itself safe

- **Level:** I
- **Setup:** valid generations 3 and 4, current 4.
- **Action:** restore 3.
- **Pass:** pre-restore generation 4 receives a new backup; effective content equals 3 but has a new monotonic generation/audit event; validation runs before activation.

### CFG-09 — Import preview and activation

- **Level:** I
- **Setup:** valid import differing in two pools/profile; invalid import with duplicate route ID.
- **Action:** preview then apply each.
- **Pass:** valid preview lists exact semantic diff and applies only after confirmation; invalid import never offers successful activation and changes nothing.

## 4. Global/project behavior

### SCOPE-01 — Project override precedence

- **Level:** U
- **Setup:** default concurrency 1; global 4; trusted project 2; mission override 1.
- **Action:** resolve with/without each layer.
- **Pass:** effective values are 4, then 2, then 1 as layers are added; source attribution matches each winner.

### SCOPE-02 — Array replacement

- **Level:** U
- **Setup:** global Investigation order `[a,b,c]`; project value `[c,a]`.
- **Action:** resolve.
- **Pass:** result is `[c,a]`, not concatenated/element-merged; other pools inherit unchanged.

### SCOPE-03 — Untrusted project ignored

- **Level:** I/P
- **Setup:** project override attempts to enable a route and loosen protected paths; Pi trust is false.
- **Action:** initialize extension.
- **Pass:** neither project value is applied; global/default values remain; diagnostics identify ignored project override without exposing content/secrets.

### SCOPE-04 — Project cannot loosen safety ceiling

- **Level:** U
- **Setup:** global non-overridable protected path; trusted project tries to remove it.
- **Action:** resolve.
- **Pass:** resolution rejects the unsafe field or retains the ceiling with a validation diagnostic; no worker launches under loosened policy.

## 5. Catalog and selective model exposure

### MOD-01 — Remote 36, enabled 5

- **Level:** I/P
- **Setup:** fake 9Router returns 36 valid distinct catalog entries; local config enables 5.
- **Action:** refresh and activate Pi provider.
- **Pass:** catalog store contains 36; orchestrator provider exposes exactly the 5 enabled IDs; the other 31 are searchable in Control Center but absent from that provider's Pi model list; unrelated native Pi providers are unchanged.

### MOD-02 — New model remains disabled

- **Level:** I
- **Setup:** generation 1 has 36 entries and 5 enabled; generation 2 adds `new-37`.
- **Action:** refresh generation 2.
- **Pass:** catalog count is 37; enabled count remains 5; `new-37` is marked new/disabled, absent from all pools and Pi provider exposure until explicit enable/save.

### MOD-03 — Missing enabled model is not retargeted

- **Level:** I
- **Setup:** enabled route `r1` points to remote ID `provider-a/model-x`; next catalog removes it but includes `provider-b/model-x`.
- **Action:** refresh.
- **Pass:** `r1` becomes unavailable/stale; no identity fields are rewritten; the same-named entry stays a separate disabled candidate; routing excludes unavailable `r1`.

### MOD-04 — Same underlying model, two resources

- **Level:** U/I
- **Setup:** routes `luna-codex-sub` and `luna-opencode-sub` share underlying family/version but have distinct resource IDs/remote IDs.
- **Action:** enable both, add both to Implementation, record one failure.
- **Pass:** two Pi model choices/routes remain; pool order preserves both; health/cost/usage/fallback events attach only to the attempted resource; no deduplication occurs.

### MOD-05 — Ambiguous resource identity

- **Level:** I
- **Setup:** two discovery rows cannot be distinguished by stable remote/resource identity.
- **Action:** reconcile.
- **Pass:** rows are marked ambiguous/disabled; no existing route is silently merged or overwritten; diagnostics name the metadata gap without secret/raw-body dump.

### MOD-06 — Runtime enable/disable

- **Level:** P
- **Setup:** Pi idle; orchestrator provider exposes routes `a,b` and active model is unrelated.
- **Action:** enable `c`, disable `b`, save/activate.
- **Pass:** without Pi restart, provider exposes `a,c`; `b` is absent; saved/active generations agree; command/TUI remains responsive.

### MOD-07 — Disable active route is staged

- **Level:** P
- **Setup:** route `b` is active; Pi is streaming.
- **Action:** request disable `b`.
- **Pass:** no mid-turn removal occurs; UI shows pending; at idle user selects/has a valid replacement, model switch succeeds, then `b` is removed; mission checkpoint records the boundary.

### MOD-08 — Unavailable 9Router with cache

- **Level:** I
- **Setup:** valid cached enabled catalog generation; gateway times out.
- **Action:** startup/refresh.
- **Pass:** bounded timeout returns; cached enabled routes may remain registered as stale; no newly discovered claims appear; health/diagnostics show gateway unavailable and cache age; no infinite retry.

### MOD-09 — Unavailable 9Router without cache

- **Level:** I
- **Setup:** empty store; gateway refuses connection.
- **Action:** startup.
- **Pass:** orchestrator registers no 9Router model; Control Center/Diagnostics opens; error is actionable/privacy-safe; Pi and unrelated providers continue.

### MOD-10 — Malformed/oversized catalog

- **Level:** I
- **Setup:** invalid shape then response beyond configured size.
- **Action:** refresh each.
- **Pass:** both are rejected before activation; last-known-good stays current; failure class/stage is recorded; memory/output remains bounded.

## 6. Pools, roles, Boss, and policies

### POOL-01 — Exactly three classes

- **Level:** U
- **Action:** validate configs with the three required pools, a missing pool, and a fourth main pool.
- **Pass:** only the exact three-pool config validates; arbitrary roles remain allowed through role mapping.

### ROLE-01 — Boss chooses roles dynamically

- **Level:** I
- **Setup:** deterministic Boss fixture plan requests `researcher`, `debugger`, `reviewer` and no other roles.
- **Action:** accept plan.
- **Pass:** exactly three tasks/roles are created; no fixed scout/implementer set is injected.

### ROLE-02 — Roles map to appropriate pool

- **Level:** U/I
- **Setup:** researcher→investigation, debugger→implementation, reviewer→verification; each pool has one distinct route.
- **Action:** route the three tasks.
- **Pass:** each selects only its mapped pool route; role identity remains present in packet/result/analytics.

### ROLE-03 — Empty mapped pool

- **Level:** U
- **Setup:** reviewer maps to an empty Verification pool.
- **Action:** route reviewer.
- **Pass:** explicit `no_eligible_route` is returned to Boss; no Investigation/Implementation borrowing occurs.

### BOSS-01 — Profile switch at safe boundary

- **Level:** I/P
- **Setup:** Balanced is active; Premium is requested during a running turn.
- **Action:** request switch, finish turn.
- **Pass:** current turn remains on original route; switch is pending then applied at idle/checkpoint; canonical mission remains same; audit records old/new profile.

### BOSS-02 — No blind replay after side effects

- **Level:** I
- **Setup:** Boss attempt executes a fake write tool, then provider fails.
- **Action:** recovery policy evaluates fallback.
- **Pass:** attempt becomes interrupted/needs-reconciliation; write is not invoked again automatically; next Boss receives canonical/tool evidence and an explicit recovery decision.

### POL-01 — Preset is policy data

- **Level:** U
- **Setup:** two differently named presets with identical fields.
- **Action:** resolve both.
- **Pass:** effective behavior is identical; renaming a preset does not change routing/gates; no model name is inferred from preset name.

## 7. Routing, fallback, health, and diversity

### FB-01 — Primary quota exhausted

- **Level:** U/I
- **Setup:** Implementation order `[sub-route,api-route]`; first attempt returns classified quota exhaustion; second succeeds; limits permit two attempts.
- **Action:** run task.
- **Pass:** `sub-route` enters quota cooldown; `api-route` is selected next; one infrastructure fallback edge is recorded with source/destination/class; task packet is unchanged; no quality escalation is counted.

### FB-02 — Rate limit honors Retry-After

- **Level:** U/I
- **Setup:** route returns 429 with valid retry-after 120 seconds; fixed clock.
- **Action:** classify/update/select before and after deadline.
- **Pass:** route is ineligible before deadline, eligible for one probe after it; it is not retried on every invocation.

### FB-03 — Authentication failure is resource-local

- **Level:** U/I
- **Setup:** one of two same-model resources returns authentication failure.
- **Action:** update health and route next task.
- **Pass:** failing resource is unavailable/cooldown per policy; sibling resource remains eligible; diagnostic contains no credential/header/value.

### FB-04 — Worker response succeeds, reviewer rejects

- **Level:** I
- **Setup:** implementer child exits 0 with valid result; reviewer returns reject with evidence.
- **Action:** process both.
- **Pass:** implementation route remains infrastructure-healthy; mission enters quality escalation/awaiting Boss; infrastructure fallback count remains zero; review/evidence and escalation count are recorded.

### FB-05 — All routes unhealthy

- **Level:** U/I
- **Setup:** every eligible route in a pool has open circuit or missing auth.
- **Action:** route a task.
- **Pass:** no child starts; selector returns all-routes-unhealthy with per-route safe reason/next eligible time; Boss decides wait/change policy/repair; loop count remains zero.

### FB-06 — Unknown error is bounded

- **Level:** U
- **Setup:** unrecognized failure and fallback limit 1.
- **Action:** handle failure.
- **Pass:** failure is `unknown`, does not leak raw content, and causes at most the configured bounded behavior; no infinite cycle or confident misclassification.

### HEALTH-01 — Circuit recovery

- **Level:** U
- **Setup:** threshold 3; fixed failures, cooldown, and probe outcomes.
- **Action:** record three failures, advance clock, probe success.
- **Pass:** transitions are healthy/degraded/open/probing/healthy exactly; only one probe is admitted; consecutive failure count resets on success.

### DIV-01 — Implementer/reviewer diversity preference

- **Level:** U/I
- **Setup:** implementer uses family Luna/resource A; Verification pool order has Luna/resource B then DeepSeek/resource C; both eligible; diversity preferred.
- **Action:** route reviewer.
- **Pass:** DeepSeek/resource C is selected even though second in raw order; if C becomes ineligible, Luna/B is selected rather than failing.

### DIV-02 — Required diversity gate

- **Level:** U
- **Setup:** policy requires different family and only same-family routes exist.
- **Action:** route reviewer.
- **Pass:** no route launches; explicit diversity-unsatisfied result reaches Boss; preference is not silently weakened because this policy made it a gate.

### DIV-03 — Opaque combo is not claimed independent

- **Level:** U/I
- **Setup:** implementer used a 9Router combo with no actual-route metadata; reviewer candidate is another opaque combo.
- **Action:** evaluate diversity/analytics.
- **Pass:** actual family/resource fields remain unknown; no independent-family pass or avoided-cost claim is recorded without evidence.

## 8. Context, workers, mission state, and gates

### CTX-01 — Bounded role-specific packets

- **Level:** U
- **Setup:** canonical state contains broad transcript-equivalent data, approved findings, source paths, one secret-like field, and unrelated artifacts.
- **Action:** build investigator, implementer, and reviewer packets.
- **Pass:** each has required role fields; unrelated/full conversation and secret field are absent; size is within budget; reviewer gets actual diff/test refs but not instructions to accept.

### CTX-02 — Only approved findings promoted

- **Level:** U/I
- **Setup:** child result has one evidenced finding and one unsupported claim.
- **Action:** Boss validation/promotion.
- **Pass:** evidenced finding may become canonical; unsupported claim remains proposed/rejected; next worker receives only the approved finding.

### WORK-01 — Structured result success

- **Level:** I
- **Setup:** fake Pi child streams events then submits a valid implementer result.
- **Action:** run worker.
- **Pass:** exact route/role/timing/usage is captured; result validates; bounded progress is visible; attempt reaches succeeded/proposed-evidence; temporary files/process are gone.

### WORK-02 — Malformed structured result

- **Level:** I
- **Setup:** child exits 0 with prose or wrong schema.
- **Action:** run worker.
- **Pass:** attempt is invalid-result, not success; no evidence promotion; bounded repair/escalation policy is invoked; infrastructure health is unchanged unless separate provider failure evidence exists.

### WORK-03 — Timeout and cancellation

- **Level:** I
- **Setup:** fake child hangs and owns a descendant; short timeout.
- **Action:** time out, then repeat with user cancellation.
- **Pass:** owned process tree is terminated within bounds or platform limitation is surfaced; terminal states differ (`timeout` vs `cancelled`); no orphan lease; checkpoint and analytics event exist.

### WORK-04 — Serial shared-worktree mutation

- **Level:** I
- **Setup:** two mutating Implementation tasks plus read-only investigator; concurrency permits three.
- **Action:** schedule together.
- **Pass:** investigator may overlap; only one mutator is active at a time in the same worktree; second waits without losing lease/order.

### STATE-01 — Restart/resume mission

- **Level:** I/P
- **Setup:** mission has accepted plan, one completed task, one running task, test evidence, and checkpoint; terminate process without clean worker completion.
- **Action:** create new engine instance/resume mission.
- **Pass:** goal/plan/completed evidence/tests are identical; running attempt becomes interrupted/unknown after lease reconciliation; no duplicate child auto-starts; next actions are shown.

### STATE-02 — Stale result cannot overwrite newer state

- **Level:** U/I
- **Setup:** task launched at canonical generation 5; mission advances to 6 and changes revision; old result arrives.
- **Action:** submit result.
- **Pass:** compare-and-swap rejects automatic promotion; result is retained as stale evidence; generation 6 stays current.

### STATE-03 — Transactional checkpoint

- **Level:** I
- **Setup:** inject failure between snapshot and event writes.
- **Action:** apply transition.
- **Pass:** transaction commits both or neither; after restart snapshot generation and last event agree.

### GATE-01 — Worker `done` is insufficient

- **Level:** U/I
- **Setup:** worker result says done; required diff/test/review gates have no evidence.
- **Action:** evaluate completion.
- **Pass:** mission cannot become completed; each missing gate is missing/fail, never pass.

### GATE-02 — Boss-only completion

- **Level:** U/I
- **Setup:** all required gates pass; worker/reviewer attempts to set mission completed.
- **Action:** apply each transition then Boss acceptance.
- **Pass:** worker/reviewer transition is unauthorized/rejected; Boss transition succeeds once with audit evidence.

### GATE-03 — Explicit waiver

- **Level:** U/I
- **Setup:** one waivable gate fails and one non-waivable critical gate fails.
- **Action:** authorized user supplies reason for both.
- **Pass:** waivable gate records identity/reason/time; critical gate remains failed; mission cannot complete.

## 9. Analytics and recommendations

### AN-01 — Analytics event recorded

- **Level:** I
- **Setup:** one successful investigator run with known input/output/duration and unknown cache/cost.
- **Action:** finish attempt.
- **Pass:** one versioned event references mission/task/role/pool/route and known metrics; unknown cache/cost are null with provenance, not zero/fabricated; no prompt/source/tool output exists in row.

### AN-02 — Fallback and quality counts remain distinct

- **Level:** U/I
- **Setup:** one quota fallback and one review rejection.
- **Action:** query time range.
- **Pass:** infrastructure fallback count is 1 and quality escalation count is 1; neither event appears in the other's category.

### AN-03 — Time range and pool-specific score

- **Level:** U
- **Setup:** fixed events across 31 days where a route performs differently in Investigation and Implementation.
- **Action:** query 7/30/all-time and scores.
- **Pass:** boundary inclusion is documented/exact; counts match fixtures; two role/pool scores differ according to the versioned formula and show sample size.

### AN-04 — Cost provenance

- **Level:** U
- **Setup:** actual metered cost, subscription run, configured equivalent estimate, and unknown price.
- **Action:** aggregate.
- **Pass:** only metered cost contributes to actual spend; subscription use is counted separately; estimates are labeled with formula; unknown stays unknown.

### REC-01 — Recommendation does not mutate configuration

- **Level:** U/I
- **Setup:** history meets sample threshold and favors route B over current route A; capture config hash/generation.
- **Action:** generate and view recommendation.
- **Pass:** recommendation includes range, sample size, metrics, limitations, formula, and proposed diff; config hash/generation/order remain unchanged.

### REC-02 — Apply and ignore

- **Level:** I
- **Setup:** valid recommendation.
- **Action:** Ignore once; regenerate equivalent recommendation and Apply once.
- **Pass:** Ignore records status only; Apply previews and uses validated backup/atomic save, creates new generation/audit, and changes only proposed fields.

### PRIV-01 — Analytics content minimization

- **Level:** I
- **Setup:** prompts, source snippets, headers, tool args/results, and secret markers flow through fake events.
- **Action:** persist and export analytics.
- **Pass:** none of those content values/markers appear in database/query/export; permitted IDs/metrics remain.

## 10. Export and security

### SEC-01 — Secrets absent from exports

- **Level:** I
- **Setup:** config uses `SecretRef`; resolver returns a sentinel secret in memory; history/runtime contain route use.
- **Action:** export config and search all output.
- **Pass:** sentinel and resolved credential fields are absent; only allowed non-secret reference metadata appears; export validates on re-import without credentials.

### SEC-02 — Secrets absent from failures and logs

- **Level:** I
- **Setup:** fake gateway echoes an authorization sentinel in an error/body/header.
- **Action:** trigger discovery/request failure and collect TUI diagnostic, logs, analytics, result, and database text fields.
- **Pass:** sentinel is absent everywhere persisted/rendered; safe failure stage/class remains useful.

### SEC-03 — Tool/path policy blocks before execution

- **Level:** I
- **Setup:** worker requests a disallowed mutating tool and protected path.
- **Action:** process tool preflight.
- **Pass:** execution stub invocation count is zero; worker receives policy reason; mission records denial, not infrastructure failure.

### SEC-04 — Import cannot add executable secret resolver

- **Level:** U/I
- **Setup:** import attempts arbitrary command/path secret resolver or traversal path.
- **Action:** preview/import.
- **Pass:** schema/policy rejects it before file/process/network action; current config unchanged.

## 11. TUI and observability

### TUI-01 — Control Center sections

- **Level:** P
- **Action:** open `/orchestrator` and navigate keyboard-only.
- **Pass:** all twelve required sections are reachable; focus is visible; escape/cancel returns safely; no section requires JSON editing for its normal operations.

### TUI-02 — State labels are explicit

- **Level:** U/P
- **Setup:** view models include live, stale, estimated, unknown, disabled, pending, and unhealthy values.
- **Action:** render.
- **Pass:** each state has text/icon semantics independent of color; stale timestamp/estimate label appears; unknown is not rendered as zero/healthy.

### OBS-01 — Active mission visibility

- **Level:** I/P
- **Setup:** one active Boss, two running workers, one cooldown route, one pending review.
- **Action:** open overview/health/mission views.
- **Pass:** profile/route, gateway status, pool counts, worker role/model/progress, cooldown/fallback, and review state are visible without reading logs.

## 12. Real integration gates

### PI-01 — Extension lifecycle smoke

- **Level:** P
- **Action:** load a built M milestone extension from an isolated temporary/project path, open/close command, reload, resume/fork as applicable, unload.
- **Pass:** no live global settings are changed; command/provider/components bind once, dispose once, and recover from canonical state; Pi remains usable.

### LIVE-01 — Controlled 9Router catalog smoke

- **Level:** L, M2 authorization required
- **Action:** resolve credential through approved store and fetch catalog once with bounded timeout; do not print URL/header/body secrets.
- **Pass:** catalog IDs/count/schema and resource-identity capability are recorded privacy-safely; no model inference call and no 9Router mutation occurs.

### LIVE-02 — Controlled route invocation smoke

- **Level:** L, later milestone and explicit quota authorization required
- **Action:** invoke one selected route with a minimal non-sensitive prompt through Pi provider bridge.
- **Pass:** model/route selection, cancellation, usage/failure metadata, and gateway behavior are recorded; exact live evidence is labeled; cost/quota is bounded by the authorization.

## 13. Release acceptance rule

A milestone is complete only when every required case through that milestone passes at its required level, skipped P/L gates are explicitly named, migrations/rollback pass, and the milestone's Roadmap exit gate is satisfied. A passing fake-provider suite is never a substitute for a required Pi UI or authorized live smoke.
