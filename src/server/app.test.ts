import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ParsedSession } from "../shared/types.ts";
import { createApp } from "./app.ts";
import type { AppConfig } from "./config.ts";
import { SearchDatabase } from "./database.ts";
import type { SessionIndexer } from "./indexer.ts";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const remove of cleanup.splice(0)) await remove();
});

const createFixture = async (hostname = "127.0.0.1") => {
  const directory = await mkdtemp(join(tmpdir(), "ai-session-search-app-"));
  const database = new SearchDatabase(join(directory, "search.db"));
  cleanup.push(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const session: ParsedSession = {
    sessionKey: "codex:session-1",
    sourceSessionId: "session-1",
    provider: "codex",
    filePath: "/tmp/session-1.jsonl",
    projectPath: "/workspace/demo",
    originalTitle: "Resume test",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    messages: [],
  };
  database.upsertSession(session, {
    provider: "codex",
    path: session.filePath,
    mtimeMs: 1,
    size: 100,
  });
  database.updateResumeCommandTemplate("codex", "yolo");
  const config = {
    port: 3411,
    hostname,
    dataDir: directory,
    providerHomes: {} as AppConfig["providerHomes"],
    providers: new Set(["codex"]),
    watch: true,
  } satisfies AppConfig;
  const terminalLauncher = { launch: vi.fn(async () => undefined) };
  const app = createApp({
    database,
    indexer: {} as SessionIndexer,
    config,
    terminalLauncher,
  });
  return { app, database, terminalLauncher };
};

describe("terminal launch API", () => {
  test("stores terminal settings and launches a server-rendered resume command", async () => {
    const { app, terminalLauncher } = await createFixture();
    const settingsResponse = await app.request("http://127.0.0.1:3411/api/settings/terminal", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminal: "iterm2", customPath: null, shellPath: "/bin/bash" }),
    });
    expect(await settingsResponse.json()).toEqual({
      settings: { terminal: "iterm2", customPath: null, shellPath: "/bin/bash" },
    });

    const response = await app.request(
      "http://127.0.0.1:3411/api/sessions/codex%3Asession-1/open-terminal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3411",
        },
        body: "{}",
      },
    );

    expect(response.status).toBe(200);
    expect(terminalLauncher.launch).toHaveBeenCalledWith(
      { terminal: "iterm2", customPath: null, shellPath: "/bin/bash" },
      "yolo session-1",
      "/workspace/demo",
    );
  });

  test("rejects cross-origin launch requests", async () => {
    const { app, terminalLauncher } = await createFixture();
    const response = await app.request(
      "http://127.0.0.1:3411/api/sessions/codex%3Asession-1/open-terminal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://example.com" },
        body: "{}",
      },
    );

    expect(response.status).toBe(403);
    expect(terminalLauncher.launch).not.toHaveBeenCalled();
  });

  test("disables terminal launching when listening beyond loopback", async () => {
    const { app, terminalLauncher } = await createFixture("0.0.0.0");
    const response = await app.request(
      "http://localhost:3411/api/sessions/codex%3Asession-1/open-terminal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3411" },
        body: "{}",
      },
    );

    expect(response.status).toBe(403);
    expect(terminalLauncher.launch).not.toHaveBeenCalled();
  });
});
