# Worker Infrastructure Fallback Forensics

Date: 2026-08-16
Development identity: `0.1.0-rc.29` (local unpublished)
Public RC28 remains immutable.

Read-only reconstruction of why Mission
`mission-b290a07a-dba3-4d03-87cf-ebe99dd9e6ae` produced one
`infrastructure_stopped` worker Attempt and no second route Attempt.
This document does not authorize publication, runtime changes, or another
Mission.

Live MissionStore, HealthStore, and ConfigStore were read, not written.
Exactly one bounded `createChildSession` probe ran on `ocg/gpt-5.6-luna`.
Two-phase result finalization (ADR-048) is not involved: the child never
reached a provider-success work phase.

## 1. Exact Mission timeline

Mission: `mission-b290a07a-dba3-4d03-87cf-ebe99dd9e6ae`

| Field | Value |
|---|---|
| Created | 2026-08-16T04:59:42.734Z |
| Terminal | 2026-08-16T05:00:13.832Z |
| Status | `awaiting-review` / `AWAITING_USER` |
| Boss route | `r9-ninerouter-ag-gemini-3-7-flash-high-962ee2177cd95a08c941` (`ag/gemini-3.7-flash-high`) |
| protocolFailures | 0 |
| actionablePlanFailures | 0 |
| productiveCycles | 4 |
| Boss fallbackHistory | `[]` |
| Tasks | 1 |
| Canonical Attempts | 1 |
| Evidence | 0 |
| Verification runs | 0 |
| Analytics events for this Mission | 0 (`analytics.enabled` is false) |

Canonical Task: `task-6d2d57d6-f88c-4c1d-a1c2-d7c05493036d`

- executionClass: `investigation`
- roleId: `investigator`
- poolId: `investigation`
- created 2026-08-16T04:59:46.693Z (cycle 0 dispatch)
- reused by later plans (no second logical Task)
- final status: `blocked` at 2026-08-16T04:59:49.421Z
- quality: `unverified` (no quality row for investigation)

Canonical Attempt: `attempt-0c01025f-db11-4afc-9a64-67dc9918d54a`

| Field | Value |
|---|---|
| Worker route | `r9-ninerouter-ocg-gpt-5-6-luna-f83d0cd809d5518b622c` |
| Remote model | `ocg/gpt-5.6-luna` |
| started_at | 2026-08-16T04:59:46.698Z |
| ended_at | 2026-08-16T04:59:49.421Z |
| elapsed | 2723 ms |
| status | failed |
| terminal_state | `infrastructure_stopped` |
| mutation_observed | 0 |
| result_json | null |
| attempt_failed payload | null (failure class not persisted on the event) |

Event order (MissionStore `mission_events`):

| Time | Kind | Notes |
|---|---|---|
| 04:59:42.734Z | mission_created | |
| 04:59:42.737Z | boss-start / assignment | Gemini Boss pinned; no Boss fallback |
| 04:59:42.738Z | boss-cycle-start | cycle 0 |
| 04:59:46.692Z | boss-plan | cycle 0 `dispatch` |
| 04:59:46.693Z | task_created | the only Task |
| 04:59:46.698Z | task_started | the only Attempt |
| 04:59:49.403Z | HealthStore write | Luna `transport_error` (see §4) |
| 04:59:49.421Z | attempt_failed | Task becomes `blocked` |
| 04:59:52.585Z | boss-evaluation | cycle 0 action `dispatch`, verification `[blocked]` |
| 04:59:52.587Z | boss-cycle-start | cycle 1 |
| 04:59:55.007Z | boss-plan | cycle 1 `dispatch` (same Task identity) |
| 04:59:59.288Z | boss-evaluation | cycle 1 `replan`, verification `[blocked]` |
| 04:59:59.289Z | boss-cycle-start | cycle 2 |
| 05:00:02.653Z | boss-plan | cycle 2 `replan` |
| 05:00:06.607Z | boss-evaluation | cycle 2 `replan` |
| 05:00:06.609Z | boss-cycle-start | cycle 3 |
| 05:00:10.146Z | boss-plan | cycle 3 `replan` |
| 05:00:13.827Z | boss-evaluation | cycle 3 `replan` |
| 05:00:13.829Z | boss-terminal | `AWAITING_USER`; cycles=4; fallback=none |

