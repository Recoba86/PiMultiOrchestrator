# M12 final external release review — RC15

Status: `EXTERNAL_REVIEW_PENDING`. RC15 source review is locally green, but the
detached packet gate is still pending. RC15 is local-only and is not an accepted,
public, or production-ready release.

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

Record reviewer identity, separate context/process, result, blocker/high and
medium findings, dispositions, and residual uncertainty in a separate
handoff. Planner/manual acceptance, publication, and production readiness are
separate gates.

Historical M11 and earlier RC evidence remains in Git history and the
append-only development log. It is intentionally not copied into this current
review packet so stale commands, hashes, or candidate headings cannot be
mistaken for RC15 evidence.
