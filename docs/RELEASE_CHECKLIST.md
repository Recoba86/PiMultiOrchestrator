# M11 release-candidate checklist

Run from a clean `main` checkout. All output belongs outside the repository.

```sh
npm install
npm run typecheck
npm test
npm run check
npm run build
npm pack --dry-run
npm run release:candidate -- --output /tmp/pi-multi-orchestrator-release --force
node scripts/verify-pi-release.mjs --release-dir /tmp/pi-multi-orchestrator-release
node scripts/run-release-verification.mjs --output /tmp/pi-multi-orchestrator-release-final --bundle /tmp/pi-multi-orchestrator-review-final --force
node scripts/create-review-bundle.mjs --verify /tmp/pi-multi-orchestrator-review-final --expected-root-sha256 <planner-supplied-root-sha256>
```

Then verify the generated `release-manifest.json`, checksum, sorted file list,
and unpacked compiled entrypoint. Reject artifacts containing secrets, local
absolute paths, `.git`, `node_modules`, runtime databases, sessions, or source
checkout files. Import the unpacked entrypoint with Node while the checkout is
absent.

The `.tgz` is the immutable release artifact, not a Pi local install source.
Verify its SHA-256, extract it into a fresh temporary directory, and install
that extracted `package/` directory. With isolated `HOME`,
`PI_CODING_AGENT_DIR`, session/config roots, the verified workflow is:

```sh
shasum -a 256 -c pi-multi-orchestrator-0.1.0-rc.4.tgz.sha256
rm -rf /tmp/pi-multi-orchestrator-rc4-package
mkdir -p /tmp/pi-multi-orchestrator-rc4-package
tar -xzf pi-multi-orchestrator-0.1.0-rc.4.tgz -C /tmp/pi-multi-orchestrator-rc4-package
pi install /tmp/pi-multi-orchestrator-rc4-package/package --no-approve
pi list
```

Then run clean startup, `/orchestrator`, Diagnostics, upgrade, rollback,
remove, and reinstall using the extracted directory. Direct `pi install
<artifact>.tgz` is unsupported on Pi `0.84.1` and MUST NOT be documented as a
working path. Do not touch the user's live Pi settings. The external rescue
path is independent of the extension: remove or disable the candidate in the
isolated settings, reinstall the M10 compatibility baseline directory, or use
an external Codex/harness to inspect and repair the repository.

Before any future publication, obtain separate authorization for real-route
smoke, human keyboard smoke, independent external review, npm publish, tags,
GitHub releases, and live configuration changes. M11 remains implemented but
not accepted until those applicable gates are closed by the Planner.

The rc.4 gate also requires exact-Git source staging, trusted absolute
Node/npm/TypeScript/Pi identities, an independent rerun of the bound check
definition, strict non-zero totals (`169/169` with no failures/cancellations),
clean privacy evidence, and integrated worker pre-tool denial for blocked
paths, unsafe commands, and role/profile-expanding tools. A fake executable
earlier on `PATH` must not control release evidence. All 20 mandatory integrity
attacks must be rejected, all symlinks must fail closed, authentic M10-created
state must survive rc.4 upgrade and M10 rollback, and the complete recursive
bundle must verify against the expected root SHA supplied outside the bundle.
The `submit_evil` regression and capture-only protocol checks remain required.
