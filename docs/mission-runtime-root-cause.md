# Mission runtime root-cause gate

Last updated: 2026-08-16

This document is the RC29 architecture-repair gate. It is sourced from a
read-only copy of the live host MissionStore at
`~/.pi/agent/pi-multi-orchestrator/mission.sqlite` (copied with WAL/SHM;
live database was not modified). Do not treat operator recollection as
stronger than this store.

Live root used: `PI_MULTI_ORCH_CONFIG_ROOT` unset; host default
`runtime.getAgentDir()/pi-multi-orchestrator` =
`/Users/amin/.pi/agent/pi-multi-orchestrator`.

## 1. Exact real Mission timeline

### 1.1 Identity

| Field | Value |
|---|---|
| Mission ID | `mission-04452706-5486-4131-8565-dcec84f52beb` |
| Created | `2026-08-15T22:38:17.450Z` |
| Terminal | `2026-08-15T22:38:24.663Z` (7.213s wall clock) |
| Status | `awaiting-review` |
| Revisions | 15 |
| Tasks | **0** |
| Attempts | **0** |
| Evidence | **0** |
| Verification runs | **0** |
| Quality decisions | **0** |
| Canonical items | **0** |

No plan decision, no Task IDs, no worker routes, no M7 verdicts, and no
repair/replan exist in the store. Those layers did not run.

Scheduled pin at start: `Tabi/claude-opus-5-thinking`
(`r9-ninerouter-tabi-claude-opus-5-think-3344efdba2f40358b508`), weight 1,
thinkingEffort `auto`.

Terminal pin: `cu/cursor-grok-4.6-high`
(`r9-ninerouter-cu-cursor-grok-4-6-high-878588ec20e9b0b62896`), weight 0,
fallback from Tabi.

Acceptance criteria provenance: `labelled-goal` (13 criteria, including
commit/push and `HEAD == origin/main`).

### 1.2 Cycle-by-cycle table

Source: `mission_events` + `plan.orchestration` snapshots. Times are ISO-8601
from the store.

| Cycle | Time (UTC) | Pin | Event | Plan action | Tasks created | Worker / M7 | Notes |
|---|---|---|---|---|---|---|---|
| — | 22:38:17.451 | — | `mission_created` | — | 0 | none | Goal stored as title/objective |
| — | 22:38:17.459 | Tabi | `boss-start` | — | 0 | none | Automatic Boss start |
| — | 22:38:17.460 | Tabi | `boss-assignment` | — | 0 | none | weight 1, thinkingEffort auto |
| — | 22:38:17.461 | Tabi | `boss-acceptance-criteria` | — | 0 | none | provenance `labelled-goal` |
| 0 | 22:38:17.461 | Tabi | `boss-cycle-start` cycle=0 | none | 0 | none | First inference begins |
| 0 | 22:38:22.001 | Tabi → Cursor | `boss-fallback` | none | 0 | none | `authentication_failed`, HTTP 403, `stopReason=error`, stage `response`; 4.540s after cycle start |
| 0 | 22:38:22.718 | Cursor | `boss-protocol-failure` | none | 0 | none | `empty_response`, `stopReason=stop`, `hasText=false`, `normalized=false`; 0.717s after fallback. Classified as protocol, so no further fallback |
| 1 | 22:38:22.719 | Cursor | `boss-cycle-start` cycle=1 | none | 0 | none | Same pin retried |
| 1 | 22:38:23.345 | Cursor | `boss-protocol-failure` | none | 0 | none | identical `empty_response`; 0.626s |
| 2 | 22:38:23.346 | Cursor | `boss-cycle-start` cycle=2 | none | 0 | none | |
| 2 | 22:38:24.150 | Cursor | `boss-protocol-failure` | none | 0 | none | identical `empty_response`; 0.804s |
| 3 | 22:38:24.151 | Cursor | `boss-cycle-start` cycle=3 | none | 0 | none | |
| 3 | 22:38:24.660 | Cursor | `boss-protocol-failure` | none | 0 | none | identical `empty_response`; 0.509s. This is the condition that consumed cycle 4 (`cycle+1 >= maxCycles`) |
| — | 22:38:24.662 | Cursor | `boss-terminal` `AWAITING_USER` | none | 0 | none | reason below |
| — | 22:38:24.663 | Cursor | `mission_awaiting-review` | none | 0 | none | MissionStatus `awaiting-review` |

