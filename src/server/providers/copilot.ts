import { basename, dirname, join } from "node:path";
import { isRecord, stringValue } from "./files.ts";
import { addMessage, jsonlProvider } from "./providerSupport.ts";
import type { ConversationProvider } from "./types.ts";

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
