# AI Session Search

[English](./README.md) | 简体中文

[![GitHub Release](https://img.shields.io/github/v/release/lililib/ai-session-search)](https://github.com/lililib/ai-session-search/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

一个本地优先、只读的 AI 编程会话搜索与阅读器。自动发现 11 种 AI 编程工具的
会话，使用 SQLite FTS5 trigram 索引，适合搜索中文、代码标识符、文件路径和错误信息。

![AI Session Search 界面](./docs/images/ai-session-search.png)

## 桌面客户端

macOS（Apple Silicon、Intel）`.zip` 应用包和 Windows x64 `Setup.exe` 会发布在
[GitHub Releases](https://github.com/lililib/ai-session-search/releases)。桌面客户端无需安装
Node.js：打开后会在随机的本机回环端口启动内置服务，并自动扫描当前用户的会话目录。
应用数据库存放在操作系统分配给 AI Session Search 的应用数据目录，不依赖开发者机器上的路径。

当前发布包未进行 Apple Developer ID 或 Windows Authenticode 签名，因此首次打开时可能出现
Gatekeeper 或 Microsoft Defender SmartScreen 提示。“在终端中恢复”目前只支持 macOS；Windows
客户端仍然支持搜索、阅读、收藏夹、重命名以及复制 Session ID/恢复命令。

从源码启动或生成当前平台安装包：

```bash
corepack pnpm desktop:start
corepack pnpm desktop:make
```

生成结果位于 `out/make/`。推送 `v*` 标签后，GitHub Actions 会分别构建 macOS arm64、
macOS x64 和 Windows x64，并把文件加入对应的 GitHub Release。

## 功能

- 自动发现 Claude Code、Codex、Antigravity、OpenCode、Hermes、GitHub Copilot CLI、Droid、OpenClaw、Cursor、Pi 与 Kimi Code 会话
- 搜索全部来源、指定来源或指定项目
- SQLite FTS5 trigram 全文搜索
- 两字中文查询自动使用子串搜索兜底
- 只读会话详情与命中消息定位
- 自定义会话名称
- 收藏或取消收藏会话
- 筛选所有已重命名的会话
- 搜索消息内容、自定义名称以及完整或部分 Session ID
- 创建、重命名和删除本地收藏夹
- 将会话移动到收藏夹，或筛选尚未分类的会话
- 一键复制 Session ID 或恢复命令
- 按来源分别自定义恢复命令模板
- 在 Terminal、iTerm2、Warp 或自定义终端路径中执行恢复命令
- 根据浏览器与系统首选语言自动切换简体中文或英文界面
- 文件变化后自动重新索引
- 不需要 Anthropic API、OpenAI API 或云端数据库

本项目不会修改任何来源的会话文件。自定义名称、收藏状态和搜索索引
仅写入自己的 SQLite 数据库。

## 复制与恢复命令

打开会话后可以直接复制 Session ID，或复制完整恢复命令。Claude Code、Codex、Antigravity、OpenCode、Hermes、Copilot CLI、Cursor、Pi 和 Kimi Code 提供内置模板，例如：

```text
Claude Code: cd {cwd} && claude --resume {sessionId}
Codex:       cd {cwd} && codex resume {sessionId}
```

`{cwd}` 会替换为会话记录的项目目录，`{sessionId}` 会替换为源 Session ID。模板按
来源分别保存在应用数据库中。也可以只输入自定义前缀，例如 `yolo`，复制结果会自动
变成 `yolo <session-id>`。

在 macOS 上，“在终端中恢复”可以把生成后的命令交给 Terminal、iTerm2、Warp，或
自定义的绝对应用/可执行文件路径。自定义 `.app` 路径会打开应用自己生成的
`.command` 文件；自定义可执行文件使用 `-e <shell> -lic` 参数。所有终端命令都会
通过配置的交互式登录 Shell 执行，因此可以读取其启动文件中的 `yolo` 等别名。
Shell 路径默认优先使用服务进程的绝对 `$SHELL`，否则使用 `/bin/zsh`。
自定义 Shell 需要支持 `-lic`，常见选择包括 `/bin/zsh` 和 `/bin/bash`。只有服务监听在
`localhost`、`127.0.0.1` 或 `::1` 时才允许启动终端。
如果 iTerm2 已经有窗口，AI Session Search 会在当前窗口中新建 Tab；只有完全没有
iTerm2 窗口时才会新建窗口。

## 自动发现与配置

路径按以下优先级解析：

| 数据 | CLI | 应用环境变量 | 原生环境变量 | 默认值 |
| --- | --- | --- | --- | --- |
| Claude Code | `--claude-dir` | `AI_SESSION_CLAUDE_HOME` | `CLAUDE_CONFIG_DIR` | `~/.claude` |
| Codex | `--codex-dir` | `AI_SESSION_CODEX_HOME` | `CODEX_HOME` | `~/.codex` |
| 其他来源 | `--provider-dir provider=path` | `AI_SESSION_<PROVIDER>_HOME` | 部分来源支持原生变量 | 见下表 |
| 本应用数据 | `--data-dir` | `AI_SESSION_DATA_DIR` | `XDG_DATA_HOME` | 平台应用数据目录 |

### 命令行参数

命令行参数的优先级高于环境变量。

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `-p, --port <port>` | `PORT` | `3411` | Web 服务监听端口 |
| `-h, --hostname <hostname>` | `HOSTNAME` | `localhost` | 要监听的主机名或网络接口 |
| `--claude-dir <path>` | `AI_SESSION_CLAUDE_HOME`，其次 `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code 主目录 |
| `--codex-dir <path>` | `AI_SESSION_CODEX_HOME`，其次 `CODEX_HOME` | `~/.codex` | Codex 主目录 |
| `--provider-dir <provider=path>` | 对应来源的环境变量 | 对应来源默认值 | 覆盖来源主目录，可重复使用 |
| `--data-dir <path>` | `AI_SESSION_DATA_DIR`，其次 `XDG_DATA_HOME` | 平台应用数据目录 | 应用数据库目录 |
| `--providers <providers>` | `AI_SESSION_PROVIDERS` | `auto` | `auto` 或逗号分隔的来源列表 |
| `--no-watch` | — | 默认启用监听 | 关闭会话文件变化后的自动重新索引 |
| `--help` | — | — | 显示 CLI 帮助 |

示例：

```bash
corepack pnpm start --hostname 127.0.0.1 --port 8080
```

支持的来源 ID 和默认主目录：

| 来源 ID | 客户端 | 默认主目录 |
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

例如，`--provider-dir kimi=/custom/kimi --provider-dir pi=/custom/pi` 可以覆盖两个来源的目录，不会写死任何用户路径。`--providers` 只扫描选中的来源；使用 `auto` 时会对所有已注册来源进行自动检测。

Claude Code 扫描：

```text
<claude-home>/projects/**/*.jsonl
```

Codex 扫描：

```text
<codex-home>/sessions/**/*.jsonl
<codex-home>/archived_sessions/**/*.jsonl
```

`history.jsonl` 和 `session_index.jsonl` 不作为会话发现来源；Codex 的
`session_index.jsonl` 只用于补充已有会话的标题。

## 国际化

应用使用 Lingui 管理界面翻译，并根据浏览器提供的系统首选语言自动选择语言：

- `zh-*`：简体中文
- `en-*`：英文
- 其他语言：回退为英文

语言检测与翻译目录位于 `src/client/i18n/`。新增语言时需要增加对应 Catalog，并在
`localeDetection.ts` 中注册语言标签映射。

## 本地开发

要求：

- Node.js 24 或更高版本（使用内置 `node:sqlite`）
- pnpm 11

```bash
corepack pnpm install
corepack pnpm dev
```

开发模式：

- 前端：http://localhost:3410
- 后端：http://localhost:3411

生产构建：

```bash
corepack pnpm build
corepack pnpm start
```

只启用 Codex，并指定自定义目录：

```bash
corepack pnpm start \
  --providers codex \
  --codex-dir /path/to/codex-home \
  --data-dir /path/to/app-data
```

关闭文件监听：

```bash
corepack pnpm start --no-watch
```

## 验证

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

## 隐私边界

- 索引完全保存在本地。
- 不读取 `auth.json`、API Key 或登录凭证。
- 只有用户点击“在终端中恢复”后才执行恢复命令；非回环监听时该接口禁用。
- 不执行会话中的命令或工具调用。
- 远程暴露服务前应自行增加认证和网络访问控制；默认仅监听 `localhost`。

## 上游与许可证

搜索架构参考并改编自
[d-kimuson/claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer)，
上游采用 MIT License。详细署名见 [NOTICE.md](./NOTICE.md)。本项目同样采用 MIT License。
