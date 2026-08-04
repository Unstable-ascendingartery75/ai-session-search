import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { desktopDataDirectoryOption, migrateLegacyDesktopDatabase } from "./dataDirectory.ts";

const createDatabase = (path: string): DatabaseSync => {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE session_metadata (
      session_key TEXT PRIMARY KEY,
      custom_title TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      collection_id INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return database;
};

describe("migrateLegacyDesktopDatabase", () => {
  test("reads a desktop --data-dir override without consuming Electron arguments", () => {
    expect(desktopDataDirectoryOption(["app", "--data-dir", "/tmp/shared-data"])).toBe("/tmp/shared-data");
    expect(desktopDataDirectoryOption(["app", "--data-dir=/tmp/shared-data"])).toBe("/tmp/shared-data");
    expect(desktopDataDirectoryOption(["app", "--inspect"])).toBeUndefined();
  });

  test("copies a legacy desktop database when the shared database does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-session-search-desktop-data-"));
    const legacyDirectory = join(root, "AI Session Search");
    const sharedDirectory = join(root, "ai-session-search");
    await mkdir(legacyDirectory);
    const legacy = createDatabase(join(legacyDirectory, "search.db"));
    legacy.prepare("INSERT INTO session_metadata VALUES (?, ?, ?, ?, ?)")
      .run("codex:one", "Legacy title", 1, null, 10);
    legacy.prepare("INSERT INTO app_settings VALUES (?, ?, ?)")
      .run("resume_command_template.codex", "yolo resume {sessionId}", 10);
    legacy.close();

    await expect(migrateLegacyDesktopDatabase(legacyDirectory, sharedDirectory)).resolves.toBe("copied");

    const shared = new DatabaseSync(join(sharedDirectory, "search.db"), { readOnly: true });
    expect(shared.prepare("SELECT custom_title, favorite FROM session_metadata").get()).toEqual({
      custom_title: "Legacy title",
      favorite: 1,
    });
    expect(shared.prepare("SELECT value FROM app_settings WHERE key = ?")
      .get("resume_command_template.codex")).toEqual({ value: "yolo resume {sessionId}" });
    shared.close();
  });

  test("merges user metadata without overwriting shared favorites or collections", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-session-search-desktop-data-"));
    const legacyDirectory = join(root, "AI Session Search");
    const sharedDirectory = join(root, "ai-session-search");
    await Promise.all([mkdir(legacyDirectory), mkdir(sharedDirectory)]);

    const legacy = createDatabase(join(legacyDirectory, "search.db"));
    legacy.prepare("INSERT INTO collections VALUES (?, ?, ?, ?)").run(1, "Legacy folder", 10, 10);
    legacy.prepare("INSERT INTO session_metadata VALUES (?, ?, ?, ?, ?)")
      .run("codex:one", "Legacy title", 0, 1, 20);
    legacy.prepare("INSERT INTO session_metadata VALUES (?, ?, ?, ?, ?)")
      .run("codex:two", null, 1, null, 20);
    legacy.prepare("INSERT INTO app_settings VALUES (?, ?, ?)")
      .run("terminal.kind", "iterm2", 20);
    legacy.close();

    const shared = createDatabase(join(sharedDirectory, "search.db"));
    shared.prepare("INSERT INTO collections VALUES (?, ?, ?, ?)").run(7, "Shared folder", 10, 10);
    shared.prepare("INSERT INTO session_metadata VALUES (?, ?, ?, ?, ?)")
      .run("codex:one", "Shared title", 1, 7, 10);
    shared.prepare("INSERT INTO app_settings VALUES (?, ?, ?)")
      .run("terminal.kind", "terminal", 10);
    shared.close();

    await expect(migrateLegacyDesktopDatabase(legacyDirectory, sharedDirectory)).resolves.toBe("merged");

    const migrated = new DatabaseSync(join(sharedDirectory, "search.db"), { readOnly: true });
    expect(migrated.prepare(
      "SELECT custom_title, favorite, collection_id FROM session_metadata WHERE session_key = ?",
    ).get("codex:one")).toEqual({ custom_title: "Legacy title", favorite: 1, collection_id: 7 });
    expect(migrated.prepare(
      "SELECT favorite FROM session_metadata WHERE session_key = ?",
    ).get("codex:two")).toEqual({ favorite: 1 });
    expect(migrated.prepare("SELECT name FROM collections ORDER BY name").all()).toEqual([
      { name: "Legacy folder" },
      { name: "Shared folder" },
    ]);
    expect(migrated.prepare("SELECT value FROM app_settings WHERE key = ?").get("terminal.kind"))
      .toEqual({ value: "iterm2" });
    migrated.close();

    await expect(migrateLegacyDesktopDatabase(legacyDirectory, sharedDirectory)).resolves.toBe("skipped");
  });
});
