# Worker Result Protocol Forensics

Date: 2026-08-16
Development identity: `0.1.0-rc.29` (local unpublished)
Public RC28 remains immutable.

This document records the confirmed live Mission failure, the bounded
direct worker probe, the exact `invalid_child_result` predicate, and the
installed Pi 0.84.1 AgentSession capabilities that constrain the repair.
It does not authorize publication.

## 1. Real Mission timeline

Mission: `mission-306fb445-f267-4745-b5fc-a3c46e1760f5`

| Field | Value |
|---|---|
| Created | 2026-08-16T04:26:22.840Z |
| Terminal | 2026-08-16T04:28:21.815Z |
| Status | `awaiting-review` / `AWAITING_USER` |
| Boss route | `r9-ninerouter-ag-gemini-3-7-flash-high-962ee2177cd95a08c941` (`ag/gemini-3.7-flash-high`) |
| protocolFailures | 0 |
| actionablePlanFailures | 0 |
| productiveCycles | 4 |
| fallback | none |
| Tasks | 1 |
| Attempts | 1 |
| Evidence | 0 |
| Verification runs | 0 |

Canonical Task: `task-113d2094-1711-49bc-ab81-75b8fe20643a`

- executionClass: investigation
- roleId: investigator
- created cycle 0; reused by later replans (no duplicate logical Task)
- final status: `blocked`
- quality status: `unverified`

Canonical Attempt: `attempt-e533b18a-d6b5-4941-8914-bce137e39e1b`

| Field | Value |
|---|---|
| Worker route | `r9-ninerouter-ocg-deepseek-v4-flash-da31f2fa9acae2b5429e` |
| Remote model | `ocg/deepseek-v4-flash` |
| started_at | 2026-08-16T04:26:41.324Z |
| ended_at | 2026-08-16T04:27:01.734Z |
| elapsed | ~20.41s |
| status | failed |
| terminal_state | `invalid_child_result` |
| mutation_observed | 0 |
| result_json | null |

Cycle plan/eval:

- cycle 0 plan: dispatch (creates the Task and starts the Attempt)
- cycle 0 evaluate: replan; M7 blocked because worker did not complete
- cycles 1–3: replan/dispatch against the same Task identity; no second Attempt
- cycle 4: safety budget exhausted → `AWAITING_USER`

Budget exhaustion reason (persisted):

    Mission safety budget exhausted before the goal and acceptance criteria
    were proven; cycles=4; tasks=1; protocolFailures=0;
    actionablePlanFailures=0; lastAction=evaluate/replan;
    pin=ag/gemini-3.7-flash-high; fallback=none

M7 correctly blocked: no Evidence, no quality decision, quality remains
`unverified`.

## 2. Exact invalid_child_result predicate

`src/core/workers/executor.ts` after a normal provider-success boundary:

    result = readProtocolResult(resultProtocol, handle.protocolState)
    outcome = protocolViolation
      ? "protocol_violation"
      : result === undefined
        ? "invalid_child_result"
        : "completed"

`readProtocolResult` for `submit_agent_result` calls
`readProtocolCapture(state, parseStructuredChildResult)`.

`readProtocolCapture` returns `undefined` when `state.captured === undefined`.

`state.captured` is set only inside `createProtocolOnlyCaptureTool.execute`
when the child actually invokes the result tool with parseable arguments.

Therefore `invalid_child_result` means: the child session finished a normal
provider-success turn without a captured `submit_agent_result` (and without
a protocol-violation flag).

This classification is truthful for the live Mission. It is not a capture
bug hiding a valid result: `result_json` is null and no Evidence was
admitted.

## 3. Direct diagnostic probe (already performed)

Exactly one bounded `createChildSession` invocation on
`ocg/deepseek-v4-flash` using the same child path.

Trivial read-only task: check whether `package.json` exists and submit via
`submit_agent_result`.

| Field | Value |
|---|---|
| elapsedMs | 7407 |
| advertised tools | read, grep, find, ls, submit_agent_result |
| submit_agent_result advertised | yes |
| submit_agent_result invoked | yes |
| invocation sequence | find → ls → read → submit_agent_result |
| argument validation | success |
| protocolViolation | false |
| captured present | true |
| assistant stopReason | toolUse on every assistant turn |
| assistant hasText | false (textLength 0) |

Conclusion: the Pi → 9Router → DeepSeek path can advertise, invoke, and
capture `submit_agent_result`. The live Mission failure is model
non-compliance with an **optional** result tool during a longer work
session, not advertisement, capture, schema, or provider incompatibility.

## 4. Primary root cause

Class D: model non-compliance with an optional result handoff tool.

`invalid_child_result` is the correct classification of that behavior.

Not:

- A worker tool advertisement defect
- B worker tool capture/handler defect
- C schema-validation defect
- E provider/runtime tool incompatibility
- F child-session lifecycle defect
- G safety/tool-policy interruption (mutation_observed = 0; no safety event)

## 5. Boss vs Worker control channels

