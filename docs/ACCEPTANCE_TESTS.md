# Acceptance test plan

## 1. Test contract

Every implementation test MUST record its level, fixture versions, action, expected state/output, and pass/fail result. A test passes only when every listed assertion holds. Network/model tests are never inferred from unit or fake-provider evidence.

Levels:

- **U — Unit:** pure or temporary-local deterministic test; no network/model call.
- **I — Integration:** fake 9Router, fake Pi child, and real temporary storage authorized by the owning milestone (temporary filesystem in M1; SQLite from M6); no paid/live provider.
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
- **Pass:** catalog count is 37; enabled count remains 5; `new-37` is disabled (and marked ambiguous when resource identity is absent), absent from all pools and Pi provider exposure until explicit enable/save.

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
- **Milestone ownership:** M2 proves distinct route IDs and Pi choices without deduplication. M3 owns pool membership/order; M4/M8 own health and cost/usage attribution.

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

### MOD-07 — Disable active route is blocked or staged safely

- **Level:** P
- **Setup:** route `b` is active; Pi is streaming.
- **Action:** request disable `b`.
- **Pass:** no mid-turn removal occurs. M2 may reject the mutation with visible switch-first guidance. A later staged implementation may show pending, wait for idle, require a valid confirmed replacement, switch, and then remove `b`; neither path silently selects an unrelated model.

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

### POOL-02 — Membership mutations preserve pool boundaries

- **Level:** U/I
- **Setup:** seven configured routes; one route already belongs to Investigation and Verification.
- **Action:** add a configured route to Implementation, reject a duplicate and an unknown route, then remove the shared route from Investigation.
- **Pass:** only the requested memberships change; Verification and route configuration are unchanged; empty pools remain valid.

### POOL-03 — Array order is the only priority

- **Level:** U/I
- **Setup:** Implementation order `[a,b,c,d,e]`.
- **Action:** move `e` to index 1, exercise first-up and last-down boundaries, save, reload, and inspect history.
- **Pass:** order is exactly `[a,e,b,c,d]`; safe boundary moves are no-ops; no numeric priority exists; a complete prior generation is retained.

### POOL-04 — Availability never silently deletes membership

- **Level:** U/I
- **Setup:** one pool entry disabled only in that pool, one globally disabled route, and one configured route absent from the latest successful catalog.
- **Action:** load pool status and reorder all three entries.
- **Pass:** all memberships and positions remain configurable; states are explicit; no provider reconciliation or automatic deletion occurs.

### POOL-05 — Cross-pool, identity, and concurrency semantics

- **Level:** U/I
- **Setup:** two distinct route IDs for the same underlying family/resource choices and concurrent same-process edits to different pools.
- **Action:** add both routes, reorder independently, and await all mutations.
- **Pass:** both identities survive, each pool has its declared order, and `ConfigStore` serializes valid generations without a lost update.

### POOL-06 — Empty pools and candidate boundaries

- **Level:** U/I
- **Setup:** an empty pool, configured routes, and unconfigured remote catalog rows.
- **Action:** list the pool and its add candidates.
- **Pass:** the empty state is explicit; candidates include only configured routes not already assigned; M2 enablement never auto-assigns a pool.

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

### M4-ROUTE-01 — Pure priority and eligibility preview

- **Level:** U
- **Setup:** an Implementation pool contains ordered enabled, pool-disabled, globally disabled, missing, unavailable, cooldown, attempted, and eligible routes.
- **Action:** call the preview selector with fixed time and explicit exclusions.
- **Pass:** the first eligible route wins; no eligible output contains safe per-route reasons and earliest retry; pool order is unchanged.

### M4-ROUTE-02 — Explicit diversity and same-model resources

- **Level:** U
- **Setup:** synthetic routes share a remote model ID but have distinct explicit resources; context marks one route/resource/model as conflicting.
- **Action:** preview with `none`, `prefer`, and `require` diversity.
- **Pass:** `prefer` skips conflicts only when possible, `require` treats them as ineligible, explicit resource identity keeps same-model routes distinct, and no model-name family inference occurs.

### M4-FAILURE-01 — Bounded retry and fallback sequence

- **Level:** U
- **Setup:** fixed-clock fake executor sequence `A rate_limited`, `A rate_limited`, `B timeout`, `B timeout`, `C globally disabled`, `D success`; max attempts permits one same-route retry.
- **Action:** classify each result, record the attempt chain, and select the next route.
- **Pass:** exact attempts are `A, A, B, B, D`; A/B receive cooldown state; D succeeds; A remains priority 1 in configuration; no loop or pool reorder occurs.

### M4-FAILURE-02 — Conservative failure actions

- **Level:** U
- **Setup:** quota, rate-limit, authentication, timeout, transport, provider/model unavailable, invalid request, protocol, cancellation, and unknown structured failures.
- **Action:** classify and decide actions with fallback enabled.
- **Pass:** explicit quota evidence is distinct from an ordinary 429 rate limit; retryable transient classes are bounded; auth/quota/provider/model may fallback; cancellation, invalid request, protocol, and unknown stop; raw provider text is never returned.

### M4-HEALTH-01 — Runtime persistence and corruption isolation

- **Level:** I
- **Setup:** injectable fake clock/root; record failures, retry-after, circuit threshold, success, and reset; corrupt `health.json` with a secret sentinel.
- **Action:** reload, advance the clock, inspect/reset, quarantine corruption, and inspect ConfigStore export/history.
- **Pass:** cooldown survives reload and expires deterministically; success/reset recover the route; corrupt health is isolated/quarantined; health never appears in config export/history; the sentinel is absent from persisted/display-safe output.

### M4-PI-01 — Pi 0.84.1 routing/health control surface

- **Level:** P
- **Setup:** isolated Pi `0.84.1`, fake 9Router, temporary agent/session/config/runtime roots.
- **Action:** load the extension, inspect command registration, preview routing, reset a persisted cooldown through `/route-health`, and run existing model-list/completion/pool regression flows.
- **Pass:** `/routing-status`, `/route-health`, and `/routing-settings` are registered; Routing & Fallback and Health & Quotas are reachable through Pi RPC; reset changes only runtime health; fake provider exposure/completion and M2/M3 behavior remain unchanged; no live credentials, Pi files, or paid calls are touched. Human keyboard TUI smoke remains separately pending.

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

