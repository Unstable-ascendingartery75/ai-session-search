import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { NormalizedMessage, ParsedSession } from "../../shared/types.ts";
import {
  compactTitle,
  discoverJsonlFiles,
  isRecord,
  readFirstJsonlRecord,
  readJsonl,
  stringValue,
} from "./files.ts";
import type { ConversationProvider, SessionFile } from "./types.ts";

const getPayload = (record: Record<string, unknown>): Record<string, unknown> | null =>
  isRecord(record.payload) ? record.payload : null;

const isSubagentSessionMeta = (record: unknown): boolean => {
  if (!isRecord(record) || record.type !== "session_meta") return false;
  const payload = getPayload(record);
  if (payload === null) return false;
  const source = payload.source;
  return (
    stringValue(payload.thread_source) === "subagent" ||
    (isRecord(source) && isRecord(source.subagent))
  );
};

const extractContentText = (content: unknown, type: "input_text" | "output_text"): string => {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) => {
      if (!isRecord(item) || item.type !== type) return [];
      const text = stringValue(item.text);
      return text === null ? [] : [text];
    })
    .join("\n");
};

const readSessionTitles = async (home: string): Promise<Map<string, string>> => {
  const titles = new Map<string, string>();
  let content: string;
  try {
    content = await readFile(join(home, "session_index.jsonl"), "utf8");
  } catch {
    return titles;
  }

  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const record: unknown = JSON.parse(line);
      if (!isRecord(record)) continue;
      const id = stringValue(record.id);
      const title = stringValue(record.thread_name);
      if (id !== null && title !== null && title.trim() !== "") titles.set(id, title);
    } catch {
      // Ignore incomplete index records. Session files remain the source of truth.
    }
  }
  return titles;
};

const sessionIdFromFileName = (path: string): string => {
  const name = basename(path, ".jsonl");
  const uuid = name.match(/([0-9a-f]{8}-[0-9a-f-]{27})$/i)?.[1];
  return uuid ?? name;
};

const parseCodexSession = async (
  file: SessionFile,
  titles: ReadonlyMap<string, string>,
): Promise<ParsedSession | null> => {
  const messages: NormalizedMessage[] = [];
  const fallbackUsers: Array<Omit<NormalizedMessage, "index">> = [];
  let sourceSessionId = sessionIdFromFileName(file.path);
  let cwd: string | null = null;
  let firstTimestamp = "";
  let lastTimestamp = "";
  let sessionMetaSeen = false;
  let isSubagent = false;

  await readJsonl(file.path, (record) => {
    if (!isRecord(record)) return;
    const timestamp = stringValue(record.timestamp) ?? "";
    if (timestamp !== "") {
      if (firstTimestamp === "") firstTimestamp = timestamp;
      lastTimestamp = timestamp;
    }
    const payload = getPayload(record);
    if (payload === null) return;

    if (record.type === "session_meta") {
      if (sessionMetaSeen) return;
      sessionMetaSeen = true;
      isSubagent = isSubagentSessionMeta(record);
      sourceSessionId = stringValue(payload.id) ?? stringValue(payload.session_id) ?? sourceSessionId;
      cwd = stringValue(payload.cwd) ?? cwd;
      return;
    }

    if (isSubagent) return;

    if (record.type === "event_msg" && payload.type === "user_message") {
      const content = stringValue(payload.message);
      if (content !== null && content.trim() !== "") {
        messages.push({ index: messages.length, role: "user", content, timestamp });
      }
      return;
    }

    if (record.type !== "response_item" || payload.type !== "message") return;
    if (payload.role === "assistant") {
      const content = extractContentText(payload.content, "output_text");
      if (content.trim() === "") return;
      const phase =
        payload.phase === "commentary" || payload.phase === "final_answer"
          ? payload.phase
          : undefined;
      messages.push({
        index: messages.length,
        role: "assistant",
        content,
        timestamp,
        ...(phase === undefined ? {} : { phase }),
      });
    } else if (payload.role === "user") {
      const content = extractContentText(payload.content, "input_text");
      if (content.trim() !== "") fallbackUsers.push({ role: "user", content, timestamp });
    }
  });

  if (!messages.some((message) => message.role === "user")) {
    for (const message of fallbackUsers) messages.push({ ...message, index: messages.length });
    messages.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    messages.forEach((message, index) => {
      message.index = index;
    });
  }

  if (isSubagent || messages.length === 0) return null;
  const fallbackTitle = messages.find((message) => message.role === "user")?.content ?? sourceSessionId;

  return {
    sessionKey: `codex:${sourceSessionId}`,
    sourceSessionId,
    provider: "codex",
    filePath: file.path,
    projectPath: cwd,
    originalTitle: compactTitle(titles.get(sourceSessionId) ?? fallbackTitle),
    startedAt: firstTimestamp || new Date(file.mtimeMs).toISOString(),
    updatedAt: lastTimestamp || new Date(file.mtimeMs).toISOString(),
    messages,
  };
};

export const createCodexProvider = (home: string): ConversationProvider => {
  const sessionRoots = [join(home, "sessions"), join(home, "archived_sessions")];

  return {
    id: "codex",
    home,
    sessionRoots,
    discover: async () => {
      const files = await discoverJsonlFiles(sessionRoots);
      const newestBySession = new Map<string, (typeof files)[number]>();
      for (const file of files) {
        const id = sessionIdFromFileName(file.path);
        const current = newestBySession.get(id);
        if (current === undefined || file.mtimeMs > current.mtimeMs) newestBySession.set(id, file);
      }
      const visibleFiles = [];
      for (const file of newestBySession.values()) {
        if (isSubagentSessionMeta(await readFirstJsonlRecord(file.path))) continue;
        visibleFiles.push({ ...file, provider: "codex" as const });
      }
      return visibleFiles;
    },
    parse: async (file) => parseCodexSession(file, await readSessionTitles(home)),
  };
};
