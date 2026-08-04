import { DatabaseSync } from "node:sqlite";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import type { NormalizedMessage, ParsedSession, ProviderId } from "../../shared/types.ts";
import { compactTitle, discoverFiles, discoverJsonlFiles, isRecord, readJsonl, stringValue } from "./files.ts";
import type { ConversationProvider, SessionFile } from "./types.ts";

type MutableSession = {
  id: string;
  cwd: string | null;
  title: string | null;
  startedAt: string;
  updatedAt: string;
  messages: NormalizedMessage[];
};

const timestampValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  return "";
};

const textValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === "string") return [item];
        if (!isRecord(item)) return [];
        if (item.type === "thinking" || item.type === "think" || item.type === "tool_use" || item.type === "tool_result") return [];
        const text = stringValue(item.text) ?? stringValue(item.content);
        return text === null ? [] : [text];
      })
      .join("\n");
  }
  if (!isRecord(value)) return "";
  return stringValue(value.text) ?? stringValue(value.content) ?? stringValue(value.message) ?? "";
};

const createMutable = (file: SessionFile): MutableSession => ({
  id: basename(file.path).replace(/\.(jsonl|json|md)$/i, ""),
  cwd: null,
  title: null,
  startedAt: "",
  updatedAt: "",
  messages: [],
});

const addMessage = (
  session: MutableSession,
  role: unknown,
  content: unknown,
  timestamp: unknown,
): void => {
  const normalizedRole = typeof role === "string" ? role.toLowerCase() : "";
  if (normalizedRole !== "user" && normalizedRole !== "assistant" && normalizedRole !== "model") return;
  const text = textValue(content).trim();
  if (text === "") return;
  const time = timestampValue(timestamp);
  if (time !== "") {
    if (session.startedAt === "") session.startedAt = time;
    session.updatedAt = time;
  }
  session.messages.push({
    index: session.messages.length,
    role: normalizedRole === "user" ? "user" : "assistant",
    content: text,
    timestamp: time,
  });
};

const finishSession = (
  provider: ProviderId,
  file: SessionFile,
  session: MutableSession,
): ParsedSession | null => {
  if (session.messages.length === 0) return null;
  const fallbackTitle = session.messages.find((message) => message.role === "user")?.content ?? session.id;
  const fallbackTime = new Date(file.mtimeMs).toISOString();
  return {
    sessionKey: `${provider}:${session.id}`,
    sourceSessionId: session.id,
    provider,
    filePath: file.path,
    projectPath: session.cwd,
    originalTitle: compactTitle(session.title ?? fallbackTitle),
    startedAt: session.startedAt || fallbackTime,
    updatedAt: session.updatedAt || fallbackTime,
    messages: session.messages,
  };
};

const jsonlProvider = (options: {
  id: ProviderId;
  home: string;
  roots: string[];
  include?: (path: string) => boolean;
  parseRecord: (record: Record<string, unknown>, session: MutableSession, file: SessionFile) => void;
}): ConversationProvider => ({
  id: options.id,
  home: options.home,
  sessionRoots: options.roots,
  discover: async () =>
    (await discoverJsonlFiles(options.roots, options.include)).map((file) => ({
      ...file,
      provider: options.id,
    })),
  parse: async (file) => {
    const session = createMutable(file);
    await readJsonl(file.path, (record) => {
      if (isRecord(record)) options.parseRecord(record, session, file);
    });
    return finishSession(options.id, file, session);
  },
});

const parseNestedMessage = (record: Record<string, unknown>, session: MutableSession): void => {
  const message = isRecord(record.message) ? record.message : record;
  session.id = stringValue(record.session_id) ?? stringValue(record.sessionId) ?? stringValue(record.id) ?? session.id;
  session.cwd = stringValue(record.cwd) ?? stringValue(record.working_directory) ?? session.cwd;
  session.title = stringValue(record.title) ?? session.title;
  addMessage(session, message.role ?? record.role, message.content ?? message.text ?? record.content ?? record.text, record.timestamp ?? message.timestamp);
};

export const createCursorProvider = (home: string): ConversationProvider => {
  const isPrimaryTranscript = (path: string): boolean => {
    const transcriptDirectory = dirname(path);
    return (
      basename(dirname(transcriptDirectory)) === "agent-transcripts" &&
      basename(path, ".jsonl") === basename(transcriptDirectory)
    );
  };
  const provider = jsonlProvider({
    id: "cursor",
    home,
    roots: [join(home, "projects")],
    include: isPrimaryTranscript,
    parseRecord: (record, session, file) => {
      parseNestedMessage(record, session);
      const parts = file.path.split(sep);
      const transcriptIndex = parts.lastIndexOf("agent-transcripts");
      if (transcriptIndex > 0 && session.cwd === null) session.cwd = parts[transcriptIndex - 1] ?? null;
      if (transcriptIndex >= 0 && parts[transcriptIndex + 1]) session.id = parts[transcriptIndex + 1] as string;
    },
  });
  return {
    ...provider,
    parserVersion: 2,
    parse: (file) => isPrimaryTranscript(file.path) ? provider.parse(file) : Promise.resolve(null),
  };
};

