import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantAccess } from "../middleware/auth.js";
import { getSseBroadcaster } from "../services/sse.js";
import { getEnv } from "../config/env.js";

const streamQuerySchema = z.object({
  tenantId: z.string().min(1).max(128),
});

/**
 * SSE responses write raw headers (bypassing Fastify's reply pipeline), so
 * the @fastify/cors headers never land on them automatically. Compute the
 * allow-list decision here and mirror it onto the raw response.
 */
function corsOriginFor(requestOrigin: string | undefined): string {
  const allowed = getEnv()
    .CORS_ORIGIN.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (allowed.includes("*")) {
    return "*";
  }
  if (requestOrigin !== undefined && allowed.includes(requestOrigin)) {
    return requestOrigin;
  }
  // Same-origin calls (Vite proxy) send no Origin header — omit the header
  // entirely; browsers only enforce CORS on cross-origin responses.
  return "";
}

/** GET /api/stream?tenantId=... — single-poll SSE fan-out per tenant. */
export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stream", async (request, reply) => {
    const parsed = streamQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "tenantId query parameter is required" });
    }
    const { tenantId } = parsed.data;
    if (!(await requireTenantAccess(request, reply, tenantId))) {
      return reply; // 401/403 already sent
    }

    const corsOrigin = corsOriginFor(request.headers.origin);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      // Raw writeHead bypasses @fastify/cors — headers must be explicit.
      ...(corsOrigin.length > 0 ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
    });
    reply.raw.write(`retry: 3000\n\n`);
    reply.raw.write(`event: connected\ndata: {"tenantId":"${tenantId}"}\n\n`);

    const broadcaster = getSseBroadcaster();
    const removeClient = broadcaster.addClient(tenantId, (payload) => {
      reply.raw.write(`event: health\ndata: ${payload}\n\n`);
    });

    // Clean up on socket close — critical to stop the per-tenant poll loop.
    request.raw.on("close", () => {
      removeClient();
      try {
        reply.raw.end();
      } catch {
        // Socket already destroyed.
      }
    });

    // Keep the reply open; Fastify must not auto-send.
    await reply;
  });
}
