#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import { createApp } from "./app.ts";
import { type CliOptions, resolveConfig } from "./config.ts";
import { SearchDatabase } from "./database.ts";
import { SessionIndexer } from "./indexer.ts";
import { createClaudeProvider } from "./providers/claude.ts";
import { createCodexProvider } from "./providers/codex.ts";

const program = new Command()
  .name("ai-session-search")
  .description("Read-only local search for Claude Code and Codex conversations")
  .option("-p, --port <port>", "port to listen on")
  .option("-h, --hostname <hostname>", "hostname to listen on")
  .option("--claude-dir <path>", "Claude Code home directory")
  .option("--codex-dir <path>", "Codex home directory")
  .option("--data-dir <path>", "application database directory")
  .option("--providers <providers>", "auto, claude, codex, or comma-separated values")
  .option("--no-watch", "disable filesystem watching");

program.action(async (rawOptions: CliOptions) => {
  const config = resolveConfig(rawOptions);
  await mkdir(config.dataDir, { recursive: true });
  const database = new SearchDatabase(join(config.dataDir, "search.db"));
  const providers = [
    ...(config.providers.has("claude") ? [createClaudeProvider(config.claudeHome)] : []),
    ...(config.providers.has("codex") ? [createCodexProvider(config.codexHome)] : []),
  ];
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
