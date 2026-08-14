# M11 staged dogfooding log

This is an auditable local record. It contains no prompts, transcripts, tool
output, credentials, or live-provider data.

## M12.3 — Adaptive Routing Memory closeout

- **Date:** 2026-08-14.
- **Candidate:** `pi-multi-orchestrator@0.1.0-rc.12`, local source candidate only; detached RC.12 verifier passed against exact Git source commit `f077ae90ffe95187f821a64dd08cc8cc7e15b166`.
- **Environment:** Pi `0.84.1`, `--offline`, fake 9Router fixture, disposable agent/session/project roots, and the compiled extension. No live Pi configuration, provider account, credential value, public release, or external provider call was used.
- **Real isolated RPC/TUI path:** A complex English prompt selected `Always orchestrate similar tasks`, creating exactly one canonical Mission and an explicit rule. A semantically similar Persian prompt then auto-routed to one canonical Mission without a second confirmation. Routing & Fallback showed `Routing Memory (ON)` and `Learn from routing choices (ON)`; Learned Behaviors exposed the abstract rule, and disabling it persisted `enabled: false`. A risky escalation was not silently auto-routed, and a restart preserved the Mission/control-center path.
- **Sanitized evidence IDs:** first Mission `mission-32c154d2-8105-46c0-a16c-0d009ec12c73`; follow-up Mission `mission-acfb193b-aee9-4938-bafa-f579b41203e7`; explicit rule `rm-1b480f08-0135-4d40-a870-155835a95f9d`. The stored sidecar contained neither tested prompt, Persian text, nor provider data; fake provider chat requests were `0`.
- **Deterministic/host coverage:** Routing Memory `14/14`, Smart Router `28/28`, and provider host `25/25` cover repeated Mission/Normal learning, confidence/provenance, conflict and complexity gates, settings/persistence/migration/corruption, backup/restore, telemetry privacy, M12.1/M12.2 preservation, and canonical Mission/no-loop behavior.
- **Result:** Isolated M12.3 dogfood `1/1 PASS`; detached RC.12 verification passed `211/211` tests and `20/20` integrity attacks. M12.3 is COMPLETE / LOCAL PASS only. The M12 Final Routing Gate, focused independent review, Planner/manual acceptance, and publication remain separate gates.
- **Detached verifier:** Artifact SHA-256 `b5de508bf7c47cccd894a12c4c74c6e123f292d7b8e839471c70f51073446670`; source digest `ebc5aa2bd3969c6e13155f9e264bbd8e33bf1e01a34cdbde033deec668ace657`; review-bundle root SHA-256 `c02c72dc5042d3dc02c6b66cb03afa1f8e0a89f2f1a477bae05e3e28dba58cfe`; Pi `0.84.1` install/upgrade/rollback, privacy, and worker-safety evidence passed with zero live/paid calls.

| Stage | Result | Evidence / boundary |
|---|---|---|
| Stage 0 — repository baseline | PASS | Full rc.4 `npm run check` and exact-Git independent rerun each passed `169/169`; release-integrity attacks `20/20`; Pi `0.84.1`, Node `v22.23.0` |
| Stage 1 — artifact-derived isolated install | PASS | RC `0.1.0-rc.4` artifact SHA-256 `a1e14c83da374c5f6a1b849c589feb444002d46e8a0634c0bbd5d520a539572b` was extracted to a fresh temporary directory and installed/listed with asserted identity/version/source in isolated Pi `0.84.1` settings. Direct `.tgz` installation is unsupported by Pi `0.84.1`. |
| Stage 2 — normal non-destructive Control Center | PASS | Artifact-derived rc.4 loaded `/orchestrator` and Diagnostics with candidate metadata and all twelve sections; authentic M10 commit `c65470c001e539c36f0a53cacd912f48eb05ff7f` created non-empty Config/Mission/Analytics/Trust state; semantic equality held through rc.4 upgrade and M10 rollback; broken-candidate rescue passed; fake gateway/temporary roots only |
| Stage 3 — controlled real-route smoke | PASS | RC.7 explicit supported-route Implementation + M7 Verification path passed; route-specific compatibility limits remain documented |
| Stage 4A — autonomous Computer-Use dogfood | PASS | RC.8 disposable-root Mission → Task → Implementation → normal Verify path passed on `9router/ag/claude-opus-4-6-thinking`; final human sanity, External Review #5, and Planner acceptance remain open |

Rescue procedure: from the isolated settings, run `pi remove <extracted package
directory>` or disable the package, then reinstall the M10 compatibility
baseline directory. If the
extension cannot load, an external Codex or shell harness can inspect the
repository and package artifact without importing the extension. No automatic
rollback or automatic rerun is implied.

## M11 Stage 4A — autonomous Computer-Use dogfood closeout

