import type { ResumeCommandTemplates } from "./types.ts";
import type { CommandDialect } from "./terminal.ts";

export const DEFAULT_RESUME_COMMAND_TEMPLATES: ResumeCommandTemplates = {
  claude: "cd {cwd} && claude --resume {sessionId}",
  codex: "cd {cwd} && codex resume {sessionId}",
  antigravity: "cd {cwd} && agy --conversation {sessionId}",
  opencode: "cd {cwd} && opencode --session {sessionId}",
  copilot: "cd {cwd} && copilot --resume={sessionId}",
  cursor: "cd {cwd} && agent --resume {sessionId}",
  kimi: "cd {cwd} && kimi --session {sessionId}",
};

const shellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
};

const powershellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
};

const commandPromptQuote = (value: string): string => {
  if (/^[A-Za-z0-9_@+=:,./\\-]+$/.test(value)) return value;
  return `"${value.replace(/%/g, "%%").replace(/"/g, '""')}"`;
};

const prepareTemplate = (template: string, dialect: CommandDialect): string => {
  if (dialect === "powershell") {
    return template.replace(/^\s*cd\s+\{cwd\}\s*&&\s*/i, "Set-Location -LiteralPath {cwd}; ");
  }
  if (dialect === "cmd") {
    return template.replace(/^\s*cd\s+\{cwd\}\s*&&\s*/i, "cd /d {cwd} && ");
  }
  return template;
};

export const renderResumeCommand = (
  template: string,
  values: { sessionId: string; cwd: string | null },
  dialect: CommandDialect = "posix",
): string => {
  const prepared = prepareTemplate(template, dialect);
  const normalized = prepared.includes("{sessionId}")
    ? prepared.trim()
    : `${prepared.trim()} {sessionId}`;
  const quote = dialect === "powershell"
    ? powershellQuote
    : dialect === "cmd"
      ? commandPromptQuote
      : shellQuote;
  return normalized
    .replaceAll("{cwd}", quote(values.cwd ?? "."))
    .replaceAll("{sessionId}", quote(values.sessionId));
};
