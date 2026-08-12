# M11 release-candidate compatibility

This matrix records the tested local release-candidate boundary. A tested row
is not a live-provider or public-release claim.

| Dimension | Tested | Not tested / limitation |
|---|---|---|
| Pi | `@earendil-works/pi-coding-agent@0.84.1` | Other Pi versions |
| Node.js | `v22.23.0` (`>=22.19.0`) | Older Node; standalone/Bun |
| Package source | Verified contents extracted from the exact local `.tgz`, then installed as a local directory with Pi `0.84.1` | Direct `.tgz` through `pi install` (Pi treats it as a loadable file), npm registry, git source, public publish |
| Extension load | Unpacked artifact without the source checkout | Live global/project settings |
| Provider | Fake OpenAI-compatible 9Router only | Real 9Router, subscription/account metadata |
| Persistence | Config schema 2, MissionStore schema 2, Analytics schema 1 retained across candidate install test | Schema migration introduced by M11: none |
| Platform | Current macOS development host, isolated temporary roots | Other OSes/Termius/remote TUI |
| Upgrade | M10 compatibility baseline artifact → verified extracted `0.1.0-rc.1` directory in temporary roots; Config/Mission/Analytics/Trust hashes recorded before and after | Public package-manager upgrade |
| Rollback | Candidate removal → reinstall of the M10 compatibility baseline directory; before/after state hashes and package version are recorded | Rollback across future schema changes |

The package declares Pi as a peer dependency and has no runtime npm
dependencies. Runtime state, databases, credentials, `.git`, source checkout
paths, and session data are outside the package allowlist. A local RC is not a
stable or public release. The release artifact is the immutable `.tgz`; the
local RC install source is a fresh extracted directory derived from and
checksum-verified against that artifact. The source checkout is never the
installed package.