- **Date:** 2026-08-14.
- **Candidate:** `pi-multi-orchestrator@0.1.0-rc.8`, installed from the checksum-derived `directory-source/` in Pi `0.84.1`; artifact SHA-256 `8fd4b233f7ee3d22ac0ac5703078ab165b55ba11a3978ae94a1f21039b746f28`.
- **Offline boundary:** RC.8 release evidence remained authoritative: `175/175 PASS`, `20/20` integrity attacks, typecheck/build/check, package/provenance/privacy, Pi compatibility/install/rollback/rescue, and worker-safety evidence all passed. No source fix or RC regeneration was needed.
- **Environment:** Termius, real Pi TUI, temporary project `/private/tmp/pi-m11-stage4-dogfood`, and a trusted disposable project root. The live credential was resolved from Keychain into process memory only; it was not displayed or persisted.
- **Mission path:** Mission `mission-049cbd67-01d6-40bf-a103-3c31267d71ec` created Task `task-e44240e9-a662-45fc-9a48-2e7c9dab31e1`. The real Implementation run `attempt-8c6df7fb-68c9-471b-9246-33e038af3a34` completed on `r9-ninerouter-ag-claude-opus-4-6-think-fe2f756e1d848cbb05ca` / `ag/claude-opus-4-6-thinking`, producing the requested `m7-dogfood.json` only.
- **M7 path:** the normal task Verify action used the Verification Pool and QualityService. Verification `verification-a4855595-3a1f-4d10-925c-d30d523d98eb` completed at round 0; bounded `submit_verification_result` capture was valid; decision `decision-e87d80b4-8654-4368-86af-987465bbe521` was `pass`; task quality status became `passed`; escalation count was zero.
- **Independent checks:** `m7-dogfood.json` parsed exactly as `{"status":"ok","stage":"M11","verification":"m7"}`. The temporary root contained only the pre-existing files plus the requested fixture, and the reviewer reported no unexpected mutation. No fallback, retry, repair, analyst, hidden inference, or live Pi configuration mutation occurred.
- **Visible result:** the normal Pi task detail and Quality history showed `quality status: passed`, one completed verification run, one pass decision, and zero escalations; Diagnostics showed candidate RC.8, TRUSTED disposable root, active application-level policy, healthy Mission/Analytics DBs, and healthy observed route.
- **Final state:** autonomous Stage 4A is PASS. Human sanity smoke is still PENDING; M11 remains IMPLEMENTED BUT NOT ACCEPTED, not production-ready, local-only, and unpublished.

## M12.1 — frictionless Mission entry closeout

- **Date:** 2026-08-14.
- **Candidate:** `pi-multi-orchestrator@0.1.0-rc.9`, implementation commit `ad39a8f`; the candidate remains local and unpublished.
- **Environment:** real Pi `0.84.1`, offline mode, disposable project `/private/tmp/pi-m12-entry-dogfood`, and disposable config roots under `/private/tmp/pi-m12-ui-*`. The Computer Use connector could not target Terminal, so an equivalent isolated PTY run loaded the compiled extension; no live provider, credential, user Pi configuration, or external service was touched.
- **Mission entry:** `@orchestrator` created English Mission `mission-68626594-683d-4b3a-a273-b9e1a9b83df5` and Persian Mission `mission-40224d4f-55d5-4cb6-9cad-0fe7c8eca6ea`; both persisted as `draft` with the disposable repository cwd. `/missions <id>` rendered the stored goal/status/repository, and the store contained exactly those two Missions with zero Tasks.
- **Boundary checks:** an ordinary prompt continued to Pi and reached the expected no-API-key error in the offline/no-model environment; empty `@orchestrator` showed `Add a goal after @orchestrator.`; Control Center → Context & Mission Settings showed `Direct Workers`, and Back navigation returned to the parent menus. Deterministic tests covered the canonical M7/direct-worker boundary.
- **Offline evidence:** final typecheck/build/check and full `177/177` tests passed; release verification passed with `20/20` integrity attacks and independent bundle verification reported `EXTERNAL_REVIEW_PENDING`.
- **Final state:** M12.1 is COMPLETE / LOCAL PASS only. M10 remains the latest accepted milestone; independent review, Planner/manual acceptance, and publication remain open, and M12.2/M12.3/final routing gate are not started.

## Correction — M12.2 live Smart Router dogfood

- **Date:** 2026-08-14.
- The M12.1 entry above is historical and is not rewritten. M12.2 was
  subsequently implemented and locally passed; its current evidence is in
  [`M12.2_DOGFOOD.md`](M12.2_DOGFOOD.md).
- The bounded follow-up used disposable roots and the secure Pi auth bridge to
  exercise English and Persian ambiguous triage, capability-only fallback,
  selected-route telemetry, and both-route-unavailable degradation. No live Pi
  configuration, credential value, provider account, or public release state
  was modified.
