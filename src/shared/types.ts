export const PROVIDER_IDS = [
  "claude",
  "codex",
  "antigravity",
  "opencode",
  "hermes",
  "copilot",
  "droid",
  "openclaw",
  "cursor",
  "pi",
  "kimi",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ResumeCommandTemplates = Partial<Record<ProviderId, string>>;

export const TERMINAL_IDS = ["terminal", "iterm2", "warp", "custom"] as const;

export type TerminalId = (typeof TERMINAL_IDS)[number];

export type TerminalSettings = {
  terminal: TerminalId;
  customPath: string | null;
  shellPath: string;
};

export type ProviderDescriptor = {
  id: ProviderId;
  label: string;
  color: string;
  defaultResumeTemplate: string | null;
};

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

export type SyncProgress = {
  running: boolean;
  currentProvider: ProviderId | null;
  completedProviders: number;
  totalProviders: number;
  processedFiles: number;
  totalFiles: number;
};
