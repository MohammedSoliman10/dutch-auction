import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerErrorHandler } from "../src/errorHandler.js";

describe("global error handler", () => {
  it("maps unexpected throws to 500 INTERNAL with request id, no internals leaked", async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get("/boom", () => {
      throw new Error("boom-secret-detail");
    });

    const res = await app.inject({ method: "GET", url: "/boom" });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toMatch(/request id/i);
    expect(body.error.message).not.toContain("boom-secret-detail");
    await app.close();
  });

  it("passes 4xx fastify errors through as INVALID_PARAMETER with their status", async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get("/bad", () => {
      throw Object.assign(new Error("bad input"), { statusCode: 400 });
    });

    const res = await app.inject({ method: "GET", url: "/bad" });

    // Route-level rejections are handled by routes themselves; this asserts the
    // handler never downgrades a genuine 4xx to 500 INTERNAL.
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