Terminal reason (verbatim, 240-char bound):

`Boss planning did not produce a valid actionable plan; cycles=4; tasks=0; protocolFailures=4; actionablePlanFailures=0; lastAction=none; pin=cu/cursor-grok-4.6-high; fallback=yes`

Completion gate never became true because **no Task was stored**.
`completedAndVerified()` was not the failing predicate; the loop never reached
a `complete` decision.

### 1.3 Historical Missions (unchanged evidence)

| Mission | RC | Terminal | Tasks | What the store shows |
|---|---|---|---|---|
| `mission-89d5e163-17ee-4218-b06c-dea5fa4b480b` | RC27 | `AWAITING_USER` | 0 | Cursor grok pinned at weight 1; 4× `Boss provider returned no decision` in ~3.2s; fallback none |
| `mission-aa30ed69-3213-4cf0-882a-a60be426412d` | RC27 | `BLOCKED` cycle 0 | 0 | Tabi pinned; `Boss infrastructure is unavailable and no configured fallback remains`; weight-0 Cursor could not fallback |
| `mission-04452706-5486-4131-8565-dcec84f52beb` | RC28 | `AWAITING_USER` | 0 | Tabi pin + 403 fallback to weight-0 Cursor; 4× classified `empty_response` in ~2.2s |

The live store contains **no Mission that created worker Tasks except** the
older draft `mission-049cbd67-01d6-40bf-a103-3c31267d71ec` (M11 Stage4, status
`draft`, 1 task, never run through RC25+ Boss loop).

## 2. Confirmed root cause(s)

### Primary (this RC28 dogfood)

1. **Pinned Tabi Boss failed delivery** with classified
   `authentication_failed` / HTTP 403. RC28 infrastructure fallback to the
   weight-0 Cursor route **did run** and **did pin** the replacement.
2. **Fallback Cursor `completeSimple` returned `stopReason: "stop"` with no
   assistant text** four times, each in 0.5–0.8s. RC28 correctly classified
   this as `empty_response` and persisted Inspect diagnostics.
3. **ADR-045 treats empty assistant text as protocol**, so it does not
   fallback and does not stop. `runMissionGoalLoop` counts each empty
   response as one of four `maxCycles`. Cycle 3's empty response is the
   exact bound hit (`cycle + 1 >= 4`).
4. The loop then terminals **`AWAITING_USER`**, a review state, even though
   there is nothing to review: no plan, no tasks, no user decision, lastAction
   `none`.

This is **Boss invocation delivery failure**, not Mission convergence after
successful planning.

### Confirmed non-causes for this Mission

The following suspected hazards **did not execute** on this Mission and must
not be reported as its failing predicate:

- Task identity duplication
- `completedAndVerified()` poisoning by historical failed Tasks
- M7 prompt/class mismatch
- repair/replan quality reset
- worker `git push` safety denial during an Attempt

They remain **latent architecture defects** (section 3) that would fire as
soon as a Boss actually produced a plan.

## 3. Contributing architecture flaws

### A. One integer named "cycle" means four different things

`maxCycles` default 4. One iteration is:

plan invoke → (optional) dispatch every task → M7 every task → evaluate invoke

A hollow `empty_response` consumes a full unit. A productive
plan→execute→verify→evaluate also consumes a full unit. Protocol failures,
repairs, and no-progress loops share the same counter.

### B. Empty delivery vs invalid decision

ADR-045: "Protocol/quality errors still must not fallback." Empty assistant
text was filed under protocol. That is the wrong bucket.

- **Invocation delivery failure:** no user-visible assistant text (empty
  body, auth, transport, pending/deferred). The model/runtime did not deliver
  a completion. This is infrastructure-class for fallback.
- **Decision protocol failure:** text arrived but is not a valid
  `BossDecision` (malformed JSON, `dispatch` with `tasks=[]`). This stays on
  the pin with corrective feedback (RC27).

RC27 Cursor dogfood and RC28 Cursor fallback are the same delivery failure,
0.5–0.8s apart, retried until the bound.

### C. `AWAITING_USER` is used as a generic bound-exhaustion bucket

RC27-02 required four empty *dispatch documents* to become informative
`AWAITING_USER` rather than false `COMPLETED`. That remains correct for
"Boss spoke, plan was empty." It is incorrect for "Boss never spoke."

### D. Task identity (latent)

