import { basename } from "node:path";
import type { NormalizedMessage, ParsedSession, ProviderId } from "../../shared/types.ts";
import { compactTitle, discoverJsonlFiles, isRecord, readJsonl, stringValue } from "./files.ts";
import type { ConversationProvider, SessionFile } from "./types.ts";

export type MutableSession = {
  id: string;
  cwd: string | null;
  title: string | null;
  startedAt: string;
  updatedAt: string;
  messages: NormalizedMessage[];
};

export const timestampValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  return "";
};

export const textValue = (value: unknown): string => {
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

export const createMutable = (file: SessionFile): MutableSession => ({
  id: basename(file.path).replace(/\.(jsonl|json|md)$/i, ""),
  cwd: null,
  title: null,
  startedAt: "",
  updatedAt: "",
  messages: [],
});

export const addMessage = (
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

export const finishSession = (
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

export const jsonlProvider = (options: {
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

export const parseNestedMessage = (record: Record<string, unknown>, session: MutableSession): void => {
  const message = isRecord(record.message) ? record.message : record;
  session.id = stringValue(record.session_id) ?? stringValue(record.sessionId) ?? stringValue(record.id) ?? session.id;
  session.cwd = stringValue(record.cwd) ?? stringValue(record.working_directory) ?? session.cwd;
  session.title = stringValue(record.title) ?? session.title;
  addMessage(session, message.role ?? record.role, message.content ?? message.text ?? record.content ?? record.text, record.timestamp ?? message.timestamp);
};
