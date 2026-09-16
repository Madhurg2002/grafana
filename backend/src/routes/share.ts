import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../middleware/auth.js";
import {
  createShareLink,
  getShareLink,
  listShareLinks,
  revokeShareLink,
  tenantOwnedBy,
} from "../db/users.js";
import { instantQuery } from "../services/prometheus.js";
import { DEFAULT_PUBLIC_QUERIES } from "../services/publicQueries.js";

const createSchema = z.object({
  tenantId: z.string().min(1).max(128),
  label: z.string().min(1).max(64).optional(),
});

export interface ShareViewHost {
  instance: string;
  job: string;
  up: number;
}

export interface ShareViewPayload {
  tenantId: string;
  label: string | null;
  createdAt: string;
  metrics: {
    hosts: ShareViewHost[];
    hostsUp: number;
    hostsTotal: number;
    cpuPercent: number | null;
    ramPercent: number | null;
  };
  generatedAt: string;
}

function scalarFrom(result: unknown[]): number | null {
  if (result.length === 0) {
    return null;
  }
  const first = result[0] as { value?: { value: number } };
  return typeof first.value?.value === "number" ? first.value.value : null;
}

/** Registers share-link routes: owner-managed creation + public read-only view. */
export async function shareRoutes(app: FastifyInstance): Promise<void> {
  // Create a share link (auth required, ownership enforced).
  app.post<{ Body: unknown }>("/api/share", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) {
      return reply; // 401 already sent
    }
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body" });
    }
    const { tenantId, label } = parsed.data;
    const owned = await tenantOwnedBy(tenantId, user.sub);
    if (!owned) {
      return reply.code(403).send({ error: "You do not own this tenant" });
    }
    const link = await createShareLink({
      tenantId,
      createdBy: user.sub,
      label: label ?? "default",
    });
    return reply.code(201).send({
      id: link.id,
      url: `/share/${link.id}`,
      label: link.label,
      createdAt: link.created_at,
    });
  });

  // List active share links for a tenant (owner only).
  app.get<{ Querystring: unknown }>("/api/share", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) {
      return reply;
    }
    const parsed = z
      .object({ tenantId: z.string().min(1).max(128) })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "tenantId query parameter is required" });
    }
    const owned = await tenantOwnedBy(parsed.data.tenantId, user.sub);
    if (!owned) {
      return reply.code(403).send({ error: "You do not own this tenant" });
    }
    const links = await listShareLinks(parsed.data.tenantId);
    return reply.code(200).send({
      links: links.map((link) => ({
        id: link.id,
        url: `/share/${link.id}`,
        label: link.label,
        createdAt: link.created_at,
      })),
    });
  });

  // Revoke (owner only).
  app.delete<{ Params: { id: string } }>("/api/share/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) {
      return reply;
    }
    const revoked = await revokeShareLink(request.params.id, user.sub);
    return reply.code(revoked ? 200 : 404).send({ revoked });
  });

  // Public, unauthenticated read-only view — the "shareable link" target.
  app.get<{ Params: { id: string } }>("/api/share/:id/view", async (request, reply) => {
    const link = await getShareLink(request.params.id);
    if (link === null || link.revoked) {
      return reply.code(404).send({ error: "Share link not found or revoked" });
    }

    const metrics: ShareViewPayload["metrics"] = {
      hosts: [],
      hostsUp: 0,
      hostsTotal: 0,
      cpuPercent: null,
      ramPercent: null,
    };

    try {
      const hosts = await instantQuery({ tenantId: link.tenant_id, query: DEFAULT_PUBLIC_QUERIES.hostsUp });
      const hostEntries = hosts.result.result.map((entry) => {
        const item = entry as { metric?: Record<string, string>; value?: { value: number } };
        return {
          instance: item.metric?.instance ?? "unknown",
          job: item.metric?.job ?? "unknown",
          up: item.value?.value ?? 0,
        };
      });
      metrics.hosts = hostEntries;
      metrics.hostsTotal = hostEntries.length;
      metrics.hostsUp = hostEntries.filter((h) => h.up === 1).length;

      const cpu = await instantQuery({ tenantId: link.tenant_id, query: DEFAULT_PUBLIC_QUERIES.cpu });
      metrics.cpuPercent = scalarFrom(cpu.result.result);

      const ram = await instantQuery({ tenantId: link.tenant_id, query: DEFAULT_PUBLIC_QUERIES.ram });
      metrics.ramPercent = scalarFrom(ram.result.result);
    } catch {
      // Upstream degraded — return whatever we have; client shows stale state.
    }

    const payload: ShareViewPayload = {
      tenantId: link.tenant_id,
      label: link.label,
      createdAt: link.created_at.toISOString(),
      metrics,
      generatedAt: new Date().toISOString(),
    };
    return reply.code(200).send(payload);
  });
}
