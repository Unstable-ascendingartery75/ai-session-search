import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createClaudeProvider } from "./claude.ts";
import { createCodexProvider } from "./codex.ts";

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
