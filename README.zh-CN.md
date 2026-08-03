# AI Session Search

[English](./README.md) | 简体中文

[![GitHub Release](https://img.shields.io/github/v/release/lililib/ai-session-search)](https://github.com/lililib/ai-session-search/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

本地优先、只读的 AI 编程会话搜索器。自动发现 11 种编程工具的本地会话，并使用
SQLite FTS5 trigram 索引搜索自然语言、代码、路径、错误信息和 Session ID。

![AI Session Search 界面](./docs/images/ai-session-search.png)

## 桌面客户端

从 [GitHub Releases](https://github.com/lililib/ai-session-search/releases) 下载：

- macOS Apple Silicon：`darwin-arm64.zip`
- macOS Intel：`darwin-x64.zip`
- Windows x64 便携版：`AI.Session.Search-win32-x64-<version>.zip`

客户端不需要安装 Node.js。启动后会立即显示界面，在后台扫描会话并展示索引进度；
数据库存放在当前用户的系统应用数据目录，不包含开发者机器路径。

当前发布包尚未签名，首次打开可能出现 Gatekeeper 或 SmartScreen 提示。Windows 版本为
便携版：解压 ZIP 后运行 `ai-session-search.exe`，无需安装。“在终端中恢复”支持 macOS
和 Windows；Windows Terminal 会在最近使用的窗口中新建标签页，找不到 `wt.exe` 时回退
到 PowerShell。
Windows 包要求 64 位 Windows 10 或 Windows 11，不支持 Windows 7/8/8.1。

## 主要功能

- 跨来源、项目、消息内容、自定义名称和完整/部分 Session ID 搜索
- SQLite FTS5 trigram 全文索引，支持中文、日文、韩文、英文和代码子串
- 收藏、重命名、收藏夹分类及对应筛选
- 复制 Session ID 和可自定义的恢复命令
- macOS 支持 Terminal、iTerm2、Warp 和自定义终端/Shell
- Windows 支持 Windows Terminal、PowerShell、命令提示符和自定义可执行文件
- 侧边栏可拖拽调整宽度，并记住用户设置
- 后台增量索引和文件变化监听
- Web/桌面端共用会话来源设置，支持自定义路径、启用/禁用和即时重新扫描
- 简体中文/英文界面自动切换；无需 API Key 或云端数据库

本项目不会修改任何来源会话。名称、收藏夹、设置和索引只写入自己的 SQLite 数据库。

## 支持的客户端

| ID | 客户端 | 默认目录 |
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

Web 和桌面端都可以打开“会话来源”，修改客户端目录、恢复自动路径或启用/禁用客户端。
设置保存在应用自己的数据库中，保存后即时重新扫描，无需重启；自定义路径必须是绝对路径。

路径优先级为：界面保存设置 → CLI 参数 → `AI_SESSION_*` 环境变量 → 客户端原生环境变量
→ 平台默认目录。因此不会写死用户主目录。

## CLI / Web 版本

要求 Node.js 24+ 和 pnpm 11：

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm start
```

默认地址为 `http://localhost:3411`。

| 参数 | 环境变量 | 默认值 |
| --- | --- | --- |
| `-p, --port <port>` | `PORT` | `3411` |
| `-h, --hostname <hostname>` | `HOSTNAME` | `localhost` |
| `--claude-dir <path>` | `AI_SESSION_CLAUDE_HOME` / `CLAUDE_CONFIG_DIR` | `~/.claude` |
| `--codex-dir <path>` | `AI_SESSION_CODEX_HOME` / `CODEX_HOME` | `~/.codex` |
| `--provider-dir <provider=path>` | `AI_SESSION_<PROVIDER>_HOME` | 来源默认目录 |
| `--data-dir <path>` | `AI_SESSION_DATA_DIR` / `XDG_DATA_HOME` | 平台应用数据目录 |
| `--providers <ids>` | `AI_SESSION_PROVIDERS` | `auto` |
| `--no-watch` | — | 默认监听文件变化 |

示例：

```bash
corepack pnpm start --providers codex --codex-dir /path/to/codex-home
corepack pnpm start --provider-dir kimi=/custom/kimi --provider-dir pi=/custom/pi
```

## 恢复命令

内置模板示例：

```text
Claude Code: cd {cwd} && claude --resume {sessionId}
Codex:       cd {cwd} && codex resume {sessionId}
```

`{cwd}` 和 `{sessionId}` 会从会话自动替换。也可以把模板设置为 `yolo`，复制结果会自动
追加 Session ID。macOS 终端执行使用可配置的绝对 Shell 路径和 `-lic`，因此可以读取
`~/.zshrc` 中的别名；iTerm2 会优先在当前窗口打开新 Tab。Windows 会按 PowerShell
或命令提示符语法生成命令，并通过 `wt.exe -w 0 new-tab` 复用最近的终端窗口。

## 开发与发布

```bash
corepack pnpm dev             # Web 开发模式
corepack pnpm desktop:start   # 启动 Electron
corepack pnpm desktop:make    # 构建当前平台客户端
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

推送 `v*` 标签后，GitHub Actions 会自动构建 macOS arm64、macOS x64、Windows x64，
并把产物加入 GitHub Release。

## 隐私与许可证

- 不读取 `auth.json`、API Key 或登录凭证。
- 不执行会话内容中的命令或工具调用。
- 终端恢复仅在用户点击后执行，并要求服务监听回环地址。
- 如需远程暴露 Web 服务，请自行增加认证和网络访问控制。

搜索架构参考并改编自
[d-kimuson/claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer)。详见
[NOTICE.md](./NOTICE.md)。项目采用 [MIT License](./LICENSE)。
