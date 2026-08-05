import { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";
import type {
  CollectionSummary,
  NormalizedMessage,
  ParsedSession,
  ProviderId,
  ProviderSourceSetting,
  ResumeCommandTemplates,
  SearchResult,
  SessionSummary,
  TerminalSettings,
} from "../shared/types.ts";
import { DEFAULT_RESUME_COMMAND_TEMPLATES } from "../shared/resumeCommand.ts";
import { isProviderId } from "../shared/providers.ts";
import { PROVIDER_IDS } from "../shared/types.ts";
import { TERMINAL_IDS } from "../shared/types.ts";
import {
  defaultTerminalSettings,
  isValidShellReference,
  normalizeRuntimePlatform,
  terminalIdsForPlatform,
} from "../shared/terminal.ts";
import {
  escapeFtsQuery,
  escapeLikeQuery,
  initializeSearchDatabase,
  nullableStringColumn,
  numberColumn,
  providerColumn,
  stringColumn,
  toSessionSummary,
  type SqlRow,
  type SqlValue,
} from "./databaseCore.ts";
import type { SessionFile } from "./providers/types.ts";

export class SearchDatabase {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    initializeSearchDatabase(this.#db);
  }

  close(): void {
    this.#db.close();
  }

  getAppSetting(key: string): string | null {
    const row = this.#db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as SqlRow | undefined;
    return row === undefined ? null : stringColumn(row, "value");
  }

  setAppSetting(key: string, value: string): void {
    this.#db.prepare(`
      INSERT INTO app_settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(key, value, Date.now());
  }

  getIndexedFile(path: string): {
    sessionKey: string;
    mtimeMs: number;
    size: number;
    parserVersion: number;
  } | null {
    const row = this.#db
      .prepare(
        "SELECT session_key, file_mtime_ms, file_size, parser_version FROM sessions WHERE file_path = ?",
      )
      .get(path) as SqlRow | undefined;
    if (row === undefined) return null;
    return {
      sessionKey: stringColumn(row, "session_key"),
      mtimeMs: numberColumn(row, "file_mtime_ms"),
      size: numberColumn(row, "file_size"),
      parserVersion: numberColumn(row, "parser_version"),
    };
  }

  getIndexedFiles(provider: ProviderId): Map<string, {
    sessionKey: string;
    mtimeMs: number;
    size: number;
    parserVersion: number;
  }> {
    const rows = this.#db
      .prepare(
        "SELECT session_key, file_path, file_mtime_ms, file_size, parser_version FROM sessions WHERE provider = ? ORDER BY file_path",
      )
      .all(provider) as SqlRow[];
    return new Map(rows.map((row) => [
      stringColumn(row, "file_path"),
      {
        sessionKey: stringColumn(row, "session_key"),
        mtimeMs: numberColumn(row, "file_mtime_ms"),
        size: numberColumn(row, "file_size"),
        parserVersion: numberColumn(row, "parser_version"),
      },
    ]));
  }

  removeSessionIndex(sessionKey: string): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("DELETE FROM sessions WHERE session_key = ?").run(sessionKey);
      this.#db.prepare("DELETE FROM messages_fts WHERE session_key = ?").run(sessionKey);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertSession(session: ParsedSession, file: SessionFile, parserVersion = 1): void {
    const result = this.applyProviderIndexBatch({
      provider: session.provider,
      visibleFiles: null,
      removeSessionKeys: new Set(),
      upserts: [{ session, file, parserVersion }],
    });
    const failure = result.errors[0];
    if (failure !== undefined) throw new Error(failure.error);
  }

  applyProviderIndexBatch(options: {
    provider: ProviderId;
    visibleFiles: ReadonlySet<string> | null;
    removeSessionKeys: ReadonlySet<string>;
    retainSessionKeys?: ReadonlySet<string>;
    upserts: Array<{ session: ParsedSession; file: SessionFile; parserVersion: number }>;
  }): { indexed: number; removed: number; errors: Array<{ path: string; error: string }> } {
    for (const { session, file } of options.upserts) {
      if (session.provider !== options.provider || file.provider !== options.provider) {
        throw new Error(`Cannot apply ${session.provider}/${file.provider} session to ${options.provider} batch`);
      }
    }
    const insertSession = this.#db.prepare(`
      INSERT INTO sessions (
        session_key, source_session_id, provider, file_path, project_path,
        original_title, started_at, updated_at, message_count,
        file_mtime_ms, file_size, parser_version, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        parser_version=excluded.parser_version,
        indexed_at=excluded.indexed_at
    `);
    const deleteFts = this.#db.prepare("DELETE FROM messages_fts WHERE session_key = ?");
    const insertFts = this.#db.prepare(`
      INSERT INTO messages_fts (
        session_key, provider, project_path, role, timestamp, message_index, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const customTitle = this.#db.prepare(
      "SELECT custom_title FROM session_metadata WHERE session_key = ?",
    );
    const deleteSession = this.#db.prepare("DELETE FROM sessions WHERE session_key = ?");
    const existingRows = options.visibleFiles === null
      ? []
      : this.#db
          .prepare("SELECT session_key, file_path FROM sessions WHERE provider = ?")
          .all(options.provider) as SqlRow[];
    const upsertSessionKeys = new Set([
      ...options.upserts.map((entry) => entry.session.sessionKey),
      ...(options.retainSessionKeys ?? []),
    ]);
    const missingSessionKeys = new Set(existingRows.flatMap((row) => {
      const sessionKey = stringColumn(row, "session_key");
      return options.visibleFiles?.has(stringColumn(row, "file_path")) === false &&
        !upsertSessionKeys.has(sessionKey)
        ? [sessionKey]
        : [];
    }));
    const deleteSessionKeys = new Set([...options.removeSessionKeys, ...missingSessionKeys]);
    const errors: Array<{ path: string; error: string }> = [];
    let indexed = 0;
    const indexedAt = Date.now();

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const sessionKey of deleteSessionKeys) {
        deleteSession.run(sessionKey);
        deleteFts.run(sessionKey);
      }
      for (const { session, file, parserVersion } of options.upserts) {
        this.#db.exec("SAVEPOINT session_upsert");
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
            parserVersion,
            indexedAt,
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
          const metadata = customTitle.get(session.sessionKey) as SqlRow | undefined;
          const savedTitle = nullableStringColumn(metadata ?? {}, "custom_title");
          insertFts.run(
            session.sessionKey,
            session.provider,
            session.projectPath,
            "title",
            session.updatedAt,
            -1,
            savedTitle === null ? session.originalTitle : `${savedTitle}\n${session.originalTitle}`,
          );
          this.#db.exec("RELEASE SAVEPOINT session_upsert");
          indexed += 1;
        } catch (error) {
          this.#db.exec("ROLLBACK TO SAVEPOINT session_upsert");
          this.#db.exec("RELEASE SAVEPOINT session_upsert");
          errors.push({ path: file.path, error: String(error) });
        }
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { indexed, removed: missingSessionKeys.size, errors };
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

  getProviderSourceSettings(
    defaultHomes: Record<ProviderId, string>,
    defaultProviders: ReadonlySet<ProviderId>,
  ): Array<Pick<ProviderSourceSetting, "provider" | "enabled" | "home" | "defaultHome" | "customized">> {
    const rows = this.#db
      .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'provider_source.%'")
      .all() as SqlRow[];
    const values = new Map(rows.map((row) => [stringColumn(row, "key"), stringColumn(row, "value")]));
    return PROVIDER_IDS.map((provider) => {
      const defaultHome = defaultHomes[provider];
      const storedHome = values.get(`provider_source.${provider}.home`)?.trim();
      const customized = storedHome !== undefined && isAbsolute(storedHome);
      const storedEnabled = values.get(`provider_source.${provider}.enabled`);
      return {
        provider,
        enabled: storedEnabled === undefined ? defaultProviders.has(provider) : storedEnabled === "1",
        home: customized ? storedHome : defaultHome,
        defaultHome,
        customized,
      };
    });
  }

  updateProviderSourceSetting(
    provider: ProviderId,
    setting: { enabled: boolean; home: string | null },
  ): void {
    const home = setting.home?.trim() || null;
    if (home !== null && (!isAbsolute(home) || home.length > 2000)) {
      throw new Error("Provider home must be an absolute path no longer than 2000 characters");
    }
    const update = this.#db.prepare(`
      INSERT INTO app_settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      update.run(`provider_source.${provider}.enabled`, setting.enabled ? "1" : "0", Date.now());
      if (home === null) {
        this.#db.prepare("DELETE FROM app_settings WHERE key = ?").run(`provider_source.${provider}.home`);
      } else {
        update.run(`provider_source.${provider}.home`, home, Date.now());
      }
      this.#db.exec("COMMIT");
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

  getTerminalSettings(runtimePlatform: NodeJS.Platform = process.platform): TerminalSettings {
    const platform = normalizeRuntimePlatform(runtimePlatform);
    const defaults = defaultTerminalSettings(platform);
    const availableTerminals = terminalIdsForPlatform(platform);
    const rows = this.#db
      .prepare("SELECT key, value FROM app_settings WHERE key IN ('terminal.kind', 'terminal.custom_path', 'terminal.shell_path')")
      .all() as SqlRow[];
    const values = new Map(rows.map((row) => [stringColumn(row, "key"), stringColumn(row, "value")]));
    const storedTerminal = values.get("terminal.kind");
    const terminal = availableTerminals.includes(storedTerminal as TerminalSettings["terminal"])
      ? (storedTerminal as TerminalSettings["terminal"])
      : defaults.terminal;
    const customPath = values.get("terminal.custom_path")?.trim() || null;
    const environmentShell = process.env.SHELL?.trim();
    const defaultShellPath = platform === "win32"
      ? defaults.shellPath
      : environmentShell !== undefined && isAbsolute(environmentShell)
        ? environmentShell
        : defaults.shellPath;
    const storedShellPath = values.get("terminal.shell_path")?.trim();
    const shellPath = storedShellPath !== undefined && isValidShellReference(storedShellPath, platform)
      ? storedShellPath
      : defaultShellPath;
    return { terminal, customPath, shellPath };
  }

  updateTerminalSettings(
    settings: TerminalSettings,
    runtimePlatform: NodeJS.Platform = process.platform,
  ): TerminalSettings {
    const platform = normalizeRuntimePlatform(runtimePlatform);
    if (!TERMINAL_IDS.includes(settings.terminal) || !terminalIdsForPlatform(platform).includes(settings.terminal)) {
      throw new Error("Unsupported terminal on this platform");
    }
    const customPath = settings.customPath?.trim() || null;
    const shellPath = settings.shellPath.trim();
    if (customPath !== null && customPath.length > 1000) {
      throw new Error("Custom terminal path must not exceed 1000 characters");
    }
    if (settings.terminal === "custom" && customPath === null) {
      throw new Error("Custom terminal path is required");
    }
    if (!isValidShellReference(shellPath, platform) || shellPath.length > 1000) {
      throw new Error("Invalid shell executable");
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
