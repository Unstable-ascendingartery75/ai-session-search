import type { ResumeCommandTemplates } from "./types.ts";

export const DEFAULT_RESUME_COMMAND_TEMPLATES: ResumeCommandTemplates = {
  claude: "cd {cwd} && claude --resume {sessionId}",
  codex: "cd {cwd} && codex resume {sessionId}",
};

const shellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
};

export const renderResumeCommand = (
  template: string,
  values: { sessionId: string; cwd: string | null },
): string => {
  const normalized = template.includes("{sessionId}")
    ? template.trim()
    : `${template.trim()} {sessionId}`;
  return normalized
    .replaceAll("{cwd}", shellQuote(values.cwd ?? "."))
    .replaceAll("{sessionId}", shellQuote(values.sessionId));
};