`spec.taskId` missing or unknown → `createTask()` with a new UUID. A replan
that omits IDs multiplies canonical Tasks. Completion then requires every
stored Task to pass.

### E. Completion gate (latent)

```ts
tasks.length > 0 && tasks.every(task =>
  task.status === "execution_completed" &&
  quality === "passed")
```

Every Task ever stored is an active completion requirement. Failed,
replaced, or rejected work can poison `COMPLETED` forever. Historical
evidence should remain durable without remaining an active gate.

### F. Boss state projection

`bossInferencePrompt` sends goal, acceptance, phase, cycle, pin, status, a
slice of `mission.plan` (orchestration metadata), and in-memory feedback.
It does **not** project canonical Tasks from MissionStore: task ID,
lifecycle, latest Attempt, quality, accepted evidence, required fixes,
supersession, or outstanding Goal criteria as structured rows.

In-memory `feedback` is not part of `BossMissionState`. A process restart
drops it.

### G. Capability / safety contradiction in the RC28 Goal

Workers never pass `explicitlyAuthorized: true`.
`WorkerSafetyGuard.authorizeBash` uses `decision !== "ALLOW"` as a hard
block (REVIEW_REQUIRED terminates the child).

| Operation | Policy | Worker outcome |
|---|---|---|
| `git status` / `git log` / `git branch` | allowlisted | ALLOW |
| `git commit` | `COMMAND_NOT_ALLOWLISTED` | REVIEW_REQUIRED → blocked |
| `git push` | `NETWORK_OR_PUBLICATION` | BLOCK |
| `npm publish` | `NETWORK_OR_PUBLICATION` | BLOCK |

The labelled criterion "Commit and push the docs-only closure if all checks
pass" plus "Finish with HEAD == origin/main" is an **impossible worker
action**. The Boss system prompt does not say so. Preflight does not exist.
The loop would have burned cycles on SAFETY_STOP / failed Tasks if invocation
had succeeded.

Classification for that Goal, had workers run:

- not a model failure
- **capability mismatch** + **safety policy**
- should become `AWAITING_USER` with provenance `CAPABILITY_MISMATCH`
  *before* invoking Boss, because the operator can rewrite the Goal
- an actual in-run `git push` remains `SAFETY_STOP` / `NETWORK_OR_PUBLICATION`

### H. Resume (latent)

`runMissionGoalLoop` only short-circuits `completed` and `cancelled`.
`awaiting-review` / `blocked` with `state.terminal` set can be re-entered.
`state.cycle` is the last started 0-based cycle, not the next cycle, so a
crash after a finished cycle 0 restarts cycle 0. Feedback is in-memory only.

### I. M7 class (latent)

`executeReviewer` always says "Review implementation run …". Investigation
and Verification Tasks still require `quality === "passed"` for Mission
completion. Evidence stays `proposed`; `promoteEvidence` is a manual host
path and bumps `mission.revision`, which makes later promotion
source-revision stale if the loop persists in between.

## 4. Symptoms previously patched

| RC | Symptom patched | What moved |
|---|---|---|
| RC26 | False completion / missing CANCELLED and SAFETY_STOP | Bound exhaustion became `AWAITING_USER` |
| RC27 | Empty `dispatch` treated as success; UX asked user to Add Task | Empty plans became protocol failures; still 4× no-text on Cursor |
| RC28 | `stopReason === "stop"` only; black-box infra; weight-0 cannot fallback; untruthful Boss UI | Tabi 403 now fallbacks; empty Cursor now classified; UI truthful; **same hollow Cursor completion still burns 4 cycles** |

RC28 worked as designed for selection, classification, weight-0 fallback, and
UI. It did not make Cursor deliver assistant text, and it did not stop
retrying a hollow completion.

## 5. Why previous tests missed this

302/302 tests inject a `BossDecision` object, or a Pi-shaped
`AssistantMessage` that already contains JSON `type:"text"` blocks, or they
assert the RC28 *classification* of thinking-only empty (`protocol`,
`AWAITING_USER`, no fallback).

They did not:

- replay the live two-stage failure (Tabi 403 → Cursor empty ×4) as a
  **store-inspected** host loop
- require that delivery-empty fallback or BLOCK instead of consuming
  `maxCycles`
- run real `MissionStore` + `ContextBroker` + `executeMissionTask` +
  `QualityService` across repair/replan/resume
