import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ProviderId } from "../shared/types.ts";
import { resolveConfig } from "./config.ts";
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
});