M8 acceptance note: STATE-8 records `134/134 PASS` and the actual Pi/fake-gateway mission→quality→analytics, usage provenance, fallback, billing, detail-view, and recommendation-control evidence. M8.5 analyst checks are recorded below and remain pending Planner acceptance.

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

### ANL-01 — Manual Recommendation Analyst

- **Level:** I/P
- **Setup:** deterministic candidate exists; enabled Verification Pool route is selected; analytics input includes bounded metrics and UNKNOWN fields.
- **Action:** operator explicitly chooses AI-assisted → Analyze Now or Re-analyze.
- **Pass:** only the selected Verification Pool route is used; no timer/background call runs; the bounded packet excludes prompts/source/transcripts/tool output/secrets; result validates as SUPPORT, OPPOSE, or INSUFFICIENT_EVIDENCE with bounded factors/caveats; deterministic metrics remain unchanged and explicit Apply still uses the existing recommendation service.

### ANL-02 — Analyst persistence, staleness, and failure isolation

- **Level:** U/I/P
- **Setup:** persist one analyst result, reopen analytics storage, then materially change the deterministic input; separately make the analyst route unavailable or infrastructure-fail.
- **Action:** inspect status and deterministic recommendation.
- **Pass:** bounded audit metadata reopens without transcript/source content; changed input marks the prior result stale; analyst failure leaves the deterministic recommendation usable; no pool/config mutation or automatic Apply occurs.

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

### TUI-03 — M3 pool editors use one Pi-native management flow

- **Level:** U/P
- **Action:** open the three pool sections from `/orchestrator`, then use `/pool-models` and `/pool-status`.
- **Pass:** one reusable editor supports add, confirmed membership removal, per-pool enable/disable, move up/down, inspect, refresh, and safe cancel; empty and unavailable states are textual; no manual JSON edit is required.

### TUI-04 — M9 Control Center shell

- **Level:** U/P, fixture-v1
- **Action:** open `/orchestrator` through Pi native TUI/RPC selectors and inspect the dashboard, each top-level section, deferred boundaries, state labels, and Back/Esc behavior.
- **Pass:** exactly twelve required sections appear in order; dashboard metadata is safe and textual; accepted domain views remain reachable; unavailable runtime dependencies use truthful `Not implemented yet`/`Planned` state while configured RC25 Boss profiles expose their editor; empty/stale/error/busy states are explicit; direct commands and explicit recommendation actions remain compatible; no automatic Apply or priority mutation occurs.

### OBS-01 — Active mission visibility

- **Level:** I/P
- **Setup:** one active Boss, two running workers, one cooldown route, one pending review.
- **Action:** open overview/health/mission views.
- **Pass:** profile/route, gateway status, pool counts, worker role/model/progress, cooldown/fallback, and review state are visible without reading logs.

## 12. M5 routed subagent execution

### WORK-05 — Child isolation and tool profiles

- **Level:** U/I, fixture-v1
- **Action:** create fresh children for Investigation, Implementation, and Verification with an exact route/model.
- **Pass:** session storage is in memory; parent extensions/delegate tool are absent; Investigation and Verification expose only read/grep/find/ls; Implementation exposes read/grep/find/ls/bash/edit/write; and each child receives only its bounded result tool.

### WORK-06 — Structured result protocol

- **Level:** U/I, fixture-v1
- **Action:** submit one bounded `submit_agent_result`, omit it, submit twice, and attempt post-submit mutation.
- **Pass:** one valid result completes; missing/invalid is `invalid_child_result`; duplicate/post-submit activity is a protocol violation; no infrastructure health penalty or automatic fallback is inferred.

### WORK-07 — M4 fallback and mutation safety

- **Level:** I, fixture-v1
- **Action:** exercise provider failure before tools, read-only failure, quota/rate failure, edit/write/bash followed by timeout/failure, cancellation, and exact route changes.
- **Pass:** M4 alone decides retry/fallback; safe pre-tool/read-only failures may fall back; potential mutation returns `partial_mutation_requires_review` and never starts the next route; cancellation stops without fallback/health penalty; every child uses the exact selected remote ID.

### WORK-08 — Parent delegation and Pi proof

- **Level:** P, fixture-v1, Pi `0.84.1`
- **Action:** invoke parent `delegate_agent` and `/subagent-run` against the fake gateway with isolated Pi/config/session roots.
- **Pass:** role/pool/task are explicit, no model parameter is exposed, child reads and submits a bounded result, delegate recursion is absent, progress/result is concise, no parent history or live path is used, and M2–M4 provider/pool/routing regressions remain green.

### WORK-09 — Shared-worktree and cleanup boundary

- **Level:** U/I, fixture-v1
- **Action:** run concurrent Implementation requests in one cwd; cancel and timeout child sessions.
- **Pass:** mutating runs serialize; sessions abort, unsubscribe, and dispose deterministically; no child files/session history are left outside the requested cwd; no worktree fan-out or background worker is created.

## 13. M6 canonical mission state and context broker

### MISSION-01 — SQLite MissionStore and revision safety

- **Level:** U/I, fixture-v1, Node `22.23.0`
- **Action:** create/reopen a mission, create a canonical three-pool task, start/finish an attempt, mutate with a stale expected revision, and inject a transaction fault.
- **Pass:** durable revisioned rows survive reopen; stale writes are typed conflicts; rollback leaves prior state; `node:sqlite` uses foreign keys/busy timeout/prepared statements; ConfigStore, HealthStore, and Pi session history remain separate.

### MISSION-02 — Evidence admission and canonical provenance

- **Level:** U/I, fixture-v1
- **Action:** ingest a worker result, inspect the queue, reject one item, accept another into a canonical item, and inspect events/checkpoint.
- **Pass:** worker evidence starts `proposed`; proposed/rejected evidence is not canonical context; explicit acceptance atomically advances revision, preserves evidence history, records canonical provenance and journal/checkpoint metadata; no worker direct-write path exists.

### MISSION-03 — Deterministic bounded TaskPacketV1