- inspect durable Task/Attempt/Evidence/M7 rows rather than only the
  returned `terminal` enum
- present a Goal that requires `git push` and assert a capability terminal
- distinguish productive cycles from no-progress invocation retries

The fake Goal→Task→M7→COMPLETED path is a closed mock: `invoke` returns
`dispatch`, `dispatch` writes a succeeded Attempt, `verify` writes `pass`.
It cannot see Pi returning `content: []` / thinking-only in 600ms.

## 6. Accepted architecture constraints that must remain

- Exactly three worker Pools.
- One pinned weighted Boss per Mission; infrastructure fallback vs quality
  escalation stay separate.
- Context Broker boundedness; no raw transcripts or hidden reasoning in
  packets, Inspect, or orchestration JSON.
- M7 independence/diversity; reviewer is not the implementer.
- Strict `normalizeBossDecision`.
- Goal acceptance-criteria provenance (explicit > labelled > derived).
- `CANCELLED` and `SAFETY_STOP` terminals.
- Trust / path / secret protections.
- RC26/RC27/RC28 public identities immutable. RC28 is a public prerelease
  (`0.1.0-rc.28`, tag `v0.1.0-rc.28`, source
  `aad28c33260326665ec17e347d50fe985b18a953`); this repair does not rewrite
  those commits.
- Thinking/CoT is never the Boss decision (ADR-045 text contract).

## 7. Proposed corrected state machine

```text
Goal
  -> capability preflight (impossible worker ops -> AWAITING_USER / CAPABILITY_MISMATCH)
  -> pin weighted Boss
  -> cycle N:
       invoke plan (delivery failure -> infrastructure fallback or BLOCKED)
       decision-protocol failure -> feedback on same pin; do not rotate Boss
       dispatch:
         resolve Task by explicit taskId or identity key (class + normalized objective)
         skip already execution_completed + quality passed
         Context Broker packet -> worker Attempt -> proposed Evidence
       M7 by execution class against that Attempt
         pass -> promote verified Evidence (refresh Mission revision)
         reject -> repair same identity (quality reset on next Attempt)
       invoke evaluate with canonical projection (not raw transcripts)
       COMPLETED only if active Tasks (latest per identity, not cancelled)
         are execution_completed AND quality passed
         AND Boss action complete with acceptanceSatisfied
  -> productive-cycle bound (default 4) for plan-execute-evaluate progress
  -> decision-protocol bound (default 4) still AWAITING_USER with 0 tasks
  -> delivery/infrastructure exhaustion: BLOCKED with classified reason
  -> persist feedback + next cycle in orchestration; terminal Missions do not resume
```

Safety-budget semantics:

| Budget | Counts | Exhaustion |
|---|---|---|
| Productive cycles | plan that dispatched or evaluated work | `AWAITING_USER` if work exists but Goal unproven |
| Decision-protocol failures | malformed/empty-task JSON on the pin | `AWAITING_USER`, 0 tasks, Inspect (RC27-02) |
| Invocation delivery failures | empty/auth/transport | fallback; if none remain, `BLOCKED` (not 4 retries) |

Task identity: `executionClass + NFKC/lower/collapsed objective`. Reuse the
latest non-cancelled Task with that key. Explicit `taskId` that belongs to
the Mission wins. Historical rows remain; only the latest identity is
**active** for `completedAndVerified`.

Boss projection (bounded, no CoT): task ID, objective, class, lifecycle,
latest Attempt outcome, quality, accepted evidence summary, required fixes,
supersession (replaced by later same-key Task), outstanding Goal criteria.

## 8. Migration / backward compatibility

- Mission SQLite schema stays at version 2. No new tables.
- `plan.orchestration` gains optional fields (`lastFeedback`, richer
  `lastInvocation` counts). Old Missions remain readable.
- Empty-response classification stored as `empty_response` is unchanged;
  its **runtime class** becomes infrastructure for fallback.
- Existing `awaiting-review` Missions are historical; they are not rewritten.
- RC27-02 (empty `dispatch` JSON → protocol, no fallback, `AWAITING_USER`)
  remains.
- RC28-02's "thinking-only empty does not fallback" is superseded by ADR-046
  for *delivery* emptiness only.
- Package identity for this repair is `0.1.0-rc.29` with status
  IN PROGRESS / LOCAL DOGFOOD REQUIRED. Public RC28 remains immutable.
  This document authorizes the architecture repair, not RC29 publication.