Persisted lastFeedback (cycle 3, overwrites cycle 0):

- task summary: `Mission validation failed (1 issue)`
- verification: `M7 verification cannot start because the worker did not complete`

Cycle 0 worker summary is not retained in `plan_json`. From the STOP path in
`SubagentExecutor.execute`, that summary was the classified safe message
`Route transport failed`.

## 2. Luna safe failure classification

Persisted HealthStore record written at the Attempt end
(`health.json` generation 9, `updatedAt` 2026-08-16T04:59:49.403Z):

| Field | Value |
|---|---|
| routeId | `r9-ninerouter-ocg-gpt-5-6-luna-f83d0cd809d5518b622c` |
| lastFailureClass | `transport_error` |
| lastHttpStatus | absent |
| cooldownReason | `transport_error` |
| cooldownUntil | 2026-08-16T05:00:19.403Z (default 30s transport cooldown) |
| consecutiveFailures | 1 |
| circuit | `degraded` |
| lastSuccessAt | absent |

`recordFailure` runs only when `single.failure` is defined and not
`cancelled`. Therefore the executor **did** classify a failure and **did**
reach `nextAfterFailure`. This is not the `failure === undefined` →
`infrastructure_stopped` shortcut.

`transport_error` is retryable and fallback-eligible under M4
(`decideFailureAction`) **when** `routing.fallback.enabled` is true.

No HTTP status/code was persisted. `failureInputFromProviderText` defaults
unmatched provider `stopReason: "error"` text to `transport_error`. The live
class is therefore a safe transport bucket, not a proven socket/network
outage.

## 3. Investigation route eligibility at Attempt start

Live ConfigStore generation 59, `savedAt` 2026-08-16T00:53:55.688Z
(unchanged through the Mission). Routing policy at that generation:

```json
{
  "diversityPreference": "none",
  "fallback": { "enabled": false },
  "maxAttempts": 1,
  "quotaCooldownMs": 300000,
  "rateLimitCooldownMs": 30000,
  "timeoutMs": 60000
}
```

This matches product defaults in `src/core/config/defaults.ts` and history
generations 56–58. Fallback was not toggled off during the Mission; it was
already off.

Investigation Pool (operational profile `default-policy`),
`schedulingPolicy: weighted`:

| route | remote model | weight | pool/global enabled | thinkingEffort |
|---|---|---:|---|---|
| `r9-ninerouter-ocg-deepseek-v4-flash-da31f2fa9acae2b5429e` | `ocg/deepseek-v4-flash` | 40 | true/true | high |
| `r9-ninerouter-ocg-gpt-5-6-luna-f83d0cd809d5518b622c` | `ocg/gpt-5.6-luna` | 20 | true/true | high |
| `r9-ninerouter-ag-gemini-3-7-flash-high-962ee2177cd95a08c941` | `ag/gemini-3.7-flash-high` | 40 | true/true | high |

Health at Attempt start (04:59:46.698Z), before the Luna failure write:

| route | circuit | consecutiveFailures | cooldown | notes |
|---|---|---:|---|---|
| DeepSeek | healthy | 0 | none | lastSuccess 04:27:01.719Z; earlier timeout 04:23 recovered |
| Luna | none recorded | 0 | none | first health event is the 04:59:49.403Z failure |
| Gemini | healthy | 0 | none | lastSuccess 04:24:24.498Z; this Mission's Boss used the same route |

Do not use a later standalone `PoolManager` view as historical eligibility.
A Pi-less pool snapshot after the Mission reports `state/catalogState:
unknown` and `thinkingEffortValid: false` for all three; that is missing Pi
provider catalog in the forensic process, not the live host state. Live
selection of Luna, the DeepSeek success at 04:27, and Gemini Boss invocation
at 04:59:42 prove the three members were scheduling-available.

Eligibility at 04:59:46.698Z (normal weighted assignment vs infrastructure
fallback). Worker fallback reuses `selectRoute`; it is not Boss
`selectBossFallbackEntry`. Weight 0 would be ineligible for **both** in the
worker path; all three weights are > 0, so that distinction does not apply
here.