- **Level:** U/I, fixture-v1
- **Action:** build packets with accepted, proposed, rejected, stale, scoped, tagged, oversized, and reordered canonical items.
- **Pass:** accepted-only default, explicit filters, deterministic order, bounded chars/items, omitted count/IDs, immutable packet, SHA-256 digest, source mission revision, and no transcript/secret content. Packet-to-M5 adaptation preserves exact role/pool/task context.

### MISSION-04 — Checkpoint and interrupted recovery

- **Level:** I, fixture-v1
- **Action:** create checkpoint, close/reopen the same runtime root, expire a running lease, and recover.
- **Pass:** checkpoints/events/tasks persist; running becomes interrupted with mutation-risk metadata; no child is auto-rerun and no parent transcript is required for resume; corrupt DB fails typed and is not replaced with an empty database.

### MISSION-05 — Mission Control and packet inspection

- **Level:** U/P, fixture-v1, Pi `0.84.1`
- **Action:** open `/missions`, `/mission-packet`, and Context & Mission Settings through the native command/RPC surface; inspect evidence and record a checkpoint from Mission Control where the store supports those operations.
- **Pass:** mission create/list/open/status, task/packet inspection, evidence review actions, checkpointing, and settings are available; session history contains only safe mission pointers/status; no JSON/SQLite editing is exposed to the operator.

## 14. M7 verification, quality, and escalation

### QUALITY-01 — Mission schema migration and recovery

- **Level:** U/I, fixture-v1, Node `22.23.0`
- **Action:** open a real v1 MissionStore fixture, migrate, reopen, and recover an in-flight verification.
- **Pass:** all M6 rows and packet lineage survive; quality defaults to `unverified`; running verification becomes interrupted/review-required; no automatic rerun or history rewrite occurs.

### QUALITY-02 — Bounded verification protocol and deterministic gate

- **Level:** U/I, fixture-v1
- **Action:** submit valid, malformed, duplicate, oversized, contradictory, and incomplete `submit_verification_result` payloads with mechanical checks.
- **Pass:** exactly one bounded result is accepted; PASS/REJECT/BLOCKED is deterministic; mandatory failures and observed mechanical failures cannot be overridden by reviewer prose.

### QUALITY-03 — Quality state is separate from execution and M4 health

- **Level:** U/I
- **Action:** complete an implementation run, record reviewer PASS/REJECT/BLOCKED, and inspect task quality, route health, decisions, and events.
- **Pass:** quality status/history is durable and distinct from execution status; valid quality REJECT does not create cooldown/fallback or penalize the implementation route; semantic evidence remains proposed until explicit admission.

### QUALITY-04 — Reviewer routing and repair lineage

- **Level:** U/I
- **Action:** select Verification routes with `prefer`/`require` diversity, reject once, repair through Implementation with explicit exclusions, then re-verify.
- **Pass:** authoritative route/resource IDs drive selection; each round records target run, packet, reviewer route, exclusions, failed criteria, findings, and required fixes; max rounds are bounded and terminal.

### QUALITY-05 — Explicit host controls

- **Level:** U/P, fixture-v1, Pi `0.84.1`
- **Action:** use Mission Control task actions and `/quality-status`/`/verify-task`; confirm a bounded quality loop before repair.
- **Pass:** status/history, Verify/Re-verify, and Run quality loop are visible through Pi-native UI/RPC; no background loop or implicit mutation authorization starts.

### QUALITY-06 — Pi/fake quality-loop proof

- **Level:** P, fixture-v1, Pi `0.84.1`
- **Action:** run the scripted fake reviewer reject → routed repair → reviewer pass flow with isolated Pi/config/session roots.
- **Pass:** fake chat observes read-only reviewer tools without `delegate_agent`, a separate Implementation child, exact route/model requests, durable reject/escalation/pass lineage after reopen, no secret/token output, and zero live/paid calls.

## 15. Real integration gates

### PI-01 — Extension lifecycle smoke

- **Level:** P
- **Action:** load a built M milestone extension from an isolated temporary/project path, open/close command, reload, resume/fork as applicable, unload.
- **Pass:** no live global settings are changed; command/provider/components bind once, dispose once, and recover from canonical state; Pi remains usable.

### PI-02 — Actual Pi preserves M3 pool state without provider churn

- **Level:** P
- **Setup:** isolated Pi `0.84.1`, temporary agent/config roots, and the fake 9Router with at least seven configured routes.
- **Action:** load the extension, inspect registered pool commands, mutate an ordered pool through the extension UI/RPC host path, restart Pi, and inspect status/provider models.
- **Pass:** the mutation persists with exact order, all three pool sections and direct commands work, and the M2 `9router` provider projection remains unchanged.

### LIVE-01 — Controlled 9Router catalog smoke

- **Level:** L, M2 authorization required
- **Action:** resolve credential through approved store and fetch catalog once with bounded timeout; do not print URL/header/body secrets.
- **Pass:** catalog IDs/count/schema and resource-identity capability are recorded privacy-safely; no model inference call and no 9Router mutation occurs.

### LIVE-02 — Controlled route invocation smoke

- **Level:** L, later milestone and explicit quota authorization required
- **Action:** invoke one selected route with a minimal non-sensitive prompt through Pi provider bridge.
- **Pass:** model/route selection, cancellation, usage/failure metadata, and gateway behavior are recorded; exact live evidence is labeled; cost/quota is bounded by the authorization.

## 16. M10 safety and hardening

### SAFETY-01 — Local trust and capability boundary

- **Level:** U/I/P, fixture-v1
- **Action:** inspect an unknown project, explicitly trust/revoke it, inspect the capability matrix, and attempt an Implementation mutation while untrusted.
- **Pass:** unknown projects remain untrusted; trust is local and nonportable; revoke persists; Investigation/Verification are read-only; Implementation is blocked until explicit trust; no secret or trust record enters ConfigStore export/history.

### SAFETY-02 — Path, command, and privacy policy

- **Level:** U/I
- **Action:** evaluate workspace paths, traversal/symlink escapes, protected/credential paths, safe/destructive/ambiguous commands, and adversarial secret-shaped diagnostics/import values.
- **Pass:** canonical in-workspace reads are allowed; escapes/protected credentials block; destructive commands block; ambiguous shell constructs require review; value and structural secret redaction leaves no secret in output or persisted metadata.

