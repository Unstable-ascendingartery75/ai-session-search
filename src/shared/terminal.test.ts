import { describe, expect, test } from "vitest";
import {
  commandDialectForTerminal,
  defaultTerminalSettings,
  isValidShellReference,
  terminalIdsForPlatform,
} from "./terminal.ts";

describe("terminal platform settings", () => {
  test("provides native terminal choices for macOS and Windows", () => {
    expect(terminalIdsForPlatform("darwin")).toEqual(["terminal", "iterm2", "warp", "custom"]);
    expect(terminalIdsForPlatform("win32")).toEqual([
      "windows-terminal",
      "powershell",
      "cmd",
      "custom",
    ]);
    expect(defaultTerminalSettings("win32")).toEqual({
      terminal: "windows-terminal",
      customPath: null,
      shellPath: "powershell.exe",
    });
  });

  test("selects command syntax from the configured Windows shell", () => {
    expect(commandDialectForTerminal("windows-terminal", "win32", "powershell.exe")).toBe("powershell");
    expect(commandDialectForTerminal("windows-terminal", "win32", "cmd.exe")).toBe("cmd");
    expect(commandDialectForTerminal("terminal", "darwin", "/bin/zsh")).toBe("posix");
  });

  test("accepts PATH executables only on Windows", () => {
    expect(isValidShellReference("pwsh.exe", "win32")).toBe(true);
    expect(isValidShellReference("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "win32")).toBe(true);
    expect(isValidShellReference("pwsh.exe", "darwin")).toBe(false);
  });
});
