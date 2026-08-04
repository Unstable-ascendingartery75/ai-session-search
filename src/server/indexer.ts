import { watch, type FSWatcher } from "node:fs";
import type { ProviderId, ProviderStatus, SyncProgress } from "../shared/types.ts";
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
  #providers: ConversationProvider[];
  readonly #watchers: FSWatcher[] = [];
  readonly #debounceTimers = new Map<ProviderId, NodeJS.Timeout>();
  #syncQueue: Promise<unknown> = Promise.resolve();
  #syncAllPromise: Promise<SyncResult[]> | null = null;
  #closed = false;
  #syncProgress: SyncProgress;

  constructor(database: SearchDatabase, providers: ConversationProvider[]) {
    this.#database = database;
    this.#providers = providers;
    this.#syncProgress = {
      running: false,
      currentProvider: null,
      completedProviders: 0,
      totalProviders: providers.length,
      processedFiles: 0,
      totalFiles: 0,
    };
  }

  syncProgress(): SyncProgress {
    return { ...this.#syncProgress };
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

  syncAll(): Promise<SyncResult[]> {
    if (this.#syncAllPromise !== null) return this.#syncAllPromise;
    const operation = this.#runSyncAll();
    this.#syncAllPromise = operation;
    const clearOperation = (): void => {
      if (this.#syncAllPromise === operation) this.#syncAllPromise = null;
    };
    void operation.then(clearOperation, clearOperation);
    return operation;
  }

  async #runSyncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    this.#syncProgress = {
      running: true,
      currentProvider: this.#providers[0]?.id ?? null,
      completedProviders: 0,
      totalProviders: this.#providers.length,
      processedFiles: 0,
      totalFiles: 0,
    };
    try {
      for (const provider of this.#providers) {
        if (this.#closed) break;
        this.#syncProgress = {
          ...this.#syncProgress,
          currentProvider: provider.id,
          processedFiles: 0,
          totalFiles: 0,
        };
        results.push(await this.syncProvider(provider.id, (processedFiles, totalFiles) => {
          this.#syncProgress = { ...this.#syncProgress, processedFiles, totalFiles };
        }));
        this.#syncProgress = {
          ...this.#syncProgress,
          completedProviders: this.#syncProgress.completedProviders + 1,
        };
      }
      return results;
    } finally {
      this.#syncProgress = {
        ...this.#syncProgress,
        running: false,
        currentProvider: null,
        processedFiles: 0,
        totalFiles: 0,
      };
    }
  }

  async syncProvider(
    providerId: ProviderId,
    onProgress?: (processedFiles: number, totalFiles: number) => void,
  ): Promise<SyncResult> {
    const provider = this.#providers.find((candidate) => candidate.id === providerId);
    if (provider === undefined) throw new Error(`Provider is not enabled: ${providerId}`);

    const detected = (await Promise.all(provider.sessionRoots.map(pathExists))).some(Boolean);
    if (!detected) {
      onProgress?.(0, 0);
      const removed = this.#database.removeMissingFiles(provider.id, new Set());
      return { provider: providerId, discovered: 0, indexed: 0, unchanged: 0, removed, errors: 0 };
    }

    const files = await provider.discover();
    const parserVersion = provider.parserVersion ?? 1;
    const indexedFiles = this.#database.getIndexedFiles(provider.id);
    onProgress?.(0, files.length);
    const visibleFiles = new Set(files.map((file) => file.path));
    let indexed = 0;
    let unchanged = 0;
    let errors = 0;
    const claimedSessionKeys = new Map<string, { path: string; result: "indexed" | "unchanged" }>();
    const conflictedSessionKeys = new Set<string>();
    const removeSessionKeys = new Set<string>();
    const pendingUpserts = new Map<string, {
      session: NonNullable<Awaited<ReturnType<ConversationProvider["parse"]>>>;
      file: (typeof files)[number];
      parserVersion: number;
    }>();

    let processed = 0;
    for (const file of files) {
      if (this.#closed) break;
      try {
        const existing = indexedFiles.get(file.path) ?? null;
        const isUnchanged =
          existing !== null &&
          Math.trunc(existing.mtimeMs) === Math.trunc(file.mtimeMs) &&
          existing.size === file.size &&
          existing.parserVersion === parserVersion;
        const session = isUnchanged ? null : await provider.parse(file);
        const sessionKey = isUnchanged ? existing.sessionKey : session?.sessionKey;
        if (sessionKey === undefined || conflictedSessionKeys.has(sessionKey)) continue;

        const claimed = claimedSessionKeys.get(sessionKey);
        if (claimed !== undefined && claimed.path !== file.path) {
          removeSessionKeys.add(sessionKey);
          pendingUpserts.delete(sessionKey);
          claimedSessionKeys.delete(sessionKey);
          conflictedSessionKeys.add(sessionKey);
          if (claimed.result === "indexed") indexed -= 1;
          else unchanged -= 1;
          errors += 1;
          process.stderr.write(
            `[${provider.id}] Duplicate session key ${sessionKey} from ${claimed.path} and ${file.path}; removed the ambiguous index\n`,
          );
          continue;
        }

        if (isUnchanged) {
          unchanged += 1;
          claimedSessionKeys.set(sessionKey, { path: file.path, result: "unchanged" });
        } else if (session !== null) {
          pendingUpserts.set(sessionKey, { session, file, parserVersion });
          indexed += 1;
          claimedSessionKeys.set(sessionKey, { path: file.path, result: "indexed" });
        }
      } catch (error) {
        errors += 1;
        process.stderr.write(`[${provider.id}] Failed to index ${file.path}: ${String(error)}\n`);
      } finally {
        processed += 1;
        onProgress?.(processed, files.length);
      }
    }

    const batchResult = this.#database.applyProviderIndexBatch({
      provider: provider.id,
      visibleFiles,
      removeSessionKeys,
      upserts: [...pendingUpserts.values()],
    });
    for (const failure of batchResult.errors) {
      process.stderr.write(`[${provider.id}] Failed to index ${failure.path}: ${failure.error}\n`);
    }
    return {
      provider: providerId,
      discovered: files.length,
      indexed: batchResult.indexed,
      unchanged,
      removed: batchResult.removed,
      errors: errors + batchResult.errors.length,
    };
  }

  async startWatching(): Promise<void> {
    if (this.#closed) return;
    this.#stopWatching();
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

  async reconfigure(providers: ConversationProvider[], watch: boolean): Promise<SyncResult[]> {
    if (this.#closed) throw new Error("Session indexer is closed");
    for (const timer of this.#debounceTimers.values()) clearTimeout(timer);
    this.#debounceTimers.clear();
    await this.#syncQueue;
    if (this.#syncAllPromise !== null) await this.#syncAllPromise;
    this.#stopWatching();
    this.#providers = providers;
    const results = await this.syncAll();
    if (watch) await this.startWatching();
    return results;
  }

  #stopWatching(): void {
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers.length = 0;
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
    this.#closed = true;
    for (const timer of this.#debounceTimers.values()) clearTimeout(timer);
    this.#debounceTimers.clear();
    this.#stopWatching();
  }
}