### SAFETY-03 — Cross-process locks and lease ownership

- **Level:** I, fixture-v1
- **Action:** race two ConfigStore writers and two MissionStore owners; renew/release with stale and non-owner tokens; attempt duplicate active task attempts.
- **Pass:** reread-under-lock preserves both updates; one lease owner wins; stale/non-owner operations are rejected; active task start is race-safe; recovery records the prior owner without auto-rerun.

### SAFETY-04 — Integrity, backup, restore, and crash recovery

- **Level:** I, fixture-v1, Node `22.23.0`
- **Action:** back up and reopen MissionStore/AnalyticsStore, validate/restore snapshots, corrupt schemas/payloads, and inject config fault points.
- **Pass:** snapshots are consistent and validated; invalid/empty backups are rejected atomically; MissionStore reports corruption rather than replacing user data; AnalyticsStore degrades to diagnostics; fault injection leaves the prior active config intact.

M10 evidence: `test/m10-security.test.ts` `5/5 PASS`, `test/m10-recovery.test.ts` `7/7 PASS`, provider suite `18/18 PASS`, and full deterministic/fake/actual-Pi suite `159/159 PASS`; typecheck/build/check/package/diff/secret/state validation PASS. Human keyboard smoke remains pending; no live or paid calls were used.

## 17. Release acceptance rule

A milestone is complete only when every required case through that milestone passes at its required level, skipped P/L gates are explicitly named, migrations/rollback pass, and the milestone's Roadmap exit gate is satisfied. A passing fake-provider suite is never a substitute for a required Pi UI or authorized live smoke.

## 18. M11 packaging and release candidate

### RELEASE-01 — Manifest and allowlist

- **Level:** U/I
- **Action:** build the candidate and inspect `package.json`, `pi` manifest, peer/runtime dependencies, and the generated file list.
- **Pass:** SemVer `0.1.0-rc.4`, explicit compiled entrypoint, `pi-package` keyword, Pi peer only, no runtime dependency confusion, and no source/runtime-state files.

### RELEASE-02 — Artifact verification and source independence

- **Level:** I
- **Action:** generate the tarball, SHA-256, machine-readable release manifest, and unpacked import from outside the checkout.
- **Pass:** checksum, file allowlist, secret/local-path/runtime-DB scan, syntax check, and compiled entrypoint import all pass.

### RELEASE-03 — Isolated Pi install and Control Center

- **Level:** P, Pi `0.84.1`, fake gateway
- **Action:** verify the artifact SHA-256, extract the exact `.tgz` into a fresh temporary `package/` directory, install that directory with `pi install <package-dir> --no-approve` under temporary `HOME`/`PI_CODING_AGENT_DIR`/session/config roots, list it, start clean, and open `/orchestrator`. Direct `pi install <artifact>.tgz` is an explicitly unsupported negative case on Pi `0.84.1`.
- **Pass:** the checksum-derived directory source is discovered, Diagnostics exposes the candidate version, dashboard/Control Center loads all twelve sections, source checkout is absent, removal/reinstall works, and no live user settings change occurs.

### RELEASE-04 — Upgrade, rollback, and rescue

- **Level:** I/P, temporary roots
- **Action:** generate the explicitly named M10 compatibility baseline artifact/directory, record Config/Mission/Analytics/Trust hashes, install the checksum-derived M11 directory, record hashes again, remove it, reinstall the baseline directory, and execute the extension-independent rescue procedure. Preserve machine-readable commands and results in the review bundle.
- **Pass:** no M11 schema mutation or data loss, rollback is explicit and tested, and a broken extension can be disabled/restored without loading itself.

### RELEASE-05 — Review, compatibility, and dogfood records

- **Level:** U/I
- **Action:** inspect `COMPATIBILITY.md`, `RELEASE_CHECKLIST.md`, `DOGFOOD_LOG.md`, and the generated review bundle.
- **Pass:** tested vs untested rows are separated, real-route smoke requires authorization, independent review is marked pending until a separate reviewer acts, and M11 remains implemented but not accepted.

### RELEASE-06 — Trusted provenance and evidence binding

- **Level:** U/I
- **Action:** run the release verifier with a fake executable earlier on `PATH`, alter source/build/evidence inputs in isolated copies, and verify the clean Git/tree/source/build identity, trusted Node/npm/Pi identities, strict test-total parsing, artifact/checksum binding, and machine-neutral evidence.
- **Pass:** ambient `PATH` tools cannot forge release totals or Pi identity; zero/forged totals fail; stale, dirty, altered, or path-leaking evidence is rejected; source and tests are rerun from exact Git content; the clean rc.4 bundle verifies as `EXTERNAL_REVIEW_PENDING` only with the externally supplied root digest.

### RELEASE-07 — Integrated worker safety enforcement

- **Level:** I/P, fake provider only
- **Action:** invoke Investigation, Verification, Implementation, and analyst child sessions through the real Pi SDK worker path and attempt profile-expanding tools, protected/out-of-root/symlink paths, destructive or secret-bearing commands, and allowed result submission.
- **Pass:** disallowed tools and arguments are denied before Pi executes them; Implementation mutation requires project trust; read-only roles cannot mutate; analyst remains read-only; bounded result submission remains available; no live or paid provider call occurs.

### RELEASE-08 — Capture-only custom-tool boundary

- **Level:** I/P, Pi `0.84.1`, fake gateway
- **Action:** attempt the former caller-supplied `submit_evil` handler, enumerate effective child tools, submit malicious-looking protocol payloads, and try protocol names colliding with `read`, `write`, `edit`, and `bash`.
- **Pass:** executable custom handlers cannot enter a child session; only declarative capture-only protocols are exposed; unknown and colliding tools fail closed; the exact `submit_evil` fixture remains unchanged under untrusted project state; protocol payloads are never interpreted as commands or paths.

### RELEASE-09 — Recursive integrity and authentic compatibility

