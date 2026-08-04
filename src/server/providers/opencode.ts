import { DatabaseSync } from "node:sqlite";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ProviderId } from "../../shared/types.ts";
import { discoverFiles, isRecord, stringValue } from "./files.ts";
import { addMessage, createMutable, finishSession, timestampValue } from "./providerSupport.ts";
import type { ConversationProvider, SessionFile } from "./types.ts";

const virtualFile = async (provider: ProviderId, dbPath: string, id: string): Promise<SessionFile> => {
  const info = await stat(dbPath);
  return { provider, path: `${dbPath}#${encodeURIComponent(id)}`, mtimeMs: info.mtimeMs, size: info.size };
};

const openReadOnly = (path: string): DatabaseSync | null => {
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
};

const tableHasColumn = (db: DatabaseSync, table: string, column: string): boolean =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>)
    .some((row) => row.name === column);

const decodeVirtualId = (path: string): { dbPath: string; id: string } | null => {
  const marker = path.lastIndexOf("#");
  if (marker < 0) return null;
  return { dbPath: path.slice(0, marker), id: decodeURIComponent(path.slice(marker + 1)) };
};

export const createOpenCodeProvider = (home: string): ConversationProvider => {
  const dbPath = join(home, "opencode.db");
  const storageRoot = join(home, "storage");
  const legacySessionsRoot = join(storageRoot, "session");
  return {
    id: "opencode",
    home,
    sessionRoots: [home, legacySessionsRoot],
    discover: async () => {
      const db = openReadOnly(dbPath);
      if (db !== null) {
        try {
          const hasParentId = tableHasColumn(db, "session", "parent_id");
          const rows = db.prepare(
            `SELECT id FROM session WHERE time_archived IS NULL${hasParentId ? " AND parent_id IS NULL" : ""}`,
          ).all() as Array<{ id: string }>;
          return await Promise.all(rows.map((row) => virtualFile("opencode", dbPath, row.id)));
        } catch {
          // A legacy installation may have an unrelated or incomplete database.
        } finally {
          db.close();
        }
      }
      return (await discoverFiles([legacySessionsRoot], (path) => /^ses_.*\.json$/i.test(basename(path))))
        .map((file) => ({ ...file, provider: "opencode" as const }));
    },
    parse: async (file) => {
      const virtual = decodeVirtualId(file.path);
      if (virtual === null) {
        let value: unknown;
        try { value = JSON.parse(await readFile(file.path, "utf8")); } catch { return null; }
        if (!isRecord(value)) return null;
        if (stringValue(value.parent_id) !== null || stringValue(value.parentID) !== null) return null;
        const session = createMutable(file);
        session.id = stringValue(value.id) ?? session.id;
        session.title = stringValue(value.title);
        session.cwd = stringValue(value.directory);
        const time = isRecord(value.time) ? value.time : null;
        session.startedAt = timestampValue(time?.created);
        session.updatedAt = timestampValue(time?.updated);
        const messageRoot = join(storageRoot, "message", session.id);
        const messageFiles = await discoverFiles([messageRoot], (path) => /^msg_.*\.json$/i.test(basename(path)));
        messageFiles.sort((left, right) => left.path.localeCompare(right.path));
        const allParts = await discoverFiles([join(storageRoot, "part")], (path) => path.endsWith(".json"));
        const textsByMessage = new Map<string, string[]>();
        for (const partFile of allParts) {
          try {
            const part: unknown = JSON.parse(await readFile(partFile.path, "utf8"));
            if (!isRecord(part) || (part.type !== "text" && part.type !== "reasoning")) continue;
            const text = stringValue(part.text);
            const messageId = stringValue(part.messageID) ?? basename(dirname(partFile.path));
            if (text !== null && text.trim() !== "") {
              const existing = textsByMessage.get(messageId) ?? [];
              existing.push(text);
              textsByMessage.set(messageId, existing);
            }
          } catch { /* Ignore a live partial part. */ }
        }
        for (const messageFile of messageFiles) {
          let message: unknown;
          try { message = JSON.parse(await readFile(messageFile.path, "utf8")); } catch { continue; }
          if (!isRecord(message)) continue;
          const messageId = stringValue(message.id) ?? basename(messageFile.path, ".json");
          const summary = isRecord(message.summary) ? message.summary : null;
          addMessage(session, message.role, (textsByMessage.get(messageId) ?? []).join("\n") || summary?.body || summary?.title, isRecord(message.time) ? message.time.created : undefined);
        }
        return finishSession("opencode", file, session);
      }
      const db = openReadOnly(virtual.dbPath);
      if (db === null) return null;
      try {
        const hasParentId = tableHasColumn(db, "session", "parent_id");
        const row = db.prepare(
          `SELECT id, title, directory, time_created, time_updated${hasParentId ? ", parent_id" : ""} FROM session WHERE id = ?`,
        ).get(virtual.id) as Record<string, unknown> | undefined;
        if (row === undefined) return null;
        if (typeof row.parent_id === "string") return null;
        const session = createMutable(file);
        session.id = String(row.id);
        session.title = typeof row.title === "string" ? row.title : null;
        session.cwd = typeof row.directory === "string" ? row.directory : null;
        session.startedAt = timestampValue(row.time_created);
        session.updatedAt = timestampValue(row.time_updated);
        const messages = db.prepare("SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created").all(virtual.id) as Array<Record<string, unknown>>;
        const partQuery = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created");
        for (const messageRow of messages) {
          let data: unknown;
          try { data = JSON.parse(String(messageRow.data)); } catch { continue; }
          if (!isRecord(data)) continue;
          const parts = partQuery.all(String(messageRow.id)) as Array<{ data: string }>;
          const texts: string[] = [];
          for (const partRow of parts) {
            try {
              const part: unknown = JSON.parse(partRow.data);
              if (isRecord(part) && (part.type === "text" || part.type === "reasoning")) {
                const text = stringValue(part.text);
                if (text !== null && text.trim() !== "") texts.push(text);
              }
            } catch { /* Ignore a live partial record. */ }
          }
          const summary = isRecord(data.summary) ? data.summary : null;
          addMessage(session, data.role, texts.join("\n") || summary?.body || summary?.title, messageRow.time_created);
        }
        return finishSession("opencode", file, session);
      } finally {
        db.close();
      }
    },
  };
};
