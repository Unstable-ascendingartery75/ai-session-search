import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { PROVIDER_IDS, type ParsedSession, type ProviderId } from "../shared/types.ts";
import { SearchDatabase } from "./database.ts";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const remove of cleanup.splice(0)) await remove();
});

const createDatabase = async (): Promise<SearchDatabase> => {
  const directory = await mkdtemp(join(tmpdir(), "ai-session-search-db-"));
  const database = new SearchDatabase(join(directory, "search.db"));
  cleanup.push(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  return database;
};

const sampleSession = (): ParsedSession => ({
  sessionKey: "codex:session-1",
  sourceSessionId: "session-1",
  provider: "codex",
  filePath: "/tmp/session-1.jsonl",
  projectPath: "/workspace/demo",
  originalTitle: "排查订单回调",
  startedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
  messages: [
    {
      index: 0,
      role: "user",
      content: "帮我排查订单支付回调",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    {
      index: 1,
      role: "assistant",
      content: "问题位于 OrderCallbackService",
      timestamp: "2026-01-01T00:01:00.000Z",
    },
  ],
});

describe("SearchDatabase", () => {
  test("migrates an existing metadata table without losing rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-session-search-migration-"));
    const path = join(directory, "search.db");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE session_metadata (
        session_key TEXT PRIMARY KEY,
        custom_title TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO session_metadata(session_key, custom_title, favorite, updated_at)
      VALUES ('codex:legacy', '旧名称', 1, 1);
    `);
    legacy.close();

    const database = new SearchDatabase(path);
    cleanup.push(async () => {
      database.close();
      await rm(directory, { recursive: true, force: true });
    });
    expect(database.createCollection("迁移后收藏夹").name).toBe("迁移后收藏夹");
  });

  test("supports trigram and two-character fallback search", async () => {
    const database = await createDatabase();
    database.upsertSession(sampleSession(), {
      provider: "codex",
      path: "/tmp/session-1.jsonl",
      mtimeMs: 1,
      size: 100,
    });

    expect(database.search({ query: "支付回调" })[0]?.sessionKey).toBe("codex:session-1");
    expect(database.search({ query: "订单" })[0]?.sessionKey).toBe("codex:session-1");
    expect(database.search({ query: "CallbackService" })[0]?.messageIndex).toBe(1);
  });

  test("loads provider manifests and applies multiple session updates as one batch", async () => {
    const database = await createDatabase();
    const first = sampleSession();
    const second: ParsedSession = {
      ...sampleSession(),
      sessionKey: "codex:session-2",
      sourceSessionId: "session-2",
      filePath: "/tmp/session-2.jsonl",
      originalTitle: "第二个会话",
      messages: [{
        index: 0,
        role: "user",
        content: "批量索引关键字",
        timestamp: "2026-01-02T00:00:00.000Z",
      }],
    };

    const result = database.applyProviderIndexBatch({
      provider: "codex",
      visibleFiles: new Set([first.filePath, second.filePath]),
      removeSessionKeys: new Set(),
      upserts: [
        { session: first, file: { provider: "codex", path: first.filePath, mtimeMs: 1, size: 10 }, parserVersion: 1 },
        { session: second, file: { provider: "codex", path: second.filePath, mtimeMs: 2, size: 20 }, parserVersion: 1 },
      ],
    });

    expect(result).toEqual({ indexed: 2, removed: 0, errors: [] });
    expect(database.getIndexedFiles("codex")).toEqual(new Map([
      [first.filePath, { sessionKey: first.sessionKey, mtimeMs: 1, size: 10, parserVersion: 1 }],
      [second.filePath, { sessionKey: second.sessionKey, mtimeMs: 2, size: 20, parserVersion: 1 }],
    ]));
    expect(database.search({ query: "批量索引关键字" })[0]?.sessionKey).toBe(second.sessionKey);
  });

  test("searches sessions by full or partial session ID", async () => {
    const database = await createDatabase();
    const sessionId = "019fc543-bed2-7e21-bc69-35cb2091fcae";
    const session = {
      ...sampleSession(),
      sessionKey: `codex:${sessionId}`,
      sourceSessionId: sessionId,
      filePath: `/tmp/${sessionId}.jsonl`,
    };
    database.upsertSession(session, {
      provider: "codex",
      path: session.filePath,
      mtimeMs: 1,
      size: 100,
    });

    expect(database.search({ query: sessionId })[0]).toMatchObject({
      sessionKey: `codex:${sessionId}`,
      sourceSessionId: sessionId,
    });
    expect(database.search({ query: "35cb2091" })[0]?.sessionKey).toBe(`codex:${sessionId}`);
  });

  test("persists custom title and favorite metadata and searches the custom title", async () => {
    const database = await createDatabase();
    database.upsertSession(sampleSession(), {
      provider: "codex",
      path: "/tmp/session-1.jsonl",
      mtimeMs: 1,
      size: 100,
    });

    const updated = database.updateMetadata("codex:session-1", {
      customTitle: "QC schema design v2",
      favorite: true,
    });

    expect(updated?.displayTitle).toBe("QC schema design v2");
    expect(updated?.favorite).toBe(true);
    expect(database.search({ query: "schema" })[0]).toMatchObject({
      sessionKey: "codex:session-1",
      role: "title",
      favorite: true,
    });
  });

  test("filters sessions and search results to renamed sessions", async () => {
    const database = await createDatabase();
    const first = sampleSession();
    const second = {
      ...sampleSession(),
      sessionKey: "codex:session-2",
      sourceSessionId: "session-2",
      filePath: "/tmp/session-2.jsonl",
    };
    database.upsertSession(first, {
      provider: "codex",
      path: first.filePath,
      mtimeMs: 1,
      size: 100,
    });
    database.upsertSession(second, {
      provider: "codex",
      path: second.filePath,
      mtimeMs: 1,
      size: 100,
    });
    database.updateMetadata(first.sessionKey, { customTitle: "已命名会话" });

    expect(database.listSessions({ renamedOnly: true }).map((item) => item.sessionKey)).toEqual([
      first.sessionKey,
    ]);
    expect(
      new Set(database.search({ query: "支付回调", renamedOnly: true }).map((item) => item.sessionKey)),
    ).toEqual(new Set([first.sessionKey]));
  });

  test("creates, renames, filters, assigns, and deletes collections", async () => {
    const database = await createDatabase();
    const session = sampleSession();
    database.upsertSession(session, {
      provider: "codex",
      path: session.filePath,
      mtimeMs: 1,
      size: 100,
    });

    const collection = database.createCollection("生产问题");
    expect(collection).toMatchObject({ name: "生产问题", sessionCount: 0 });

    const assigned = database.updateMetadata(session.sessionKey, { collectionId: collection.id });
    expect(assigned?.collectionId).toBe(collection.id);
    expect(database.listSessions({ collectionId: collection.id })).toHaveLength(1);
    expect(database.listSessions({ collectionId: null })).toHaveLength(0);
    expect(database.listCollections()[0]).toMatchObject({
      id: collection.id,
      name: "生产问题",
      sessionCount: 1,
    });
    expect(database.search({ query: "支付回调", collectionId: collection.id })).not.toHaveLength(0);

    expect(database.renameCollection(collection.id, "线上排查")?.name).toBe("线上排查");
    expect(database.deleteCollection(collection.id)).toBe(true);
    expect(database.getSession(session.sessionKey)?.session.collectionId).toBeNull();
  });

  test("provides and persists provider-specific resume command templates", async () => {
    const database = await createDatabase();

    expect(database.getResumeCommandTemplates()).toMatchObject({
      claude: "cd {cwd} && claude --resume {sessionId}",
      codex: "cd {cwd} && codex resume {sessionId}",
    });

    expect(database.updateResumeCommandTemplate("codex", "yolo").codex).toBe("yolo");
    expect(database.getResumeCommandTemplates().codex).toBe("yolo");
  });

  test("provides and persists terminal launch settings", async () => {
    const database = await createDatabase();

    expect(database.getTerminalSettings("darwin")).toMatchObject({
      terminal: "terminal",
      customPath: null,
      shellPath: expect.stringMatching(/^\//),
    });
    expect(
      database.updateTerminalSettings(
        {
          terminal: "custom",
          customPath: "/Applications/Ghostty.app",
          shellPath: "/bin/bash",
        },
        "darwin",
      ),
    ).toEqual({
      terminal: "custom",
      customPath: "/Applications/Ghostty.app",
      shellPath: "/bin/bash",
    });
    expect(database.getTerminalSettings("darwin")).toEqual({
      terminal: "custom",
      customPath: "/Applications/Ghostty.app",
      shellPath: "/bin/bash",
    });
  });

  test("uses Windows Terminal and PATH-resolved PowerShell defaults on Windows", async () => {
    const database = await createDatabase();

    expect(database.getTerminalSettings("win32")).toEqual({
      terminal: "windows-terminal",
      customPath: null,
      shellPath: "powershell.exe",
    });
    expect(
      database.updateTerminalSettings(
        { terminal: "powershell", customPath: null, shellPath: "pwsh.exe" },
        "win32",
      ),
    ).toEqual({ terminal: "powershell", customPath: null, shellPath: "pwsh.exe" });
    expect(database.getTerminalSettings("win32")).toEqual({
      terminal: "powershell",
      customPath: null,
      shellPath: "pwsh.exe",
    });
  });

  test("persists provider source paths and enabled states without changing defaults", async () => {
    const database = await createDatabase();
    const defaultHomes = Object.fromEntries(
      PROVIDER_IDS.map((provider) => [provider, `/defaults/${provider}`]),
    ) as Record<ProviderId, string>;
    const defaultProviders = new Set<ProviderId>(PROVIDER_IDS);

    expect(database.getProviderSourceSettings(defaultHomes, defaultProviders)).toContainEqual({
      provider: "codex",
      enabled: true,
      home: "/defaults/codex",
      defaultHome: "/defaults/codex",
      customized: false,
    });

    database.updateProviderSourceSetting("codex", {
      enabled: false,
      home: "/archives/codex",
    });
    expect(database.getProviderSourceSettings(defaultHomes, defaultProviders)).toContainEqual({
      provider: "codex",
      enabled: false,
      home: "/archives/codex",
      defaultHome: "/defaults/codex",
      customized: true,
    });

    database.updateProviderSourceSetting("codex", { enabled: true, home: null });
    expect(database.getProviderSourceSettings(defaultHomes, defaultProviders)).toContainEqual({
      provider: "codex",
      enabled: true,
      home: "/defaults/codex",
      defaultHome: "/defaults/codex",
      customized: false,
    });
  });

  test("migrates the two-provider constraint and indexes a new provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-session-search-provider-migration-"));
    const path = join(directory, "search.db");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE sessions (
        session_key TEXT PRIMARY KEY, source_session_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
        file_path TEXT NOT NULL UNIQUE, project_path TEXT, original_title TEXT NOT NULL,
        started_at TEXT NOT NULL, updated_at TEXT NOT NULL, message_count INTEGER NOT NULL,
        file_mtime_ms INTEGER NOT NULL, file_size INTEGER NOT NULL, indexed_at INTEGER NOT NULL
      );
    `);
    legacy.close();
    const database = new SearchDatabase(path);
    cleanup.push(async () => {
      database.close();
      await rm(directory, { recursive: true, force: true });
    });
    const session = { ...sampleSession(), sessionKey: "pi:session-1", provider: "pi" as const };
    database.upsertSession(session, { provider: "pi", path: session.filePath, mtimeMs: 1, size: 100 });
    expect(database.search({ query: "支付回调", provider: "pi" })[0]?.provider).toBe("pi");
  });
});
