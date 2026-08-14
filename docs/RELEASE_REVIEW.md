# M12 final external release review — RC16

Status: `EXTERNAL_REVIEW_PASS` for the exact detached RC16 local candidate.
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

Historical M11 and earlier RC evidence remains in Git history and the
append-only development log. It is intentionally not copied into this current
review packet so stale commands, hashes, or candidate headings cannot be
mistaken for RC16 evidence.
