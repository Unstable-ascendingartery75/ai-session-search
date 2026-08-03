import { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";
import type {
  CollectionSummary,
  NormalizedMessage,
  ParsedSession,
  ProviderId,
  ResumeCommandTemplates,
  SearchResult,
  SessionSummary,
  TerminalSettings,
} from "../shared/types.ts";
import { DEFAULT_RESUME_COMMAND_TEMPLATES } from "../shared/resumeCommand.ts";
import { isProviderId } from "../shared/providers.ts";
import { PROVIDER_IDS } from "../shared/types.ts";
import { TERMINAL_IDS } from "../shared/types.ts";
import type { SessionFile } from "./providers/types.ts";

type SqlValue = string | number | bigint | Uint8Array | null;
type SqlRow = Record<string, SqlValue>;

const FTS_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    session_key UNINDEXED,
    provider UNINDEXED,
    project_path UNINDEXED,
    role UNINDEXED,
    timestamp UNINDEXED,
    message_index UNINDEXED,
    content,
    tokenize='trigram'
  )
`;

const stringColumn = (row: SqlRow, key: string): string => {
  const value = row[key];
  return typeof value === "string" ? value : "";
};

const nullableStringColumn = (row: SqlRow, key: string): string | null => {
  const value = row[key];
  return typeof value === "string" ? value : null;
};

const numberColumn = (row: SqlRow, key: string): number => {
  const value = row[key];
  return typeof value === "number" ? value : Number(value ?? 0);
};

const providerColumn = (row: SqlRow): ProviderId => {
  const provider = stringColumn(row, "provider");
  if (!isProviderId(provider)) throw new Error(`Unsupported provider stored in database: ${provider}`);
  return provider;
};

const toSessionSummary = (row: SqlRow): SessionSummary => {
  const originalTitle = stringColumn(row, "original_title");
  const customTitle = nullableStringColumn(row, "custom_title");
  return {
    sessionKey: stringColumn(row, "session_key"),
    sourceSessionId: stringColumn(row, "source_session_id"),
    provider: providerColumn(row),
    projectPath: nullableStringColumn(row, "project_path"),
    originalTitle,
    customTitle,
    displayTitle: customTitle ?? originalTitle,
    favorite: numberColumn(row, "favorite") === 1,
    collectionId:
      row.collection_id === null || row.collection_id === undefined
        ? null
        : numberColumn(row, "collection_id"),
    startedAt: stringColumn(row, "started_at"),
    updatedAt: stringColumn(row, "updated_at"),
    messageCount: numberColumn(row, "message_count"),
  };
};

const escapeFtsQuery = (query: string): string => `"${query.replace(/"/g, '""')}"`;
const escapeLikeQuery = (query: string): string =>
  `%${query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

export class SearchDatabase {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_key TEXT PRIMARY KEY,
        source_session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        project_path TEXT,
        original_title TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        file_mtime_ms INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_metadata (
        session_key TEXT PRIMARY KEY,
        custom_title TEXT,
        favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
        collection_id INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.#migrateProviderConstraint();
    const metadataColumns = this.#db.prepare("PRAGMA table_info(session_metadata)").all() as SqlRow[];
    if (!metadataColumns.some((row) => stringColumn(row, "name") === "collection_id")) {
      this.#db.exec("ALTER TABLE session_metadata ADD COLUMN collection_id INTEGER");
    }
    this.#db.exec(
      "CREATE INDEX IF NOT EXISTS idx_session_metadata_collection ON session_metadata(collection_id)",
    );
    this.#db.exec(FTS_DDL);
  }

  #migrateProviderConstraint(): void {
    const row = this.#db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get() as SqlRow | undefined;
    const sql = row === undefined ? "" : stringColumn(row, "sql");
    if (!sql.includes("CHECK(provider IN ('claude', 'codex'))")) return;
    this.#db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE sessions RENAME TO sessions_provider_v1;
      CREATE TABLE sessions (
        session_key TEXT PRIMARY KEY,
        source_session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        project_path TEXT,
        original_title TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        file_mtime_ms INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );
      INSERT INTO sessions SELECT * FROM sessions_provider_v1;
      DROP TABLE sessions_provider_v1;
      CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
      COMMIT;
    `);
  }

  close(): void {
    this.#db.close();
  }

  getIndexedFile(path: string): { mtimeMs: number; size: number } | null {
    const row = this.#db
      .prepare("SELECT file_mtime_ms, file_size FROM sessions WHERE file_path = ?")
      .get(path) as SqlRow | undefined;
    if (row === undefined) return null;
    return { mtimeMs: numberColumn(row, "file_mtime_ms"), size: numberColumn(row, "file_size") };
  }

  upsertSession(session: ParsedSession, file: SessionFile): void {
    const insertSession = this.#db.prepare(`
      INSERT INTO sessions (
        session_key, source_session_id, provider, file_path, project_path,
        original_title, started_at, updated_at, message_count,
        file_mtime_ms, file_size, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        source_session_id=excluded.source_session_id,
        provider=excluded.provider,
        file_path=excluded.file_path,
        project_path=excluded.project_path,
        original_title=excluded.original_title,
        started_at=excluded.started_at,
        updated_at=excluded.updated_at,
        message_count=excluded.message_count,
        file_mtime_ms=excluded.file_mtime_ms,
        file_size=excluded.file_size,
        indexed_at=excluded.indexed_at
    `);
    const deleteFts = this.#db.prepare("DELETE FROM messages_fts WHERE session_key = ?");
    const insertFts = this.#db.prepare(`
      INSERT INTO messages_fts (
        session_key, provider, project_path, role, timestamp, message_index, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      insertSession.run(
        session.sessionKey,
        session.sourceSessionId,
        session.provider,
        session.filePath,
        session.projectPath,
        session.originalTitle,
        session.startedAt,
        session.updatedAt,
        session.messages.length,
        Math.trunc(file.mtimeMs),
        file.size,
        Date.now(),
      );
      deleteFts.run(session.sessionKey);
      for (const message of session.messages) {
        insertFts.run(
          session.sessionKey,
          session.provider,
          session.projectPath,
          message.role,
          message.timestamp,
          message.index,
          message.content,
        );
      }
      this.#insertTitleFts(insertFts, session.sessionKey);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #insertTitleFts(statement: ReturnType<DatabaseSync["prepare"]>, sessionKey: string): void {
    const row = this.#db
      .prepare(`
        SELECT s.provider, s.project_path, s.updated_at, s.original_title, m.custom_title
        FROM sessions s
        LEFT JOIN session_metadata m ON m.session_key = s.session_key
        WHERE s.session_key = ?
      `)
      .get(sessionKey) as SqlRow | undefined;
    if (row === undefined) return;
    const originalTitle = stringColumn(row, "original_title");
    const customTitle = nullableStringColumn(row, "custom_title");
    const content = customTitle === null ? originalTitle : `${customTitle}\n${originalTitle}`;
    statement.run(
      sessionKey,
      stringColumn(row, "provider"),
      nullableStringColumn(row, "project_path"),
      "title",
      stringColumn(row, "updated_at"),
      -1,
      content,
    );
  }

  removeMissingFiles(provider: ProviderId, visibleFiles: ReadonlySet<string>): number {
    const rows = this.#db
      .prepare("SELECT session_key, file_path FROM sessions WHERE provider = ?")
      .all(provider) as SqlRow[];
    const removeSession = this.#db.prepare("DELETE FROM sessions WHERE session_key = ?");
    const removeFts = this.#db.prepare("DELETE FROM messages_fts WHERE session_key = ?");
    let removed = 0;

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        if (visibleFiles.has(stringColumn(row, "file_path"))) continue;
        const sessionKey = stringColumn(row, "session_key");
        removeSession.run(sessionKey);
        removeFts.run(sessionKey);
        removed += 1;
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return removed;
  }

  search(options: {
    query: string;
    provider?: ProviderId;
    projectPath?: string;
    favoritesOnly?: boolean;
    renamedOnly?: boolean;
    collectionId?: number | null;
    limit?: number;
  }): SearchResult[] {
    const query = options.query.trim();
    if (query === "") return [];
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const filters: string[] = [];
    const filterValues: SqlValue[] = [];
    if (options.provider !== undefined) {
      filters.push("s.provider = ?");
      filterValues.push(options.provider);
    }
    if (options.projectPath !== undefined && options.projectPath !== "") {
      filters.push("s.project_path = ?");
      filterValues.push(options.projectPath);
    }
    if (options.favoritesOnly === true) filters.push("COALESCE(m.favorite, 0) = 1");
    if (options.renamedOnly === true) {
      filters.push("m.custom_title IS NOT NULL AND TRIM(m.custom_title) != ''");
    }
    if (options.collectionId === null) filters.push("m.collection_id IS NULL");
    else if (options.collectionId !== undefined) {
      filters.push("m.collection_id = ?");
      filterValues.push(options.collectionId);
    }
    const extraWhere = filters.length === 0 ? "" : ` AND ${filters.join(" AND ")}`;

    const select = `
      SELECT f.session_key, s.source_session_id, s.provider, s.project_path,
             s.original_title, m.custom_title, COALESCE(m.favorite, 0) favorite, m.collection_id,
             s.started_at, s.updated_at, s.message_count,
             CAST(f.message_index AS INTEGER) message_index,
             f.role, f.content, f.rank
      FROM messages_fts f
      JOIN sessions s ON s.session_key = f.session_key
      LEFT JOIN session_metadata m ON m.session_key = f.session_key
    `;
    const idSelect = `
      SELECT s.session_key, s.source_session_id, s.provider, s.project_path,
             s.original_title, m.custom_title, COALESCE(m.favorite, 0) favorite, m.collection_id,
             s.started_at, s.updated_at, s.message_count,
             -1 message_index, 'title' role, s.source_session_id content, -1000000 rank
      FROM sessions s
      LEFT JOIN session_metadata m ON m.session_key = s.session_key
    `;
    const idLikeQuery = escapeLikeQuery(query);
    const idRows = this.#db
      .prepare(
        `${idSelect}
         WHERE (s.source_session_id LIKE ? ESCAPE '\\' COLLATE NOCASE
                OR s.session_key LIKE ? ESCAPE '\\' COLLATE NOCASE)${extraWhere}
         ORDER BY CASE
                    WHEN s.source_session_id = ? COLLATE NOCASE THEN 0
                    WHEN s.session_key = ? COLLATE NOCASE THEN 1
                    ELSE 2
                  END,
                  COALESCE(m.favorite, 0) DESC, s.updated_at DESC
         LIMIT ?`,
      )
      .all(idLikeQuery, idLikeQuery, query, query, ...filterValues, limit) as SqlRow[];
    const contentRows =
      query.length < 3
        ? (this.#db
            .prepare(
              `${select} WHERE f.content LIKE ? ESCAPE '\\'${extraWhere}
               ORDER BY COALESCE(m.favorite, 0) DESC, s.updated_at DESC LIMIT ?`,
            )
            .all(escapeLikeQuery(query), ...filterValues, limit) as SqlRow[])
        : (this.#db
            .prepare(
              `${select} WHERE messages_fts MATCH ?${extraWhere}
               ORDER BY (f.rank * CASE f.role WHEN 'title' THEN 1.5 WHEN 'user' THEN 1.15 ELSE 1 END),
                        s.updated_at DESC LIMIT ?`,
            )
            .all(escapeFtsQuery(query), ...filterValues, limit) as SqlRow[]);

    const idSessionKeys = new Set(idRows.map((row) => stringColumn(row, "session_key")));
    const rows = [
      ...idRows,
      ...contentRows.filter((row) => !idSessionKeys.has(stringColumn(row, "session_key"))),
    ].slice(0, limit);

    return rows.map((row) => {
      const summary = toSessionSummary(row);
      const content = stringColumn(row, "content");
      const matchIndex = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      const start = Math.max(0, matchIndex < 0 ? 0 : matchIndex - 60);
      const end = Math.min(content.length, start + 220);
      const rawRole = stringColumn(row, "role");
      const role = rawRole === "title" ? "title" : rawRole === "assistant" ? "assistant" : "user";
      return {
        ...summary,
        messageIndex: numberColumn(row, "message_index"),
        role,
        snippet: `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`,
        score: -numberColumn(row, "rank"),
      };
    });
  }

  listSessions(options?: {
    provider?: ProviderId;
    projectPath?: string;
    favoritesOnly?: boolean;
    renamedOnly?: boolean;
    collectionId?: number | null;
    limit?: number;
  }): SessionSummary[] {
    const filters: string[] = [];
    const values: SqlValue[] = [];
    if (options?.provider !== undefined) {
      filters.push("s.provider = ?");
      values.push(options.provider);
    }
    if (options?.projectPath !== undefined && options.projectPath !== "") {
      filters.push("s.project_path = ?");
      values.push(options.projectPath);
    }
    if (options?.favoritesOnly === true) filters.push("COALESCE(m.favorite, 0) = 1");
    if (options?.renamedOnly === true) {
      filters.push("m.custom_title IS NOT NULL AND TRIM(m.custom_title) != ''");
    }
    if (options?.collectionId === null) filters.push("m.collection_id IS NULL");
    else if (options?.collectionId !== undefined) {
      filters.push("m.collection_id = ?");
      values.push(options.collectionId);
    }
    const where = filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`;
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
    const rows = this.#db
      .prepare(`
        SELECT s.*, m.custom_title, COALESCE(m.favorite, 0) favorite, m.collection_id
        FROM sessions s
        LEFT JOIN session_metadata m ON m.session_key = s.session_key
        ${where}
        ORDER BY COALESCE(m.favorite, 0) DESC, s.updated_at DESC
        LIMIT ?
      `)
      .all(...values, limit) as SqlRow[];
    return rows.map(toSessionSummary);
  }

  getSession(sessionKey: string): { session: SessionSummary; messages: NormalizedMessage[] } | null {
    const sessionRow = this.#db
      .prepare(`
        SELECT s.*, m.custom_title, COALESCE(m.favorite, 0) favorite, m.collection_id
        FROM sessions s
        LEFT JOIN session_metadata m ON m.session_key = s.session_key
        WHERE s.session_key = ?
      `)
      .get(sessionKey) as SqlRow | undefined;
    if (sessionRow === undefined) return null;
    const messageRows = this.#db
      .prepare(`
        SELECT role, content, timestamp, CAST(message_index AS INTEGER) message_index
        FROM messages_fts
        WHERE session_key = ? AND role IN ('user', 'assistant')
        ORDER BY CAST(message_index AS INTEGER)
      `)
      .all(sessionKey) as SqlRow[];
    return {
      session: toSessionSummary(sessionRow),
      messages: messageRows.map((row) => ({
        index: numberColumn(row, "message_index"),
        role: stringColumn(row, "role") === "assistant" ? "assistant" : "user",
        content: stringColumn(row, "content"),
        timestamp: stringColumn(row, "timestamp"),
      })),
    };
  }

  updateMetadata(
    sessionKey: string,
    patch: { customTitle?: string | null; favorite?: boolean; collectionId?: number | null },
  ): SessionSummary | null {
    const sessionExists = this.#db
      .prepare("SELECT 1 present FROM sessions WHERE session_key = ?")
      .get(sessionKey);
    if (sessionExists === undefined) return null;
    const current = this.#db
      .prepare(
        "SELECT custom_title, favorite, collection_id FROM session_metadata WHERE session_key = ?",
      )
      .get(sessionKey) as SqlRow | undefined;
    const customTitle =
      patch.customTitle === undefined
        ? nullableStringColumn(current ?? {}, "custom_title")
        : patch.customTitle?.trim() || null;
    const favorite =
      patch.favorite === undefined
        ? numberColumn(current ?? {}, "favorite") === 1
        : patch.favorite;
    const collectionId =
      patch.collectionId === undefined
        ? current?.collection_id === null || current?.collection_id === undefined
          ? null
          : numberColumn(current, "collection_id")
        : patch.collectionId;
    if (collectionId !== null) {
      const collectionExists = this.#db
        .prepare("SELECT 1 present FROM collections WHERE id = ?")
        .get(collectionId);
      if (collectionExists === undefined) throw new Error("Collection not found");
    }
    this.#db
      .prepare(`
        INSERT INTO session_metadata(session_key, custom_title, favorite, collection_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_key) DO UPDATE SET
          custom_title=excluded.custom_title,
          favorite=excluded.favorite,
          collection_id=excluded.collection_id,
          updated_at=excluded.updated_at
      `)
      .run(sessionKey, customTitle, favorite ? 1 : 0, collectionId, Date.now());

    this.#db.prepare("DELETE FROM messages_fts WHERE session_key = ? AND role = 'title'").run(sessionKey);
    const insertFts = this.#db.prepare(`
      INSERT INTO messages_fts (
        session_key, provider, project_path, role, timestamp, message_index, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.#insertTitleFts(insertFts, sessionKey);
    return this.getSession(sessionKey)?.session ?? null;
  }

  createCollection(name: string): CollectionSummary {
    const normalized = name.replace(/\s+/g, " ").trim();
    if (normalized === "" || normalized.length > 100) {
      throw new Error("Collection name must contain 1 to 100 characters");
    }
    const now = Date.now();
    const result = this.#db
      .prepare("INSERT INTO collections(name, created_at, updated_at) VALUES (?, ?, ?)")
      .run(normalized, now, now);
    return { id: Number(result.lastInsertRowid), name: normalized, sessionCount: 0, createdAt: now, updatedAt: now };
  }

  listCollections(): CollectionSummary[] {
    const rows = this.#db
      .prepare(`
        SELECT c.id, c.name, c.created_at, c.updated_at, COUNT(s.session_key) session_count
        FROM collections c
        LEFT JOIN session_metadata m ON m.collection_id = c.id
        LEFT JOIN sessions s ON s.session_key = m.session_key
        GROUP BY c.id, c.name, c.created_at, c.updated_at
        ORDER BY c.name COLLATE NOCASE
      `)
      .all() as SqlRow[];
    return rows.map((row) => ({
      id: numberColumn(row, "id"),
      name: stringColumn(row, "name"),
      sessionCount: numberColumn(row, "session_count"),
      createdAt: numberColumn(row, "created_at"),
      updatedAt: numberColumn(row, "updated_at"),
    }));
  }

  renameCollection(id: number, name: string): CollectionSummary | null {
    const normalized = name.replace(/\s+/g, " ").trim();
    if (normalized === "" || normalized.length > 100) {
      throw new Error("Collection name must contain 1 to 100 characters");
    }
    const result = this.#db
      .prepare("UPDATE collections SET name = ?, updated_at = ? WHERE id = ?")
      .run(normalized, Date.now(), id);
    if (result.changes === 0) return null;
    return this.listCollections().find((collection) => collection.id === id) ?? null;
  }

  deleteCollection(id: number): boolean {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare("UPDATE session_metadata SET collection_id = NULL, updated_at = ? WHERE collection_id = ?")
        .run(Date.now(), id);
      const result = this.#db.prepare("DELETE FROM collections WHERE id = ?").run(id);
      this.#db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  getResumeCommandTemplates(): ResumeCommandTemplates {
    const templates = { ...DEFAULT_RESUME_COMMAND_TEMPLATES };
    const rows = this.#db
      .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'resume_command_template.%'")
      .all() as SqlRow[];
    for (const row of rows) {
      const provider = stringColumn(row, "key").replace("resume_command_template.", "");
      if (isProviderId(provider)) {
        templates[provider] = stringColumn(row, "value");
      }
    }
    return templates;
  }

  updateResumeCommandTemplate(
    provider: ProviderId,
    template: string,
  ): ResumeCommandTemplates {
    const normalized = template.trim();
    if (normalized === "" || normalized.length > 500) {
      throw new Error("Resume command template must contain 1 to 500 characters");
    }
    this.#db
      .prepare(`
        INSERT INTO app_settings(key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
      `)
      .run(`resume_command_template.${provider}`, normalized, Date.now());
    return this.getResumeCommandTemplates();
  }

  getTerminalSettings(): TerminalSettings {
    const rows = this.#db
      .prepare("SELECT key, value FROM app_settings WHERE key IN ('terminal.kind', 'terminal.custom_path', 'terminal.shell_path')")
      .all() as SqlRow[];
    const values = new Map(rows.map((row) => [stringColumn(row, "key"), stringColumn(row, "value")]));
    const storedTerminal = values.get("terminal.kind");
    const terminal = TERMINAL_IDS.includes(storedTerminal as TerminalSettings["terminal"])
      ? (storedTerminal as TerminalSettings["terminal"])
      : "terminal";
    const customPath = values.get("terminal.custom_path")?.trim() || null;
    const environmentShell = process.env.SHELL?.trim();
    const defaultShellPath =
      environmentShell !== undefined && isAbsolute(environmentShell) ? environmentShell : "/bin/zsh";
    const storedShellPath = values.get("terminal.shell_path")?.trim();
    const shellPath = storedShellPath !== undefined && isAbsolute(storedShellPath)
      ? storedShellPath
      : defaultShellPath;
    return { terminal, customPath, shellPath };
  }

  updateTerminalSettings(settings: TerminalSettings): TerminalSettings {
    if (!TERMINAL_IDS.includes(settings.terminal)) throw new Error("Unsupported terminal");
    const customPath = settings.customPath?.trim() || null;
    const shellPath = settings.shellPath.trim();
    if (customPath !== null && customPath.length > 1000) {
      throw new Error("Custom terminal path must not exceed 1000 characters");
    }
    if (settings.terminal === "custom" && customPath === null) {
      throw new Error("Custom terminal path is required");
    }
    if (!isAbsolute(shellPath) || shellPath.length > 1000) {
      throw new Error("Shell path must be an absolute path with at most 1000 characters");
    }
    const update = this.#db.prepare(`
      INSERT INTO app_settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `);
    const now = Date.now();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      update.run("terminal.kind", settings.terminal, now);
      update.run("terminal.custom_path", customPath ?? "", now);
      update.run("terminal.shell_path", shellPath, now);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { terminal: settings.terminal, customPath, shellPath };
  }

  listProjects(): Array<{ provider: ProviderId; projectPath: string; count: number }> {
    const rows = this.#db
      .prepare(`
        SELECT provider, project_path, COUNT(*) count
        FROM sessions
        WHERE project_path IS NOT NULL AND project_path != ''
        GROUP BY provider, project_path
        ORDER BY project_path
      `)
      .all() as SqlRow[];
    return rows.map((row) => ({
      provider: providerColumn(row),
      projectPath: stringColumn(row, "project_path"),
      count: numberColumn(row, "count"),
    }));
  }

  countSessions(): Record<ProviderId, number> {
    const result = Object.fromEntries(PROVIDER_IDS.map((provider) => [provider, 0])) as Record<ProviderId, number>;
    const rows = this.#db
      .prepare("SELECT provider, COUNT(*) count FROM sessions GROUP BY provider")
      .all() as SqlRow[];
    for (const row of rows) result[providerColumn(row)] = numberColumn(row, "count");
    return result;
  }
}
