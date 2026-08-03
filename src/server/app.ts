import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { z } from "zod";
import type { ProviderId } from "../shared/types.ts";
import type { AppConfig } from "./config.ts";
import { SearchDatabase } from "./database.ts";
import { SessionIndexer } from "./indexer.ts";

const providerValue = (value: string | undefined): ProviderId | undefined =>
  value === "claude" || value === "codex" ? value : undefined;

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

export const createApp = (options: {
  database: SearchDatabase;
  indexer: SessionIndexer;
  config: AppConfig;
}): Hono => {
  const { database, indexer, config } = options;
  const app = new Hono();

  app.get("/api/status", async (context) =>
    context.json({
      providers: await indexer.status(),
      counts: database.countSessions(),
      watch: config.watch,
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

  app.post("/api/sync", async (context) => context.json({ results: await indexer.syncAll() }));

  const clientDirectory = resolve(process.cwd(), "dist/client");
  if (existsSync(clientDirectory)) {
    app.use("/*", serveStatic({ root: clientDirectory }));
    app.get("*", serveStatic({ root: clientDirectory, path: "index.html" }));
  }

  return app;
};
