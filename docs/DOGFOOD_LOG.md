# M11 staged dogfooding log

This is an auditable local record. It contains no prompts, transcripts, tool
output, credentials, or live-provider data.

| Stage | Result | Evidence / boundary |
|---|---|---|
| Stage 0 — repository baseline | PASS | M0–M10 accepted; pre-M11 suite `159/159 PASS`; Pi `0.84.1`, Node `v22.23.0` |
| Stage 1 — artifact-derived isolated install | PENDING RC.3 VERIFICATION | Candidate `0.1.0-rc.3`; exact file count, size, and SHA-256 will be recorded in the generated manifest; checksum-verified `.tgz` must be extracted to a fresh temporary directory, then `pi install <package-dir>`/`pi list` in isolated settings. Direct `.tgz` installation is unsupported by Pi `0.84.1`. |
| Stage 2 — normal non-destructive Control Center | PENDING RC.3 VERIFICATION | The rc.3 artifact-derived installed directory must load `/orchestrator` and Diagnostics with candidate version/schema metadata and all twelve sections; the real M10 baseline commit `c65470c001e539c36f0a53cacd912f48eb05ff7f` must be exercised; seeded Config/Mission/Analytics/Trust state must survive upgrade, rollback, and broken-candidate rescue; fake gateway/temporary roots only |
| Stage 3 — controlled real-route smoke | NOT AUTHORIZED | No live route, subscription, paid inference, or credentials used |
| Stage 4 — short operator dogfood | PENDING PLANNER / HUMAN | Human keyboard smoke, independent external review, and Planner acceptance remain open |

Rescue procedure: from the isolated settings, run `pi remove <extracted package
directory>` or disable the package, then reinstall the M10 compatibility
baseline directory. If the
extension cannot load, an external Codex or shell harness can inspect the
repository and package artifact without importing the extension. No automatic
rollback or automatic rerun is implied.
