import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptToken } from "../db/encryption.js";
import {
  upsertTenant,
  upsertConnection,
  getConnection,
  listConnections,
  activateConnection,
  deleteConnection,
  listPanels,
  createPanel,
  deletePanel,
  reorderPanels,
  listPages,
  createPage,
  deletePage,
  renamePage,
} from "../db/schema.js";
import { normalizePromQL } from "../services/prometheus.js";
import { getEnv } from "../config/env.js";
import { detectUpstream } from "../services/upstream.js";

const connectSchema = z.object({
  tenantId: z.string().min(1).max(128),
  /**
   * Prometheus/Grafana URL — bare `host:port` (e.g. 10.0.0.5:9090) is also
   * accepted; `normalizeUpstreamInput` adds http:// before detection.
   */
  prometheusUrl: z
    .string()
    .min(4, "prometheusUrl is required")
    .max(2048)
    .refine(
      (url) => {
        const value = url.trim();
        if (value.length === 0 || /\s/.test(value)) {
          return false;
        }
        const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value);
        if (schemeMatch !== null) {
          // Only http(s) schemes are ever proxied.
          const scheme = schemeMatch[1].toLowerCase();
          return scheme === "http" || scheme === "https";
        }
        // Scheme-less: host[:port][/path] — the normalizer adds http://.
        return /^[^\s/@]+(:[0-9]{2,5})?(\/.*)?$/.test(value);
      },
      { message: "Enter a URL like https://prom.example.com or 10.0.0.5:9090" }
    ),
  /** Bearer token for Prometheus, or a Grafana service-account token. */
  authToken: z.string().max(4096).optional(),
  /** Explicit override; omitted = auto-detect. */
  upstreamType: z.enum(["prometheus", "grafana"]).optional(),
  /** Label for multi-connection switching; defaults to "default". */
  label: z.string().min(1).max(64).regex(/^[a-zA-Z0-9-_ ]+$/).optional(),
  /** Store without switching (default: switch to the new connection). */
  activate: z.boolean().optional(),
});

const panelSchema = z.object({
  title: z.string().min(1).max(80),
  promql: z.string().min(1).max(4096),
  kind: z.enum(["sparkline", "gauge", "stat"]).default("sparkline"),
  unit: z.string().max(24).optional(),
});

export interface ConnectResponse {
  ok: boolean;
  tenantId: string;
  status: "connected" | "error";
  latencyMs: number;
  upstreamType: "prometheus" | "grafana";
  detail: string;
  connectionId?: number;
  label?: string;
  activated?: boolean;
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
    const { tenantId, prometheusUrl, authToken, upstreamType, label, activate } = parsed.data;
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
    const saved = await upsertConnection({
      tenantId,
      prometheusUrl: detection.queryBaseUrl,
      authTokenEncrypted: encrypted,
      status: probeOk ? "connected" : "error",
      upstreamType: detection.type,
      label: label ?? ("default" as const),
      activate: activate ?? true,
    });

    const response: ConnectResponse = {
      ok: probeOk,
      tenantId,
      status: probeOk ? "connected" : "error",
      latencyMs: Date.now() - probeStarted,
      upstreamType: detection.type,
      detail: detection.detail,
      connectionId: saved.id,
      label: saved.label ?? "default",
      activated: activate ?? true,
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

  /**
   * GET /api/connections/:tenantId — all stored URIs with the active one
   * flagged, so the UI can render the switcher and edit/delete controls.
   */
app.get<{ Params: { tenantId: string } }>(
  "/api/connections/:tenantId",
  async (request, reply) => {
    const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
    if (!tenantId.success) {
      return reply.code(400).send({ error: "Invalid tenantId" });
    }
    const connections = await listConnections(tenantId.data);
    return reply.code(200).send({
      connections: connections.map((c) => ({
        id: c.id,
        label: c.label ?? "default",
        status: c.status,
        upstreamType: c.upstream_type ?? "prometheus",
        upstreamHost: safeHost(c.prometheus_url),
        isActive: c.is_active ?? false,
        hasToken: c.auth_token_encrypted !== null,
        updatedAt: c.updated_at,
      })),
    });
  }
);

/** POST /api/connections/:tenantId/:id/activate — switch without reconnecting. */
app.post<{ Params: { tenantId: string; id: string } }>(
  "/api/connections/:tenantId/:id/activate",
  async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse(request.params.id);
    if (!id.success) {
      return reply.code(400).send({ error: "Invalid connection id" });
    }
    const activated = await activateConnection(request.params.tenantId, id.data);
    if (activated === null) {
      return reply.code(404).send({ error: "Connection not found for this tenant" });
    }
    return reply.code(200).send({
      activated: true,
      id: activated.id,
      label: activated.label ?? "default",
    });
  }
);

/** DELETE /api/connections/:tenantId/:id — forget a stored URI. */
app.delete<{ Params: { tenantId: string; id: string } }>(
  "/api/connections/:tenantId/:id",
  async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse(request.params.id);
    if (!id.success) {
      return reply.code(400).send({ error: "Invalid connection id" });
    }
    const removed = await deleteConnection(request.params.tenantId, id.data);
    return reply.code(removed ? 200 : 404).send({ removed });
  }
);

// ---------------------------------------------------------------------------
// Custom dashboard panels (user-defined views)
// ---------------------------------------------------------------------------