- **Level:** I/P, Pi `0.84.1`, fake gateway only
- **Action:** run the 20 mandatory release-integrity attacks; recursively enumerate regular bundle files; reject all symlinks and type changes; verify against a separately supplied root digest; build the named M10 commit, create non-empty Config/Mission/Analytics/Trust state with its modules, read the same state with rc.4 modules, and read it again after M10 rollback.
- **Pass:** all `20/20` attacks are rejected; every bundle file, review document, root package, and nested M10 file is bound; wrong external roots fail; M10/candidate/rollback provenance is explicit; all four semantic domains are non-empty and equal; `dataLoss` is false; actual `pi list` identity/version/source assertions pass; live calls and paid inference remain zero.

## 19. M12.1 frictionless Mission entry

### M12.1-01 — Explicit input parser is bounded

- **Level:** U
- **Action:** exercise `@orchestrator` with English, Persian, mixed, surrounding whitespace, empty, case-variant, quoted/code-fenced, embedded, and ordinary text.
- **Pass:** only an explicit marker at the supported input position is handled; the goal is preserved after normal outer trimming; empty input reports `Add a goal after @orchestrator.` and creates no Mission.

### M12.1-02 — Explicit input persists one canonical Mission

- **Level:** I/P fixture
- **Action:** invoke the registered Pi `input` handler against a temporary real MissionStore with a disposable cwd.
- **Pass:** exactly one draft Mission is persisted with the supplied goal and repository metadata; only the Mission pointer/status/revision is appended to Pi history; ordinary input returns `continue` and creates no Mission.

### M12.1-03 — Menu and input share canonical creation

- **Level:** I/P fixture
- **Action:** create one Mission through `@orchestrator` and one through `/orchestrator` → Context & Mission Settings → Create mission.
- **Pass:** both records use equivalent canonical defaults and persistence, including status, repository metadata, and acceptance criteria where supplied.

### M12.1-04 — Direct Worker/M7 distinction

- **Level:** U/P fixture
- **Action:** run `/subagent-run` through Direct Verification Worker and inspect `/verify-task`/quality status labels.
- **Pass:** the direct flow remains available, creates no Mission task or M7 quality record, explicitly states the distinction, and canonical `/verify-task` remains confirmation-gated and Mission/M7-labeled.

M12.1 does not add automatic prompt classification, smart routing, Routing Memory, or background execution. Real Pi Computer-Use checks and final release verification remain separately labeled evidence.

## 20. M12.2 Hybrid Smart Router

### M12.2-01 — Deterministic local paths are bounded and bilingual

- **Level:** U/I
- **Action:** run the local analyzer against English, Persian, and mixed
  explanations/questions, narrow edits, multi-step implementation, tests,
  independent verification, audit/review, release, sensitive changes, and
  research-plus-implementation prompts.
- **Pass:** only `NORMAL` and `SUGGEST_MISSION` paths are emitted; simple input
  uses no AI; structural signals—not prompt length alone—drive complex-path
  classification; the representative corpus contains at least 100 cases.

### M12.2-02 — Ambiguous triage uses strict bounded policy

- **Level:** I/P fixture
- **Action:** configure Primary and optional Fallback route IDs and exercise a
  valid normal result, valid mission result, low confidence, malformed JSON,
  timeout, auth/quota/transport failure, unavailable route, and cancelled call.
- **Pass:** the response shape is exactly `recommendedMode`, `confidence`, and
  `reasons`; fallback runs only after capability failure; valid disagreement
  does not call fallback; failure degrades to the user-choice recommendation;
  no prompt or raw provider response is persisted.

### M12.2-03 — Suggestion UX is one-shot and lossless

- **Level:** U/P fixture
- **Action:** submit a complex prompt through Pi `0.84.1` and choose Run as
  Mission, Run Normally, and cancel in separate disposable sessions.
- **Pass:** Run as Mission creates exactly one canonical Mission with the exact
  goal; Run Normally continues the exact original event once; cancel restores
  the original editor text; missing/failing MissionStore never drops input.

### M12.2-04 — Settings remain inside Routing & Fallback

- **Level:** U/P fixture
- **Action:** open the existing twelve-section Control Center and edit Smart
  Routing, AI Triage, Primary, and Fallback settings across available, missing,
  stale, and unavailable route states.
- **Pass:** the twelve top-level sections and order are unchanged; AI Triage
  cannot be enabled without an available Primary; stale IDs remain visible;
  versioned atomic history/restore works; no live Pi configuration changes.

### M12.2-05 — Telemetry privacy and release boundary

- **Level:** I/P
- **Action:** append routing decisions and analyst results containing prompt-,
  transcript-, tool-, and secret-like decoy fields, then query the stores and
  run the repository release checks.
- **Pass:** only bounded allowlisted metadata remains; full deterministic tests,
  typecheck, build, package, and privacy/diff checks pass; live provider calls,
  public publication, and M12.3 Routing Memory remain outside this milestone.

M12.2 local evidence is not acceptance of M12 or a public release. Real-route
English/Persian triage and controlled real fallback require an authorized,
securely available route and remain separate gates when unavailable.

## 21. M12.3 Adaptive Routing Memory

### M12.3-01 — Abstract durable memory and privacy boundary

- **Level:** U/I
- **Action:** create explicit and learned rules, inspect the sidecar and public
  views, restart the store, inject prompt/source/tool/credential-like decoys,
  corrupt individual rows, and load version 0/current/unknown envelopes.
- **Pass:** the sidecar is versioned and atomic; signatures contain bounded
  abstract concepts only; English, Persian, mixed, and cross-language cases
  work; raw content and credentials are absent; valid rows survive bad rows;
  supported legacy rows migrate and unsupported envelopes fail safely.

### M12.3-02 — Explicit Always Mission rule

- **Level:** U/P fixture
- **Action:** submit a complex prompt and select `Always orchestrate similar
  tasks`, then submit a strong bilingual equivalent and restart Pi.
- **Pass:** exactly one canonical Mission is created for the selected prompt,
  one durable explicit rule is written, the strong match uses AUTO_MISSION with
  no repeated confirmation or AI call, and restart retains the state. Explicit
  `@orchestrator` still wins first and uses the shared canonical creation path.

### M12.3-03 — Repeated Mission/Normal learning

- **Level:** I/P fixture
- **Action:** choose Run as Mission three times for one semantic family and Run
  Normally three times for another; test one-choice, mixed-choice, and
  materially escalated variants.
