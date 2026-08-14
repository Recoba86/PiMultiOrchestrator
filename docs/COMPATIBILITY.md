# M12 RC15 candidate compatibility

This matrix records the local candidate boundary. It is not a live-provider,
public-release, or production-readiness claim. Exact commit, tree, source
digest, artifact SHA-256, and bundle-root SHA-256 belong to the generated
release evidence.

| Dimension | Tested local boundary | Not tested / limitation |
|---|---|---|
| Pi | `@earendil-works/pi-coding-agent@0.84.1` | Other Pi versions |
| Node.js | `v22.23.0` (`>=22.19.0`) | Older Node, Bun, other platforms |
| Package source | RC15 artifact extracted and installed as the verified `directory-source/` directory | Direct `.tgz` through `pi install`, npm registry, git source, public publish |
| Extension load | Unpacked artifact without the source checkout | Live global/project settings |
| Provider | Fake OpenAI-compatible 9Router and zero-paid-inference release probes | Real 9Router/account metadata and provider smoke |
| Persistence | Config schema 2, MissionStore schema 2, Analytics schema 1; backup/restore and M7 quality state exercised | Future schema changes and unbounded external environments |
| Upgrade/rollback | Authentic M10 baseline state preserved through isolated RC15 install, rollback, and rescue | Public package-manager upgrade |
| Platform | Isolated temporary roots on the current macOS development host | Other OSes, remote TUI, human keyboard smoke |

The package has no runtime npm dependencies and declares Pi as a peer
dependency. Runtime databases, credentials, sessions, `.git`, source paths,
and live configuration are outside the package allowlist. M10 remains the
latest accepted milestone; RC15 remains local until independent external
review and Planner/manual acceptance are separately recorded.
