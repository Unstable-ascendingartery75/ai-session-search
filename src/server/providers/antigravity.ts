import { readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { discoverFiles, isRecord, readJsonl } from "./files.ts";
import { addMessage, createMutable, finishSession, textValue } from "./providerSupport.ts";
import type { ConversationProvider } from "./types.ts";

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
