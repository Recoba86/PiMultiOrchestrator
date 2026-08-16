# Boss Decision Protocol Forensics — Mission mission-939cfa52

Date: 2026-08-16. Status: forensics complete; no runtime code modified.

Mission under investigation: `mission-939cfa52-87d2-4e6f-b8d8-bc5930c90a73`
(one real read-only RC29 dogfood Mission, pinned Boss `ag/gemini-3.7-flash-high`,
route `r9-ninerouter-ag-gemini-3-7-flash-high-962ee2177cd95a08c941`).

Outcome: terminal `AWAITING_USER` (`awaiting-review`), cycles=4, tasks=0,
protocolFailures=4, actionablePlanFailures=0, fallback=none.

## 1. Evidence inventory

Safe local evidence used:

- MissionStore (read-only): `missions.plan_json`, `mission_events` payloads for the mission.
- Source: `src/core/mission/boss-prompt.ts`, `boss-response.ts`, `boss.ts`,
  `boss-projection.ts`, `acceptance-criteria.ts`, `src/host/pi-extension.ts`.
- Tests: `test/boss-response.test.ts`, `test/boss.test.ts`.
- Installed Pi 0.84.1 types/source: `@earendil-works/pi-ai` (`types.d.ts`,
  `models.d.ts`, `api/google-generative-ai.js`, `api/google-shared.js`,
  `api/openai-completions.js`, `api/constrained-sampling.js`),
  `@earendil-works/pi-coding-agent` (`core/model-runtime.d.ts`).

What was NOT available: the exact user-visible assistant texts of the four
cycles were never persisted. PMO persists only safe diagnostics
(`hasText`, `stopReason`, block counts), never assistant text. Pi session
JSONL exists only for print-mode sessions; this Mission ran via RPC. Per the
mission instructions, exactly ONE bounded diagnostic inference was performed
(see section 4) to reproduce the protocol boundary. No MissionStore mutation,
no worker execution, no config change.

## 2. The four failures, reconstructed

For every cycle the stored `boss-protocol-failure` event plus the final
`plan_json.orchestration` record:

| # | cycle | route/model | stopReason | hasText | rejection (persisted `summary`) |
|---|-------|-------------|-----------|---------|----------------------------------|
| 1 | 0 | r9-ninerouter-ag-gemini-3-7-flash-high / ag/gemini-3.7-flash-high | stop | true | `Boss decision action is invalid` |
| 2 | 1 | same | stop | true | `Boss decision summary is missing` |
| 3 | 2 | same | stop | true | `Boss decision action is invalid` |
| 4 | 3 | same | stop | true | `Boss decision summary is missing` |

Visible text lengths were not persisted (diagnostic stores booleans and block
counts only), and RPC mode left no session JSONL. `lastInvocation`
(persisted): `stage=decision-protocol`, `failureClass=decision_protocol`,
`hasText=true`, `normalized=false`, `stopReason=stop`, `code=decision_protocol`,
`fallbackAttempted=false`.

Interpretation of the two alternating rejection messages, against the parse
pipeline order in `parseDecisionText` → `normalizeBossDecision`:

- `Boss decision action is invalid`: JSON extraction and `JSON.parse`
  SUCCEEDED on some candidate; the parsed object's `action` field failed the
  enum check before the summary check. The model emitted parseable JSON with a
  missing or non-enum `action`.
- `Boss decision summary is missing`: JSON extraction and parse SUCCEEDED;
  `action` passed the enum check; `summary` was absent/empty.

So all four failures occurred AFTER successful JSON parse — none was a syntax
error. Two distinct field-level schema violations alternated.

## 3. Contract: what PMO expects

`BOSS_SYSTEM_PROMPT` (boss-prompt.ts) instructs:

- "Return exactly one JSON object and no markdown."
- Schema line: `{action:'dispatch'|'replan'|'complete'|'blocked'|'awaiting_user',summary:string,acceptanceSatisfied?:boolean,requiredFixes?:string[],tasks:[{taskId?:string,roleId:string,executionClass:'investigation'|'implementation'|'verification',poolId?:...,objective:string,acceptanceCriteria?:string[]}]}`
- dispatch / plan-phase replan require at least one task; never return them
  with an empty `tasks` array.

`parseBossAssistantResponse` (boss-response.ts) pipeline:

1. require an object response; `stopReason` gate (aborted/error/pending/deferred).
2. `extractBossAssistantText`: join only `type:"text"` blocks; ignore
   `thinking` and `toolCall` blocks.
