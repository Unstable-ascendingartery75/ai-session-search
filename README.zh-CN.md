# AI Session Search

[English](./README.md) | 简体中文

一个本地优先、只读的 AI 编程会话搜索与阅读器。自动发现 Claude Code 和 Codex
会话，使用 SQLite FTS5 trigram 索引，适合搜索中文、代码标识符、文件路径和错误信息。

## 功能

- 自动发现 Claude Code 与 Codex 会话
- 搜索全部来源、指定来源或指定项目
- SQLite FTS5 trigram 全文搜索
- 两字中文查询自动使用子串搜索兜底
- 只读会话详情与命中消息定位
- 自定义会话名称
- 收藏或取消收藏会话
- 筛选所有已重命名的会话
- 搜索自定义名称，同时保留并展示原始标题
- 创建、重命名和删除本地收藏夹
- 将会话移动到收藏夹，或筛选尚未分类的会话
- 一键复制 Session ID 或恢复命令
- 分别自定义 Claude Code 与 Codex 的恢复命令模板
- 根据浏览器与系统首选语言自动切换简体中文或英文界面
- 文件变化后自动重新索引
- 不需要 Anthropic API、OpenAI API 或云端数据库

本项目不会修改 Claude Code 或 Codex 的会话文件。自定义名称、收藏状态和搜索索引
仅写入自己的 SQLite 数据库。

## 复制与恢复命令

打开会话后可以直接复制 Session ID，或复制完整恢复命令。默认模板为：

```text
Claude Code: cd {cwd} && claude --resume {sessionId}
Codex:       cd {cwd} && codex resume {sessionId}
```

`{cwd}` 会替换为会话记录的项目目录，`{sessionId}` 会替换为源 Session ID。模板按
来源分别保存在应用数据库中。也可以只输入自定义前缀，例如 `yolo`，复制结果会自动
变成 `yolo <session-id>`。

## 自动发现与配置

路径按以下优先级解析：

| 数据 | CLI | 应用环境变量 | 原生环境变量 | 默认值 |
| --- | --- | --- | --- | --- |
| Claude Code | `--claude-dir` | `AI_SESSION_CLAUDE_HOME` | `CLAUDE_CONFIG_DIR` | `~/.claude` |
| Codex | `--codex-dir` | `AI_SESSION_CODEX_HOME` | `CODEX_HOME` | `~/.codex` |
| 本应用数据 | `--data-dir` | `AI_SESSION_DATA_DIR` | `XDG_DATA_HOME` | 平台应用数据目录 |

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
corepack pnpm start -- \
  --providers codex \
  --codex-dir /path/to/codex-home \
  --data-dir /path/to/app-data
```

关闭文件监听：

```bash
corepack pnpm start -- --no-watch
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
- 只复制恢复命令，不执行、发送、恢复或继续任何会话。
- 不执行会话中的命令或工具调用。
- 远程暴露服务前应自行增加认证和网络访问控制；默认仅监听 `localhost`。

## 上游与许可证

搜索架构参考并改编自
[d-kimuson/claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer)，
上游采用 MIT License。详细署名见 [NOTICE.md](./NOTICE.md)。本项目同样采用 MIT License。
