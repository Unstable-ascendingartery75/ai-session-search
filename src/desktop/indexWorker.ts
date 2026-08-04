import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import type { ProviderId } from "../shared/types.ts";
import { SearchDatabase } from "../server/database.ts";
import { SessionIndexer } from "../server/indexer.ts";
import { createEnabledProviders } from "../server/providers/registry.ts";
import type { ConversationProvider } from "../server/providers/types.ts";
import type {
  IndexWorkerMessage,
  IndexWorkerProvider,
  IndexWorkerRequest,
} from "./workerIndexer.ts";

type IndexWorkerData = {
  dataDir: string;
  providers: IndexWorkerProvider[];
};

if (parentPort === null) throw new Error("Index worker requires a parent port");

const port = parentPort;
const configuration = workerData as IndexWorkerData;
const database = new SearchDatabase(join(configuration.dataDir, "search.db"));

const createProviders = (providers: IndexWorkerProvider[]): ConversationProvider[] => {
  const enabled = new Set(providers.map((provider) => provider.id));
  const homes = Object.fromEntries(
    providers.map((provider) => [provider.id, provider.home]),
  ) as Record<ProviderId, string>;
  return createEnabledProviders(enabled, homes);
};

const indexer = new SessionIndexer(database, createProviders(configuration.providers));
const send = (message: IndexWorkerMessage): void => port.postMessage(message);
const sendProgress = (): void => send({ type: "progress", progress: indexer.syncProgress() });
const progressTimer = setInterval(sendProgress, 100);
let operationQueue: Promise<void> = Promise.resolve();
let closing = false;

const respond = async (request: IndexWorkerRequest): Promise<void> => {
  try {
    let result: unknown;
    switch (request.method) {
      case "status":
        result = await indexer.status();
        break;
      case "syncAll":
        result = await indexer.syncAll();
        break;
      case "startWatching":
        await indexer.startWatching();
        result = null;
        break;
      case "reconfigure":
        result = await indexer.reconfigure(
          createProviders(request.payload?.providers ?? []),
          request.payload?.watch === true,
        );
        break;
      case "close":
        result = null;
        break;
    }
    sendProgress();
    send({ type: "response", id: request.id, ok: true, result });
  } catch (error) {
    send({ type: "response", id: request.id, ok: false, error: String(error) });
  }
};

port.on("message", (request: IndexWorkerRequest) => {
  if (request.type !== "request" || closing) return;
  if (request.method === "status") {
    void respond(request);
    return;
  }
  if (request.method === "close") {
    closing = true;
    indexer.close();
    clearInterval(progressTimer);
    void operationQueue.finally(() => {
      database.close();
      send({ type: "response", id: request.id, ok: true, result: null });
      port.close();
    });
    return;
  }
  operationQueue = operationQueue.then(() => respond(request));
});

sendProgress();
