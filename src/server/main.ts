#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import { createApp } from "./app.ts";
import { type CliOptions, resolveConfig } from "./config.ts";
import { SearchDatabase } from "./database.ts";
import { SessionIndexer } from "./indexer.ts";
import { createEnabledProviders } from "./providers/registry.ts";

const collectOption = (value: string, previous: string[]): string[] => [...previous, value];

const program = new Command()
  .name("ai-session-search")
  .description("Read-only local search for AI coding agent conversations")
  .option("-p, --port <port>", "port to listen on")
  .option("-h, --hostname <hostname>", "hostname to listen on")
  .option("--claude-dir <path>", "Claude Code home directory")
  .option("--codex-dir <path>", "Codex home directory")
  .option("--provider-dir <provider=path>", "override a provider home directory (repeatable)", collectOption, [])
  .option("--data-dir <path>", "application database directory")
  .option("--providers <providers>", "auto or comma-separated provider IDs")
  .option("--no-watch", "disable filesystem watching");

program.action(async (rawOptions: CliOptions) => {
  const config = resolveConfig(rawOptions);
  await mkdir(config.dataDir, { recursive: true });
  const database = new SearchDatabase(join(config.dataDir, "search.db"));
  const providers = createEnabledProviders(config.providers, config.providerHomes);
  const indexer = new SessionIndexer(database, providers);

  const results = await indexer.syncAll();
  for (const result of results) {
    process.stdout.write(
      `[${result.provider}] discovered=${result.discovered} indexed=${result.indexed} unchanged=${result.unchanged} removed=${result.removed} errors=${result.errors}\n`,
    );
  }
  if (config.watch) await indexer.startWatching();

  const server = serve({
    fetch: createApp({ database, indexer, config }).fetch,
    port: config.port,
    hostname: config.hostname,
  });
  process.stdout.write(`AI Session Search: http://${config.hostname}:${config.port}\n`);

  const shutdown = (): void => {
    indexer.close();
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});

await program.parseAsync(process.argv);
