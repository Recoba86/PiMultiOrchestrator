# M12 RC15 external release checklist

Run from a clean checkout. Keep all generated output outside the repository.
The exact candidate identity comes from the generated release manifest.

```sh
npm run check
npm pack --dry-run --ignore-scripts --json
npm run release:candidate -- --output /tmp/pi-m12-rc15-release --force
node scripts/run-release-verification.mjs \
  --output /tmp/pi-m12-rc15-release-final \
  --bundle /tmp/pi-m12-rc15-review-bundle \
  --force
node scripts/create-review-bundle.mjs --verify \
  /tmp/pi-m12-rc15-review-bundle \
  --expected-root-sha256 <independently-supplied-root-sha256>
```

The detached verifier must independently rerun the bound check definition,
package dry-run, Pi `0.84.1` install/upgrade/rollback/rescue lifecycle,
worker-safety probes, all 20 release-integrity attacks, and recursive privacy
and archive checks. The release evidence must report zero failed, cancelled,
skipped, and todo tests.

The `.tgz` is the immutable artifact. Verify its sidecar checksum, then install
the extracted `directory-source/` directory in isolated temporary Pi settings;
direct `.tgz` installation is not a supported Pi `0.84.1` claim. Do not touch
the user's live Pi settings, provider account, Keychain, or credentials.

Before publication, obtain separate authorization for external review,
Planner/manual acceptance, real-provider smoke, human keyboard smoke, npm
publish, tags, GitHub release, and live configuration changes. A passing local
check or detached verifier is not by itself product acceptance or production
readiness.