3. empty text → `empty_response` / `truncated` / `unsupported_shape` classes.
4. `parseDecisionText`: try `JSON.parse(raw)`, then the fenced-JSON variant,
   then the `raw.indexOf("{")..lastIndexOf("}")` slice. Any
   `BossProtocolError` from `normalizeBossDecision` is rethrown immediately —
   a field-level rejection is NOT retried against other candidates.
5. `normalizeBossDecision` validation order: isRecord → `action` enum →
   `summary` non-empty → `tasks` is array → bounds → `acceptanceSatisfied`
   boolean → `requiredFixes` array → per-task `roleId`/`objective`/
   `executionClass` enum → `poolId` enum → `acceptanceCriteria` shape →
   dispatch/replan require non-empty tasks.

Expected canonical schema (what normalizeBossDecision accepts):

```
{
  "action": "dispatch" | "replan" | "complete" | "blocked" | "awaiting_user",
  "summary": non-empty string,
  "tasks": [
    {
      "taskId"?: string,
      "roleId": non-empty string,
      "executionClass": "investigation" | "implementation" | "verification",
      "poolId"?: one of the three classes,
      "objective": non-empty string,
      "acceptanceCriteria"?: string[]
    }
  ],
  "acceptanceSatisfied"?: boolean,
  "requiredFixes"?: string[]
}
```

## 4. Bounded diagnostic reproduction

One bounded inference was run with the SAME route, SAME `BOSS_SYSTEM_PROMPT`,
SAME `bossInferencePrompt` construction (cycle 0, phase plan, feedback
undefined, canonical projection of a zero-task running mission with the six
labelled acceptance criteria), SAME `completeSimple` call shape as
`invokeBossInference`, and PMO's own `parseBossAssistantResponse` on the
result. Read-only; no store writes.

Result metadata: `stopReason=stop`, `hasText=true`, `textLength=817`,
`textBlocks=1`, `thinkingBlocks=1`, `toolCalls=0`,
usage input 2714 / output 1078 / reasoning 932.

Visible assistant text (safe excerpt, normalized representation):

    (fenced "json" block)
    {
      "tasks": [
        {
          "taskId": "inspect-canonical-project-state",
          "description": "Inspect canonical project-state files ... to
            determine if RC28 is recorded as the public prerelease and RC29
            as an unpublished local development repair.",
          "acceptanceCriteria": [ (the six mission criteria, verbatim) ]
        }
      ]
    }
    (end fence)
    -> skipped: multi-phase planning, add when repository scope exceeds
       single inspection pass.

PMO parse result: `BossProtocolError: Boss decision action is invalid` —
byte-for-byte the same rejection as cycle 0 of the real Mission, and the
diagnostic's bracket-slice extraction independently reproduces
`rejected: Boss decision action is invalid` on the same object.

Field-by-field differential of the reproduced response against the schema:

| check | result |
|-------|--------|
| JSON syntactically valid | YES (after fence-strip / bracket-slice) |
| extraction valid | YES |
| `action` valid | NO — field entirely ABSENT |
| `summary` valid | NO — field entirely ABSENT |
| `tasks` array valid | YES (array of 1) |
| task `roleId` valid | NO — field ABSENT (model used `description` instead) |
| task `executionClass` valid | NO — field ABSENT |
| task `poolId` valid | NO — field ABSENT |
| task `objective` valid | NO — field ABSENT (`description` is not mapped) |
| task `acceptanceCriteria` valid | YES |
| final rejection reason | `Boss decision action is invalid` (first failing check in normalizeBossDecision order) |

The diagnostic response is not merely malformed — it is the wrong document
shape: a task-worksheet with `description`/`taskId`/`acceptanceCriteria`
instead of a decision object with `action`/`summary`/`roleId`/`objective`/
`executionClass`, followed by unstructured prose commentary.

## 5. Root cause classification

Primary class: **C. Model protocol non-compliance**, with the caveat that the
architecture made non-compliance cheap (see class E discussion).

Evidence:

1. The prompt and schema are mutually consistent. `BOSS_SYSTEM_PROMPT`
   states the exact field names (`action`, `summary`, `tasks`, `roleId`,
   `executionClass`, `objective`, `acceptanceCriteria`) and the exact enum
   values, and `normalizeBossDecision` enforces precisely that shape. There
   is no prompt/schema mismatch: every field the normalizer requires is named
   in the prompt, and every field named in the prompt is accepted by the
   normalizer. (Contrast with class B, which requires the prompt to exemplify
   a shape the validator rejects — not the case here.)
