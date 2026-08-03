#!/usr/bin/env node
import { Command } from "commander";
import { type CliOptions, resolveConfig } from "./config.ts";
import { startServer } from "./runtime.ts";

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
  const runtime = await startServer(config);
  for (const result of runtime.syncResults) {
    process.stdout.write(
      `[${result.provider}] discovered=${result.discovered} indexed=${result.indexed} unchanged=${result.unchanged} removed=${result.removed} errors=${result.errors}\n`,
    );
  }
  process.stdout.write(`AI Session Search: ${runtime.url}\n`);

  const shutdown = async (): Promise<void> => {
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
});

await program.parseAsync(process.argv);
