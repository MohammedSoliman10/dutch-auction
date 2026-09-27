import type { FastifyError, FastifyInstance } from "fastify";

/**
 * Global error handler per api.md status/error catalogue:
 * - unexpected failures answer 500 INTERNAL with the request id (logged server-side,
 *   never echoing internals to the caller);
 * - genuine 4xx fastify errors keep their status and map to INVALID_PARAMETER —
 *   they are never downgraded to 500.
 * Route-level rejections answer their own envelopes before reaching here.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    if (status === 500) {
      request.log.error({ err: error }, "unhandled error");
      return reply
        .code(500)
        .send({ error: { code: "INTERNAL", message: `Unexpected error (request id ${request.id})` } });
    }
    return reply.code(status).send({ error: { code: "INVALID_PARAMETER", message: error.message } });
  });
}
