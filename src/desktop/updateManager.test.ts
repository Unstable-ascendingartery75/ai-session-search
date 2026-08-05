import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { compareVersions, DesktopUpdateManager, releaseAssetNamePrefix } from "./updateManager.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const releaseResponse = (version: string, assetName = `AI.Session.Search-darwin-arm64-${version}.zip`) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/lililib/ai-session-search/releases/tag/v${version}`,
  draft: false,
  prerelease: false,
  assets: [{
    name: assetName,
    size: 7,
    browser_download_url: "https://example.test/update.zip",
  }],
});

const createSettings = () => {
  const values = new Map<string, string>();
  return {
    getAppSetting: (key: string) => values.get(key) ?? null,
    setAppSetting: (key: string, value: string) => void values.set(key, value),
  };
};

describe("desktop update manager", () => {
  test("compares release versions numerically", () => {
    expect(compareVersions("v0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("0.3.6", "v0.3.6")).toBe(0);
  });

  test("selects only published assets for the running platform and architecture", () => {
    expect(releaseAssetNamePrefix("darwin", "arm64")).toBe("AI.Session.Search-darwin-arm64-");
    expect(releaseAssetNamePrefix("win32", "x64")).toBe("AI.Session.Search-win32-x64-");
    expect(releaseAssetNamePrefix("linux", "x64")).toBeNull();
  });

  test("reports a newer release and downloads its asset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-session-search-update-"));
    temporaryDirectories.push(directory);
    const revealFile = vi.fn();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.includes("api.github.com")
        ? Response.json(releaseResponse("0.4.0"))
        : new Response("archive", { headers: { "content-length": "7" } });
    });
    const manager = new DesktopUpdateManager({
      currentVersion: "0.3.6",
      platform: "darwin",
      architecture: "arm64",
      downloadsDirectory: directory,
      fetch: fetchMock as typeof fetch,
      settings: createSettings(),
      revealFile,
    });

    await expect(manager.getState()).resolves.toMatchObject({
      status: "available",
      latestVersion: "0.4.0",
      downloadAvailable: true,
    });
    await expect(manager.startDownload()).resolves.toMatchObject({ status: "downloading" });
    await vi.waitFor(async () => {
      await expect(manager.getState()).resolves.toMatchObject({ status: "downloaded", downloadedBytes: 7 });
    });
    const destination = join(directory, "AI.Session.Search-darwin-arm64-0.4.0.zip");
    await expect(readFile(destination, "utf8")).resolves.toBe("archive");
    expect(revealFile).toHaveBeenCalledWith(destination);
  });

  test("does not offer the current release as an update", async () => {
    const manager = new DesktopUpdateManager({
      currentVersion: "0.3.6",
      platform: "darwin",
      architecture: "arm64",
      downloadsDirectory: "/tmp",
      fetch: vi.fn(async () => Response.json(releaseResponse("0.3.6"))) as typeof fetch,
      settings: createSettings(),
      revealFile: vi.fn(),
    });

    await expect(manager.getState()).resolves.toMatchObject({
      status: "up-to-date",
      latestVersion: null,
      downloadAvailable: false,
    });
  });

  test("persists the hourly check and ignored version across restarts", async () => {
    const settings = createSettings();
    const fetchMock = vi.fn(async () => Response.json(releaseResponse("0.4.0")));
    const createManager = () => new DesktopUpdateManager({
      currentVersion: "0.3.6",
      platform: "darwin",
      architecture: "arm64",
      downloadsDirectory: "/tmp",
      fetch: fetchMock as typeof fetch,
      settings,
      revealFile: vi.fn(),
    });
    const firstManager = createManager();
    await firstManager.getState(true);
    await expect(firstManager.ignoreVersion()).resolves.toMatchObject({ ignored: true });

    const restartedManager = createManager();
    await expect(restartedManager.getState(true)).resolves.toMatchObject({
      status: "available",
      latestVersion: "0.4.0",
      ignored: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
