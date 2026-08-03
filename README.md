# AI Session Search

English | [简体中文](./README.zh-CN.md)

[![GitHub Release](https://img.shields.io/github/v/release/lililib/ai-session-search)](https://github.com/lililib/ai-session-search/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A local-first, read-only search app for AI coding sessions. It discovers local conversations from
11 coding tools and uses SQLite FTS5 trigram indexing to search natural language, code, paths,
errors, and Session IDs.

![AI Session Search interface](./docs/images/ai-session-search.png)

## Desktop clients

Download from [GitHub Releases](https://github.com/lililib/ai-session-search/releases):

- macOS Apple Silicon: `darwin-arm64.zip`
- macOS Intel: `darwin-x64.zip`
- Windows x64: `AI-Session-Search-Setup.exe`

The desktop client requires no Node.js installation. It displays the interface immediately, scans
sessions in the background, and reports indexing progress. Its database uses the current user's
system application-data directory and contains no developer-specific paths.

Current packages are unsigned, so Gatekeeper or SmartScreen may show a first-launch warning.
**Open in terminal** currently supports macOS only; Windows provides full search, reading,
organization, and resume-command copying.

## Highlights

- Searches across providers, projects, message content, custom titles, and full/partial Session IDs
- SQLite FTS5 trigram indexing for Chinese, Japanese, Korean, English, and code substrings
- Favorites, custom titles, collections, and matching filters
- Copies Session IDs and customizable resume commands
- macOS integration with Terminal, iTerm2, Warp, and custom terminal/shell paths
- Resizable sidebar with persisted width
- Background incremental indexing and filesystem watching
- Automatic English/Simplified Chinese UI; no API key or cloud database required

AI Session Search never modifies source conversations. Titles, collections, settings, and indexes
are written only to its own SQLite database.

## Supported clients

| ID | Client | Default home |
| --- | --- | --- |
| `claude` | Claude Code | `~/.claude` |
| `codex` | Codex | `~/.codex` |
| `antigravity` | Antigravity | `~/.gemini` |
| `opencode` | OpenCode | `~/.local/share/opencode` |
| `hermes` | Hermes | `~/.hermes` |
| `copilot` | GitHub Copilot CLI | `~/.copilot` |
| `droid` | Droid / Factory | `~/.factory` |
| `openclaw` | OpenClaw | `~/.openclaw` |
| `cursor` | Cursor | `~/.cursor` |
| `pi` | Pi | `~/.pi` |
| `kimi` | Kimi Code | `~/.kimi-code` |

Path precedence is: CLI option → `AI_SESSION_*` environment variable → client-native environment
variable → platform default. User home paths are never hardcoded.

## CLI / Web version

Requires Node.js 24+ and pnpm 11:

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm start
```

The default URL is `http://localhost:3411`.

| Option | Environment | Default |
| --- | --- | --- |
| `-p, --port <port>` | `PORT` | `3411` |
| `-h, --hostname <hostname>` | `HOSTNAME` | `localhost` |
| `--claude-dir <path>` | `AI_SESSION_CLAUDE_HOME` / `CLAUDE_CONFIG_DIR` | `~/.claude` |
| `--codex-dir <path>` | `AI_SESSION_CODEX_HOME` / `CODEX_HOME` | `~/.codex` |
| `--provider-dir <provider=path>` | `AI_SESSION_<PROVIDER>_HOME` | Provider default |
| `--data-dir <path>` | `AI_SESSION_DATA_DIR` / `XDG_DATA_HOME` | Platform app data |
| `--providers <ids>` | `AI_SESSION_PROVIDERS` | `auto` |
| `--no-watch` | — | Watching enabled |

Examples:

```bash
corepack pnpm start --providers codex --codex-dir /path/to/codex-home
corepack pnpm start --provider-dir kimi=/custom/kimi --provider-dir pi=/custom/pi
```

## Resume commands

Built-in templates include:

```text
Claude Code: cd {cwd} && claude --resume {sessionId}
Codex:       cd {cwd} && codex resume {sessionId}
```

`{cwd}` and `{sessionId}` are replaced from the session. A template containing only `yolo`
automatically receives the Session ID. macOS terminal execution uses a configurable absolute shell
path with `-lic`, so aliases from files such as `~/.zshrc` are available. iTerm2 opens a tab in the
current window when possible.

## Development and releases

```bash
corepack pnpm dev             # Web development
corepack pnpm desktop:start   # Run Electron
corepack pnpm desktop:make    # Package the current platform
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Pushing a `v*` tag builds macOS arm64, macOS x64, and Windows x64 in GitHub Actions and attaches the
artifacts to a GitHub Release.

## Privacy and license

- Does not read `auth.json`, API keys, or login credentials.
- Never executes commands or tool calls found in session content.
- Terminal resume runs only after a user click and requires a loopback listener.
- Add authentication and network controls before exposing the Web service remotely.

The search architecture is inspired by and adapted from
[d-kimuson/claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer). See
[NOTICE.md](./NOTICE.md). Licensed under the [MIT License](./LICENSE).
