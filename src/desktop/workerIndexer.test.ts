import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import type { SyncProgress } from "../shared/types.ts";
import type { ConversationProvider } from "../server/providers/types.ts";
import { WorkerSessionIndexer, type IndexWorkerLike } from "./workerIndexer.ts";

class FakeWorker extends EventEmitter implements IndexWorkerLike {
  readonly messages: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }
}

const provider = (home: string): ConversationProvider => ({
  id: "codex",
  home,
  sessionRoots: [`${home}/sessions`],
  discover: async () => [],
  parse: async () => null,
});

const respond = (worker: FakeWorker, result: unknown): void => {
  const request = worker.messages.at(-1) as { id: number };
  worker.emit("message", { type: "response", id: request.id, ok: true, result });
};

describe("WorkerSessionIndexer", () => {
  test("keeps synchronous progress state in the desktop process while indexing in a worker", async () => {
    const worker = new FakeWorker();
    const indexer = new WorkerSessionIndexer(worker, [provider("/sessions/codex")]);
    const operation = indexer.syncAll();
    expect(worker.messages.at(-1)).toMatchObject({ type: "request", method: "syncAll" });

    const progress: SyncProgress = {
      running: true,
      revision: 3,
      currentProvider: "codex",
      completedProviders: 0,
      totalProviders: 1,
      processedFiles: 40,
      totalFiles: 100,
    };
    worker.emit("message", { type: "progress", progress });
    expect(indexer.syncProgress()).toEqual(progress);

    respond(worker, [{ provider: "codex", discovered: 100, indexed: 100, unchanged: 0, removed: 0, errors: 0 }]);
    await expect(operation).resolves.toMatchObject([{ provider: "codex", indexed: 100 }]);
  });

  test("serializes provider configuration instead of sending parser functions", async () => {
    const worker = new FakeWorker();
    const indexer = new WorkerSessionIndexer(worker, [provider("/old")]);
    const operation = indexer.reconfigure([provider("/new")], true);

    expect(worker.messages.at(-1)).toMatchObject({
      type: "request",
      method: "reconfigure",
      payload: { providers: [{ id: "codex", home: "/new" }], watch: true },
    });
    respond(worker, []);
    await expect(operation).resolves.toEqual([]);
  });

  test("shuts down and terminates the worker", async () => {
    const worker = new FakeWorker();
    const indexer = new WorkerSessionIndexer(worker, []);
    const operation = indexer.close();
    expect(worker.messages.at(-1)).toMatchObject({ type: "request", method: "close" });
    respond(worker, null);
    await operation;
    expect(worker.terminated).toBe(true);
  });
});
