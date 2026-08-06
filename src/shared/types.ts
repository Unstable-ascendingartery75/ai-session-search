export const PROVIDER_IDS = [
  "claude",
  "codex",
  "antigravity",
  "opencode",
  "copilot",
  "cursor",
  "kimi",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ResumeCommandTemplates = Partial<Record<ProviderId, string>>;

export const TERMINAL_IDS = [
  "terminal",
  "iterm2",
  "warp",
  "windows-terminal",
  "powershell",
  "cmd",
  "custom",
] as const;

export type TerminalId = (typeof TERMINAL_IDS)[number];

export type TerminalSettings = {
  terminal: TerminalId;
  customPath: string | null;
  shellPath: string;
};

export type RuntimePlatform = "darwin" | "win32" | "linux" | "other";

export type UpdateStatus =
  | "disabled"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdateState = {
  enabled: boolean;
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  downloadAvailable: boolean;
  ignored: boolean;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
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
  contextCount: number;
  createdAt: number;
  updatedAt: number;
};

export const CONTEXT_SNIPPET_SORTS = [
  "smart",
  "created-desc",
  "updated-desc",
  "last-copied-desc",
  "copies-desc",
] as const;

export type ContextSnippetSort = (typeof CONTEXT_SNIPPET_SORTS)[number];

export type ContextSnippetSummary = {
  id: number;
  title: string;
  preview: string;
  favorite: boolean;
  collectionId: number | null;
  copyCount: number;
  lastCopiedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ContextSnippetDetail = ContextSnippetSummary & {
  content: string;
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

export type ProviderSourceSetting = ProviderStatus & {
  defaultHome: string;
  customized: boolean;
  sessionCount: number;
};

export type SyncProgress = {
  running: boolean;
  revision: number;
  currentProvider: ProviderId | null;
  completedProviders: number;
  totalProviders: number;
  processedFiles: number;
  totalFiles: number;
};
