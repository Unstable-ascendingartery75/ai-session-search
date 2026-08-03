export type ProviderId = "claude" | "codex";

export type ResumeCommandTemplates = Record<ProviderId, string>;

export type MessageRole = "user" | "assistant";

export type NormalizedMessage = {
  index: number;
  role: MessageRole;
  content: string;
  timestamp: string;
  phase?: "commentary" | "final_answer";
};

export type ParsedSession = {
  sessionKey: string;
  sourceSessionId: string;
  provider: ProviderId;
  filePath: string;
  projectPath: string | null;
  originalTitle: string;
  startedAt: string;
  updatedAt: string;
  messages: NormalizedMessage[];
};

export type SessionSummary = {
  sessionKey: string;
  sourceSessionId: string;
  provider: ProviderId;
  projectPath: string | null;
  originalTitle: string;
  customTitle: string | null;
  displayTitle: string;
  favorite: boolean;
  collectionId: number | null;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
};

export type CollectionSummary = {
  id: number;
  name: string;
  sessionCount: number;
  createdAt: number;
  updatedAt: number;
};

export type SearchResult = SessionSummary & {
  messageIndex: number;
  role: MessageRole | "title";
  snippet: string;
  score: number;
};

export type ProviderStatus = {
  provider: ProviderId;
  enabled: boolean;
  home: string;
  detected: boolean;
  sessionRoots: string[];
};
