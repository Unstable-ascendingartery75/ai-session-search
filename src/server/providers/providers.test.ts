import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  createDroidProvider,
  createHermesProvider,
  createKimiProvider,
  createOpenClawProvider,
  createOpenCodeProvider,
  createPiProvider,
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

  test("normalizes Pi, Cursor, Droid, Copilot, and OpenClaw JSONL sessions", async () => {
    const cases = [
      {
        factory: createPiProvider,
        relativePath: "agent/sessions/pi.jsonl",
        records: [
          { type: "session", id: "pi-1", cwd: "/work/pi" },
          { type: "message", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: [{ type: "text", text: "Pi 用户问题" }] } },
          { type: "message", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "Pi 回答" }] } },
        ],
      },
      {
        factory: createCursorProvider,
        relativePath: "projects/work/agent-transcripts/cursor-1/cursor-1.jsonl",
        records: [
          { role: "user", message: { content: [{ type: "text", text: "Cursor 用户问题" }] } },
          { role: "assistant", message: { content: [{ type: "text", text: "Cursor 回答" }] } },
        ],
      },
      {
        factory: createDroidProvider,
        relativePath: "sessions/droid.jsonl",
        records: [
          { type: "session_start", id: "droid-1", cwd: "/work/droid" },
          { type: "message", message: { role: "user", content: [{ type: "text", text: "Droid 用户问题" }] } },
          { type: "completion", finalText: "Droid 回答" },
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
      {
        factory: createOpenClawProvider,
        relativePath: "agents/main/sessions/openclaw.jsonl",
        records: [
          { type: "session", id: "openclaw-1", cwd: "/work/openclaw" },
          { type: "message", message: { role: "user", content: [{ type: "text", text: "OpenClaw 用户问题" }] } },
          { type: "message", message: { role: "assistant", content: [{ type: "text", text: "OpenClaw 回答" }] } },
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

  test("indexes Antigravity transcript and Hermes JSON history", async () => {
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

    const hermesHome = await makeTempDirectory();
    await mkdir(join(hermesHome, "sessions"), { recursive: true });
    await writeFile(join(hermesHome, "sessions", "session_h1.json"), JSON.stringify({
      session_id: "h1",
      cwd: "/work/hermes",
      messages: [{ role: "user", content: "Hermes 问题" }, { role: "assistant", content: "Hermes 回答" }],
    }));
    const hermes = createHermesProvider(hermesHome);
    const hermesParsed = await hermes.parse((await hermes.discover())[0]!);
    expect(hermesParsed?.messages).toHaveLength(2);
  });

  test("reads current OpenCode SQLite sessions without writing to the source database", async () => {
    const home = await makeTempDirectory();
    const path = join(home, "opencode.db");
    const source = new DatabaseSync(path);
    source.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT);
    `);
    source.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, NULL)").run("oc-1", "OpenCode 测试", "/work/opencode", 1_800_000_000_000, 1_800_000_001_000);
    source.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("m1", "oc-1", 1_800_000_000_000, JSON.stringify({ role: "user" }));
    source.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("p1", "m1", 1, JSON.stringify({ type: "text", text: "OpenCode 用户问题" }));
    source.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("m2", "oc-1", 1_800_000_001_000, JSON.stringify({ role: "assistant" }));
    source.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("p2", "m2", 2, JSON.stringify({ type: "text", text: "OpenCode 回答" }));
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
});
