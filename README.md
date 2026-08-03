# AI Session Search

English | [简体中文](./README.zh-CN.md)

A local-first, read-only search and viewer for AI coding sessions. It automatically discovers
Claude Code and Codex conversations and indexes them with SQLite FTS5 trigram search, making it
easy to find natural language, code identifiers, file paths, and error messages.

## Features

- Automatically discovers Claude Code and Codex sessions
- Searches across all providers or filters by provider and project
- Full-text search powered by SQLite FTS5 trigram indexing
- Substring fallback for two-character Chinese queries
- Read-only conversation viewer with matched-message navigation
- Custom session titles
- Favorite and renamed-session filters
- Searches custom titles while preserving and displaying original titles
- Creates, renames, and deletes local collections
- Organizes sessions into collections or filters uncategorized sessions
- Copies Session IDs and resume commands
- Supports provider-specific custom resume command templates
- Automatically selects English or Simplified Chinese from browser language preferences
- Reindexes sessions automatically when source files change
- Requires no Anthropic API, OpenAI API, or cloud database

AI Session Search never modifies Claude Code or Codex session files. Custom titles, favorites,
collections, settings, and the search index are stored only in the application's own SQLite
database.

## Copy and resume commands

Open a session to copy its Session ID or a complete resume command. The default templates are:

```text
Claude Code: cd {cwd} && claude --resume {sessionId}
Codex:       cd {cwd} && codex resume {sessionId}
```

`{cwd}` is replaced with the project directory recorded by the session, and `{sessionId}` is
replaced with the source Session ID. Templates are stored separately for each provider in the
application database. A custom prefix such as `yolo` is also valid and produces
`yolo <session-id>`.

## Automatic discovery and configuration

Paths are resolved using the following precedence:

| Data | CLI option | Application environment | Native environment | Default |
| --- | --- | --- | --- | --- |
| Claude Code | `--claude-dir` | `AI_SESSION_CLAUDE_HOME` | `CLAUDE_CONFIG_DIR` | `~/.claude` |
| Codex | `--codex-dir` | `AI_SESSION_CODEX_HOME` | `CODEX_HOME` | `~/.codex` |
| Application data | `--data-dir` | `AI_SESSION_DATA_DIR` | `XDG_DATA_HOME` | Platform application data directory |

Claude Code discovery:

```text
<claude-home>/projects/**/*.jsonl
```

Codex discovery:

```text
<codex-home>/sessions/**/*.jsonl
<codex-home>/archived_sessions/**/*.jsonl
```

`history.jsonl` and `session_index.jsonl` are not used as session discovery sources. Codex
`session_index.jsonl` is used only to enrich titles for sessions that were already discovered.

## Internationalization

The interface uses Lingui and automatically selects a locale from browser language preferences:

- `zh-*`: Simplified Chinese
- `en-*`: English
- Any other language: English fallback

Locale detection and translation catalogs live in `src/client/i18n/`. To add a language, create
its catalog and register its language-tag mapping in `localeDetection.ts`.

## Local development

Requirements:

- Node.js 24 or later, for the built-in `node:sqlite` module
- pnpm 11

```bash
corepack pnpm install
corepack pnpm dev
```

Development servers:

- Frontend: http://localhost:3410
- Backend: http://localhost:3411

Production build:

```bash
corepack pnpm build
corepack pnpm start
```

Enable only Codex and provide custom directories:

```bash
corepack pnpm start -- \
  --providers codex \
  --codex-dir /path/to/codex-home \
  --data-dir /path/to/app-data
```

Disable file watching:

```bash
corepack pnpm start -- --no-watch
```

## Validation

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

## Privacy boundaries

- The index stays entirely on the local device.
- The application does not read `auth.json`, API keys, or login credentials.
- It copies resume commands but never executes, sends, resumes, or continues sessions.
- It never executes commands or tool calls found in session content.
- Add authentication and network access controls before exposing the service remotely. By
  default, it listens only on `localhost`.

## Upstream and license

The search architecture is inspired by and adapted from
[d-kimuson/claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer), which is licensed
under the MIT License. See [NOTICE.md](./NOTICE.md) for attribution. This project is also licensed
under the MIT License.
