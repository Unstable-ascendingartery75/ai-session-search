import { basename, dirname, join, sep } from "node:path";
import { jsonlProvider, parseNestedMessage } from "./providerSupport.ts";
import type { ConversationProvider } from "./types.ts";

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
