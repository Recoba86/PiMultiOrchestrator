# M11 staged dogfooding log

This is an auditable local record. It contains no prompts, transcripts, tool
output, credentials, or live-provider data.

| Stage | Result | Evidence / boundary |
|---|---|---|
| Stage 0 — repository baseline | PASS | M0–M10 accepted; pre-M11 suite `159/159 PASS`; Pi `0.84.1`, Node `v22.23.0` |
| Stage 1 — artifact-derived isolated install | PASS (directory-source workflow) | Candidate `0.1.0-rc.1`, 103 files, 155072 bytes, SHA-256 `48bd2762e3396eb1b274e8b2bff756ef6d107fa2ca6b89e3980c9c0e35679005`; checksum-verified `.tgz` extracted to a fresh temporary directory, then `pi install <package-dir>`/`pi list` in isolated settings. Direct `.tgz` installation is unsupported by Pi `0.84.1`. |
| Stage 2 — normal non-destructive Control Center | PASS (directory-source workflow) | The artifact-derived installed directory loaded `/orchestrator` and Diagnostics with candidate version/schema metadata, dashboard, and all twelve sections; baseline upgrade, candidate removal, reinstall, rollback hashes, and rescue all passed; fake gateway/temporary roots only |
| Stage 3 — controlled real-route smoke | NOT AUTHORIZED | No live route, subscription, paid inference, or credentials used |
| Stage 4 — short operator dogfood | PENDING PLANNER / HUMAN | Human keyboard smoke and independent Review #2 remain open |

Rescue procedure: from the isolated settings, run `pi remove <extracted package
directory>` or disable the package, then reinstall the M10 compatibility
baseline directory. If the
extension cannot load, an external Codex or shell harness can inspect the
repository and package artifact without importing the extension. No automatic
rollback or automatic rerun is implied.
