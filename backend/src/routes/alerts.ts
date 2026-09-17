import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantAccess } from "../middleware/auth.js";
import {
  createAlert,
  deleteAlert,
  listAlerts,
  updateAlertEnabled,
  type AlertComparator,
} from "../db/schema.js";

/**
 * Threshold alerts API (migration 011 + services/alertEvaluator.ts).
 * All routes are tenant-authenticated (session or tenant token).
 */
export async function alertRoutes(app: FastifyInstance): Promise<void> {
  const alertBodySchema = z.object({
    title: z.string().min(1).max(80),
    promql: z.string().min(1).max(2000),
    comparator: z.enum([">", "<", ">=", "<=", "=="]),
    threshold: z.number(),
    forSeconds: z.number().int().min(0).max(86400).optional(),
    webhookUrl: z.string().url().max(500).optional(),
  });
  const enableSchema = z.object({ enabled: z.boolean() });

  app.get<{ Params: { tenantId: string } }>(
    "/api/alerts/:tenantId",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      if (!tenantId.success) {
        return reply.code(400).send({ error: "Invalid tenantId" });
      }
      if (!(await requireTenantAccess(request, reply, tenantId.data))) {
        return reply; // 401/403 already sent
      }
      return reply.code(200).send({ alerts: await listAlerts(tenantId.data) });
    }
  );

  app.post<{ Params: { tenantId: string }; Body: unknown }>(
    "/api/alerts/:tenantId",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      if (!tenantId.success) {
        return reply.code(400).send({ error: "Invalid tenantId" });
      }
      if (!(await requireTenantAccess(request, reply, tenantId.data))) {
        return reply;
      }
      const parsed = alertBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid alert",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      const alert = await createAlert({
        tenantId: tenantId.data,
        title: parsed.data.title.trim(),
        promql: parsed.data.promql.trim(),
        comparator: parsed.data.comparator as AlertComparator,
        threshold: parsed.data.threshold,
        forSeconds: parsed.data.forSeconds,
        webhookUrl: parsed.data.webhookUrl,
      });
      return reply.code(201).send({ alert });
    }
  );

  app.patch<{ Params: { tenantId: string; id: string }; Body: unknown }>(
    "/api/alerts/:tenantId/:id",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      const id = z.coerce.number().int().positive().safeParse(request.params.id);
      if (!tenantId.success || !id.success) {
        return reply.code(400).send({ error: "Invalid tenantId or alert id" });
      }
      if (!(await requireTenantAccess(request, reply, tenantId.data))) {
        return reply;
      }
      const parsed = enableSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body" });
      }
      const ok = await updateAlertEnabled(tenantId.data, id.data, parsed.data.enabled);
      return reply.code(ok ? 200 : 404).send({ ok });
    }
  );

  app.delete<{ Params: { tenantId: string; id: string } }>(
    "/api/alerts/:tenantId/:id",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      const id = z.coerce.number().int().positive().safeParse(request.params.id);
      if (!tenantId.success || !id.success) {
        return reply.code(400).send({ error: "Invalid tenantId or alert id" });
      }
      if (!(await requireTenantAccess(request, reply, tenantId.data))) {
        return reply;
      }
      const removed = await deleteAlert(tenantId.data, id.data);
      return reply.code(removed ? 200 : 404).send({ removed });
    }
  );
}