- **Pass:** learned rules expose source/confidence/observations, do not activate
  after one choice, strong learned Mission can AUTO_MISSION, strong learned
  Normal remains NORMAL, contradictory evidence prevents automation, and learned
  Normal cannot suppress complex/sensitive current work.

### M12.3-04 — Conservative matching and authority

- **Level:** I
- **Action:** exercise structural similarity, keyword-only overlap, explicit vs
  learned opposite actions, same-tier conflicts, duplicate equivalent rules,
  and bounded learned growth.
- **Pass:** keyword overlap is insufficient; materially escalated matches are
  bypassed; explicit rules outrank learned rules; same-tier conflicts require
  user choice; explicit rules are not pruned; duplicate rules merge; learned
  growth is bounded; strong hits avoid unnecessary AI Triage.

### M12.3-05 — Learned Behaviors and settings

- **Level:** U/P fixture
- **Action:** open Routing & Fallback and Learned Behaviors; toggle Routing
  Memory and Auto-Learn; inspect, disable, enable, delete, forget learned, and
  reset all with confirmation.
- **Pass:** controls remain inside the existing twelve-section Control Center,
  abstract metadata only is shown, disabling retains state, per-rule and
  learned/full reset semantics are durable and distinct, and safety/M12.1/M7
  terminology remains unchanged.

### M12.3-06 — Backup, restore, telemetry, and regression boundary

- **Level:** I/P fixture
- **Action:** create/restore valid and invalid Routing Memory backups and append
  memory telemetry containing decoy prompt/credential fields; run existing
  M12.1/M12.2/TrustStore/worker safety tests.
- **Pass:** backup/restore validates before activation and is confirmation-gated;
  telemetry remains bounded and prompt-free; M12.2 Primary/Fallback semantics,
  M12.1 input, Direct Worker/M7 distinction, TrustStore, and safety guards pass.

### M12.3-07 — Real isolated Pi dogfood and release gate

- **Level:** P / authorized isolated Pi `0.84.1`
- **Action:** run explicit Always, cross-language AUTO_MISSION, Learned
  Behaviors disable, risky escalation, restart, and clean-tree/full RC checks.
- **Pass:** the disposable Pi/TUI flow passes; focused independent review has no
  unresolved blocker/high; full validation, package/release integrity, clean
  repository, and truthful state documents pass. No live Pi configuration,
  provider account, credential, public tag, push, npm publication, or GitHub
  release is implied.

### M12.3 acceptance mapping

The 53 mission criteria map to the tests above as follows: 1–7 → M12.3-01;
8–11, 22, 42–44, 46 → M12.3-02; 12–18 → M12.3-03; 19–24, 37–38 →
M12.3-04; 25–36 → M12.3-05; 39–41, 45, 47–48 → M12.3-06; 49–53 →
M12.3-07. The M12.3 local focused evidence is analytics `9/9`, Routing
Memory `14/14`, Smart Router `13/13`, provider host `25/25`, and isolated Pi
dogfood `1/1` (`61/61` focused tests); the detached exact-Git RC.12 verifier
then passed `212/212` tests, `20/20` integrity attacks, Pi `0.84.1`
install/upgrade/rollback/rescue, privacy, and worker safety. Artifact SHA-256
is `84cabb6553a5599d548be15646c92fc872c6010778e4eaeda2e05c63a158dc30`;
source commit is `56dbbb150fd184240db55e58e4bffc20efdd5c5f`; source tree is
`7f795881954033d75618a57e9dba30b9b0314dc2`; source digest is
`4d417b1360cbb9b3a8a9e6f529470cf85f24bcbc37194f802d3c4b276f6ce8fd`; and
review-bundle root SHA-256 is
`69e55e37731c44d6540950056664e729fa56b7898eccadc8b417669cc1327ce8`.
Focused independent review of that exact commit is PASS with no unresolved
blocker/high. This RC12 evidence is historical; RC15 supersedes its candidate
and passes final external review. Planner/manual acceptance and publication
remain separate.

## 22. M12 Final Routing Gate evidence — historical RC13 record

The RC13 local final-gate run revalidated the M12.1–M12.3 boundary and the
end-to-end routing surface without promoting the result to product acceptance:

- balanced English/Persian/mixed analyzer corpus: `360/360` expected paths,
  `120` simple, `120` complex, `120` ambiguous, zero errors;
- bounded adversarial analyzer/parser inputs: `13/13` exception-free, with
  explicit invocation recognized and embedded invocation rejected;
- isolated Pi `0.84.1` RPC/PTY dogfood: explicit entry, normal-input isolation,
  Smart Routing, Routing Memory persistence/disable/restart, stale routes,
  Direct Worker/M7 labeling, and composed Smart-routed Mission → Task → Run →
  M7 PASS. The composed lifecycle uses FakeNineRouter; current live-provider
  M7 is not re-claimed by this entry;
- fresh disposable-root real 9Router Triage: ten ambiguous sessions, `20`
  calls, `9` capability-only fallback successes, `1` timeout degradation, and
  no raw prompt telemetry;
- RC13 `npm run check`: `214/214 PASS`; detached release verifier: `20/20`
  integrity attacks, privacy, worker safety, and Pi `0.84.1`
  install/upgrade/rollback/rescue PASS; focused review has no unresolved
  blocker/high;
- artifact SHA-256 `abbfaf8580008a5f2d297a28a49fe3a0c962b1f3c512944b9f680c74e630085b`,
  source commit `8d8e36a9526c6edd106d36fa8cb5069cda517405`, source digest
  `0c5d0b49a2c637b592e039b31548bd549e31eee5c0854c20487a74324185d074`, and
  review-bundle root
  `f3183574deed6dc96e6a15953a5949bdbb4858f34a9a26b5378437a81ca7075c`.

This RC13 record is historical. At the time, External Review #5 remained
`EXTERNAL_REVIEW_PENDING`; RC15 supersedes that pending state and passes final
external review. Planner/manual acceptance, public release, tags, push, npm
publication, and GitHub release remain separate pending or unauthorized gates.

## RC18 — Real-world Pi/9Router compatibility repair

