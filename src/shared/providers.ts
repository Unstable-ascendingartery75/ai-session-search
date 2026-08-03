import { DEFAULT_RESUME_COMMAND_TEMPLATES } from "./resumeCommand.ts";
import { PROVIDER_IDS, type ProviderDescriptor, type ProviderId } from "./types.ts";

const labels: Record<ProviderId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  hermes: "Hermes",
  copilot: "GitHub Copilot CLI",
  droid: "Droid",
  openclaw: "OpenClaw",
  cursor: "Cursor",
  pi: "Pi",
  kimi: "Kimi Code",
};

const colors: Record<ProviderId, string> = {
  claude: "#b85c2d",
  codex: "#176b55",
  antigravity: "#6d5bd0",
  opencode: "#2f6feb",
  hermes: "#9254de",
  copilot: "#24292f",
  droid: "#d97706",
  openclaw: "#dc2626",
  cursor: "#111827",
  pi: "#0891b2",
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
