# M11 release-candidate compatibility

This matrix records the tested local release-candidate boundary. A tested row
is not a live-provider or public-release claim.

| Dimension | Tested | Not tested / limitation |
|---|---|---|
| Pi | `@earendil-works/pi-coding-agent@0.84.1` | Other Pi versions |
| Node.js | `v22.23.0` (`>=22.19.0`) | Older Node; standalone/Bun |
| Package source | Local `.tgz` through `pi install` in isolated settings | npm registry, git source, public publish |
| Extension load | Unpacked artifact without the source checkout | Live global/project settings |
| Provider | Fake OpenAI-compatible 9Router only | Real 9Router, subscription/account metadata |
| Persistence | Config schema 2, MissionStore schema 2, Analytics schema 1 retained across candidate install test | Schema migration introduced by M11: none |
| Platform | Current macOS development host, isolated temporary roots | Other OSes/Termius/remote TUI |
| Upgrade | M10-compatible package representation to `0.1.0-rc.1` in temporary roots | Public package-manager upgrade |
| Rollback | Temporary candidate removal and prior accepted package representation | Rollback across future schema changes |

The package declares Pi as a peer dependency and has no runtime npm
dependencies. Runtime state, databases, credentials, `.git`, source checkout
paths, and session data are outside the package allowlist. A local RC is not a
stable or public release.
