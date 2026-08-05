import { describe, expect, test } from "vitest";
import { filterProjectOptions, type ProjectFilterOption } from "./projectFilter.ts";

const projects: ProjectFilterOption[] = [
  { provider: "codex", projectPath: "/Users/didi/code/ai-session-search", count: 12 },
  { provider: "claude", projectPath: "/workspace/CustomerPortal", count: 4 },
  { provider: "codex", projectPath: "/workspace/api-service", count: 7 },
];

describe("project filter", () => {
  test("matches any case-insensitive part of the project path", () => {
    expect(filterProjectOptions(projects, "SESSION")).toEqual([projects[0]]);
    expect(filterProjectOptions(projects, "customerportal")).toEqual([projects[1]]);
  });

  test("trims the query and preserves all projects for an empty query", () => {
    expect(filterProjectOptions(projects, "  api-  ")).toEqual([projects[2]]);
    expect(filterProjectOptions(projects, "   ")).toEqual(projects);
  });

  test("returns no options when no project path contains the query", () => {
    expect(filterProjectOptions(projects, "missing-project")).toEqual([]);
  });
});
