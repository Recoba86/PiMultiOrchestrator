# M11 staged dogfooding log

This is an auditable local record. It contains no prompts, transcripts, tool
output, credentials, or live-provider data.

| Stage | Result | Evidence / boundary |
|---|---|---|
| Stage 0 — repository baseline | PASS | Full rc.4 `npm run check` and exact-Git independent rerun each passed `169/169`; release-integrity attacks `20/20`; Pi `0.84.1`, Node `v22.23.0` |
| Stage 1 — artifact-derived isolated install | PASS | RC `0.1.0-rc.4` artifact SHA-256 `a1e14c83da374c5f6a1b849c589feb444002d46e8a0634c0bbd5d520a539572b` was extracted to a fresh temporary directory and installed/listed with asserted identity/version/source in isolated Pi `0.84.1` settings. Direct `.tgz` installation is unsupported by Pi `0.84.1`. |
| Stage 2 — normal non-destructive Control Center | PASS | Artifact-derived rc.4 loaded `/orchestrator` and Diagnostics with candidate metadata and all twelve sections; authentic M10 commit `c65470c001e539c36f0a53cacd912f48eb05ff7f` created non-empty Config/Mission/Analytics/Trust state; semantic equality held through rc.4 upgrade and M10 rollback; broken-candidate rescue passed; fake gateway/temporary roots only |
| Stage 3 — controlled real-route smoke | NOT AUTHORIZED / NOT PERFORMED | No live route, subscription, paid inference, or credentials used |
| Stage 4 — short operator dogfood | PENDING | Human keyboard smoke, fully independent External Review #5, and Planner acceptance remain open |

Rescue procedure: from the isolated settings, run `pi remove <extracted package
directory>` or disable the package, then reinstall the M10 compatibility
baseline directory. If the
extension cannot load, an external Codex or shell harness can inspect the
repository and package artifact without importing the extension. No automatic
rollback or automatic rerun is implied.
