# AgentOS

A unified, purpose-built interface to interact with agents safely.

AgentOS is a desktop app for working with Claude agents the way you work with people: in
conversations you can read. Agents are mentioned by name, act one at a time, and everything they do
is an entry in the thread, tool calls included, with their input and output shown rather than
narrated. Nothing an agent touches sits outside a boundary you granted it.

- **Workspaces** are hard boundaries. Agents, tools, data sources and conversations belong to one
  workspace, and nothing crosses between them.
- **Conversations** are threads shared by you and any agents you mention. The thread is the record:
  append-only, one writer at a time, and readable forever.
- **Tools** are narrow capabilities, never a shell. File, git and mount tools ship with the app;
  script tools are JavaScript functions you write in the app itself.
- **Permissions** are per agent and per tool: allow, ask, or deny. An ask call waits in the thread
  for you to approve or refuse it, with the reason the agent gave.
- **Mounts** attach a directory, a git repository or the workspace's own conversations into a
  conversation's sandbox. Isolated git mounts get their own worktree, so parallel conversations
  never collide, and work leaves through a branch you push.

The complete specification of how AgentOS behaves is [docs/overview.md](docs/overview.md). It is the
source of truth: the code follows it, not the other way round.

## Requirements

- **Claude Code**, installed and signed in. AgentOS drives the Claude Code on your machine and uses
  its credentials, exactly as it uses your machine's git. Get it from
  [claude.com/download](https://claude.com/download). If AgentOS cannot find it, it says so at the
  top of the window.
- **git**, for git mount sources. Cloning, pulling and pushing use your machine's git configuration
  and keys, so a repository you can clone in a terminal is one AgentOS can clone.

## Install

Download the build for your platform from the
[latest release](https://github.com/protoku/agentos/releases/latest).

| Platform | File |
| --- | --- |
| Linux | `AgentOS-<version>.AppImage`, or `agentos_<version>_amd64.deb` |
| Windows | `AgentOS-Setup-<version>.exe` |
| macOS | `AgentOS-<version>-arm64.dmg` for Apple silicon, `AgentOS-<version>.dmg` for Intel |

Releases are not code signed yet, so the first launch needs one extra step:

- **macOS** reports that the app is damaged. Right-click the app and choose Open, or run
  `xattr -dr com.apple.quarantine /Applications/AgentOS.app`.
- **Windows** shows a SmartScreen warning. Choose More info, then Run anyway.
- **Linux** has nothing to click through. Make the AppImage executable with `chmod +x` if your
  file manager has not.

## Build from source

```sh
npm install
npm run dev            # run the app
npm test               # the suite
npm run typecheck      # both tsconfigs
npm run dist:linux     # a build for your platform: dist:win, dist:mac
```

Packages land in `release/`. A platform's installer can only be built on that platform, which is why
releases are produced by CI on three runners.

## How it is put together

Electron with TypeScript throughout, React and shadcn/ui in the renderer, and the
[Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) driving turns. Everything
is stored locally: workspaces as JSON, conversations as JSONL files with one entry per line, written
only once an entry is final. Mounts are symlinks and git worktrees.

`docs/overview.md` describes behavior and never implementation. `ARCHITECTURE.md` does not exist yet;
the source tree is small enough to read.

## Contributing

Behavior changes start in `docs/overview.md` and reach the code second. If the doc does not answer a
question the code needs answered, that is a gap in the doc, not a decision to make in code.

## Licence

MIT. See [LICENSE](LICENSE).
