import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PROVIDER_IDS, type ProviderId } from "../../shared/types.ts";
import { createClaudeProvider } from "./claude.ts";
import { createCodexProvider } from "./codex.ts";
import {
  createAntigravityProvider,
  createCopilotProvider,
  createCursorProvider,
  createDroidProvider,
  createHermesProvider,
  createKimiProvider,
  createOpenClawProvider,
  createOpenCodeProvider,
  createPiProvider,
} from "./additional.ts";
import type { ConversationProvider } from "./types.ts";

type ProviderRegistration = {
  id: ProviderId;
  defaultHome: () => string;
  environmentVariables: string[];
  create: (home: string) => ConversationProvider;
};

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderRegistration> = {
  claude: { id: "claude", defaultHome: () => join(homedir(), ".claude"), environmentVariables: ["AI_SESSION_CLAUDE_HOME", "CLAUDE_CONFIG_DIR"], create: createClaudeProvider },
  codex: { id: "codex", defaultHome: () => join(homedir(), ".codex"), environmentVariables: ["AI_SESSION_CODEX_HOME", "CODEX_HOME"], create: createCodexProvider },
  antigravity: { id: "antigravity", defaultHome: () => join(homedir(), ".gemini"), environmentVariables: ["AI_SESSION_ANTIGRAVITY_HOME"], create: createAntigravityProvider },
  opencode: { id: "opencode", defaultHome: () => join(homedir(), ".local", "share", "opencode"), environmentVariables: ["AI_SESSION_OPENCODE_HOME", "OPENCODE_DATA_HOME"], create: createOpenCodeProvider },
  hermes: { id: "hermes", defaultHome: () => join(homedir(), ".hermes"), environmentVariables: ["AI_SESSION_HERMES_HOME"], create: createHermesProvider },
  copilot: { id: "copilot", defaultHome: () => join(homedir(), ".copilot"), environmentVariables: ["AI_SESSION_COPILOT_HOME"], create: createCopilotProvider },
  droid: { id: "droid", defaultHome: () => join(homedir(), ".factory"), environmentVariables: ["AI_SESSION_DROID_HOME", "FACTORY_HOME"], create: createDroidProvider },
  openclaw: { id: "openclaw", defaultHome: () => join(homedir(), ".openclaw"), environmentVariables: ["AI_SESSION_OPENCLAW_HOME", "OPENCLAW_STATE_DIR"], create: createOpenClawProvider },
  cursor: { id: "cursor", defaultHome: () => join(homedir(), ".cursor"), environmentVariables: ["AI_SESSION_CURSOR_HOME"], create: createCursorProvider },
  pi: { id: "pi", defaultHome: () => join(homedir(), ".pi"), environmentVariables: ["AI_SESSION_PI_HOME"], create: createPiProvider },
  kimi: { id: "kimi", defaultHome: () => join(homedir(), ".kimi-code"), environmentVariables: ["AI_SESSION_KIMI_HOME"], create: createKimiProvider },
};

export const resolveProviderHomes = (
  overrides: Partial<Record<ProviderId, string>>,
): Record<ProviderId, string> => Object.fromEntries(PROVIDER_IDS.map((id) => {
  const registration = PROVIDER_REGISTRY[id];
  const environmentHome = registration.environmentVariables
    .map((key) => process.env[key])
    .find((value): value is string => typeof value === "string" && value !== "");
  return [id, resolve(overrides[id] ?? environmentHome ?? registration.defaultHome())];
})) as Record<ProviderId, string>;

export const createEnabledProviders = (
  enabled: ReadonlySet<ProviderId>,
  homes: Record<ProviderId, string>,
): ConversationProvider[] => PROVIDER_IDS
  .filter((id) => enabled.has(id))
  .map((id) => PROVIDER_REGISTRY[id].create(homes[id]));
