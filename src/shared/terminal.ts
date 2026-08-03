import type { RuntimePlatform, TerminalId, TerminalSettings } from "./types.ts";

export type CommandDialect = "posix" | "powershell" | "cmd";

export const normalizeRuntimePlatform = (platform: string): RuntimePlatform => {
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform;
  return "other";
};

export const terminalIdsForPlatform = (platform: RuntimePlatform): TerminalId[] => {
  if (platform === "darwin") return ["terminal", "iterm2", "warp", "custom"];
  if (platform === "win32") return ["windows-terminal", "powershell", "cmd", "custom"];
  return [];
};

export const defaultTerminalSettings = (platform: RuntimePlatform): TerminalSettings =>
  platform === "win32"
    ? { terminal: "windows-terminal", customPath: null, shellPath: "powershell.exe" }
    : { terminal: "terminal", customPath: null, shellPath: "/bin/zsh" };

export const commandDialectForTerminal = (
  terminal: TerminalId,
  platform: RuntimePlatform,
  shellPath = "",
): CommandDialect => {
  if (platform !== "win32") return "posix";
  return terminal === "cmd" || /(^|[\\/])cmd(?:\.exe)?$/i.test(shellPath)
    ? "cmd"
    : "powershell";
};

export const isValidShellReference = (value: string, platform: RuntimePlatform): boolean => {
  if (platform !== "win32") return value.startsWith("/");
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^\\\\[^\\]+\\[^\\]+/.test(value) ||
    /^[A-Za-z0-9_.-]+(?:\.exe)?$/i.test(value)
  );
};
