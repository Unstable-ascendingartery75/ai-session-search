import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import type { ProviderId } from "../shared/types.ts";

export type CliOptions = {
  port?: string;
  hostname?: string;
  claudeDir?: string;
  codexDir?: string;
  dataDir?: string;
  providers?: string;
  watch?: boolean;
};

export type AppConfig = {
  port: number;
  hostname: string;
  dataDir: string;
  claudeHome: string;
  codexHome: string;
  providers: ReadonlySet<ProviderId>;
  watch: boolean;
};

const env = (key: string): string | undefined => process.env[key] || undefined;

const defaultDataDir = (): string => {
  const explicitBase = env("XDG_DATA_HOME");
  if (explicitBase !== undefined) return join(explicitBase, "ai-session-search");

  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "ai-session-search");
  }

  if (platform() === "win32") {
    return join(env("LOCALAPPDATA") ?? join(homedir(), "AppData", "Local"), "ai-session-search");
  }

  return join(homedir(), ".local", "share", "ai-session-search");
};

const parseProviders = (value: string | undefined): ReadonlySet<ProviderId> => {
  if (value === undefined || value.trim() === "" || value === "auto") {
    return new Set<ProviderId>(["claude", "codex"]);
  }

  const values = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ProviderId => item === "claude" || item === "codex");

  if (values.length === 0) {
    throw new Error("--providers must contain claude, codex, or auto");
  }
  return new Set(values);
};

export const resolveConfig = (options: CliOptions): AppConfig => ({
  port: Number.parseInt(options.port ?? env("PORT") ?? "3411", 10),
  hostname: options.hostname ?? env("HOSTNAME") ?? "localhost",
  dataDir: resolve(options.dataDir ?? env("AI_SESSION_DATA_DIR") ?? defaultDataDir()),
  claudeHome: resolve(
    options.claudeDir ??
      env("AI_SESSION_CLAUDE_HOME") ??
      env("CLAUDE_CONFIG_DIR") ??
      join(homedir(), ".claude"),
  ),
  codexHome: resolve(
    options.codexDir ?? env("AI_SESSION_CODEX_HOME") ?? env("CODEX_HOME") ?? join(homedir(), ".codex"),
  ),
  providers: parseProviders(options.providers ?? env("AI_SESSION_PROVIDERS")),
  watch: options.watch !== false,
});
