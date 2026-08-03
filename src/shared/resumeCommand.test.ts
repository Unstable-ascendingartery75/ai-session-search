import { describe, expect, test } from "vitest";
import { DEFAULT_RESUME_COMMAND_TEMPLATES, renderResumeCommand } from "./resumeCommand.ts";

describe("renderResumeCommand", () => {
  test("renders the default Codex resume command", () => {
    expect(
      renderResumeCommand(DEFAULT_RESUME_COMMAND_TEMPLATES.codex, {
        sessionId: "019fb22a-7602-7ad1-ae26-ead73fc25e3c",
        cwd: "/workspace/demo",
      }),
    ).toBe("cd /workspace/demo && codex resume 019fb22a-7602-7ad1-ae26-ead73fc25e3c");
  });

  test("treats a command without a session placeholder as a prefix", () => {
    expect(
      renderResumeCommand("yolo", {
        sessionId: "019fb22a-7602-7ad1-ae26-ead73fc25e3c",
        cwd: "/workspace/demo",
      }),
    ).toBe("yolo 019fb22a-7602-7ad1-ae26-ead73fc25e3c");
  });

  test("shell-quotes project paths used by the template", () => {
    expect(
      renderResumeCommand("cd {cwd} && claude --resume {sessionId}", {
        sessionId: "session-1",
        cwd: "/workspace/My Project",
      }),
    ).toBe("cd '/workspace/My Project' && claude --resume session-1");
  });
});
