# RC25 public prerelease compatibility

This matrix records the tested public prerelease boundary. It is not a
live-provider or production-readiness claim. Exact source and artifact identity
belong to the RC25 release evidence.

| Dimension | Tested local boundary | Not tested / limitation |
|---|---|---|
| Pi | `@earendil-works/pi-coding-agent@0.84.1` | Other Pi versions |
| Node.js | `v22.23.0` (`>=22.19.0`) | Older Node, Bun, other platforms |
| Package source | Public `npm:pi-multi-orchestrator@0.1.0-rc.25` fresh install and RC24→RC25 upgrade in isolated Pi settings; checksum-derived directory source also passed | Direct `.tgz` through `pi install`, git source |
| Extension load | Public RC25 package without the source checkout | Live global/project settings |
| Provider | Fake OpenAI-compatible 9Router and zero-paid-inference release probes | Real 9Router/account metadata and provider smoke |
| Persistence | Config schema 2, MissionStore schema 2, Analytics schema 1; backup/restore and M7 quality state exercised | Future schema changes and unbounded external environments |
| Upgrade/rollback | Public RC24→RC25 package-manager upgrade plus authentic M10 baseline directory-source rollback/rescue preserved state | Other package versions and external environments |
| Platform | Isolated temporary roots on the current macOS development host | Other OSes, remote TUI, human keyboard smoke |

The package has no runtime npm dependencies and declares Pi as a peer
dependency. Runtime databases, credentials, sessions, `.git`, source paths,
and live configuration are outside the package allowlist. RC25 source commit
is `52b665f6ace6eec078cbe8a28c35cce36a9cb045`, tag is `v0.1.0-rc.25`, and
artifact SHA-256 is
`32a8a9f1f968ff4bacf38385afd52869c4c793480e63f4335507ffd11a2a7ec5`.
M10 remains the latest accepted development milestone; RC25 is a public
prerelease, not a stable or production release.
