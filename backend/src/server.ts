import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { createDb } from "./db.js";
import { registerRoutes } from "./routes/index.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// Production hosting of the built SPA (R12): the API and the frontend share one
// origin, so no CORS is needed. Resolved relative to cwd and to this module so it
// works whether the process starts in backend/, the repo root, tsx, or dist/.
function resolveSpaRoot(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "../frontend/dist"),
    path.resolve(process.cwd(), "frontend/dist"),
    path.resolve(moduleDir, "../../frontend/dist"),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, "index.html"))) ?? null;
}

export async function createServer(): Promise<FastifyInstance> {
  const db = createDb();
  const app = Fastify({ logger: true });

  app.addHook("onClose", async () => {
    db.close();
  });

  await registerRoutes(app, db);

  const spaRoot = resolveSpaRoot();
  if (spaRoot !== null) {
    await app.register(fastifyStatic, { root: spaRoot, index: ["index.html"] });
  }

  app.setNotFoundHandler((request, reply) => {
    // /api/* and non-GET requests get the JSON error envelope; other GETs fall
    // through to the SPA shell so client-side routes deep-link correctly.
    if (/^\/api(?:\/|\?|$)/.test(request.url) || request.method !== "GET") {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
    }
    if (spaRoot !== null) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "SPA build not found" } });
  });

  return app;
}
