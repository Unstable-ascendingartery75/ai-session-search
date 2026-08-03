import { watch, type FSWatcher } from "node:fs";
import type { ProviderId, ProviderStatus } from "../shared/types.ts";
import { SearchDatabase } from "./database.ts";
import { pathExists } from "./providers/files.ts";
import type { ConversationProvider } from "./providers/types.ts";

export type SyncResult = {
  provider: ProviderId;
  discovered: number;
  indexed: number;
  unchanged: number;
  removed: number;
  errors: number;
};

export class SessionIndexer {
  readonly #database: SearchDatabase;
  readonly #providers: ConversationProvider[];
  readonly #watchers: FSWatcher[] = [];
  readonly #debounceTimers = new Map<ProviderId, NodeJS.Timeout>();
  #syncQueue: Promise<unknown> = Promise.resolve();

  constructor(database: SearchDatabase, providers: ConversationProvider[]) {
    this.#database = database;
    this.#providers = providers;
  }

  async status(): Promise<ProviderStatus[]> {
    return Promise.all(
      this.#providers.map(async (provider) => {
        const rootStates = await Promise.all(provider.sessionRoots.map(pathExists));
        return {
          provider: provider.id,
          enabled: true,
          home: provider.home,
          detected: rootStates.some(Boolean),
          sessionRoots: provider.sessionRoots,
        };
      }),
    );
  }

  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const provider of this.#providers) results.push(await this.syncProvider(provider.id));
    return results;
  }

  async syncProvider(providerId: ProviderId): Promise<SyncResult> {
    const provider = this.#providers.find((candidate) => candidate.id === providerId);
    if (provider === undefined) throw new Error(`Provider is not enabled: ${providerId}`);

    const detected = (await Promise.all(provider.sessionRoots.map(pathExists))).some(Boolean);
    if (!detected) {
      return { provider: providerId, discovered: 0, indexed: 0, unchanged: 0, removed: 0, errors: 0 };
    }

    const files = await provider.discover();
    const visibleFiles = new Set(files.map((file) => file.path));
    let indexed = 0;
    let unchanged = 0;
    let errors = 0;

    for (const file of files) {
      const existing = this.#database.getIndexedFile(file.path);
      if (
        existing !== null &&
        Math.trunc(existing.mtimeMs) === Math.trunc(file.mtimeMs) &&
        existing.size === file.size
      ) {
        unchanged += 1;
        continue;
      }

      try {
        const session = await provider.parse(file);
        if (session === null) continue;
        this.#database.upsertSession(session, file);
        indexed += 1;
      } catch (error) {
        errors += 1;
        process.stderr.write(`[${provider.id}] Failed to index ${file.path}: ${String(error)}\n`);
      }
    }

    const removed = this.#database.removeMissingFiles(provider.id, visibleFiles);
    return { provider: providerId, discovered: files.length, indexed, unchanged, removed, errors };
  }

  async startWatching(): Promise<void> {
    for (const provider of this.#providers) {
      for (const root of provider.sessionRoots) {
        if (!(await pathExists(root))) continue;
        try {
          const watcher = watch(root, { recursive: true }, () => this.#scheduleSync(provider.id));
          watcher.on("error", (error) => {
            process.stderr.write(`[${provider.id}] Watcher error: ${String(error)}\n`);
          });
          this.#watchers.push(watcher);
        } catch (error) {
          process.stderr.write(`[${provider.id}] Unable to watch ${root}: ${String(error)}\n`);
        }
      }
    }
  }

  #scheduleSync(provider: ProviderId): void {
    const current = this.#debounceTimers.get(provider);
    if (current !== undefined) clearTimeout(current);
    const timer = setTimeout(() => {
      this.#debounceTimers.delete(provider);
      this.#syncQueue = this.#syncQueue
        .then(() => this.syncProvider(provider))
        .catch((error: unknown) => {
          process.stderr.write(`[${provider}] Background sync failed: ${String(error)}\n`);
        });
    }, 300);
    this.#debounceTimers.set(provider, timer);
  }

  close(): void {
    for (const timer of this.#debounceTimers.values()) clearTimeout(timer);
    this.#debounceTimers.clear();
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers.length = 0;
  }
}
