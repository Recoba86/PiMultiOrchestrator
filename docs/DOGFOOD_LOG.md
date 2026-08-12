# M11 staged dogfooding log

This is an auditable local record. It contains no prompts, transcripts, tool
output, credentials, or live-provider data.

| Stage | Result | Evidence / boundary |
|---|---|---|
| Stage 0 — repository baseline | PASS | M0–M10 accepted; pre-M11 suite `159/159 PASS`; Pi `0.84.1`, Node `v22.23.0` |
| Stage 1 — packaged isolated install | PENDING RUN | Candidate `0.1.0-rc.1`; temporary `HOME`/Pi settings and fake gateway only |
| Stage 2 — normal non-destructive Control Center | PENDING RUN | Packaged `/orchestrator`, dashboard, diagnostics, analytics, and backup views |
| Stage 3 — controlled real-route smoke | NOT AUTHORIZED | No live route, subscription, paid inference, or credentials used |
| Stage 4 — short operator dogfood | PENDING PLANNER / HUMAN | Human keyboard smoke and external harness review remain open |

Rescue procedure: from the isolated settings, run `pi remove <candidate path>`
or disable the package, then restore the prior pinned package. If the
extension cannot load, an external Codex or shell harness can inspect the
repository and package artifact without importing the extension. No automatic
rollback or automatic rerun is implied.
