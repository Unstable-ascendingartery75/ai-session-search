import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type LegacyDatabaseMigrationResult = "copied" | "merged" | "skipped";

const MIGRATION_MARKER = "migration.legacy_desktop_database.v1";

export const desktopDataDirectoryOption = (argv: string[]): string | undefined => {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--data-dir") return argv[index + 1];
    if (argument?.startsWith("--data-dir=")) return argument.slice("--data-dir=".length);
  }
  return undefined;
};

type CollectionRow = {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
};

type MetadataRow = {
  session_key: string;
  custom_title: string | null;
  favorite: number;
  collection_id: number | null;
  updated_at: number;
};

type SettingRow = {
  key: string;
  value: string;
  updated_at: number;
};

const tableExists = (database: DatabaseSync, table: string): boolean =>
  database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;

const ensureMetadataSchema = (database: DatabaseSync): void => {
  database.exec(`
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
};

const quoteSqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const markMigrationComplete = (database: DatabaseSync): void => {
  ensureMetadataSchema(database);
  database.prepare(`
    INSERT INTO app_settings(key, value, updated_at)
    VALUES (?, '1', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(MIGRATION_MARKER, Date.now());
};

const copyLegacyDatabase = async (legacyPath: string, sharedPath: string): Promise<void> => {
  const source = new DatabaseSync(legacyPath, { readOnly: true });
  try {
    source.exec("PRAGMA busy_timeout = 5000");
    source.exec(`VACUUM INTO ${quoteSqlString(sharedPath)}`);
  } finally {
    source.close();
  }
  const copied = new DatabaseSync(sharedPath);
  try {
    markMigrationComplete(copied);
  } finally {
    copied.close();
  }
};

const mergeLegacyMetadata = (legacyPath: string, sharedPath: string): boolean => {
  const source = new DatabaseSync(legacyPath, { readOnly: true });
  const target = new DatabaseSync(sharedPath);
  try {
    target.exec("PRAGMA busy_timeout = 5000");
    ensureMetadataSchema(target);
    if (target.prepare("SELECT 1 FROM app_settings WHERE key = ?").get(MIGRATION_MARKER) !== undefined) {
      return false;
    }

    const collections = tableExists(source, "collections")
      ? source.prepare("SELECT id, name, created_at, updated_at FROM collections").all() as CollectionRow[]
      : [];
    const metadataColumns = tableExists(source, "session_metadata")
      ? source.prepare("PRAGMA table_info(session_metadata)").all() as Array<{ name: string }>
      : [];
    const collectionColumn = metadataColumns.some((column) => column.name === "collection_id")
      ? "collection_id"
      : "NULL AS collection_id";
    const metadata = metadataColumns.length > 0
      ? source.prepare(`
          SELECT session_key, custom_title, favorite, ${collectionColumn}, updated_at
          FROM session_metadata
        `).all() as MetadataRow[]
      : [];
    const settings = tableExists(source, "app_settings")
      ? source.prepare("SELECT key, value, updated_at FROM app_settings WHERE key != ?").all(MIGRATION_MARKER) as SettingRow[]
      : [];

    const insertCollection = target.prepare(`
      INSERT INTO collections(name, created_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO NOTHING
    `);
    const findCollection = target.prepare("SELECT id FROM collections WHERE name = ? COLLATE NOCASE");
    const findMetadata = target.prepare(`
      SELECT custom_title, favorite, collection_id, updated_at
      FROM session_metadata WHERE session_key = ?
    `);
    const upsertMetadata = target.prepare(`
      INSERT INTO session_metadata(session_key, custom_title, favorite, collection_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        custom_title = excluded.custom_title,
        favorite = excluded.favorite,
        collection_id = excluded.collection_id,
        updated_at = excluded.updated_at
    `);
    const findSetting = target.prepare("SELECT updated_at FROM app_settings WHERE key = ?");
    const upsertSetting = target.prepare(`
      INSERT INTO app_settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    target.exec("BEGIN IMMEDIATE");
    try {
      const collectionIds = new Map<number, number>();
      for (const collection of collections) {
        insertCollection.run(collection.name, collection.created_at, collection.updated_at);
        const row = findCollection.get(collection.name) as { id: number };
        collectionIds.set(collection.id, row.id);
      }

      for (const row of metadata) {
        const current = findMetadata.get(row.session_key) as Omit<MetadataRow, "session_key"> | undefined;
        const legacyCollectionId = row.collection_id === null ? null : collectionIds.get(row.collection_id) ?? null;
        const legacyTitleWins = row.custom_title !== null && (current === undefined || row.updated_at > current.updated_at);
        upsertMetadata.run(
          row.session_key,
          legacyTitleWins ? row.custom_title : current?.custom_title ?? row.custom_title,
          row.favorite === 1 || current?.favorite === 1 ? 1 : 0,
          current?.collection_id ?? legacyCollectionId,
          Math.max(row.updated_at, current?.updated_at ?? 0),
        );
      }

      for (const setting of settings) {
        const current = findSetting.get(setting.key) as { updated_at: number } | undefined;
        if (current === undefined || setting.updated_at > current.updated_at) {
          upsertSetting.run(setting.key, setting.value, setting.updated_at);
        }
      }
      markMigrationComplete(target);
      target.exec("COMMIT");
    } catch (error) {
      target.exec("ROLLBACK");
      throw error;
    }
    return true;
  } finally {
    source.close();
    target.close();
  }
};

export const migrateLegacyDesktopDatabase = async (
  legacyDataDirectory: string,
  sharedDataDirectory: string,
): Promise<LegacyDatabaseMigrationResult> => {
  if (resolve(legacyDataDirectory) === resolve(sharedDataDirectory)) return "skipped";
  const legacyPath = join(legacyDataDirectory, "search.db");
  const sharedPath = join(sharedDataDirectory, "search.db");
  if (!existsSync(legacyPath)) return "skipped";
  await mkdir(sharedDataDirectory, { recursive: true });
  if (!existsSync(sharedPath)) {
    await copyLegacyDatabase(legacyPath, sharedPath);
    return "copied";
  }
  return mergeLegacyMetadata(legacyPath, sharedPath) ? "merged" : "skipped";
};
