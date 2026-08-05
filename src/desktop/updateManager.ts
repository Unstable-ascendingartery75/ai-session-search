import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UpdateState } from "../shared/types.ts";
import type { UpdateService } from "../server/updateService.ts";

const LATEST_RELEASE_API = "https://api.github.com/repos/lililib/ai-session-search/releases/latest";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const CHECKED_AT_SETTING = "desktop_update.checked_at";
const RELEASE_SETTING = "desktop_update.latest_release";
const IGNORED_VERSION_SETTING = "desktop_update.ignored_version";

type ReleaseAsset = {
  name: string;
  size: number;
  browser_download_url: string;
};

type GitHubRelease = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: ReleaseAsset[];
};

const normalizedVersion = (value: string): string => value.trim().replace(/^v/i, "");

export const compareVersions = (left: string, right: string): number => {
  const parse = (value: string): [number[], string | null] | null => {
    const match = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(normalizedVersion(value));
    if (match === null) return null;
    return [match[1]!.split(".").map(Number), match[2] ?? null];
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  if (leftVersion === null || rightVersion === null) return 0;
  const length = Math.max(leftVersion[0].length, rightVersion[0].length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftVersion[0][index] ?? 0) - (rightVersion[0][index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (leftVersion[1] === rightVersion[1]) return 0;
  if (leftVersion[1] === null) return 1;
  if (rightVersion[1] === null) return -1;
  return leftVersion[1].localeCompare(rightVersion[1], "en", { numeric: true });
};

export const releaseAssetNamePrefix = (
  platform: NodeJS.Platform,
  architecture: string,
): string | null => {
  if (platform === "darwin" && (architecture === "arm64" || architecture === "x64")) {
    return `AI.Session.Search-darwin-${architecture}-`;
  }
  if (platform === "win32" && architecture === "x64") return "AI.Session.Search-win32-x64-";
  return null;
};

const initialState = (currentVersion: string): UpdateState => ({
  enabled: true,
  status: "checking",
  currentVersion,
  latestVersion: null,
  releaseUrl: null,
  downloadAvailable: false,
  ignored: false,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
});

export class DesktopUpdateManager implements UpdateService {
  private state: UpdateState;
  private checkPromise: Promise<UpdateState> | null = null;
  private selectedAsset: ReleaseAsset | null = null;
  private downloadPromise: Promise<void> | null = null;
  private lastCheckedAt = 0;

  constructor(private readonly options: {
    currentVersion: string;
    platform: NodeJS.Platform;
    architecture: string;
    downloadsDirectory: string;
    fetch?: typeof fetch;
    settings: {
      getAppSetting: (key: string) => string | null;
      setAppSetting: (key: string, value: string) => void;
    };
    revealFile: (path: string) => void;
  }) {
    this.state = initialState(options.currentVersion);
    this.restoreCachedRelease();
  }

  async getState(refresh = false): Promise<UpdateState> {
    const cacheExpired = Date.now() - this.lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
    if (this.state.status !== "downloading" && this.checkPromise === null
      && (this.lastCheckedAt === 0 || (refresh && cacheExpired))) {
      this.checkPromise = this.checkLatestRelease().finally(() => {
        this.checkPromise = null;
      });
    }
    await this.checkPromise;
    return { ...this.state };
  }

  async startDownload(): Promise<UpdateState> {
    await this.getState();
    if (this.selectedAsset === null || this.state.status === "up-to-date") return { ...this.state };
    if (this.downloadPromise === null) {
      this.state = {
        ...this.state,
        status: "downloading",
        downloadedBytes: 0,
        totalBytes: this.selectedAsset.size > 0 ? this.selectedAsset.size : null,
        error: null,
      };
      this.downloadPromise = this.downloadRelease(this.selectedAsset).finally(() => {
        this.downloadPromise = null;
      });
    }
    return { ...this.state };
  }

  async ignoreVersion(): Promise<UpdateState> {
    await this.getState();
    if (this.state.latestVersion !== null) {
      this.options.settings.setAppSetting(IGNORED_VERSION_SETTING, this.state.latestVersion);
      this.state = { ...this.state, ignored: true };
    }
    return { ...this.state };
  }

  private restoreCachedRelease(): void {
    const checkedAt = Number.parseInt(this.options.settings.getAppSetting(CHECKED_AT_SETTING) ?? "", 10);
    this.lastCheckedAt = Number.isFinite(checkedAt) ? checkedAt : 0;
    const cached = this.options.settings.getAppSetting(RELEASE_SETTING);
    if (cached === null) {
      if (this.lastCheckedAt > 0) this.state = { ...this.state, status: "error" };
      return;
    }
    try {
      this.applyRelease(JSON.parse(cached) as GitHubRelease);
    } catch {
      this.lastCheckedAt = 0;
    }
  }

  private applyRelease(release: GitHubRelease): void {
    if (release.draft || release.prerelease
      || compareVersions(release.tag_name, this.options.currentVersion) <= 0) {
      this.selectedAsset = null;
      this.state = { ...initialState(this.options.currentVersion), status: "up-to-date" };
      return;
    }
    const prefix = releaseAssetNamePrefix(this.options.platform, this.options.architecture);
    this.selectedAsset = prefix === null
      ? null
      : release.assets.find((asset) => asset.name.startsWith(prefix) && asset.name.endsWith(".zip")) ?? null;
    const latestVersion = normalizedVersion(release.tag_name);
    this.state = {
      ...initialState(this.options.currentVersion),
      status: "available",
      latestVersion,
      releaseUrl: release.html_url,
      downloadAvailable: this.selectedAsset !== null,
      ignored: this.options.settings.getAppSetting(IGNORED_VERSION_SETTING) === latestVersion,
      totalBytes: this.selectedAsset?.size ?? null,
    };
  }

  private async checkLatestRelease(): Promise<UpdateState> {
    try {
      const response = await (this.options.fetch ?? fetch)(LATEST_RELEASE_API, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "ai-session-search",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
      const release = await response.json() as GitHubRelease;
      this.applyRelease(release);
      this.options.settings.setAppSetting(RELEASE_SETTING, JSON.stringify(release));
    } catch (error) {
      if (this.state.latestVersion === null) {
        this.state = {
          ...initialState(this.options.currentVersion),
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    this.lastCheckedAt = Date.now();
    this.options.settings.setAppSetting(CHECKED_AT_SETTING, String(this.lastCheckedAt));
    return this.state;
  }

  private async downloadRelease(asset: ReleaseAsset): Promise<void> {
    const fetchImpl = this.options.fetch ?? fetch;
    const destination = join(this.options.downloadsDirectory, basename(asset.name));
    const temporaryDestination = `${destination}.part`;
    try {
      await mkdir(this.options.downloadsDirectory, { recursive: true });
      await rm(temporaryDestination, { force: true });
      const response = await fetchImpl(asset.browser_download_url, {
        headers: { "User-Agent": "ai-session-search" },
        redirect: "follow",
      });
      if (!response.ok || response.body === null) {
        throw new Error(`Download returned HTTP ${response.status}`);
      }
      const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(contentLength) && contentLength > 0) {
        this.state = { ...this.state, totalBytes: contentLength };
      }
      const progress = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          this.state = { ...this.state, downloadedBytes: this.state.downloadedBytes + chunk.length };
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
        progress,
        createWriteStream(temporaryDestination),
      );
      await rm(destination, { force: true });
      await rename(temporaryDestination, destination);
      this.state = {
        ...this.state,
        status: "downloaded",
        downloadedBytes: this.state.totalBytes ?? this.state.downloadedBytes,
      };
      this.options.revealFile(destination);
    } catch (error) {
      await rm(temporaryDestination, { force: true }).catch(() => undefined);
      this.state = {
        ...this.state,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
