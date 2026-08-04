import { DEFAULT_RESUME_COMMAND_TEMPLATES } from "./resumeCommand.ts";
import { PROVIDER_IDS, type ProviderDescriptor, type ProviderId } from "./types.ts";

const labels: Record<ProviderId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  copilot: "GitHub Copilot CLI",
  cursor: "Cursor",
  kimi: "Kimi Code",
};

const colors: Record<ProviderId, string> = {
  claude: "#b85c2d",
  codex: "#176b55",
  antigravity: "#6d5bd0",
  opencode: "#2f6feb",
  copilot: "#24292f",
  cursor: "#111827",
  kimi: "#2563eb",
};

export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = PROVIDER_IDS.map((id) => ({
  id,
  label: labels[id],
  color: colors[id],
  defaultResumeTemplate: DEFAULT_RESUME_COMMAND_TEMPLATES[id] ?? null,
}));

export const isProviderId = (value: string): value is ProviderId =>
  (PROVIDER_IDS as readonly string[]).includes(value);

export const providerDescriptor = (id: ProviderId): ProviderDescriptor =>
  PROVIDER_DESCRIPTORS.find((item) => item.id === id) as ProviderDescriptor;
