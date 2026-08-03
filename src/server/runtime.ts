import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app.ts";
import type { AppConfig } from "./config.ts";
import { SearchDatabase } from "./database.ts";
import { SessionIndexer, type SyncResult } from "./indexer.ts";
import { createEnabledProviders } from "./providers/registry.ts";
import { TerminalLauncher } from "./terminalLauncher.ts";

export type ServerRuntime = {
  url: string;
  port: number;
  syncResults: SyncResult[];
  close: () => Promise<void>;
};

const closeServer = (server: ServerType): Promise<void> =>
  new Promise((resolveClose, reject) => {
    server.close((error) => (error === undefined ? resolveClose() : reject(error)));
  });

export const startServer = async (
  config: AppConfig,
  options: { clientDirectory?: string } = {},
): Promise<ServerRuntime> => {
  await mkdir(config.dataDir, { recursive: true });
  const database = new SearchDatabase(join(config.dataDir, "search.db"));
  const providers = createEnabledProviders(config.providers, config.providerHomes);
  const indexer = new SessionIndexer(database, providers);
  const terminalLauncher = new TerminalLauncher(config.dataDir);

  try {
    const syncResults = await indexer.syncAll();
    if (config.watch) await indexer.startWatching();

    const server = await new Promise<ServerType>((resolveServer, reject) => {
      const candidate = serve(
        {
          fetch: createApp({
            database,
            indexer,
            config,
            terminalLauncher,
            ...(options.clientDirectory === undefined
              ? {}
              : { clientDirectory: options.clientDirectory }),
          }).fetch,
          port: config.port,
          hostname: config.hostname,
        },
        () => resolveServer(candidate),
      );
      candidate.once("error", reject);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      await closeServer(server);
      throw new Error("Unable to resolve the local server address");
    }
    const port = (address as AddressInfo).port;
    let closed = false;

    return {
      url: `http://${config.hostname}:${port}`,
      port,
      syncResults,
      close: async () => {
        if (closed) return;
        closed = true;
        indexer.close();
        await closeServer(server);
        database.close();
      },
    };
  } catch (error) {
    indexer.close();
    database.close();
    throw error;
  }
};
