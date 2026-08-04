import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ParsedSession } from "../shared/types.ts";
import { SearchDatabase } from "./database.ts";
import { SessionIndexer } from "./indexer.ts";
import { createCodexProvider } from "./providers/codex.ts";
import type { ConversationProvider } from "./providers/types.ts";

const tempDirectories: string[] = [];

const makeTempDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "ai-session-indexer-test-"));
  tempDirectories.push(path);
  return path;
};

const emptyCodexProvider = (home: string): ConversationProvider => ({
  id: "codex",
  home,
  sessionRoots: [join(home, "sessions")],
  discover: async () => [],
  parse: async () => null,
});

afterEach(async () => {
  for (const path of tempDirectories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("session indexer", () => {
  test("repairs a Codex main session previously overwritten by a subagent", async () => {
    const root = await makeTempDirectory();
    const home = join(root, "codex");
    const sessions = join(home, "sessions", "2026", "01", "01");
    await mkdir(sessions, { recursive: true });
    const mainId = "01900000-0000-7000-8000-000000000020";
    const subagentId = "01900000-0000-7000-8000-000000000021";
    const mainPath = join(sessions, `rollout-2026-01-01T00-00-00-${mainId}.jsonl`);
    const subagentPath = join(sessions, `rollout-2026-01-01T00-01-00-${subagentId}.jsonl`);

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
        payload: { type: "user_message", message: "执行主会话任务" },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:03:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "主会话恢复后的尾部关键字" }],
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
          source: { subagent: { thread_spawn: { parent_thread_id: mainId, depth: 1 } } },
        },
      },
      {
        type: "session_meta",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: { id: mainId, session_id: mainId, cwd: "/workspace/main" },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:01:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "不应保留的 subagent 内部关键字" }],
        },
      },
    ].map((record) => JSON.stringify(record)).join("\n"));

    const subagentStat = await stat(subagentPath);
    const database = new SearchDatabase(join(root, "search.db"));
    const sessionKey = `codex:${mainId}`;
    database.upsertSession({
      sessionKey,
      sourceSessionId: mainId,
      provider: "codex",
      filePath: subagentPath,
      projectPath: "/workspace/main",
      originalTitle: "被覆盖的主会话",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:01.000Z",
      messages: [{
        index: 0,
        role: "assistant",
        content: "不应保留的 subagent 内部关键字",
        timestamp: "2026-01-01T00:01:01.000Z",
      }],
    }, {
      provider: "codex",
      path: subagentPath,
      mtimeMs: subagentStat.mtimeMs,
      size: subagentStat.size,
    });
    database.updateMetadata(sessionKey, { customTitle: "保留的自定义标题", favorite: true });

    const indexer = new SessionIndexer(database, [createCodexProvider(home)]);
    try {
      const result = await indexer.syncProvider("codex");
      expect(result.discovered).toBe(1);
      expect(database.getIndexedFile(mainPath)).not.toBeNull();
      expect(database.getIndexedFile(subagentPath)).toBeNull();
      expect(database.search({ query: "主会话恢复后的尾部关键字" })).toHaveLength(1);
      expect(database.search({ query: "不应保留的 subagent 内部关键字" })).toHaveLength(0);

      const restored = database.getSession(sessionKey);
      expect(restored?.session.customTitle).toBe("保留的自定义标题");
      expect(restored?.session.favorite).toBe(true);
      expect(restored?.messages.map((message) => message.content)).toEqual([
        "执行主会话任务",
        "主会话恢复后的尾部关键字",
      ]);
    } finally {
      indexer.close();
      database.close();
    }
  });

  test("rejects duplicate session keys without losing metadata when the provider is repaired", async () => {
    const root = await makeTempDirectory();
    const home = join(root, "provider");
    const mainPath = join(home, "main.jsonl");
    const childPath = join(home, "child.jsonl");
    await mkdir(home, { recursive: true });
    await writeFile(mainPath, "main");
    await writeFile(childPath, "child");
    const mainStat = await stat(mainPath);
    const childStat = await stat(childPath);
    let includeChild = false;
    const provider: ConversationProvider = {
      id: "cursor",
      home,
      sessionRoots: [home],
      discover: async () => [
        { provider: "cursor", path: mainPath, mtimeMs: mainStat.mtimeMs, size: mainStat.size },
        ...(includeChild
          ? [{ provider: "cursor" as const, path: childPath, mtimeMs: childStat.mtimeMs, size: childStat.size }]
          : []),
      ],
      parse: async (file) => ({
        sessionKey: "cursor:shared-id",
        sourceSessionId: "shared-id",
        provider: "cursor",
        filePath: file.path,
        projectPath: "/workspace",
        originalTitle: file.path === mainPath ? "Main" : "Child",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        messages: [{
          index: 0,
          role: "assistant",
          content: file.path === mainPath ? "main content" : "child content",
          timestamp: "2026-01-01T00:00:01.000Z",
        }],
      }),
    };

    const database = new SearchDatabase(join(root, "search.db"));
    const indexer = new SessionIndexer(database, [provider]);
    try {
      await indexer.syncProvider("cursor");
      database.updateMetadata("cursor:shared-id", { customTitle: "Keep me", favorite: true });
      includeChild = true;
      const conflicted = await indexer.syncProvider("cursor");
      expect(conflicted.errors).toBe(1);
      expect(database.getSession("cursor:shared-id")).toBeNull();
      expect(database.search({ query: "main content" })).toHaveLength(0);
      expect(database.search({ query: "child content" })).toHaveLength(0);

      includeChild = false;
      const repaired = await indexer.syncProvider("cursor");
      expect(repaired.errors).toBe(0);
      expect(database.getSession("cursor:shared-id")?.session).toMatchObject({
        customTitle: "Keep me",
        favorite: true,
      });
      expect(database.search({ query: "main content" })).toHaveLength(1);
    } finally {
      indexer.close();
      database.close();
    }
  });

  test("reindexes unchanged source files when the provider parser version changes", async () => {
    const root = await makeTempDirectory();
    const home = join(root, "provider");
    const path = join(home, "session.jsonl");
    await mkdir(home, { recursive: true });
    await writeFile(path, "unchanged source");
    const info = await stat(path);
    let parsedContent = "old parsed content";
    const provider: ConversationProvider = {
      id: "copilot",
      home,
      sessionRoots: [home],
      parserVersion: 1,
      discover: async () => [{ provider: "copilot", path, mtimeMs: info.mtimeMs, size: info.size }],
      parse: async () => ({
        sessionKey: "copilot:session-1",
        sourceSessionId: "session-1",
        provider: "copilot",
        filePath: path,
        projectPath: "/workspace",
        originalTitle: "Session",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        messages: [{
          index: 0,
          role: "assistant",
          content: parsedContent,
          timestamp: "2026-01-01T00:00:01.000Z",
        }],
      }),
    };

    const database = new SearchDatabase(join(root, "search.db"));
    const indexer = new SessionIndexer(database, [provider]);
    try {
      await indexer.syncProvider("copilot");
      expect(database.search({ query: "old parsed content" })).toHaveLength(1);

      parsedContent = "new parsed content";
      provider.parserVersion = 2;
      const result = await indexer.syncProvider("copilot");
      expect(result.indexed).toBe(1);
      expect(result.unchanged).toBe(0);
      expect(database.search({ query: "old parsed content" })).toHaveLength(0);
      expect(database.search({ query: "new parsed content" })).toHaveLength(1);
    } finally {
      indexer.close();
      database.close();
    }
  });

  test("switches provider homes without restarting the server", async () => {
    const root = await makeTempDirectory();
    const database = new SearchDatabase(join(root, "search.db"));
    const indexer = new SessionIndexer(database, [emptyCodexProvider(join(root, "first"))]);
    try {
      await indexer.reconfigure([emptyCodexProvider(join(root, "second"))], false);
      expect(await indexer.status()).toMatchObject([{ home: join(root, "second") }]);
    } finally {
      indexer.close();
      database.close();
    }
  });

  test("loads the existing provider manifest once instead of querying every file", async () => {
    const root = await makeTempDirectory();
    const home = join(root, "provider");
    const path = join(home, "session.jsonl");
    await mkdir(home, { recursive: true });
    await writeFile(path, "session");
    const info = await stat(path);
    const provider: ConversationProvider = {
      id: "pi",
      home,
      sessionRoots: [home],
      discover: async () => [{ provider: "pi", path, mtimeMs: info.mtimeMs, size: info.size }],
      parse: async () => ({
        sessionKey: "pi:session",
        sourceSessionId: "session",
        provider: "pi",
        filePath: path,
        projectPath: null,
        originalTitle: "Session",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        messages: [],
      }),
    };
    const database = new SearchDatabase(join(root, "search.db"));
    const perFileLookup = vi.spyOn(database, "getIndexedFile");
    const manifestLookup = vi.spyOn(database, "getIndexedFiles");
    const indexer = new SessionIndexer(database, [provider]);
    try {
      await indexer.syncProvider("pi");
      expect(manifestLookup).toHaveBeenCalledOnce();
      expect(perFileLookup).not.toHaveBeenCalled();
    } finally {
      indexer.close();
      database.close();
    }
  });

  test("removes stale indexed sessions when the configured path is unavailable", async () => {
    const root = await makeTempDirectory();
    const database = new SearchDatabase(join(root, "search.db"));
    const session: ParsedSession = {
      sessionKey: "codex:stale",
      sourceSessionId: "stale",
      provider: "codex",
      filePath: join(root, "old", "session.jsonl"),
      projectPath: null,
      originalTitle: "Stale session",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [],
    };
    database.upsertSession(session, {
      provider: "codex",
      path: session.filePath,
      mtimeMs: 1,
      size: 1,
    });
    const indexer = new SessionIndexer(database, [emptyCodexProvider(join(root, "missing"))]);
    try {
      const result = await indexer.syncProvider("codex");
      expect(result.removed).toBe(1);
      expect(database.getSession(session.sessionKey)).toBeNull();
    } finally {
      indexer.close();
      database.close();
    }
  });
});
