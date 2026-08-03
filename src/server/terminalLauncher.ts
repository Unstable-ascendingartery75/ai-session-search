import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { TerminalSettings } from "../shared/types.ts";

const execFileAsync = promisify(execFile);

const TERMINAL_APPLESCRIPT = `
on run argv
  tell application "Terminal"
    activate
    do script (item 1 of argv)
  end tell
end run
`;

const ITERM_APPLESCRIPT = `
on run argv
  tell application "iTerm"
    activate
    if (count of windows) is 0 then
      create window with default profile command (item 1 of argv)
    else
      tell current window
        create tab with default profile command (item 1 of argv)
      end tell
    end if
  end tell
end run
`;

export type TerminalLaunchArtifact = {
  path: string;
  content: string;
  mode: number;
};

export type TerminalLaunch = {
  file: string;
  args: string[];
  artifact?: TerminalLaunchArtifact;
};

const shellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
};

const interactiveShellCommand = (shellPath: string, command: string): string =>
  `${shellQuote(shellPath)} -lic ${shellQuote(command)}`;

const warpLaunch = (
  shellPath: string,
  command: string,
  cwd: string | null,
  dataDir: string,
): TerminalLaunch => {
  const artifactPath = join(dataDir, "terminal-launches", "ai-session-search.yaml");
  const workingDirectory = cwd ?? homedir();
  const shellCommand = interactiveShellCommand(shellPath, command);
  const content = [
    "---",
    "name: AI Session Search",
    "windows:",
    "  - tabs:",
    "      - title: AI Session Search",
    "        layout:",
    `          cwd: ${JSON.stringify(workingDirectory)}`,
    "          commands:",
    `            - exec: ${JSON.stringify(shellCommand)}`,
    "",
  ].join("\n");
  return {
    file: "/usr/bin/open",
    args: [`warp://launch${encodeURI(artifactPath)}`],
    artifact: { path: artifactPath, content, mode: 0o600 },
  };
};

const customLaunch = (
  customPath: string | null,
  shellPath: string,
  command: string,
  dataDir: string,
): TerminalLaunch => {
  if (customPath === null || !isAbsolute(customPath)) {
    throw new Error("Custom terminal path must be absolute");
  }
  if (!customPath.toLocaleLowerCase().endsWith(".app")) {
    return { file: customPath, args: ["-e", shellPath, "-lic", command] };
  }
  const artifactPath = join(dataDir, "terminal-launches", "resume.command");
  const shellCommand = interactiveShellCommand(shellPath, command);
  return {
    file: "/usr/bin/open",
    args: ["-a", customPath, artifactPath],
    artifact: {
      path: artifactPath,
      content: `#!/bin/zsh\nexec ${shellCommand}\n`,
      mode: 0o700,
    },
  };
};

export const buildTerminalLaunch = (
  settings: TerminalSettings,
  command: string,
  cwd: string | null,
  dataDir: string,
  runtimePlatform: NodeJS.Platform = process.platform,
): TerminalLaunch => {
  if (!isAbsolute(settings.shellPath)) throw new Error("Shell path must be absolute");
  if (settings.terminal === "custom") {
    return customLaunch(settings.customPath, settings.shellPath, command, dataDir);
  }
  if (runtimePlatform !== "darwin") {
    throw new Error(`${settings.terminal} terminal launching is only supported on macOS`);
  }
  const shellCommand = interactiveShellCommand(settings.shellPath, command);
  if (settings.terminal === "terminal") {
    return { file: "/usr/bin/osascript", args: ["-e", TERMINAL_APPLESCRIPT, shellCommand] };
  }
  if (settings.terminal === "iterm2") {
    return { file: "/usr/bin/osascript", args: ["-e", ITERM_APPLESCRIPT, shellCommand] };
  }
  return warpLaunch(settings.shellPath, command, cwd, dataDir);
};

export class TerminalLauncher {
  readonly #dataDir: string;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  async launch(settings: TerminalSettings, command: string, cwd: string | null): Promise<void> {
    const launch = buildTerminalLaunch(settings, command, cwd, this.#dataDir);
    await stat(settings.shellPath);
    if (settings.terminal === "custom" && settings.customPath !== null) {
      await stat(settings.customPath);
    }
    if (launch.artifact !== undefined) {
      await mkdir(join(this.#dataDir, "terminal-launches"), { recursive: true });
      await writeFile(launch.artifact.path, launch.artifact.content, { mode: launch.artifact.mode });
    }
    await execFileAsync(launch.file, launch.args, { timeout: 15_000 });
  }
}