export const createCopilotProvider = (home: string): ConversationProvider =>
  jsonlProvider({
    id: "copilot",
    home,
    roots: [join(home, "session-state")],
    include: (path) => basename(path) === "events.jsonl" || dirname(path).endsWith("session-state"),
    parseRecord: (record, session, file) => {
      const data = isRecord(record.data) ? record.data : record;
      if (stringValue(record.agentId) !== null || stringValue(data.agentId) !== null) return;
      const type = stringValue(record.type) ?? stringValue(data.type) ?? "";
      session.id = stringValue(data.sessionId) ?? (basename(file.path) === "events.jsonl" ? basename(dirname(file.path)) : session.id);
      if (type === "session.info") session.cwd = stringValue(data.cwd) ?? stringValue(data.path) ?? session.cwd;
      if (type === "user.message") addMessage(session, "user", data.content ?? data.message, record.timestamp ?? data.timestamp);
      if (type === "assistant.message") addMessage(session, "assistant", data.content ?? data.message, record.timestamp ?? data.timestamp);
    },
  });

const stripUserRequest = (value: string): string => {
  const match = value.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  return (match?.[1] ?? value).trim();
};

export const createAntigravityProvider = (home: string): ConversationProvider => {
  const roots = basename(home) === ".gemini"
    ? [join(home, "antigravity", "brain"), join(home, "antigravity-cli", "brain")]
    : [home];
  return {
  id: "antigravity",
  home,
  sessionRoots: roots,
  discover: async () =>
    (await discoverFiles(roots, (path) => {
      if (basename(path) === "transcript.jsonl") return true;
      if (!path.endsWith(".md")) return false;
      const owningRoot = roots.find((root) => path.startsWith(root));
      return owningRoot !== undefined && relative(owningRoot, path).split(sep).length === 2;
    })).map((file) => ({
      ...file,
      provider: "antigravity" as const,
    })),
  parse: async (file) => {
    const session = createMutable(file);
    const owningRoot = roots.find((root) => file.path.startsWith(root)) ?? home;
    const relativeParts = relative(owningRoot, file.path).split(sep);
    if (relativeParts.length > 1) session.id = relativeParts[0] as string;
    if (file.path.endsWith(".md")) {
      const content = (await readFile(file.path, "utf8")).trim();
      if (content === "") return null;
      session.title = content.match(/^#+\s+(.+)$/m)?.[1] ?? null;
      addMessage(session, "assistant", content, file.mtimeMs);
    } else {
      await readJsonl(file.path, (value) => {
        if (!isRecord(value)) return;
        const source = String(value.source ?? "").toUpperCase();
        const type = String(value.type ?? "").toUpperCase();
        const content = type === "USER_INPUT" ? stripUserRequest(textValue(value.content)) : value.content ?? value.thinking;
        if (source === "USER_EXPLICIT" || type === "USER_INPUT") addMessage(session, "user", content, value.created_at);
        else if (source === "MODEL") addMessage(session, "assistant", content, value.created_at);
      });
    }
    return finishSession("antigravity", file, session);
  },
};
};

export const createKimiProvider = (home: string): ConversationProvider => {
  const provider = jsonlProvider({
    id: "kimi",
    home,
    roots: [join(home, "sessions")],
    include: (path) => path.endsWith(`${sep}agents${sep}main${sep}wire.jsonl`),
    parseRecord: (record, session, file) => {
      const parts = file.path.split(sep);
      const agentsIndex = parts.lastIndexOf("agents");
      if (agentsIndex > 0) session.id = parts[agentsIndex - 1] as string;
      if (record.type === "context.append_message" && isRecord(record.message)) {
        addMessage(session, record.message.role, record.message.content, record.time);
      }
      if (record.type === "context.append_loop_event" && isRecord(record.event) && record.event.type === "content.part" && isRecord(record.event.part) && record.event.part.type === "text") {
        addMessage(session, "assistant", record.event.part.text, record.time);
      }
    },
  });
  return {
    ...provider,
    parse: async (file) => {
      const parsed = await provider.parse(file);
      if (parsed === null) return null;
      const sessionDirectory = dirname(dirname(dirname(file.path)));
      try {
        const state: unknown = JSON.parse(await readFile(join(sessionDirectory, "state.json"), "utf8"));
        if (!isRecord(state)) return parsed;
        const workDir = stringValue(state.workDir);
        const title = stringValue(state.customTitle) ?? stringValue(state.title) ?? stringValue(state.lastPrompt);
        return {
          ...parsed,
          projectPath: workDir ?? parsed.projectPath,
          originalTitle: title === null ? parsed.originalTitle : compactTitle(title),
        };
      } catch {
        return parsed;
      }
    },
  };
};

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
