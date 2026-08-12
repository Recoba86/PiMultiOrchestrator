# M11 external review bundle

The review bundle is generated outside the checkout from a clean candidate:

```sh
node scripts/create-review-bundle.mjs --release-dir /tmp/pi-multi-orchestrator-release
```

It contains the release manifest, checksum, artifact file list, compatibility
matrix, release checklist, dogfood log, and an explicit review prompt. The
implementation context does not mark its own review as independent. Until a
separate reviewer/process records a result, the status is
`EXTERNAL_REVIEW_PENDING`.

Review scope: package manifest and allowlist, compiled-entrypoint independence,
dependency/lifecycle policy, isolated install/upgrade/rollback, persistence
compatibility, rescue path, privacy scan, and truthful release-state wording.
