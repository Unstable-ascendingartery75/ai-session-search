import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { createClaudeProvider } from "./claude.ts";
import { createCodexProvider } from "./codex.ts";
import {
  createAntigravityProvider,
  createCopilotProvider,
  createCursorProvider,
  createKimiProvider,
  createOpenCodeProvider,
} from "./additional.ts";

const tempDirectories: string[] = [];

const makeTempDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "ai-session-search-test-"));
  tempDirectories.push(path);
  return path;
};

afterEach(async () => {
  for (const path of tempDirectories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("conversation providers", () => {
  test("Claude provider discovers and normalizes visible messages", async () => {
    const home = await makeTempDirectory();
    const project = join(home, "projects", "-workspace-demo");
    await mkdir(project, { recursive: true });
    const sessionPath = join(project, "session-1.jsonl");
    await writeFile(
      sessionPath,
      [
        {
          type: "user",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: "/workspace/demo",
          message: { role: "user", content: "查找订单问题" },
        },
        {
          type: "assistant",
          timestamp: "2026-01-01T00:00:01.000Z",
          cwd: "/workspace/demo",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "定位到 OrderService" },
              { type: "tool_use", name: "Read", input: { path: "OrderService.ts" } },
            ],
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );

    const provider = createClaudeProvider(home);
    const files = await provider.discover();
    expect(files).toHaveLength(1);
    const parsed = await provider.parse(files[0]!);
    expect(parsed?.projectPath).toBe("/workspace/demo");
    expect(parsed?.originalTitle).toBe("查找订单问题");
    expect(parsed?.messages.map((message) => message.content)).toEqual([
      "查找订单问题",
      "定位到 OrderService",
    ]);
  });

  test("Claude provider excludes sidechains even when their filenames do not start with agent-", async () => {
    const home = await makeTempDirectory();
    const project = join(home, "projects", "-workspace-demo");
    const mainPath = join(project, "main-session.jsonl");
    const sidechainPath = join(project, "main-session", "subagents", "worker.jsonl");
    await mkdir(join(sidechainPath, ".."), { recursive: true });
    await writeFile(mainPath, [
      {
        type: "user",
        sessionId: "main-session",
        isSidechain: false,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "Claude main question" },
      },
      {
        type: "assistant",
        sessionId: "main-session",
        isSidechain: false,
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "Claude main answer" }] },
      },
    ].map((record) => JSON.stringify(record)).join("\n"));
    await writeFile(sidechainPath, [
      {
        type: "user",
        sessionId: "main-session",
        agentId: "worker",
        isSidechain: true,
        timestamp: "2026-01-01T00:00:00.500Z",
        message: { role: "user", content: "Claude child task" },
      },
      {
        type: "assistant",
        sessionId: "main-session",
        agentId: "worker",
        isSidechain: true,
        timestamp: "2026-01-01T00:00:00.750Z",
        message: { role: "assistant", content: [{ type: "text", text: "Claude child detail" }] },
      },
    ].map((record) => JSON.stringify(record)).join("\n"));

    const provider = createClaudeProvider(home);
    const files = await provider.discover();
    expect(files.map((file) => file.path)).toEqual([mainPath]);
    const sidechainStat = await stat(sidechainPath);
    await expect(provider.parse({
      provider: "claude",
      path: sidechainPath,
      mtimeMs: sidechainStat.mtimeMs,
      size: sidechainStat.size,
    })).resolves.toBeNull();
  });

  test("Cursor provider only accepts the primary transcript for each session", async () => {
    const home = await makeTempDirectory();
    const transcriptRoot = join(home, "projects", "work", "agent-transcripts", "parent-1");
    const mainPath = join(transcriptRoot, "parent-1.jsonl");
    const auxiliaryPath = join(transcriptRoot, "notes.jsonl");
    const childPath = join(transcriptRoot, "subagents", "child-1.jsonl");
    await mkdir(join(childPath, ".."), { recursive: true });
    await writeFile(mainPath, [
      { role: "user", message: { content: "Cursor main question" } },
      { role: "assistant", message: { content: "Cursor main answer" } },
    ].map((record) => JSON.stringify(record)).join("\n"));
    await writeFile(childPath, [
      { role: "user", message: { content: "Cursor child task" } },
      { role: "assistant", message: { content: "Cursor child detail" } },
    ].map((record) => JSON.stringify(record)).join("\n"));
    await writeFile(auxiliaryPath, [
      { role: "assistant", message: { content: "Cursor auxiliary detail" } },
    ].map((record) => JSON.stringify(record)).join("\n"));

    const provider = createCursorProvider(home);
    const files = await provider.discover();
    expect(files.map((file) => file.path)).toEqual([mainPath]);
    expect((await provider.parse(files[0]!))?.sessionKey).toBe("cursor:parent-1");
    const childStat = await stat(childPath);
    await expect(provider.parse({
      provider: "cursor",
      path: childPath,
      mtimeMs: childStat.mtimeMs,
      size: childStat.size,
    })).resolves.toBeNull();
    const auxiliaryStat = await stat(auxiliaryPath);
    await expect(provider.parse({
      provider: "cursor",
      path: auxiliaryPath,
      mtimeMs: auxiliaryStat.mtimeMs,
      size: auxiliaryStat.size,
    })).resolves.toBeNull();
  });

  test("Copilot provider keeps root messages and excludes subagent event envelopes", async () => {
    const home = await makeTempDirectory();
    const path = join(home, "session-state", "copilot-1", "events.jsonl");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, [
      { type: "session.start", data: { sessionId: "copilot-1" } },
      { type: "user.message", data: { content: "Copilot main question" } },
      { type: "assistant.message", agentId: "researcher", data: { content: "Copilot child detail one" } },
      { type: "assistant.message", data: { agentId: "reviewer", content: "Copilot child detail two" } },
      { type: "assistant.message", data: { content: "Copilot main answer" } },
    ].map((record) => JSON.stringify(record)).join("\n"));

    const provider = createCopilotProvider(home);
    const parsed = await provider.parse((await provider.discover())[0]!);
    expect(parsed?.messages.map((message) => message.content)).toEqual([
      "Copilot main question",
      "Copilot main answer",
    ]);
  });

  test("normalizes Cursor and Copilot JSONL sessions", async () => {
    const cases = [
      {
        factory: createCursorProvider,
        relativePath: "projects/work/agent-transcripts/cursor-1/cursor-1.jsonl",
        records: [
          { role: "user", message: { content: [{ type: "text", text: "Cursor 用户问题" }] } },
          { role: "assistant", message: { content: [{ type: "text", text: "Cursor 回答" }] } },
        ],
      },
      {
        factory: createCopilotProvider,
        relativePath: "session-state/copilot-1/events.jsonl",
        records: [
          { type: "session.start", data: { sessionId: "copilot-1" } },
          { type: "user.message", data: { content: "Copilot 用户问题" } },
          { type: "assistant.message", data: { content: "Copilot 回答" } },
        ],
      },
    ];

    for (const item of cases) {
      const home = await makeTempDirectory();
      const path = join(home, item.relativePath);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, item.records.map((record) => JSON.stringify(record)).join("\n"));
      const provider = item.factory(home);
      const files = await provider.discover();
      expect(files, item.relativePath).toHaveLength(1);
      const parsed = await provider.parse(files[0]!);
      expect(parsed?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(parsed?.messages[0]?.content).toContain("用户问题");
      expect(parsed?.messages[1]?.content).toContain("回答");
    }
  });

  test("combines Kimi user messages and assistant loop events", async () => {
    const home = await makeTempDirectory();
    const path = join(home, "sessions", "project", "kimi-1", "agents", "main", "wire.jsonl");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, [
      { type: "context.append_message", time: 1_800_000_000, message: { role: "user", content: "Kimi 用户问题" } },
      { type: "context.append_loop_event", time: 1_800_000_001, event: { type: "content.part", part: { type: "text", text: "Kimi 完整回答" } } },
    ].map((record) => JSON.stringify(record)).join("\n"));
    const provider = createKimiProvider(home);
    const files = await provider.discover();
    const parsed = await provider.parse(files[0]!);
    expect(parsed?.sourceSessionId).toBe("kimi-1");
    expect(parsed?.messages.map((message) => message.content)).toEqual(["Kimi 用户问题", "Kimi 完整回答"]);
  });

  test("indexes an Antigravity transcript", async () => {
    const antigravityHome = await makeTempDirectory();
    const transcript = join(antigravityHome, "conversation-1", ".system_generated", "logs", "transcript.jsonl");
    await mkdir(join(transcript, ".."), { recursive: true });
    await writeFile(transcript, [
      { source: "USER_EXPLICIT", type: "USER_INPUT", content: "<USER_REQUEST>\n查找配置\n</USER_REQUEST>" },
      { source: "MODEL", type: "PLANNER_RESPONSE", content: "已经找到配置" },
    ].map((record) => JSON.stringify(record)).join("\n"));
    const antigravity = createAntigravityProvider(antigravityHome);
    const antigravityParsed = await antigravity.parse((await antigravity.discover())[0]!);
    expect(antigravityParsed?.messages.map((message) => message.content)).toEqual(["查找配置", "已经找到配置"]);

  });

  test("reads current OpenCode SQLite sessions without writing to the source database", async () => {
    const home = await makeTempDirectory();
    const path = join(home, "opencode.db");
    const source = new DatabaseSync(path);
    source.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, directory TEXT, agent TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT);
    `);
    source.prepare("INSERT INTO session VALUES (?, NULL, ?, ?, ?, ?, ?, NULL)").run("oc-1", "OpenCode 测试", "/work/opencode", "build", 1_800_000_000_000, 1_800_000_001_000);
    source.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, NULL)").run("oc-child", "oc-1", "检查实现 (@review subagent)", "/work/opencode", "review", 1_800_000_000_100, 1_800_000_000_900);
    source.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("m1", "oc-1", 1_800_000_000_000, JSON.stringify({ role: "user" }));
    source.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("p1", "m1", 1, JSON.stringify({ type: "text", text: "OpenCode 用户问题" }));
    source.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("m2", "oc-1", 1_800_000_001_000, JSON.stringify({ role: "assistant" }));
    source.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("p2", "m2", 2, JSON.stringify({ type: "text", text: "OpenCode 回答" }));
    source.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("m3", "oc-child", 1_800_000_000_100, JSON.stringify({ role: "assistant" }));
    source.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("p3", "m3", 3, JSON.stringify({ type: "text", text: "OpenCode child detail" }));
    source.close();

    const provider = createOpenCodeProvider(home);
    const files = await provider.discover();
    expect(files).toHaveLength(1);
    const parsed = await provider.parse(files[0]!);
    expect(parsed?.originalTitle).toBe("OpenCode 测试");
    expect(parsed?.messages.map((message) => message.content)).toEqual(["OpenCode 用户问题", "OpenCode 回答"]);
  });

  test("Codex provider reads active and archived sessions without duplicate event records", async () => {
    const home = await makeTempDirectory();
    const active = join(home, "sessions", "2026", "01", "01");
    const archived = join(home, "archived_sessions");
    await mkdir(active, { recursive: true });
    await mkdir(archived, { recursive: true });
    const sessionId = "01900000-0000-7000-8000-000000000001";
    const sessionPath = join(active, `rollout-2026-01-01T00-00-00-${sessionId}.jsonl`);
    await writeFile(
      join(home, "session_index.jsonl"),
      `${JSON.stringify({ id: sessionId, thread_name: "订单链路排查", updated_at: "2026-01-01" })}\n`,
    );
    await writeFile(
      sessionPath,
      [
        {
          type: "session_meta",
          timestamp: "2026-01-01T00:00:00.000Z",
          payload: { id: sessionId, cwd: "/workspace/codex" },
        },
        {
          type: "response_item",
          timestamp: "2026-01-01T00:00:01.000Z",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "injected fallback" }],
          },
        },
        {
          type: "event_msg",
          timestamp: "2026-01-01T00:00:01.000Z",
          payload: { type: "user_message", message: "排查支付异常" },
        },
        {
          type: "response_item",
          timestamp: "2026-01-01T00:00:02.000Z",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            content: [{ type: "output_text", text: "问题位于支付回调" }],
          },
        },
        {
          type: "event_msg",
          timestamp: "2026-01-01T00:00:02.000Z",
          payload: { type: "agent_message", phase: "final_answer", message: "问题位于支付回调" },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );

    const provider = createCodexProvider(home);
    const files = await provider.discover();
    expect(files).toHaveLength(1);
    const parsed = await provider.parse(files[0]!);
    expect(parsed?.sourceSessionId).toBe(sessionId);
    expect(parsed?.originalTitle).toBe("订单链路排查");
    expect(parsed?.messages.map((message) => message.content)).toEqual([
      "排查支付异常",
      "问题位于支付回调",
    ]);
  });

  test("Codex provider excludes subagents without hiding user forks", async () => {
    const home = await makeTempDirectory();
    const sessions = join(home, "sessions", "2026", "01", "01");
    await mkdir(sessions, { recursive: true });
    const mainId = "01900000-0000-7000-8000-000000000010";
    const subagentId = "01900000-0000-7000-8000-000000000011";
    const userForkId = "01900000-0000-7000-8000-000000000012";
    const mainPath = join(sessions, `rollout-2026-01-01T00-00-00-${mainId}.jsonl`);
    const subagentPath = join(sessions, `rollout-2026-01-01T00-01-00-${subagentId}.jsonl`);
    const userForkPath = join(sessions, `rollout-2026-01-01T00-02-00-${userForkId}.jsonl`);

    await writeFile(mainPath, [
      {
        type: "session_meta",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: {
          id: mainId,
          session_id: mainId,
          cwd: "/workspace/main",
          thread_source: "user",
          source: "cli",
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-01-01T00:00:01.000Z",
        payload: { type: "user_message", message: "让 subagent 开发并审查代码" },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:03:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "主会话在 subagent 完成后的最终汇总" }],
        },
      },
    ].map((record) => JSON.stringify(record)).join("\n"));

    await writeFile(subagentPath, [
      {
        type: "session_meta",
        timestamp: "2026-01-01T00:01:00.000Z",
        payload: {
          id: subagentId,
          session_id: mainId,
          forked_from_id: mainId,
          parent_thread_id: mainId,
          cwd: "/workspace/main",
          thread_source: "subagent",
          source: {
            subagent: {
              thread_spawn: { parent_thread_id: mainId, depth: 1, agent_path: "/root/repro" },
            },
          },
        },
      },
      {
        type: "session_meta",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: {
          id: mainId,
          session_id: mainId,
          cwd: "/workspace/main",
          thread_source: "user",
          source: "cli",
        },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:01:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "subagent 独有的内部开发细节" }],
        },
      },
    ].map((record) => JSON.stringify(record)).join("\n"));

    await writeFile(userForkPath, [
      {
        type: "session_meta",
        timestamp: "2026-01-01T00:02:00.000Z",
        payload: {
          id: userForkId,
          session_id: mainId,
          forked_from_id: mainId,
          cwd: "/workspace/fork",
          thread_source: "user",
          source: "cli",
        },
      },
      {
        type: "session_meta",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: { id: mainId, session_id: mainId, cwd: "/workspace/main" },
      },
      {
        type: "event_msg",
        timestamp: "2026-01-01T00:02:01.000Z",
        payload: { type: "user_message", message: "保留用户主动创建的 fork" },
      },
    ].map((record) => JSON.stringify(record)).join("\n"));

    const provider = createCodexProvider(home);
    const files = await provider.discover();
    expect(files.map((file) => file.path).sort()).toEqual([mainPath, userForkPath].sort());

    const parsedMain = await provider.parse(files.find((file) => file.path === mainPath)!);
    expect(parsedMain?.sourceSessionId).toBe(mainId);
    expect(parsedMain?.messages.at(-1)?.content).toBe("主会话在 subagent 完成后的最终汇总");

    const parsedFork = await provider.parse(files.find((file) => file.path === userForkPath)!);
    expect(parsedFork?.sourceSessionId).toBe(userForkId);
    expect(parsedFork?.projectPath).toBe("/workspace/fork");

    const subagentStat = await stat(subagentPath);
    const parsedSubagent = await provider.parse({
      provider: "codex",
      path: subagentPath,
      mtimeMs: subagentStat.mtimeMs,
      size: subagentStat.size,
    });
    expect(parsedSubagent).toBeNull();
  });
});