/** GET /api/panels/:tenantId?pageId= — panels, optionally scoped to a page. */
app.get<{ Params: { tenantId: string }; Querystring: { pageId?: string } }>(
  "/api/panels/:tenantId",
  async (request, reply) => {
  const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
  if (!tenantId.success) {
    return reply.code(400).send({ error: "Invalid tenantId" });
  }
  const pageIdRaw = request.query.pageId;
  let pageId: number | undefined;
  if (pageIdRaw !== undefined && pageIdRaw !== "") {
    const parsedPage = z.coerce.number().int().positive().safeParse(pageIdRaw);
    if (!parsedPage.success) {
      return reply.code(400).send({ error: "Invalid pageId" });
    }
    pageId = parsedPage.data;
  }
  const panels = await listPanels(tenantId.data, pageId);
  return reply.code(200).send({ panels });
});

/** POST /api/panels/:tenantId — create/upsert a panel (title is the key). */
app.post<{ Params: { tenantId: string }; Body: unknown }>(
  "/api/panels/:tenantId",
  async (request, reply) => {
    const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
    if (!tenantId.success) {
      return reply.code(400).send({ error: "Invalid tenantId" });
    }
    const parsed = panelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid panel body",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    // Store the NORMALIZED query so saved panels always obey safety laws.
    const normalized = normalizePromQL(parsed.data.promql);
    const pageIdSchema = z.number().int().positive().optional();
    const rawPage = (request.body as { pageId?: unknown } | null)?.pageId;
    const pageId = pageIdSchema.safeParse(rawPage);
    if (!pageId.success && rawPage !== undefined) {
      return reply.code(400).send({ error: "Invalid pageId" });
    }
    const panel = await createPanel({
      tenantId: tenantId.data,
      title: parsed.data.title,
      promql: normalized,
      kind: parsed.data.kind,
      unit: parsed.data.unit,
      pageId: pageId.success ? pageId.data : undefined,
    });
    return reply.code(201).send({ panel });
  }
);

/** DELETE /api/panels/:tenantId/:id */
app.delete<{ Params: { tenantId: string; id: string } }>(
  "/api/panels/:tenantId/:id",
  async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse(request.params.id);
    if (!id.success) {
      return reply.code(400).send({ error: "Invalid panel id" });
    }
    const removed = await deletePanel(request.params.tenantId, id.data);
    return reply.code(removed ? 200 : 404).send({ removed });
  }
);

const reorderSchema = z.object({ position: z.number().int().min(0).max(999) });

// ---------------------------------------------------------------------------
// Dashboard pages ("Home" + user-created groupings of panels)
// ---------------------------------------------------------------------------

const pageSchema = z.object({ name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9-_ ]+$/) });

/** GET /api/pages/:tenantId — ordered pages; lowest position is Home. */
app.get<{ Params: { tenantId: string } }>("/api/pages/:tenantId", async (request, reply) => {
  const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
  if (!tenantId.success) {
    return reply.code(400).send({ error: "Invalid tenantId" });
  }
  const pages = await listPages(tenantId.data);
  // Auto-provision Home on first read so the UI always has a landing page.
  if (pages.length === 0) {
    await createPage(tenantId.data, "Home");
    return reply.code(200).send({ pages: await listPages(tenantId.data) });
  }
  return reply.code(200).send({ pages });
});

app.post<{ Params: { tenantId: string }; Body: unknown }>(
  "/api/pages/:tenantId",
  async (request, reply) => {
    const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
    if (!tenantId.success) {
      return reply.code(400).send({ error: "Invalid tenantId" });
    }
    const parsed = pageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Page name must be 1–64 chars (letters, digits, spaces, - _)",
      });
    }
    const page = await createPage(tenantId.data, parsed.data.name.trim());
    return reply.code(201).send({ page });
  }
);

app.patch<{ Params: { tenantId: string; id: string }; Body: unknown }>(
  "/api/pages/:tenantId/:id",
  async (request, reply) => {
    const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
    const id = z.coerce.number().int().positive().safeParse(request.params.id);
    if (!tenantId.success || !id.success) {
      return reply.code(400).send({ error: "Invalid tenantId or page id" });
    }
    const parsed = pageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid page name" });
    }
    const ok = await renamePage(tenantId.data, id.data, parsed.data.name.trim());
    return reply.code(ok ? 200 : 404).send({ ok });
  }
);

app.delete<{ Params: { tenantId: string; id: string } }>(
  "/api/pages/:tenantId/:id",
  async (request, reply) => {
    const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
    const id = z.coerce.number().int().positive().safeParse(request.params.id);
    if (!tenantId.success || !id.success) {
      return reply.code(400).send({ error: "Invalid tenantId or page id" });
    }
    const ok = await deletePage(tenantId.data, id.data);
    return reply.code(ok ? 200 : 404).send({ ok });
  }
);

/** POST /api/panels/:tenantId/:id/reorder — persist a new panel position. */
app.post<{ Params: { tenantId: string; id: string }; Body: unknown }>(
  "/api/panels/:tenantId/:id/reorder",
  async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse(request.params.id);
    const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
    if (!id.success || !tenantId.success) {
      return reply.code(400).send({ error: "Invalid panel id or tenantId" });
    }
    const parsed = reorderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid position" });
    }
    const ok = await reorderPanels(tenantId.data, [
      { id: id.data, position: parsed.data.position },
    ]);
    return reply.code(ok ? 200 : 404).send({ ok });
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