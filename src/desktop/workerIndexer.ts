import type { ProviderStatus, SyncProgress } from "../shared/types.ts";
import type { SessionIndexService, SyncResult } from "../server/indexer.ts";
import type { ConversationProvider } from "../server/providers/types.ts";

export type IndexWorkerProvider = Pick<ConversationProvider, "id" | "home">;

export type IndexWorkerRequest = {
  type: "request";
  id: number;
  method: "status" | "syncAll" | "startWatching" | "reconfigure" | "close";
  payload?: {
    providers?: IndexWorkerProvider[];
    watch?: boolean;
  };
};

export type IndexWorkerMessage =
  | { type: "progress"; progress: SyncProgress }
  | { type: "response"; id: number; ok: true; result: unknown }
  | { type: "response"; id: number; ok: false; error: string };

export interface IndexWorkerLike {
  postMessage(message: IndexWorkerRequest): void;
  on(event: "message", listener: (message: IndexWorkerMessage) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

const providerConfiguration = (providers: ConversationProvider[]): IndexWorkerProvider[] =>
  providers.map(({ id, home }) => ({ id, home }));

export class WorkerSessionIndexer implements SessionIndexService {
  readonly #worker: IndexWorkerLike;
  readonly #pending = new Map<number, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  }>();
  #nextRequestId = 1;
  #closed = false;
  #failure: Error | null = null;
  #progress: SyncProgress;

  constructor(worker: IndexWorkerLike, providers: ConversationProvider[]) {
    this.#worker = worker;
    this.#progress = {
      running: false,
      revision: 0,
      currentProvider: null,
      completedProviders: 0,
      totalProviders: providers.length,
      processedFiles: 0,
      totalFiles: 0,
    };
    worker.on("message", (message) => this.#handleMessage(message));
    worker.on("error", (error) => this.#fail(error));
    worker.on("exit", (code) => {
      if (!this.#closed) this.#fail(new Error(`Index worker exited with code ${code}`));
    });
  }

  #handleMessage(message: IndexWorkerMessage): void {
    if (message.type === "progress") {
      this.#progress = { ...message.progress };
      return;
    }
    const pending = this.#pending.get(message.id);
    if (pending === undefined) return;
    this.#pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error));
  }

  #fail(error: Error): void {
    this.#failure = error;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #request<T>(method: IndexWorkerRequest["method"], payload?: IndexWorkerRequest["payload"]): Promise<T> {
    if (this.#failure !== null) return Promise.reject(this.#failure);
    if (this.#closed && method !== "close") return Promise.reject(new Error("Index worker is closed"));
    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
      });
      this.#worker.postMessage({
        type: "request",
        id,
        method,
        ...(payload === undefined ? {} : { payload }),
      });
    });
  }

  syncProgress(): SyncProgress {
    return { ...this.#progress };
  }

  status(): Promise<ProviderStatus[]> {
    return this.#request("status");
  }

  syncAll(): Promise<SyncResult[]> {
    return this.#request("syncAll");
  }

  startWatching(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    return this.#request("startWatching");
  }

  reconfigure(providers: ConversationProvider[], watch: boolean): Promise<SyncResult[]> {
    return this.#request("reconfigure", { providers: providerConfiguration(providers), watch });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#request("close");
    } finally {
      await this.#worker.terminate();
    }
  }
}