### RC18-01 — External provider is not shadowed or unregistered

- **Level:** U/I fixture
- **Action:** seed a Pi `9router` provider with 27 user models, reconcile a PMO
  projection containing two enabled models, make the projection empty, and
  dispose/reload the host.
- **Pass:** the PMO host makes zero provider registration/unregistration calls;
  all 27 external models remain unchanged.

### RC18-02 — PMO-owned standalone lifecycle remains bounded

- **Level:** U/I fixture
- **Action:** reconcile an absent namespace, update its PMO projection, clear
  the projection, and dispose twice.
- **Pass:** PMO registers and updates only its own namespace, unregisters it on
  loss/disposal exactly once, and never unregisters an unknown namespace.

### RC18-03 — Current and legacy catalog metadata are preserved

- **Level:** U/I fixture
- **Action:** parse current `capabilities` objects and legacy arrays/aliases,
  including Gemini-style vision/reasoning/context/max-output and GPT/Grok
  current/legacy rows; project enabled routes.
- **Pass:** reasoning, text/image input, bounded context/max tokens, exact IDs,
  and useful bounded tools/search/audio/video/thinking metadata are preserved;
  absent capabilities remain unknown/conservative and `ConfigV1` is unchanged.

### RC18-04 — Installed Pi dogfood does not change the user catalog

- **Level:** P / isolated local Pi `0.84.1`
- **Action:** compare baseline `--list-models 9router` with the explicit local
  `--no-extensions -e ./dist/host/pi-extension.js` load, isolating PMO/session
  state while inheriting the existing Pi model/auth catalog.
- **Pass:** both processes exit 0, expose 27 exact matching `9router` rows, and
  bounded RPC loading exits 0; no refresh, model request, credential display,
  or live Pi configuration mutation occurs.

RC18 does not implement the future requirement **Dynamic Route Catalog &
Capability Sync**; periodic sync, manual Refresh Now, diffs, provenance,
last-known-good/stale indicators, overrides, and advertised-versus-observed
capability distinction remain planned.

## RC19 — Pi 9Router onboarding and adoption

### RC19-01 — Existing Pi provider adoption

- **Level:** U/I fixture, Pi `0.84.1` contract
- **Action:** bind a Pi `9router` provider exposing 27 models through
  `getModels()`, start the host, open `/orchestrator` → Models & 9Router, and
  enable one model.
- **Pass:** all exact Pi model IDs are browsable; status is not false EMPTY; no
  API key is requested or copied; PMO makes zero register/unregister calls for
  the external provider; route state is created only after explicit enable and
  no pool is assigned automatically.

### RC19-02 — No-provider secure setup

- **Level:** U/TUI/RPC fixture
- **Action:** with no Pi 9Router provider, open Models & 9Router, choose Set Up
  9Router, enter a base URL, enter a key in the masked TUI component, confirm
  Test & Save, and exercise the same entry through RPC UI mode.
- **Pass:** the key is never rendered, notified, logged, or persisted by PMO;
  `/v1/models` is tested before save; Pi auth storage receives the key only after
  success; PMO receives only `{store:"pi-auth",key:"9router"}`; successful
  setup exposes models and a pool handoff; RPC refuses raw-key setup.

### RC19-03 — Setup failure and auth bridge

- **Level:** I/security/fixture
- **Action:** fail the bounded catalog test, then exercise Pi `ModelRuntime.login`
  and a fresh runtime using the stored credential with a provider registration
  that omits `apiKey`.
- **Pass:** failed testing causes no PMO config or credential-save call; the Pi
  auth file is restrictive and the fresh runtime resolves the stored key; the
  PMO provider projection never treats `$PMO_PI_AUTH` as a literal API key.

### RC19-04 — External refresh and regression boundary

- **Level:** U/I/P isolated Pi `0.84.1`
- **Action:** refresh an existing external provider, reconcile/reload/dispose,
  run the PMO-owned env-backed path, and run the full release checks.
- **Pass:** external refresh uses Pi registry refresh rather than requiring a
  PMO gateway; external model rows remain intact; PMO-owned registration still
  updates/removes only its own namespace; typecheck, full tests, build, release
  verification, exact artifact binding, `next`-only publication, and public
  install pass. No `latest` mutation is made.

## RC20 — Thinking-aware Pool routing and live catalog refresh

### RC20-01 — Pool-entry effort and Auto semantics

- **Level:** U/I/P, Pi `0.84.1`
- **Pass:** legacy Pool entries persist as `auto`; Auto omits the Pi override;
  supported explicit values are `low`, `medium`, `high`, `xhigh`, and `max`;
  unsupported values fail before model execution; the same route can persist
  different effort values in different Pools without changing route ID/order.

### RC20-02 — Execution and safe metadata

- **Level:** I/P, fixture Pi `0.84.1`
- **Pass:** Direct Workers and shared Mission/M7 executor paths select the
  Pool-entry effort, child session state is observed, and analytics records
  bounded requested/effective effort without prompts, credentials, or raw
  provider data. A stale explicit effort is unavailable and is not silently
  downgraded.

### RC20-03 — Model Router enablement and refresh

- **Level:** U/I/P/TUI/RPC, fake gateway and external-Pi fixtures
- **Pass:** Models & 9Router visibly offers Refresh Models; live refresh shows
  added/removed/changed rows, new rows default disabled, removed Pool routes
  remain missing/unavailable, enabled flags and Pool order/effort survive, and
  disabled PMO routes are excluded from Add Model. PMO enablement never shrinks
  or unregisters an external Pi provider.

### RC20-04 — Last-known-good and identity safety

- **Level:** I/security
- **Pass:** timeout, auth, malformed, empty, duplicate, and provider refresh
  failures retain the prior valid catalog; exact Pi/live route matches reconcile
  deterministically; genuine duplicate configured identities remain ambiguous;
  refresh and diagnostics never expose credential values.

Periodic automatic synchronization and Benchmark Lab are not RC20 acceptance
requirements and remain future work.

## RC21 — Model Router dogfood repair

### RC21-01 — Nested metadata and conservative thinking semantics

