# M12 final Planner/manual acceptance — RC17

Status: `PMO_FINAL_PLANNER_ACCEPTANCE_PASS`. RC17 is locally accepted for the
final Planner/manual mission, but it is not a public or production release.

The source-bound candidate is `pi-multi-orchestrator@0.1.0-rc.17`. The smallest
source correction bounds reviewer inspection to `ls`/`read`, stops on an
inspection-tool error, and requires the reviewer to submit one structured M7
result. A deterministic provider-host assertion covers that instruction.

Evidence binding:

- source commit: `5def791b31a7ad940ed87f6e720aabb0228500e7`
- source tree: `c23424f26600e988e6d96cbd794a0d22cc121ecd`
- source digest: `04935d63c419c56c4c9b92214abf06d4151bfe13ebc7a255b08475895c7d7f2c`
- build digest: `aaefde527e8f18a6accbd1dc79e9fffb87ae0f6df832c876911a4cd509373b58`
- artifact SHA-256: `2a9343de7b456840ebdd596ef14c674a51abdad65e3e840b6a29b760e9aa5b62`
- independently verified bundle-root SHA-256: `f5f58cdf255580b4cdd772b0b5885fde531232fc4130b7e352972fe7be9b9bcf`
- results: `231/231` tests, `20/20` integrity attacks, worker safety, privacy,
  Pi `0.84.1` compatibility/install/upgrade/rollback/rescue, and clean source
  identity

Live final-gate evidence:

- Mission `mission-b5a2cc76-d2b1-41d4-9c31-a922e7727d53` → Task
  `task-2b48f5e6-d3d2-4282-8318-6259a1a4e399` → Implementation attempt
  `attempt-783ba966-d696-4dfd-9230-f7094c8bedae` completed on the explicit ag
  route and created exact `rc17-smoke.json` with no other project file.
- Verification `verification-f5ea93ba-deea-41c3-a6ae-8c9d009102a4` completed
  at round 0; reviewer run `run-msthhb41-1` captured one valid structured
  submission; decision `decision-30772023-ebec-4ce9-a2cf-ba90e4e191c1` was
  `pass`. Four criteria were satisfied, `ls`/`read` mechanical checks passed,
  and reviewer potential mutation was false.
- Isolated offline Pi `0.84.1` technical TUI passed the dashboard, Routing &
  Fallback, Missions, Back navigation, clean exit, and no credential text.

No live Pi configuration, provider account, Keychain value, public tag, push,
npm publication, GitHub release, or production installation was modified.
Disposable evidence paths are intentionally omitted.

## Historical M12 final external release review — RC16

Status: `EXTERNAL_REVIEW_PASS`; final Planner/manual acceptance attempt
`HARD_BLOCKED` for the exact detached RC16 local candidate.
RC16 is not an accepted, public, or production-ready release.

The reviewer must inspect the exact detached candidate identified by
`release-manifest.json`, `verification.json`, the artifact checksum sidecar,
and the separately supplied review-bundle root SHA-256. Do not infer release
identity from this document alone.

Required independent checks:

- exact Git commit/tree/source digest and package version/artifact binding;
- clean `npm run check`, strict zero failed/cancelled/skipped/todo TAP counts,
  typecheck, build, and package dry-run evidence;
- all 20 release-integrity attacks, recursive privacy/no-symlink checks, and
  worker-safety evidence;
- Pi `0.84.1` directory-source install, upgrade, rollback, rescue, and state
  preservation against the authentic M10 baseline;
- routing, Mission/M7 target binding, cancellation, recovery, Unicode, and
  Direct Worker versus canonical Mission boundaries;
- exact worker safety at the Pi hook: shell/glob/recursive-read rejection,
  bounded descendant privacy/symlink scanning, no npm lifecycle allowlist, and
  no worker Git content inspection;
- no live Pi/provider/Keychain access, public tag/push, npm publication, or
  GitHub release as part of this local review.

The `.tgz` is the immutable artifact. Pi `0.84.1` must install the verified
extracted `directory-source/` directory; direct `.tgz` installation is not a
supported claim. The review bundle is audit material, not its own trust root:
the expected bundle-root digest must arrive independently.

Final disposition on 2026-08-14: PASS. The exact detached verifier passed the
source-bound check, artifact/package binding, privacy scan, Pi `0.84.1`
install/upgrade/rollback/rescue, worker-safety regression, and `20/20`
integrity attacks. The M12.1 entry-preservation repair, canonical completion
and M7 evidence checks, corrupt-state recovery, Unicode/input bounds, worker
timeout ceilings, and validated TypeScript launcher provenance are included.
The embedded bundle review marker remains `EXTERNAL_REVIEW_PENDING` by design:
the bundle is audit material and its root digest is checked separately; it is
not the trust root. Planner/manual acceptance and publication remain separate.

Evidence binding:

- source commit: `1ffcbed8d776c4d0379a6bf7f832967fae7dbb99`
- source tree: `0e7e01ff02abf269891fc55556d57e64d5a1f111`
- source digest: `7dd0e1c84ad6e980a19269eafddf1f1501cc1aa1f9cf330afca172584daa1b87`
- build digest: `3c7cc151497cb596fe01fe1075d97e3534d418707b250e9bd8edd3b655a5a756`
- artifact: `pi-multi-orchestrator-0.1.0-rc.16.tgz`
- artifact SHA-256: `72073e109df5a0d6b6e0f4be9f825932a768791d0752976c99aabc83eb4bcd7a`
- independently verified bundle-root SHA-256: `6414f090c54caf4004fe62a6d51fe4e9d0df562b662a7091c9f68767901bb675`
- results: `231/231` tests, `20/20` integrity attacks, worker-safety `1/1`, privacy clean, Pi `0.84.1`, live calls `0`, paid inference `0`

Final Planner/manual acceptance attempt on 2026-08-15: HARD BLOCKED. In a
disposable root, the single configured Implementation/Verification route
completed the Implementation leg and created the exact smoke JSON, but two
same-route canonical M7 reviewer attempts stopped before a valid
`submit_verification_result` capture. Both were blocked without observed
mutation or a quality decision. Isolated offline Pi `0.84.1` technical TUI
sanity passed, and no live Pi configuration or provider account was modified.
This result does not alter the detached RC16 identity above and does not
authorize publication.

Historical M11 and earlier RC evidence remains in Git history and the
append-only development log. It is intentionally not copied into this current
review packet so stale commands, hashes, or candidate headings cannot be
mistaken for RC16 evidence.
