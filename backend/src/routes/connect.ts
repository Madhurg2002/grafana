import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptToken } from "../db/encryption.js";
import { upsertTenant, upsertConnection } from "../db/schema.js";
import { probeUp } from "../services/prometheus.js";
import { getEnv } from "../config/env.js";

const connectSchema = z.object({
  tenantId: z.string().min(1).max(128),
  prometheusUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
      message: "prometheusUrl must be an http(s) URL",
    }),
  authToken: z.string().max(4096).optional(),
});

export interface ConnectResponse {
  ok: boolean;
  tenantId: string;
  status: "connected" | "error";
  latencyMs: number;
  error?: string;
}

/** POST /api/connect — validate, probe, encrypt token, persist connection. */
export async function connectRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/api/connect", async (request, reply) => {
    const parsed = connectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const { tenantId, prometheusUrl, authToken } = parsed.data;

    // Probe upstream `up` (wrapped in the shared circuit breaker).
    const probe = await probeUp(prometheusUrl, authToken);

    // Encrypt BEFORE any persistence. Never log the plaintext token.
    const encrypted = authToken !== undefined && authToken.length > 0
      ? encryptToken(authToken, getEnv().ENCRYPTION_KEY)
      : null;

    await upsertTenant(tenantId, tenantId);
    await upsertConnection({
      tenantId,
      prometheusUrl,
      authTokenEncrypted: encrypted,
      status: probe.ok ? "connected" : "error",
    });

    const response: ConnectResponse = {
      ok: probe.ok,
      tenantId,
      status: probe.ok ? "connected" : "error",
      latencyMs: probe.latencyMs,
      ...(probe.error !== undefined ? { error: probe.error } : {}),
    };
    return reply.code(probe.ok ? 200 : 502).send(response);
  });
}