| route | weight | normal-scheduling eligible? | infrastructure-fallback eligible? | rejected reason |
|---|---:|---|---|---|
| DeepSeek | 40 | yes | yes | — |
| Luna | 20 | yes (selected) | yes until this Attempt is recorded | — |
| Gemini | 40 | yes | yes | — |

After the Luna failure, if fallback had been enabled, the next `selectRoute`
would have seen Luna in `attemptedRouteIds` and in a 30s cooldown. DeepSeek
and Gemini would have remained fallback-eligible.

Hypothesis answers:

| ID | Claim | Result |
|---|---|---|
| A | no other eligible Investigation route existed | **False.** DeepSeek and Gemini were eligible. |
| B | retry/fallback budget exhausted | **Same-route retry budget was zero** (`maxAttempts: 1` → `maxSameRouteRetries = 0`). Fallback budget was not exhausted; it was **disabled**. |
| C | Luna failure class was intentionally non-retryable | **False for the persisted class.** `transport_error` is retryable and fallback-eligible. (Today's probe 400/`invalid_request` *would* be non-retryable; that is not what was persisted.) |
| D | M4 classified the underlying failure differently | **Classified as `transport_error`,** then STOP'd by policy. Terminal label `infrastructure_stopped` is the STOP outcome, not a different class. |
| E | worker executor stopped before the routing fallback path | **False.** It reached `nextAfterFailure` / `decideFailureAction`. |
| F | canonical Task wrapper prevented another Attempt | **Not for the first run.** `executeMissionTask` creates one store Attempt per dispatch. After STOP, `finishAttempt(failed)` sets Task `blocked`, which then prevented Boss re-dispatch. |
| G | health/cooldown/exclusion removed all alternatives | **False at decision time.** Alternatives were never asked for. Luna cooldown starts after `recordFailure`, which is before the STOP return, but STOP does not consult remaining candidates. |
| H | weighted scheduling replaced infrastructure fallback | **False.** Weighted selection chose Luna initially. Fallback never ran. Worker fallback would still call `selectRoute` (weighted among remaining), not skip fallback because of weights. |
| I | another evidenced condition prevented retry | **Yes: live `routing.fallback.enabled === false`.** |

## 4. Exact branch that prevented fallback

Control flow for this Attempt:

```text
executeMissionTask
  → store.createAttempt (one canonical row)
  → SubagentExecutor.run / execute
      → routingRequest() loads live routing policy
      → selectRoute (weighted) → Luna
      → createChildSession + prompt
      → failure classified (HealthStore: transport_error)
      → recordAttempt + recordFailure
      → nextAfterFailure(chain, transport_error, policy)
          → decideFailureAction(...)
      → action === STOP
      → terminalStatus = infrastructure_stopped
  → store.finishAttempt(failed, terminalState=infrastructure_stopped)
      → Task status = blocked
```

Exact predicate, `src/core/routing/index.ts` `decideFailureAction`:

```ts
const retryable = classification.class === "rate_limited"
  || classification.class === "timeout"
  || classification.class === "transport_error";
if (retryable && retryCount < maxSameRouteRetries) return "RETRY_SAME_ROUTE";
if (fallbackEnabled && class !== "cancelled" && class !== "invalid_request"
    && class !== "unknown" && class !== "protocol_error") {
  return "FALLBACK_NEXT_ROUTE";
}
return "STOP";
```

Live values:

- `classification.class` = `transport_error` (retryable)
- `retryCount` = 0 (first failure; `nextAfterFailure` subtracts the
  `recordAttempt` increment)
- `maxSameRouteRetries` = `max(0, policy.maxAttempts - 1)` = `0`
- `fallbackEnabled` = `policy.fallback.enabled` = **false**

Therefore neither retry nor fallback fires. `SubagentExecutor.execute` then:

```ts
if (action === "STOP") {
  const terminalStatus = single.outcome === "timed_out"
    ? "timed_out"
    : "infrastructure_stopped";
  return resultBase(..., terminalStatus, ...);
}
```

That is the first failing code predicate: **`fallbackEnabled === false`**
with **`maxSameRouteRetries === 0`**, after a classified `transport_error`.

ADR-048 finalization is unreachable: `providerSucceeded` stayed false,
`stopReason` was error, no capture, no second turn.

## 5. Underlying Luna failure (direct probe)

Existing store diagnostics were class-only (no status/code). Exactly one
bounded `createChildSession` probe ran on `ocg/gpt-5.6-luna` with
`thinkingEffort: "high"`, investigation tools, no Mission, no worktree
mutation, no HealthStore write.

| Field | Probe value |
|---|---|
| elapsedMs | 1355 |
| session create | returned normally |
| prompt | returned normally (`promptKind=returned`, did not throw) |
| advertised tools | read, grep, find, ls, submit_agent_result |
| first assistant stopReason | `error` |
| hasText | false |
| toolUse | false |
| safe class from error text | `invalid_request` |
| status | 400 |
| protocol capture | absent |

Raw provider text was not persisted. The 400 token was extracted only to
classify.

Live Attempt (2723 ms, no status) vs probe (1355 ms, 400): both fail on the
**first assistant turn** before any tool. The live `transport_error` with no
HTTP status is consistent with the unmatched-error default, not with a
distinct later transport outage. The probe does not rewrite the persisted
live class; it shows Luna currently rejects the same child-session request
as HTTP 400.

`invalid_request` is intentionally non-fallbackable in `decideFailureAction`.
If the live Attempt had been classified 400/`invalid_request`, fallback
would have STOPped **even with fallback enabled**. The persisted live class
was `transport_error`, which would have fallen back if enabled.

## 6. Luna vs DeepSeek first divergence

Existing DeepSeek evidence (not re-run):

- Mission Attempt `attempt-e533b18a-d6b5-4941-8914-bce137e39e1b` on
  `ocg/deepseek-v4-flash`: ~20.4s, `invalid_child_result`, mutation 0.
- Direct `createChildSession` probe: provider-success, tools invoked,
  `submit_agent_result` captured.

Same boundaries:

| Boundary | Luna (this Mission / probe) | DeepSeek (prior evidence) |
|---|---|---|
| route resolution | success; `provider=9router`, `api=openai-completions` | success; same gateway |
| model object | `ocg/gpt-5.6-luna` | `ocg/deepseek-v4-flash` |
| tools | investigation + `submit_agent_result` advertised | same advertisement |
| AgentSession creation | success | success |
| first assistant turn | `stopReason=error`, no text, no tools, ~1–3s | provider-success, toolUse, tens of seconds |
| failure classification | live `transport_error`; probe `invalid_request`/400 | none (provider success; later `invalid_child_result`) |
| executor fallback path | STOP because fallback disabled | never entered (not an infrastructure failure) |

First divergence: **first assistant turn / provider `stopReason`**.
Everything before the first model response is common and working.

## 7. Accepted M4 architecture vs actual behavior

For a worker Attempt with infrastructure failure, `mutation_observed=false`,
and no structured result, accepted architecture says:

1. Retry the same route only if the class is `rate_limited` | `timeout` |
   `transport_error` **and** `retryCount < maxAttempts - 1`.
2. Else fallback to a different eligible route if `routing.fallback.enabled`
   **and** the class is not `cancelled` | `invalid_request` | `unknown` |
   `protocol_error`.
3. Else STOP. Parent (Boss) decides next. Quality escalation is a different
   transition (ADR-007).
4. After a potential mutation, do not fallback (M5). Not applicable here.

PRODUCT_SPEC FB-002: eligible infrastructure failures **MAY** automatically
try the next route **within attempt/budget policy**. Defaults ship
`fallback.enabled: false` and `maxAttempts: 1`.

Actual behavior matches that policy: classified `transport_error`, no
same-route retry budget, fallback disabled, STOP, terminal
`infrastructure_stopped`.

**This is not a runtime executor bug.** It is the accepted M4 STOP path
under the live routing policy.

Boss-specific ADR text that weight 0 may still infrastructure-fallback does
not apply: worker fallback uses `selectRoute`, and all Investigation weights
were positive.

`executeMissionTask` wrapping one canonical Attempt around the whole
executor run is also accepted. If fallback had run, the store would still
show one Attempt whose provenance could move to the fallback route. The
missing second **child** Attempt is the STOP decision, not the wrapper.

## 8. Boss interaction

Why only one worker Attempt:

1. Executor STOP'd inside the first `executeMissionTask` (policy).
2. `finishAttempt(failed)` maps Task status to `blocked`.
3. `resolveOrCreateMissionTask` treats `blocked` as reusable identity.
4. `executeMissionTask` runnable set is `pending|planned|ready|interrupted`
   (plus quality-repair `execution_completed`). `blocked` is not runnable.
5. Cycle 1 `dispatch` therefore threw `MissionValidationError` ("Mission
   validation failed (1 issue)"). No second `createAttempt`.
6. Cycles 2–3 replanned the same blocked Task and spent the cycle budget.

What Boss received:

- Cycle 0: worker summary from the STOP path (`Route transport failed`) plus
  M7 `blocked` because the worker did not complete. Evaluation action was
  still `dispatch`.
- Later cycles: validation failure text, not the infrastructure class.
  Failure class was never on `attempt_failed` payload.

Boss knew the first failure was infrastructure-class only on cycle 0, via
the safe summary. It was expected to re-dispatch if it chose `dispatch`;
the Task wrapper then refused. Mission cycle budget compensated for missing
M4 fallback with semantic replan. That is a contributing handoff gap, not
the primary missing-fallback cause.

Boss did **not** incorrectly classify the failure as quality/protocol. It
absorbed an infrastructure STOP as repeated Task replan because fallback
was off and `blocked` is not re-runnable.

## 9. Test gap

Worker fallback tests in `test/workers-core.test.ts` and
`test/routing.test.ts` set `fallback.enabled: true` and `maxAttempts: 2`.
Product defaults and this live ConfigStore use the opposite.

Covered today:

- infrastructure failure before result capture, mutation false, 2+ routes,
  second child Attempt, health update, route exclusion, success on fallback
  route — **yes, but only with fallback enabled in the test policy**
- STOP when `maxAttempts: 1` and fallback disabled — **yes for timeout with
  a single candidate** (`returns timed_out when M4 has no retry or fallback
  left`), not for `transport_error` with two remaining eligible routes

Not covered:

- live/default policy (`fallback.enabled: false`, `maxAttempts: 1`)
- 2+ eligible Investigation routes
- classified `transport_error`, mutation false, no structured result
- assertion that **no** second child Attempt is created and terminal is
  `infrastructure_stopped`
- Boss cycle 1 re-dispatch of a Task that `finishAttempt(failed)` marked
  `blocked`
- persistence of failure class/status on the canonical Attempt or
  `attempt_failed` event (HealthStore is currently the only durable class)
- worker fallback eligibility distinct from weighted `selectRoute` (weight 0)

That is why the suite passed while this real path produced one
infrastructure-stopped Attempt and no fallback.

## 10. Verdict

| Question | Answer |
|---|---|
| Bug in worker executor fallback control flow? | **No.** STOP matches accepted M4 policy. |
| Bug in ADR-048 finalization? | **No.** Finalization never ran. |
| Primary root cause | Live `routing.fallback.enabled === false` (and `maxAttempts: 1`) caused `decideFailureAction` to return `STOP` after a classified, otherwise fallback-eligible `transport_error`. Two other Investigation routes were eligible. |
| Contributing causes | (1) `finishAttempt(failed)` marks the Task `blocked`, so Boss `dispatch` cannot create another Attempt. (2) Attempt/event rows do not persist failure class; later Boss cycles only see `Mission validation failed (1 issue)`. (3) Unmatched provider error text defaults to `transport_error`; a later probe of the same child path is HTTP 400 `invalid_request`. (4) Weighted Investigation pool selected Luna (weight 20) over DeepSeek (40) for this `runId`; that is scheduling, not fallback. |
| Recommended single correction | **Enable worker infrastructure fallback in live routing policy** (`routing.fallback.enabled = true`, via `/routing-settings`). Optionally raise `routing.maxAttempts` if same-route retry is desired. No runtime source change is required for the missing-fallback question. |

Do not change pool weights or routes as part of this finding. Changing
product defaults (`createDefaultConfig` ships fallback off) would be a
separate configuration-policy decision, not a runtime defect fix.

If a later mission wants Luna itself to succeed, that is a different
problem: first-turn HTTP 400 on `ocg/gpt-5.6-luna` with the child-session
request (thinking/tools/schema). It is not why DeepSeek was not tried.
