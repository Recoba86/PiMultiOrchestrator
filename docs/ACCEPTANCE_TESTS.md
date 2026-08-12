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
- **Pass:** exactly twelve required sections appear in order; dashboard metadata is safe and textual; accepted domain views remain reachable; Boss/deferred engines say `Not implemented yet` or `Planned`; empty/stale/error/busy states are explicit; direct commands and explicit recommendation actions remain compatible; no automatic Apply or priority mutation occurs.

### OBS-01 — Active mission visibility

- **Level:** I/P
- **Setup:** one active Boss, two running workers, one cooldown route, one pending review.
- **Action:** open overview/health/mission views.
- **Pass:** profile/route, gateway status, pool counts, worker role/model/progress, cooldown/fallback, and review state are visible without reading logs.

## 12. M5 routed subagent execution

### WORK-05 — Child isolation and tool profiles

- **Level:** U/I, fixture-v1
- **Action:** create fresh children for Investigation, Implementation, and Verification with an exact route/model.
- **Pass:** session storage is in memory; parent extensions/delegate tool are absent; allowlists are read/grep/find/ls; read/grep/find/ls/bash; and read/grep/find/ls/bash respectively.

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
- **Pass:** SemVer `0.1.0-rc.3`, explicit compiled entrypoint, `pi-package` keyword, Pi peer only, no runtime dependency confusion, and no source/runtime-state files.

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
- **Pass:** ambient `PATH` tools cannot forge release totals or Pi identity; stale, dirty, altered, or path-leaking evidence is rejected; the clean rc.3 bundle verifies as `EXTERNAL_REVIEW_PENDING`.

### RELEASE-07 — Integrated worker safety enforcement

- **Level:** I/P, fake provider only
- **Action:** invoke Investigation, Verification, Implementation, and analyst child sessions through the real Pi SDK worker path and attempt profile-expanding tools, protected/out-of-root/symlink paths, destructive or secret-bearing commands, and allowed result submission.
- **Pass:** disallowed tools and arguments are denied before Pi executes them; Implementation mutation requires project trust; read-only roles cannot mutate; analyst remains read-only; bounded result submission remains available; no live or paid provider call occurs.

### RELEASE-08 — Capture-only custom-tool boundary

- **Level:** I/P, Pi `0.84.1`, fake gateway
- **Action:** attempt the former caller-supplied `submit_evil` handler, enumerate effective child tools, submit malicious-looking protocol payloads, and try protocol names colliding with `read`, `write`, `edit`, and `bash`.
- **Pass:** executable custom handlers cannot enter a child session; only declarative capture-only protocols are exposed; unknown and colliding tools fail closed; the exact `submit_evil` fixture remains unchanged under untrusted project state; protocol payloads are never interpreted as commands or paths.
