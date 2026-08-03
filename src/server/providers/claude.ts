import { basename, dirname, join, relative } from "node:path";
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

const extractTextItems = (content: unknown, expectedType?: string): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!isRecord(item)) return [];
      if (expectedType !== undefined && item.type !== expectedType) return [];
      const text = stringValue(item.text);
      return text === null ? [] : [text];
    })
    .join("\n");
};

const sourceIdFromPath = (filePath: string): string => basename(filePath, ".jsonl");

const isClaudeSidechainRecord = (record: unknown): boolean =>
  isRecord(record) && record.isSidechain === true;

const parseClaudeSession = async (home: string, file: SessionFile): Promise<ParsedSession | null> => {
  const messages: NormalizedMessage[] = [];
  let cwd: string | null = null;
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let firstTimestamp = "";
  let lastTimestamp = "";
  let isSidechain = false;

  await readJsonl(file.path, (record) => {
    if (!isRecord(record)) return;
    if (record.isSidechain === true) isSidechain = true;
    const type = stringValue(record.type);
    const timestamp = stringValue(record.timestamp) ?? "";
    if (timestamp !== "") {
      if (firstTimestamp === "") firstTimestamp = timestamp;
      lastTimestamp = timestamp;
    }
    if (cwd === null) cwd = stringValue(record.cwd);

    if (type === "custom-title") {
      customTitle = stringValue(record.customTitle);
      return;
    }
    if (type === "ai-title") {
      aiTitle = stringValue(record.aiTitle);
      return;
    }
    if (type !== "user" && type !== "assistant") return;

    const message = isRecord(record.message) ? record.message : null;
    if (message === null) return;
    const content =
      type === "user"
        ? extractTextItems(message.content)
        : extractTextItems(message.content, "text");
    if (content.trim() === "") return;

    messages.push({
      index: messages.length,
      role: type,
      content,
      timestamp,
    });
  });

  if (isSidechain || messages.length === 0) return null;
  const sourceSessionId = sourceIdFromPath(file.path);
  const relativePath = relative(join(home, "projects"), file.path);
  const projectDirectory = relativePath.split(/[\\/]/)[0] ?? basename(dirname(file.path));
  const fallbackTitle = messages.find((message) => message.role === "user")?.content ?? sourceSessionId;

  return {
    sessionKey: `claude:${projectDirectory}:${sourceSessionId}`,
    sourceSessionId,
    provider: "claude",
    filePath: file.path,
    projectPath: cwd,
    originalTitle: compactTitle(customTitle ?? aiTitle ?? fallbackTitle),
    startedAt: firstTimestamp || new Date(file.mtimeMs).toISOString(),
    updatedAt: lastTimestamp || new Date(file.mtimeMs).toISOString(),
    messages,
  };
};

export const createClaudeProvider = (home: string): ConversationProvider => {
  const sessionRoots = [join(home, "projects")];

  return {
    id: "claude",
    home,
    sessionRoots,
    discover: async () => {
      const files = await discoverJsonlFiles(sessionRoots);
      const visibleFiles = await Promise.all(files.map(async (file) => {
        if (basename(file.path).startsWith("agent-")) return null;
        if (isClaudeSidechainRecord(await readFirstJsonlRecord(file.path))) return null;
        return { ...file, provider: "claude" as const };
      }));
      return visibleFiles.filter((file) => file !== null);
    },
    parse: (file) => parseClaudeSession(home, file),
  };
};
