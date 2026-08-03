import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ProviderId } from "../shared/types.ts";
import { resolveConfig } from "./config.ts";
import type { ConversationProvider } from "./providers/types.ts";
import { startServer } from "./runtime.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("startServer", () => {
  test("serves the API and bundled client on an available loopback port", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-session-search-runtime-"));
    temporaryDirectories.push(root);
    const clientDirectory = join(root, "client");
    await mkdir(clientDirectory);
    await writeFile(join(clientDirectory, "index.html"), "<!doctype html><title>Desktop test</title>");

    const config = {
      ...resolveConfig({
        dataDir: join(root, "data"),
        hostname: "127.0.0.1",
        port: "0",
        watch: false,
      }),
      providers: new Set<ProviderId>(),
    };
    const runtime = await startServer(config, { clientDirectory });

    try {
      await runtime.initialSync;
      expect(runtime.port).toBeGreaterThan(0);
      expect(runtime.url).toBe(`http://127.0.0.1:${runtime.port}`);
      await expect(fetch(`${runtime.url}/api/providers`).then((response) => response.json())).resolves.toEqual({
        providers: expect.any(Array),
      });
      await expect(fetch(runtime.url).then((response) => response.text())).resolves.toContain("Desktop test");
    } finally {
      await runtime.close();
    }
  });

  test("serves the desktop client while the initial session scan continues in the background", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-session-search-background-sync-"));
    temporaryDirectories.push(root);
    const clientDirectory = join(root, "client");
    await mkdir(clientDirectory);
    await writeFile(join(clientDirectory, "index.html"), "<!doctype html><title>Ready now</title>");

    let finishDiscovery = (): void => undefined;
    const discoveryGate = new Promise<void>((resolveDiscovery) => {
      finishDiscovery = resolveDiscovery;
    });
    const provider: ConversationProvider = {
      id: "codex",
      home: root,
      sessionRoots: [root],
      discover: async () => {
        await discoveryGate;
        return [];
      },
      parse: async () => null,
    };
    const config = {
      ...resolveConfig({
        dataDir: join(root, "data"),
        hostname: "127.0.0.1",
        port: "0",
        watch: false,
      }),
      providers: new Set<ProviderId>(["codex"]),
    };
    const runtime = await startServer(config, { clientDirectory, providers: [provider] });

    try {
      await expect(fetch(runtime.url).then((response) => response.text())).resolves.toContain("Ready now");
      const status = await fetch(`${runtime.url}/api/status`).then((response) => response.json()) as {
        sync: { running: boolean; currentProvider: ProviderId | null };
      };
      expect(status.sync).toMatchObject({ running: true, currentProvider: "codex" });
      finishDiscovery();
      await runtime.initialSync;
      await expect(fetch(`${runtime.url}/api/status`).then((response) => response.json())).resolves.toMatchObject({
        sync: { running: false, completedProviders: 1, totalProviders: 1 },
      });
    } finally {
      finishDiscovery();
      await runtime.close();
    }
  });
});
