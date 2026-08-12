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
```

Then verify the generated `release-manifest.json`, checksum, sorted file list,
and unpacked compiled entrypoint. Reject artifacts containing secrets, local
absolute paths, `.git`, `node_modules`, runtime databases, sessions, or source
checkout files. Import the unpacked entrypoint with Node while the checkout is
absent.

Use an isolated `HOME`, `PI_CODING_AGENT_DIR`, session directory, config root,
and fake gateway for `pi install <artifact>`, `pi list`, clean startup,
`/orchestrator`, upgrade, and rollback. Do not touch the user's live Pi
settings. The external rescue path is independent of the extension: disable or
remove the candidate in the isolated settings, select the prior pinned package,
or use an external Codex/harness to inspect and repair the repository.

Before any future publication, obtain separate authorization for real-route
smoke, human keyboard smoke, independent external review, npm publish, tags,
GitHub releases, and live configuration changes. M11 remains implemented but
not accepted until those applicable gates are closed by the Planner.
