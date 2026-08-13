# M11 external review bundle

The review bundle is generated outside the checkout from a clean candidate:

```sh
node scripts/run-release-verification.mjs --output /tmp/pi-multi-orchestrator-r8-release-final --bundle /tmp/pi-multi-orchestrator-r8-bundle --force
node scripts/create-review-bundle.mjs --verify /tmp/pi-multi-orchestrator-r8-bundle --expected-root-sha256 <planner-supplied-root-sha256>
```

It contains copies of the exact release `.tgz`, its SHA-256 file, release
manifest, artifact file list, privacy scan, independently rerun test evidence,
compatibility matrix, release checklist, dogfood log, package metadata, exact
Git build commit, upgrade/rollback snapshots, worker-safety evidence, all 20
integrity-attack results, and a canonical recursive file manifest. Review docs,
the root `package.json`, and every nested M10 baseline file are included. Any
symlink or non-regular entry fails closed.

External Review #4 rejected rc.3 for release-evidence integrity defects even
though worker/custom-tool safety independently passed. rc.4 is bound to exact
build commit `ae39f24937988ef95975b2b45c018f4c45efd23c`, source digest
`b91432b23b9fa44b3f1e750ff852ca78369f4f3d4808242841124364a510868b`,
trusted Node/npm/TypeScript/Pi identities, and artifact SHA-256
`a1e14c83da374c5f6a1b849c589feb444002d46e8a0634c0bbd5d520a539572b`.
The bundle cannot authenticate its own coordinated rewrite: the expected root
SHA-256 must arrive independently from the Planner and be passed explicitly to
the verifier. Until a separate reviewer records a result, status remains
`EXTERNAL_REVIEW_PENDING`.

The immutable release artifact is the `.tgz`. For Pi `0.84.1`, a reviewer must
verify the checksum, extract it into a fresh `package/` directory, and run
`pi install <package-dir> --no-approve`; direct `pi install <artifact>.tgz` is
not supported because Pi later tries to load the tarball as JavaScript. The
source checkout is not an installation source.

Review scope: exact-Git package source and allowlist, compiled-entrypoint
independence, trusted tool/test provenance, zero/forged-count rejection,
private-path scanning, recursive no-symlink integrity, external-root mismatch,
authentic M10 state creation and semantic snapshots, actual `pi list` content,
integrated worker pre-tool safety, capture-only protocol enforcement and exact
`submit_evil` regression, isolated install/upgrade/rollback, broken-candidate
rescue, and truthful release-state wording. The next required action is fully
independent External Review #5; Stage 3 real-route smoke is not authorized.
