import type { DatabaseSync } from "node:sqlite";
import { isProviderId } from "../shared/providers.ts";
import { PROVIDER_IDS, type ProviderId, type SessionSummary } from "../shared/types.ts";

export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlRow = Record<string, SqlValue>;

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

const CONTEXT_FTS_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS context_snippets_fts USING fts5(
    snippet_id UNINDEXED,
    title,
    content,
    tokenize='trigram'
  )
`;

export const stringColumn = (row: SqlRow, key: string): string => {
  const value = row[key];
  return typeof value === "string" ? value : "";
};

export const nullableStringColumn = (row: SqlRow, key: string): string | null => {
  const value = row[key];
  return typeof value === "string" ? value : null;
};

export const numberColumn = (row: SqlRow, key: string): number => {
  const value = row[key];
  return typeof value === "number" ? value : Number(value ?? 0);
};

export const providerColumn = (row: SqlRow): ProviderId => {
  const provider = stringColumn(row, "provider");
  if (!isProviderId(provider)) throw new Error(`Unsupported provider stored in database: ${provider}`);
  return provider;
};

export const toSessionSummary = (row: SqlRow): SessionSummary => {
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

export const escapeFtsQuery = (query: string): string => `"${query.replace(/"/g, '""')}"`;
export const escapeLikeQuery = (query: string): string =>
  `%${query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

const migrateProviderConstraint = (database: DatabaseSync): void => {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
    .get() as SqlRow | undefined;
  const sql = row === undefined ? "" : stringColumn(row, "sql");
  if (!sql.includes("CHECK(provider IN ('claude', 'codex'))")) return;
  database.exec(`
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
      parser_version INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL
    );
    INSERT INTO sessions (
      session_key, source_session_id, provider, file_path, project_path,
      original_title, started_at, updated_at, message_count,
      file_mtime_ms, file_size, parser_version, indexed_at
    ) SELECT
      session_key, source_session_id, provider, file_path, project_path,
      original_title, started_at, updated_at, message_count,
      file_mtime_ms, file_size, 0, indexed_at
    FROM sessions_provider_v1;
    DROP TABLE sessions_provider_v1;
    CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
    COMMIT;
  `);
};

const removeUnsupportedProviderIndexes = (database: DatabaseSync): void => {
  const placeholders = PROVIDER_IDS.map(() => "?").join(", ");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`DELETE FROM messages_fts WHERE provider NOT IN (${placeholders})`).run(...PROVIDER_IDS);
    database.prepare(`DELETE FROM sessions WHERE provider NOT IN (${placeholders})`).run(...PROVIDER_IDS);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

export const initializeSearchDatabase = (database: DatabaseSync): void => {
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
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
      parser_version INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS context_snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
      collection_id INTEGER,
      copy_count INTEGER NOT NULL DEFAULT 0,
      last_copied_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_context_snippets_collection
      ON context_snippets(collection_id);
    CREATE INDEX IF NOT EXISTS idx_context_snippets_created_at
      ON context_snippets(created_at);
    CREATE INDEX IF NOT EXISTS idx_context_snippets_updated_at
      ON context_snippets(updated_at);
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  migrateProviderConstraint(database);
  const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all() as SqlRow[];
  if (!sessionColumns.some((row) => stringColumn(row, "name") === "parser_version")) {
    database.exec("ALTER TABLE sessions ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 0");
  }
  const metadataColumns = database.prepare("PRAGMA table_info(session_metadata)").all() as SqlRow[];
  if (!metadataColumns.some((row) => stringColumn(row, "name") === "collection_id")) {
    database.exec("ALTER TABLE session_metadata ADD COLUMN collection_id INTEGER");
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_session_metadata_collection ON session_metadata(collection_id)");
  database.exec(FTS_DDL);
  database.exec(CONTEXT_FTS_DDL);
  removeUnsupportedProviderIndexes(database);
};