2. The parser is not rejecting compliant output. The reproduced response
   genuinely lacks `action`, `summary`, `roleId`, `objective`, and
   `executionClass`. The parser accepts raw JSON, fenced JSON, and
   bracket-slice extraction; tests `parses a normal Pi text JSON decision` and
   `parses fenced JSON from the public text contract` prove compliant shapes
   parse. So class A (parser defect) is excluded — the rejected output was
   unambiguously non-compliant with the documented contract.
3. No truncation. Every stored invocation records `stopReason=stop` with
   `hasText=true`; the diagnostic completed at 817 chars with `stop`. Class D
   is excluded.
4. The model understood the mission (its task text restates the goal
   accurately and copies the six acceptance criteria verbatim) yet omitted
   the decision envelope the prompt explicitly requires. It produced a plan
   worksheet plus prose commentary — semantically useful, protocol-invalid.
   That is the definition of class C: internally consistent prompt/schema,
   repeatedly ignored shape instructions.
5. The alternating rejections across cycles (`action is invalid` vs `summary
   is missing`) show stochastic variance in WHICH required field was omitted,
   not learning. This is also why class E is a legitimate secondary
   observation: the model's output was semantically coherent but the
   free-text channel offers no enforcement, so field omission is a sampling
   lottery. However E is selected as the architectural lesson, not the root
   cause: the root cause of each rejection is the model omitting mandated
   fields (C), and the reason the system had no recourse is that plain-text
   JSON cannot be enforced (E).

## 6. Feedback loop audit

After each protocol failure, `runMissionGoalLoop` builds the corrective
feedback object (boss.ts, recordProtocolFailure path):

    {
      kind: "boss-plan-failure",
      summary: <error message, e.g. "Boss decision action is invalid">,
      protocolFailures: <count>,
      actionablePlanFailures: <count>
    }

This is stored as `lastFeedback`, persisted via `persistState` into
`plan_json.orchestration.lastFeedback`, and passed into the next
`bossInferencePrompt` as `Prior feedback/evidence: ...`. Persistence across
restart is therefore real (readState rehydrates it, bounded to 8192 chars).

Findings:

