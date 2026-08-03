import type { ParsedSession, ProviderId } from "../../shared/types.ts";

export type SessionFile = {
  provider: ProviderId;
  path: string;
  mtimeMs: number;
  size: number;
};

export type ConversationProvider = {
  id: ProviderId;
  home: string;
  sessionRoots: string[];
  discover: () => Promise<SessionFile[]>;
  parse: (file: SessionFile) => Promise<ParsedSession | null>;
};
