import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSseBroadcaster } from "../services/sse.js";

const streamQuerySchema = z.object({
  tenantId: z.string().min(1).max(128),
});

/** GET /api/stream?tenantId=... — single-poll SSE fan-out per tenant. */
export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stream", async (request, reply) => {
    const parsed = streamQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "tenantId query parameter is required" });
    }
    const { tenantId } = parsed.data;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
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
