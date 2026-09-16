import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptToken } from "../db/encryption.js";
import { upsertTenant, upsertConnection, getConnection } from "../db/schema.js";
import { getEnv } from "../config/env.js";
import { detectUpstream } from "../services/upstream.js";

const connectSchema = z.object({
  tenantId: z.string().min(1).max(128),
  /** Prometheus URL OR a Grafana URL — auto-detected. */
  prometheusUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
      message: "prometheusUrl must be an http(s) URL",
    }),
  /** Bearer token for Prometheus, or a Grafana service-account token. */
  authToken: z.string().max(4096).optional(),
  /** Explicit override; omitted = auto-detect. */
  upstreamType: z.enum(["prometheus", "grafana"]).optional(),
});

export interface ConnectResponse {
  ok: boolean;
  tenantId: string;
  status: "connected" | "error";
  latencyMs: number;
  upstreamType: "prometheus" | "grafana";
  detail: string;
  error?: string;
}

/** POST /api/connect — detect upstream, probe, encrypt token, persist. */
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
    const { tenantId, prometheusUrl, authToken, upstreamType } = parsed.data;
    const startedAt = Date.now();

    // Detect/resolve the upstream (direct Prometheus or Grafana datasource).
    let detection;
    try {
      detection = await detectUpstream(prometheusUrl, { authToken });
      if (upstreamType !== undefined && detection.type !== upstreamType) {
        return reply.code(400).send({
          error: `URL resolved as ${detection.type} but upstreamType=${upstreamType} was requested`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upstream detection failed";
      return reply.code(502).send({
        ok: false,
        tenantId,
        status: "error" as const,
        latencyMs: Date.now() - startedAt,
        upstreamType: "prometheus" as const,
        detail: "upstream unreachable",
        error: message,
      });
    }

    // Verify the resolved base actually serves /api/v1/query ( Grafana
    // datasource proxies support this path).
    const probeStarted = Date.now();
    let probeOk = false;
    let probeError: string | undefined;
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (authToken !== undefined && authToken.length > 0) {
        headers.authorization = `Bearer ${authToken}`;
      }
      const response = await fetch(`${detection.queryBaseUrl}/api/v1/query?query=up`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      probeOk = response.ok;
      if (!probeOk) {
        probeError = `Upstream /api/v1/query responded ${response.status}`;
      }
    } catch (error) {
      probeError = error instanceof Error ? error.message : "Probe failed";
    }

    // Encrypt BEFORE any persistence. Never log the plaintext token.
    const encrypted =
      authToken !== undefined && authToken.length > 0
        ? encryptToken(authToken, getEnv().ENCRYPTION_KEY)
        : null;

    await upsertTenant(tenantId, tenantId);
    await upsertConnection({
      tenantId,
      prometheusUrl: detection.queryBaseUrl,
      authTokenEncrypted: encrypted,
      status: probeOk ? "connected" : "error",
      upstreamType: detection.type,
    });

    const response: ConnectResponse = {
      ok: probeOk,
      tenantId,
      status: probeOk ? "connected" : "error",
      latencyMs: Date.now() - probeStarted,
      upstreamType: detection.type,
      detail: detection.detail,
      ...(probeError !== undefined ? { error: probeError } : {}),
    };
    return reply.code(probeOk ? 200 : 502).send(response);
  });

  /** GET /api/connection/:tenantId — connection state + detected upstream flavor. */
  app.get<{ Params: { tenantId: string } }>(
    "/api/connection/:tenantId",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      if (!tenantId.success) {
        return reply.code(400).send({ error: "Invalid tenantId" });
      }
      const connection = await getConnection(tenantId.data);
      if (connection === null) {
        return reply.code(404).send({ error: "No connection for this tenant" });
      }
      return reply.code(200).send({
        tenantId: connection.tenant_id,
        status: connection.status,
        upstreamType: connection.upstream_type ?? "prometheus",
        // Never expose the URL to anonymous callers beyond its host.
        upstreamHost: safeHost(connection.prometheus_url),
        updatedAt: connection.updated_at,
      });
    }
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