| Dimension | Boss | Worker |
|---|---|---|
| Runtime | `ModelRuntime.completeSimple` | Pi `AgentSession` multi-turn loop |
| Result tool | `submit_boss_decision` | `submit_agent_result` |
| Availability | forced via `toolChoice` | optional among pool tools |
| Schema enforcement | `constrainedSampling` json_schema strict prefer | tool `parameters` schema; capture validates on invoke |
| Thinking | excluded from decision parsing | not used as the structured result |
| Finish without tool | infrastructure/empty_response | normal session idle + `invalid_child_result` |

The Boss repair (forced schema-enforced tool) cannot be copied blindly:
Worker execution is a multi-tool AgentSession. Forcing `submit_agent_result`
during the work phase would prevent `read`/`grep`/`find`/`ls` (and
implementation tools) from running.

Approved architecture: two-phase completion. Work phase keeps the normal
tool set. If capture is missing after a normal provider-success boundary,
exactly one capture-only finalization turn may run with only
`submit_agent_result` exposed.

## 6. Pi 0.84.1 AgentSession capability audit

Inspected installed `@earendil-works/pi-coding-agent@0.84.1` types:

- `dist/core/agent-session.d.ts`
- `dist/core/sdk.d.ts`
- `dist/core/extensions/types.d.ts` (`ToolDefinition`)
- nested `pi-agent-core` `Agent` / `AgentLoopConfig`
- nested `pi-ai` `SimpleStreamOptions`

Findings:

1. Same-session continuation is supported. `AgentSession.prompt(text)` may
   be called again after a previous prompt settles. Conversation state
   remains in `session.messages`.
2. Tools can be restricted between turns.
   `setActiveToolsByName(toolNames)` takes effect on the next agent turn.
   Restricting to `[submit_agent_result]` is a supported API.
3. `PromptOptions` has no `toolChoice`. `Agent.prompt()` has no
   `toolChoice`. Typed `SimpleStreamOptions` also has no `toolChoice`.
   Forced tool selection is not a public AgentSession contract.
4. `ToolDefinition.constrainedSampling` exists
   (`false | ConstrainedSamplingConfig`). This is the strongest
   schema-enforcement surface on the child tool path. Work-phase result
   tools currently declare `parameters` but do not set
   `constrainedSampling`.
5. A successful result-tool `execute` already returns `terminate: true`,
   which stops the agent loop after that tool batch.
6. `Agent.shouldStopAfterTurn` can request a graceful stop after the
   current turn. The worker session already mutates
   `session.agent.beforeToolCall`; using `shouldStopAfterTurn` for a
   one-turn finalization budget is an existing Agent API, not an invented
   one.
7. The agent loop is done when there are no further tool calls (or all
   finalized results set `terminate: true`), queues are empty, and
   `shouldStopAfterTurn` is not keeping it alive.

Architecture choice from these facts:

- Use the **same child AgentSession** for finalization.
- Do **not** invent a separate `completeSimple` finalizer; AgentSession
  can continue and can restrict tools.
- Strongest supported enforcement during finalization:
  - `setActiveToolsByName([resultToolName])`
  - short capture-only prompt
  - `constrainedSampling` on the existing result tool
  - `shouldStopAfterTurn` so the budget is exactly one turn
- Do not claim `toolChoice` is forced through AgentSession; it is not a
  supported public option on that path.

## 7. Failure taxonomy (compatibility strategy)

Do not add a new persisted Attempt `terminal_state` enum value. SQLite
`attempts.terminal_state` is free text today, but Mission/quality
callers key on `invalid_child_result` / `completed` /
`partial_mutation_requires_review`.

Runtime diagnostic (in-memory attempt metadata / Inspect-safe event
fields only):

- `work_result_captured`
- `result_finalization_required`
- `result_finalization_succeeded`
- `result_finalization_missing`
- `result_finalization_protocol_violation`
- `result_finalization_infrastructure_failure`
- `cancelled`
- `safety_stop`

When finalization also fails to capture a valid result, keep the
backward-compatible terminal `invalid_child_result` (or
`partial_mutation_requires_review` if mutation was observed). Attach the
precise diagnostic on the Attempt without a schema migration.

Do not persist raw transcripts, completions, reasoning, credentials, or
provider payloads.

## 8. Recommended single correction

Deterministic two-phase worker completion:

1. Work phase unchanged (pool tools + result tool).
2. If a valid result is captured, skip finalization.
3. If the session reached a normal provider-success boundary with no
   capture, and the Attempt is not cancelled / safety-stopped /
   infrastructure-failed, run at most one same-session capture-only
   finalization turn exposing only the result tool.
4. Successful finalization belongs to the same canonical Attempt.
5. Finalization must never replay work tools or mutate the worktree.
6. After mutation, infrastructure failure during finalization must not
   fallback to a fresh implementation worker.

Next ADR number: ADR-047 (ADR-046 is the last sequential record;
the later Boss-transport heading currently reused ADR-030 and must not
be duplicated).
