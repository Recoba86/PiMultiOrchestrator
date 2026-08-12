# M11 external review bundle

The review bundle is generated outside the checkout from a clean candidate:

```sh
node scripts/run-release-verification.mjs --output /tmp/pi-multi-orchestrator-release-r2-final --bundle /tmp/pi-multi-orchestrator-review-r2-final --force
node scripts/create-review-bundle.mjs --release-dir /tmp/pi-multi-orchestrator-release-r2-final --output /tmp/pi-multi-orchestrator-review-r2-final --force
```

It contains copies of the exact release `.tgz`, its SHA-256 file, release
manifest, artifact file list, privacy scan, test evidence, compatibility matrix,
release checklist, dogfood log, package metadata, exact Git HEAD, upgrade/
rollback evidence, and an explicit deterministic bundle-verifier result. The
implementation context does not mark its own review as independent. Until a
separate reviewer/process records a result, the status is
`EXTERNAL_REVIEW_PENDING`.

The immutable release artifact is the `.tgz`. For Pi `0.84.1`, a reviewer must
verify the checksum, extract it into a fresh `package/` directory, and run
`pi install <package-dir> --no-approve`; direct `pi install <artifact>.tgz` is
not supported because Pi later tries to load the tarball as JavaScript. The
source checkout is not an installation source.

Review scope: package manifest and allowlist, compiled-entrypoint independence,
dependency/lifecycle policy, isolated install/upgrade/rollback, persistence
compatibility, rescue path, privacy scan, and truthful release-state wording.
