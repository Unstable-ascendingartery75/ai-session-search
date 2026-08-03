import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { TERMINAL_IDS, type ProviderId, type ProviderSourceSetting } from "../shared/types.ts";
import { isProviderId, PROVIDER_DESCRIPTORS } from "../shared/providers.ts";
import { renderResumeCommand } from "../shared/resumeCommand.ts";
import { commandDialectForTerminal, normalizeRuntimePlatform } from "../shared/terminal.ts";
import type { AppConfig } from "./config.ts";
import { SearchDatabase } from "./database.ts";
import { SessionIndexer } from "./indexer.ts";
import { createEnabledProviders } from "./providers/registry.ts";
import type { TerminalLauncher } from "./terminalLauncher.ts";

const providerValue = (value: string | undefined): ProviderId | undefined =>
  value !== undefined && isProviderId(value) ? value : undefined;

const booleanValue = (value: string | undefined): boolean => value === "1" || value === "true";

const collectionValue = (value: string | undefined): number | null | undefined => {
  if (value === undefined || value === "") return undefined;
  if (value === "unassigned") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const metadataSchema = z
  .object({
    customTitle: z.string().max(200).nullable().optional(),
    favorite: z.boolean().optional(),
    collectionId: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (value) =>
      value.customTitle !== undefined ||
      value.favorite !== undefined ||
      value.collectionId !== undefined,
    { message: "At least one metadata field is required" },
  );

const collectionSchema = z.object({ name: z.string().trim().min(1).max(100) });
const resumeCommandTemplateSchema = z.object({ template: z.string().trim().min(1).max(500) });
const terminalSettingsSchema = z
  .object({
    terminal: z.enum(TERMINAL_IDS),
    customPath: z.string().trim().max(1000).nullable(),
    shellPath: z.string().trim().min(1).max(1000),
  })
  .refine(
    (value) => value.terminal !== "custom" || (value.customPath?.length ?? 0) > 0,
    { message: "Custom terminal path is required" },
  );
const providerSourceSchema = z.object({
  enabled: z.boolean(),
  home: z.string().trim().min(1).max(2000).nullable(),
});

const isLoopbackHostname = (hostname: string): boolean =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLocaleLowerCase());

const isTrustedLaunchRequest = (context: Context): boolean => {
  if (!context.req.header("content-type")?.toLocaleLowerCase().startsWith("application/json")) {
    return false;
  }
  const origin = context.req.header("origin");
  if (origin === undefined) return false;
  try {
    return new URL(origin).origin === new URL(context.req.url).origin;
  } catch {
    return false;
  }
};

export const createApp = (options: {
  database: SearchDatabase;
  indexer: SessionIndexer;
  config: AppConfig;
  terminalLauncher: Pick<TerminalLauncher, "launch">;
  clientDirectory?: string;
  runtimePlatform?: NodeJS.Platform;
}): Hono => {
  const { database, indexer, config, terminalLauncher } = options;
  const runtimePlatform = options.runtimePlatform ?? process.platform;
  const app = new Hono();

  app.get("/api/providers", (context) => context.json({ providers: PROVIDER_DESCRIPTORS }));

  const listProviderSourceSettings = async (): Promise<ProviderSourceSetting[]> => {
    const preferences = database.getProviderSourceSettings(config.providerHomes, config.providers);
    const statuses = new Map((await indexer.status()).map((status) => [status.provider, status]));
    const counts = database.countSessions();
    return preferences.map((preference) => {
      const status = statuses.get(preference.provider);
      return {
        ...preference,
        detected: status?.detected ?? false,
        sessionRoots: status?.sessionRoots ?? [],
        sessionCount: counts[preference.provider] ?? 0,
      };
    });
  };

  app.get("/api/settings/providers", async (context) =>
    context.json({ settings: await listProviderSourceSettings() }),
  );

  app.patch("/api/settings/providers/:provider", async (context) => {
    const provider = providerValue(context.req.param("provider"));
    const parsed = providerSourceSchema.safeParse(await context.req.json());
    if (provider === undefined || !parsed.success) {
      return context.json({ error: "Invalid provider source setting" }, 400);
    }
    if (parsed.data.home !== null && !isAbsolute(parsed.data.home)) {
      return context.json({ error: "Provider home must be an absolute path" }, 400);
    }
    try {
      database.updateProviderSourceSetting(provider, parsed.data);
      const preferences = database.getProviderSourceSettings(config.providerHomes, config.providers);
      const homes = Object.fromEntries(
        preferences.map((preference) => [preference.provider, preference.home]),
      ) as AppConfig["providerHomes"];
      const enabled = new Set(
        preferences.filter((preference) => preference.enabled).map((preference) => preference.provider),
      );
      for (const preference of preferences) {
        if (!preference.enabled) database.removeMissingFiles(preference.provider, new Set());
      }
      await indexer.reconfigure(createEnabledProviders(enabled, homes), config.watch);
      return context.json({ settings: await listProviderSourceSettings() });
    } catch (error) {
      return context.json({ error: String(error) }, 400);
    }
  });

  app.get("/api/status", async (context) =>
    context.json({
      providers: await indexer.status(),
      counts: database.countSessions(),
      watch: config.watch,
      sync: indexer.syncProgress(),
      runtimePlatform: normalizeRuntimePlatform(runtimePlatform),
    }),
  );

  app.get("/api/projects", (context) => context.json({ projects: database.listProjects() }));

  app.get("/api/sessions", (context) => {
    const query = context.req.query();
    const provider = providerValue(query.provider);
    const collectionId = collectionValue(query.collection);
    return context.json({
      sessions: database.listSessions({
        ...(provider === undefined ? {} : { provider }),
        ...(query.projectPath === undefined ? {} : { projectPath: query.projectPath }),
        favoritesOnly: booleanValue(query.favorites),
        renamedOnly: booleanValue(query.renamed),
        ...(collectionId === undefined ? {} : { collectionId }),
        limit: Number.parseInt(query.limit ?? "100", 10),
      }),
    });
  });

  app.post("/api/sessions/:sessionKey/open-terminal", async (context) => {
    if (!isLoopbackHostname(config.hostname) || !isTrustedLaunchRequest(context)) {
      return context.json({ error: "Terminal launching is only available to same-origin loopback requests" }, 403);
    }
    const result = database.getSession(context.req.param("sessionKey"));
    if (result === null) return context.json({ error: "Session not found" }, 404);
    const template = database.getResumeCommandTemplates()[result.session.provider];
    if (template === undefined) {
      return context.json({ error: "Resume command is unavailable for this provider" }, 400);
    }
    const terminalSettings = database.getTerminalSettings(runtimePlatform);
    const command = renderResumeCommand(template, {
      sessionId: result.session.sourceSessionId,
      cwd: result.session.projectPath,
    }, commandDialectForTerminal(
      terminalSettings.terminal,
      normalizeRuntimePlatform(runtimePlatform),
      terminalSettings.shellPath,
    ));
    try {
      await terminalLauncher.launch(
        terminalSettings,
        command,
        result.session.projectPath,
      );
      return context.json({ launched: true, command });
    } catch (error) {
      return context.json({ error: String(error) }, 500);
    }
  });

  app.get("/api/sessions/:sessionKey", (context) => {
    const result = database.getSession(context.req.param("sessionKey"));
    return result === null ? context.json({ error: "Session not found" }, 404) : context.json(result);
  });

  app.patch("/api/sessions/:sessionKey/metadata", async (context) => {
    const parsed = metadataSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: parsed.error.issues }, 400);
    const metadataPatch = {
      ...(parsed.data.customTitle === undefined ? {} : { customTitle: parsed.data.customTitle }),
      ...(parsed.data.favorite === undefined ? {} : { favorite: parsed.data.favorite }),
      ...(parsed.data.collectionId === undefined
        ? {}
        : { collectionId: parsed.data.collectionId }),
    };
    const session = database.updateMetadata(context.req.param("sessionKey"), metadataPatch);
    return session === null ? context.json({ error: "Session not found" }, 404) : context.json({ session });
  });

  app.get("/api/search", (context) => {
    const query = context.req.query();
    const q = query.q?.trim() ?? "";
    if (q === "") return context.json({ results: [] });
    const provider = providerValue(query.provider);
    const collectionId = collectionValue(query.collection);
    return context.json({
      results: database.search({
        query: q,
        ...(provider === undefined ? {} : { provider }),
        ...(query.projectPath === undefined ? {} : { projectPath: query.projectPath }),
        favoritesOnly: booleanValue(query.favorites),
        renamedOnly: booleanValue(query.renamed),
        ...(collectionId === undefined ? {} : { collectionId }),
        limit: Number.parseInt(query.limit ?? "50", 10),
      }),
    });
  });

  app.get("/api/collections", (context) =>
    context.json({ collections: database.listCollections() }),
  );

  app.post("/api/collections", async (context) => {
    const parsed = collectionSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: parsed.error.issues }, 400);
    try {
      return context.json({ collection: database.createCollection(parsed.data.name) }, 201);
    } catch (error) {
      return context.json({ error: String(error) }, 409);
    }
  });

  app.patch("/api/collections/:id", async (context) => {
    const id = Number.parseInt(context.req.param("id"), 10);
    const parsed = collectionSchema.safeParse(await context.req.json());
    if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
      return context.json({ error: "Invalid collection" }, 400);
    }
    try {
      const collection = database.renameCollection(id, parsed.data.name);
      return collection === null
        ? context.json({ error: "Collection not found" }, 404)
        : context.json({ collection });
    } catch (error) {
      return context.json({ error: String(error) }, 409);
    }
  });

  app.delete("/api/collections/:id", (context) => {
    const id = Number.parseInt(context.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) return context.json({ error: "Invalid collection" }, 400);
    return database.deleteCollection(id)
      ? context.json({ deleted: true })
      : context.json({ error: "Collection not found" }, 404);
  });

  app.get("/api/settings/resume-commands", (context) =>
    context.json({ templates: database.getResumeCommandTemplates() }),
  );

  app.patch("/api/settings/resume-commands/:provider", async (context) => {
    const provider = providerValue(context.req.param("provider"));
    const parsed = resumeCommandTemplateSchema.safeParse(await context.req.json());
    if (provider === undefined || !parsed.success) {
      return context.json({ error: "Invalid resume command template" }, 400);
    }
    return context.json({
      templates: database.updateResumeCommandTemplate(provider, parsed.data.template),
    });
  });

  app.get("/api/settings/terminal", (context) =>
    context.json({ settings: database.getTerminalSettings(runtimePlatform) }),
  );

  app.patch("/api/settings/terminal", async (context) => {
    const parsed = terminalSettingsSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: parsed.error.issues }, 400);
    try {
      return context.json({
        settings: database.updateTerminalSettings(parsed.data, runtimePlatform),
      });
    } catch (error) {
      return context.json({ error: String(error) }, 400);
    }
  });

  app.post("/api/sync", async (context) => context.json({ results: await indexer.syncAll() }));

  const clientDirectory = options.clientDirectory ?? resolve(process.cwd(), "dist/client");
  if (existsSync(clientDirectory)) {
    app.use("/*", serveStatic({ root: clientDirectory }));
    app.get("*", serveStatic({ root: clientDirectory, path: "index.html" }));
  }

  return app;
};
