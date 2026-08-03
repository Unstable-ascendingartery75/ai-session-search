import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { PROVIDER_IDS, type ProviderId } from "../shared/types.ts";
import { isProviderId } from "../shared/providers.ts";
import { resolveProviderHomes } from "./providers/registry.ts";

export type CliOptions = {
  port?: string;
  hostname?: string;
  claudeDir?: string;
  codexDir?: string;
  providerDir?: string[];
  dataDir?: string;
  providers?: string;
  watch?: boolean;
};

export type AppConfig = {
  port: number;
  hostname: string;
  dataDir: string;
  providerHomes: Record<ProviderId, string>;
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
    return new Set<ProviderId>(PROVIDER_IDS);
  }

  const values = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
  const invalid = values.filter((item) => !isProviderId(item));
  if (invalid.length > 0) throw new Error(`Unknown provider: ${invalid.join(", ")}`);

  return new Set(values as ProviderId[]);
};

const parseProviderDirectories = (options: CliOptions): Partial<Record<ProviderId, string>> => {
  const overrides: Partial<Record<ProviderId, string>> = {};
  if (options.claudeDir !== undefined) overrides.claude = options.claudeDir;
  if (options.codexDir !== undefined) overrides.codex = options.codexDir;
  for (const item of options.providerDir ?? []) {
    const separator = item.indexOf("=");
    const id = separator < 0 ? "" : item.slice(0, separator).trim().toLowerCase();
    const path = separator < 0 ? "" : item.slice(separator + 1).trim();
    if (!isProviderId(id) || path === "") throw new Error(`--provider-dir must use provider=path; received ${item}`);
    overrides[id] = path;
  }
  return overrides;
};

export const resolveConfig = (options: CliOptions): AppConfig => ({
  port: Number.parseInt(options.port ?? env("PORT") ?? "3411", 10),
  hostname: options.hostname ?? env("HOSTNAME") ?? "localhost",
  dataDir: resolve(options.dataDir ?? env("AI_SESSION_DATA_DIR") ?? defaultDataDir()),
  providerHomes: resolveProviderHomes(parseProviderDirectories(options)),
  providers: parseProviders(options.providers ?? env("AI_SESSION_PROVIDERS")),
  watch: options.watch !== false,
});