1. The feedback names the violated FIELD ("action is invalid" / "summary is
   missing") but does not include the expected schema, an example, or the
   list of required fields. It is a one-line pointer, not a repair spec.
2. The persisted `lastFeedback` confirms it was delivered:
   `{kind:"boss-plan-failure",summary:"Boss decision summary is missing",protocolFailures:4,actionablePlanFailures:0}`.
3. Despite feedback being present on cycles 1–3, the failures alternated
   between the SAME two field omissions rather than converging. The model did
   not demonstrate learning from the corrective signal within the 4-cycle
   budget.
4. Was retrying the same prompt four times rational? Partially. A retry with
   corrective feedback is a legitimate first-line strategy for a stochastic
   model. But the loop has no mechanism to ESCALATE: after an identical-class
   failure repeats, it does not (a) restate the full schema, (b) add a
   conforming example, or (c) switch to an enforced-output surface. Retrying
   a free-text instruction that has already failed twice, with only a
   one-line nudge, is low-value. The protocol retry budget should detect
   "same failure class twice" and escalate rather than merely replay.

Conclusion: the feedback channel is correctly persisted and delivered, but it
is too weak to correct a model that is omitting whole schema fields, and the
loop never escalates. This is a control-plane design gap, not a transport
bug.

## 7. Pi 0.84.1 constrained-output API surface (installed-source authority)

Verified against `@earendil-works/pi-ai` 0.84.1 and `@earendil-works/pi-coding-agent`
0.84.1 dist type declarations and API implementations in node_modules:

1. `ModelRuntime.completeSimple(model, context, options)` returns
   `Promise<AssistantMessage>` where `AssistantMessage.content` is
   `(TextContent | ThinkingContent | ToolCall)[]`. Tool calls are
   first-class content blocks with `type: "toolCall"`, `name`, and
   `arguments: Record<string, any>`.
2. `Context` supports `tools?: Tool[]` where `Tool` has `name`,
   `description`, `parameters: TSchema` (TypeBox), and
   `constrainedSampling?: false | ConstrainedSamplingConfig`.
3. `ConstrainedSamplingConfig` supports `type: "json_schema"` with
   `strict: "prefer" | "require"`, or `type: "grammar"` with lark/regex
   variants.
4. Google adapter: `supportsGoogleStrictToolSampling(modelId)` returns true
   for Gemini major version >= 3. When a tool has
   `constrainedSampling: { type: "json_schema" }`, the adapter sends
   `functionCallingConfig.mode = VALIDATED` (Gemini's strict/validated
   function calling). `toolChoice: "any"` maps to `FunctionCallingConfigMode.ANY`
   (force a tool call every turn).
5. OpenAI-completions adapter: `resolveJsonSchemaStrictSampling(tool,
   compat.supportsStrictMode !== false)` sets `strict: true` on the function
   definition when supported. `params.tool_choice` is forwarded from
   `options.toolChoice`.
6. `ModelsSimpleStreamOptions` (the options type PMO's `completeSimple` call
   uses) extends `SimpleStreamOptions` which has `reasoning`, `deferred`,
   `thinkingBudgets` — but NO `responseFormat`, NO `json_schema`, NO
   structured-output field. Structured output on the simple surface is only
   reachable through `Context.tools` + `constrainedSampling`.
7. PMO's NineRouter route resolves as `api: "openai-completions"`
   (src/core/ninerouter/manager.ts line 406, types.ts line 166), so the
   strict-tool-sampling path available to PMO today is the OpenAI-completions
   `strict: true` function-calling path, not the Google-native one.
8. Additional transport facts verified from source:
   - openai-completions `streamSimple` forwards `options.toolChoice` into
     `params.tool_choice`, and `convertTools` emits `strict: true` on a
     tool's function definition unless `compat.supportsStrictMode === false`
     (default is strict-enabled).
   - Google `streamSimple` builds its base via `buildBaseOptions`
     (simple-options.js), which does NOT forward `toolChoice`; forcing a
     tool call on the native Google API therefore requires `stream()` with
     `GoogleOptions`, or a strict-sampling tool which switches the function
     calling mode to VALIDATED.

## 8. Option comparison

| Criterion | 1. Free-form JSON in assistant text (status quo) | 2. JSON-schema structured output | 3. Dedicated submit_boss_decision tool call | 4. Deterministic tolerant parsing of semantic equivalents |
|---|---|---|---|---|
| Schema enforcement | None — prose-level instruction only | Not exposed on `completeSimple` / `ModelsSimpleStreamOptions` in Pi 0.84.1; only reachable via tools | Real: TypeBox `parameters` schema travels in the request; `constrainedSampling: {type:"json_schema"}` yields OpenAI `strict:true` (default) or Gemini VALIDATED mode (Gemini >= 3) | None — still accepts arbitrary shapes |
| Provider compatibility | Universal | N/A (no surface) | Depends on route API: first-class for openai-completions/anthropic/bedrock; Google requires stream-level options; NineRouter proxies must pass `strict`/`tool_choice` through unmodified (unverified for the live gateway — must be probed before relying on it) | Universal |
| Retry behavior | Identical prompt replayed; feedback is one line | N/A | A missing or malformed tool call is a clean, detectable event; retry can re-issue with the same tool definition; field-level violations become structurally impossible when strict sampling is honored | Silently absorbs deviations, converting protocol failures into semantic guessing |
| Hidden reasoning isolation | `thinking` blocks already ignored by extraction | N/A | Tool-call arguments are a distinct content block; thinking stays out of the decision by construction | Same as today |
| Cancellation | AbortSignal via completeSimple options | N/A | Same completeSimple/stream path; unchanged | Same as today |
| Token overhead | Baseline; prompt restates the schema in prose | N/A | Small increase (tool definition serialization); the prose schema in BOSS_SYSTEM_PROMPT can shrink | Baseline |
| Integration complexity | None | N/A | Moderate: new invocation branch in invokeBossInference, tool-call extraction path, fallback to text parsing for routes that ignore tools, and updated tests | Low code effort, high semantic risk |
| One pinned Boss per Mission | Yes | N/A | Yes — the pinned assignment is unchanged; only the response surface changes | Yes |
| Testability | Fixture assistant text | N/A | Fixture toolCall content blocks; deterministic; mirrors existing parse tests | Requires fuzzy fixtures; invites assertion drift |

Notes on rejected options:

- Option 2 as a standalone surface does not exist in Pi 0.84.1 for the simple
  completion path; it collapses into option 3 (tools are the schema surface).
- Option 4 is explicitly not acceptable for a control plane: accepting
  "close enough" prose (e.g. mapping `description` onto `objective`, or
  inferring `action: dispatch` from the mere presence of tasks) would have
  silently accepted this Mission's responses and dispatched a task with no
  roleId/executionClass — weakening validation to paper over non-compliance.
  It may still be legitimate to keep the existing bracket/fence extraction as
  a fallback for routes that cannot tool-call.

## 9. Answers to the Phase 6 questions

- Is the current parser wrong? No. Extraction handles raw, fenced, and
  embedded JSON; normalization enforces exactly the documented schema; the
  four rejections were of genuinely non-compliant objects. Existing tests
  prove compliant shapes (raw and fenced) parse.
- Is the current prompt wrong? Not wrong, but insufficient as the sole
  enforcement mechanism. The schema line is accurate and internally
  consistent with the validator, yet it competes with the model's default
  "plan worksheet" behavior and provides no structural guarantee. A
  prompt-only contract is an instruction, not a protocol.
- Is the model non-compliant? Yes — for this contract. Gemini delivered
  coherent, mission-relevant content while omitting mandated fields
  (`action`, `summary`, and per-task `roleId`/`objective`/`executionClass`)
  across all four cycles despite receiving corrective feedback. Transport,
  auth, and delivery were all healthy.
- Should free-form JSON remain the architecture? No — not as the primary
  control-plane surface. It may remain as a degraded fallback for routes
  without usable tool calling, but a pinned Boss should prefer an enforced
  surface.
- Is Gemini transport/runtime compatible? Yes. Every cycle returned
  stopReason=stop with visible text; the compatibility probe and the
  diagnostic inference both completed cleanly through the same
  ModelRuntime/completeSimple path.
- Is Gemini Boss-protocol compatible? Not via free-form text under this
  prompt. Protocol compatibility must come from the output surface
  (tool-call + json_schema), not from prose compliance.

## 10. Recommended single architectural correction

Move Boss decision capture from free-form assistant text to a dedicated
`submit_boss_decision` tool call with a `constrainedSampling`
`type:"json_schema"` declaration, keeping the current text parser as a
fallback for routes that cannot tool-call.

Concretely (single correction, not a patch series):

1. Define one TypeBox schema for BossDecision matching the existing
   normalizeBossDecision contract (action enum, summary, tasks array with
   roleId/executionClass/objective/acceptanceCriteria, acceptanceSatisfied,
   requiredFixes).
2. In invokeBossInference, pass `context.tools = [submit_boss_decision]`
   with `constrainedSampling: { type: "json_schema", strict: "prefer" }`.
   Extract the decision from the `toolCall` content block's `arguments`
   before falling back to text extraction. Run the same normalizeBossDecision
   over the tool arguments — validation is unchanged, only the source of the
   candidate changes.
3. Keep parseBossAssistantResponse for the text path so non-tool-capable
   routes still work; classify "tool present but model emitted only text" as
   the existing decision_protocol class.

Why this single correction:

- It is the only option where schema enforcement exists in Pi 0.84.1 today
  for PMO's route API (openai-completions strict tools are strict by
  default; Gemini >= 3 gets VALIDATED function calling).
