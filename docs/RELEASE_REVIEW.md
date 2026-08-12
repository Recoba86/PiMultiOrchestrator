# M11 external review bundle

The review bundle is generated outside the checkout from a clean candidate:

```sh
node scripts/run-release-verification.mjs --output /tmp/pi-multi-orchestrator-r6-release-final --bundle /tmp/pi-multi-orchestrator-r6-bundle --force
node scripts/create-review-bundle.mjs --release-dir /tmp/pi-multi-orchestrator-r6-release-final --output /tmp/pi-multi-orchestrator-r6-bundle --force
```

It contains copies of the exact release `.tgz`, its SHA-256 file, release
manifest, artifact file list, privacy scan, test evidence, compatibility matrix,
release checklist, dogfood log, package metadata, exact Git HEAD, upgrade/
rollback evidence, and an explicit deterministic bundle-verifier result. The
implementation context does not mark its own review as independent. The current
offline rc.3 evidence must be bound to the clean source commit/tree/build digests,
trusted Node/npm/Pi executable identities, and artifact checksum recorded in
the generated manifest. It also includes machine-checked worker-safety evidence
for the Pi `0.84.1` `submit_evil` regression, capture-only protocols, and the
effective tool inventory. Until a
separate reviewer/process records a result, the status is
`EXTERNAL_REVIEW_PENDING`.

The immutable release artifact is the `.tgz`. For Pi `0.84.1`, a reviewer must
verify the checksum, extract it into a fresh `package/` directory, and run
`pi install <package-dir> --no-approve`; direct `pi install <artifact>.tgz` is
not supported because Pi later tries to load the tarball as JavaScript. The
source checkout is not an installation source.

Review scope: package manifest and allowlist, compiled-entrypoint independence,
trusted tool provenance, source/build identity, strict test-total parsing,
integrated worker pre-tool safety, capture-only protocol enforcement and exact
`submit_evil` regression, isolated install/upgrade/rollback, seeded persistence
compatibility, broken-candidate rescue path, privacy scan, and truthful
release-state wording.