- **Level:** U/I, Pi `0.84.1` fixture
- **Pass:** a real `CatalogRow.entry` preserves reasoning, thinking-level map,
  vision, context, and max-output metadata through host normalization; true,
  false, and absent reasoning render as supported, not-supported, and unknown;
  Pool choices use the same authoritative metadata without fabricated values.

### RC21-02 — Static external upstream refresh

- **Level:** U/I/P, Pi `0.84.1` fixture and bounded gateway
- **Pass:** a populated picker places Refresh Models first; static external
  refresh performs a fresh `GET /v1/models` with the existing Pi auth result,
  reports added/removed/changed/no-change results, preserves PMO routes/Pools
  and LKG on failure, does not re-prompt or persist/print the key, and leaves
  the external provider model list and registration untouched.

### RC21-03 — Picker privacy and release boundary

- **Level:** U/TUI/security/release
- **Pass:** normal model rows omit internal route IDs while Inspect retains the
  exact ID; refresh start/success/failure feedback is visible and sanitized;
  full `npm run check`, detached release verification, exact artifact binding,
  `next`-only publication, unchanged `latest`, GitHub prerelease, and public
  install/dogfood all pass.

## RC25 — Operational Boss profiles and goal-oriented Mission loop

### RC25-01 — Weighted Boss profile and independent Pool scheduling

- **Level:** U/I
- **Setup:** configure three eligible Boss routes with weights `5`, `3`, and
  `2`, plus independent Investigation, Implementation, and Verification Pools.
- **Action:** launch multiple Missions and inspect assignment and worker routing.
- **Pass:** Boss assignments distribute according to the configured weighted
  policy with zero-weight routes excluded; each Mission has one persisted Boss
  assignment; worker Pool weighted scheduling remains independent and unchanged.

### RC25-02 — Multi-cycle goal loop and shared Mission entry

- **Level:** I/P, fake Pi runtime
- **Setup:** a Mission requires implementation and M7 Verification; the first
  implementation is incomplete and the first verification rejects it.
- **Action:** launch once through `@orchestrator <goal>` and once through Smart
  Routing → Run as Mission/AUTO_MISSION.
- **Pass:** both entries use the same canonical lifecycle: plan, dispatch,
  consume evidence, verify, diagnose/replan, repair, reverify, and only then
  complete after goal and acceptance criteria pass. A completed task or Boss
  completion claim alone never completes the Mission.

### RC25-03 — Boss pinning, infrastructure fallback, and terminal bounds

- **Level:** I
- **Setup:** run one Mission through multiple reject/repair cycles, then inject
  a genuine infrastructure failure for its assigned Boss route.
- **Action:** continue orchestration and inspect canonical state and analytics.
- **Pass:** the original Boss route remains stable across normal cycles; fallback
  records original, replacement, failure class, and reason, then pins the
  replacement without random re-rotation. Recoverable failures continue through
  bounded repair/retry/replan paths; only `COMPLETED`, `BLOCKED`,
  `AWAITING_USER`, `CANCELLED`, or `SAFETY_STOP` is terminal, and a bound hit is
  explicit blocked/review evidence rather than false completion. A quality
  rejection is recorded as quality escalation and does not emit or masquerade
  as infrastructure fallback.

### RC26-01 — Cancellation is a truthful terminal path

- **Level:** U
- **Setup:** run the canonical Boss goal loop and inject AbortError/AbortSignal
  during planning, after the Mission has started, during worker progression, and
  during verification.
- **Pass:** MissionStatus becomes `cancelled`; orchestration `terminal` is
  `CANCELLED`; the result is not `completed`, ordinary `blocked`, or
  infrastructure fallback; no further dispatch, Boss fallback, or repair/replan
  occurs; bounded terminal reason is persisted; analytics outcome is `cancelled`
  with `bossTerminalState=CANCELLED` when analytics is enabled.

### RC26-02 — SAFETY_STOP is distinguishable from business BLOCKED

- **Level:** U
- **Setup:** one Mission returns Boss `blocked` for an external dependency;
  another hits `ProjectTrustRequiredError` or `PathSafetyError` during worker
  progression.
- **Pass:** the business case terminals as `BLOCKED`. The safety case keeps
  MissionStatus `blocked` but persists `terminal: "SAFETY_STOP"` and a bounded
  provenance such as `PROJECT_TRUST_REQUIRED` or `CREDENTIAL_PATH`. No further
  dispatch, fallback, replan, or success claim occurs. Analytics outcome is
  `safety_stop` with `bossTerminalState=SAFETY_STOP`.

### RC26-03 — Runtime package metadata stays bound to the current RC line

- **Level:** U
- **Setup:** load `PACKAGE_INFO` from compiled `dist`/`dist-test` output.
- **Pass:** version equals `package.json` (`0.1.0-rc.26`); development line is
  `RC26 — Goal Terminal Semantics & Runtime Metadata Correctness`; RC23 titles
  are absent; `latestAcceptedMilestone` is M10; `productionReady` is false;
  an unmapped version would report `stale-development-line:<version>` rather
  than an older RC title. `@orchestrator` and Smart Routing Run as Mission
  still enter the same canonical Boss loop.

### RC26-04 — Persisted Pi install evidence is machine-neutral

- **Level:** U
- **Setup:** feed `safeCommandResult` synthetic Pi install/remove stdout that
  contains `/Users/.../directory-source`, `/home/...`, `/private/var/folders`,
  `/tmp`, `/private/tmp`, and Windows `C:\\Users\\...` paths; persist the
  result as `pi-install-evidence.json`.
- **Pass:** persisted stdout/stderr contain no local absolute machine paths;
  useful `code`/`signal` remain; `scanPrivacy` on that evidence is clean with
  no `local-absolute-path` issue and without weakening or excepting the
  scanner.

### RC25-04 — Persisted Boss analytics and manual recommendations

- **Level:** I/U
- **Action:** reopen the analytics store after Missions with assignment,
  fallback, verification, repair-cycle, terminal, elapsed-time, and authoritative
  usage metadata; generate a Boss weight recommendation and inspect Apply flow.
- **Pass:** bounded safe dimensions and outcome analytics persist by Mission;
  recommendation evidence uses the canonical architecture; generation/viewing
  does not mutate weights, and only explicit Apply changes the Boss profile.