- It makes the observed failure class structurally impossible when the
  provider honors strict sampling: missing `action`/`summary` cannot be
  sampled if the grammar requires them.
- It preserves the pinned-Boss-per-Mission invariant, cancellation, and
  thinking isolation; integration is bounded to the Boss invocation path.
- It is testable deterministically with fixture toolCall blocks, mirroring
  the existing text fixtures.

Prerequisite gate before implementation: one bounded live probe must confirm
the 9Router openai-completions gateway actually honors `strict`/`tool_choice`
for the pinned Gemini route (proxy behavior is unverified). If the gateway
strips or ignores strict tool sampling, the correction falls back to the
text path and the loop must escalate feedback instead.

## 11. Evidence log

- MissionStore (read-only): mission row, plan_json.orchestration,
  mission_events payloads (cycles 0–3, terminal).
- Source: boss-prompt.ts, boss-response.ts, boss.ts, boss-projection.ts,
  acceptance-criteria.ts, host/pi-extension.ts (invokeBossInference),
  host/boss-route-probe.ts, ninerouter/manager.ts.
- Tests: test/boss-response.test.ts, test/boss.test.ts (protocol and
  loop-behavior assertions).
- Pi 0.84.1 installed source: pi-ai types.d.ts (SimpleStreamOptions,
  Tool.constrainedSampling, ConstrainedSamplingConfig, AssistantMessage),
  models.d.ts, api/constrained-sampling.js, api/google-generative-ai.js,
  api/google-shared.js, api/openai-completions.js, api/simple-options.js;
  pi-coding-agent core/model-runtime.d.ts.
- Diagnostic artifacts (outside the repository, deleted after use):
  /tmp/pmo-forensics-inspect.mjs and forensics-diagnostic.tmp.mjs performed
  exactly one bounded inference. No MissionStore writes were performed; the
  store was opened read-only.
