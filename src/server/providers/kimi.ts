import { readFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { compactTitle, isRecord, stringValue } from "./files.ts";
import { addMessage, jsonlProvider } from "./providerSupport.ts";
import type { ConversationProvider } from "./types.ts";

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
