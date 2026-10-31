import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireTenantAccess, type AuthedRequest } from "../middleware/auth.js";
import {
  acknowledgeAlert,
  clearAlertAcknowledgement,
  createAlert,
  deleteAlert,
  listAlertEvents,
  listAlerts,
  listFiringAlerts,
  updateAlertEnabled,
  type AlertComparator,
} from "../db/schema.js";
import { recordAudit } from "../services/audit.js";
import { isAcknowledgementActive } from "../services/alertAcknowledgement.js";

/** Actor attribution for the audit trail (verified session only). */
function auditActor(request: FastifyRequest): { userId?: string; email?: string } {
  const authed = request as AuthedRequest;
  return {
    ...(authed.userId !== undefined ? { userId: authed.userId } : {}),
    ...(authed.email !== undefined ? { email: authed.email } : {}),
  };
}

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
  // 0 (or omitted) = acknowledge indefinitely; capped at 24h.
  const ackSchema = z.object({
    minutes: z.number().int().min(0).max(1440).optional(),
  });
  const eventsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

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

  /**
   * Currently firing alerts — badge hydration. The SSE stream only carries
   * TRANSITIONS, so a page opened while things are already burning would
   * otherwise show nothing until the next change.
   */
  app.get<{ Params: { tenantId: string } }>(
    "/api/alerts/:tenantId/firing",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      if (!tenantId.success) {
        return reply.code(400).send({ error: "Invalid tenantId" });
      }
      if (!(await requireTenantAccess(request, reply, tenantId.data))) {
        return reply;
      }
      const firing = await listFiringAlerts(tenantId.data);
      return reply.code(200).send({
        alerts: firing.map((alert) => ({
          alertId: alert.id,
          title: alert.title,
          state: "firing" as const,
          value: alert.last_value,
          threshold: alert.threshold,
          comparator: alert.comparator,
          firedAt: alert.firing_time ?? alert.last_eval_at ?? alert.created_at,
          acknowledged: isAcknowledgementActive(alert),
          acknowledgedUntil: alert.acknowledged_until,
          acknowledgedBy: alert.acknowledged_by,
        })),
      });
    }
  );

  /** Takes an acknowledgement (default: 60 minutes; 0 = indefinite). */
  app.post<{ Params: { tenantId: string; id: string }; Body: unknown }>(
    "/api/alerts/:tenantId/:id/ack",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      const id = z.coerce.number().int().positive().safeParse(request.params.id);
      if (!tenantId.success || !id.success) {
        return reply.code(400).send({ error: "Invalid tenantId or alert id" });
      }
      if (!(await requireTenantAccess(request, reply, tenantId.data))) {
        return reply;
      }
      const parsed = ackSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid acknowledgement",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      const minutes = parsed.data.minutes ?? 60;
      const until = minutes === 0 ? null : new Date(Date.now() + minutes * 60_000).toISOString();
      const actor = auditActor(request);
      const ok = await acknowledgeAlert(tenantId.data, id.data, until, actor.email ?? null);
      if (ok) {
        void recordAudit(
          {
            tenantId: tenantId.data,
            action: "alert.acknowledge",
            details: { alertId: id.data, minutes, until },
          },
          actor
        );
      }
      return reply.code(ok ? 200 : 404).send({ acknowledged: ok, until });
    }
  );

  /** Releases an acknowledgement — notifications resume immediately. */
  app.delete<{ Params: { tenantId: string; id: string } }>(
    "/api/alerts/:tenantId/:id/ack",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      const id = z.coerce.number().int().positive().safeParse(request.params.id);
      if (!tenantId.success || !id.success) {
        return reply.code(400).send({ error: "Invalid tenantId or alert id" });
      }
      if (!(await requireTenantAccess(request, reply, tenantId.data))) {
        return reply;
      }
      const ok = await clearAlertAcknowledgement(tenantId.data, id.data);
      if (ok) {
        void recordAudit(
          {
            tenantId: tenantId.data,
            action: "alert.unacknowledge",
            details: { alertId: id.data },
          },
          auditActor(request)
        );
      }
      return reply.code(ok ? 200 : 404).send({ cleared: ok });
    }
  );

  /** Firing/resolved history for one alert, newest first. */
  app.get<{ Params: { tenantId: string; id: string }; Querystring: unknown }>(
    "/api/alerts/:tenantId/:id/events",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      const id = z.coerce.number().int().positive().safeParse(request.params.id);
      if (!tenantId.success || !id.success) {
        return reply.code(400).send({ error: "Invalid tenantId or alert id" });
      }
      if (!(await requireTenantAccess(request, reply, tenantId.data))) {
        return reply;
      }
      const query = eventsQuerySchema.safeParse(request.query ?? {});
      const limit = query.success ? query.data.limit ?? 50 : 50;
      const events = await listAlertEvents(tenantId.data, id.data, limit);
      return reply.code(200).send({ events });
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
      void recordAudit(
        { tenantId: tenantId.data, action: "alert.create", target: alert.title, details: { alertId: alert.id, comparator: alert.comparator, threshold: alert.threshold } },
        auditActor(request)
      );
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
      if (ok) {
        void recordAudit(
          { tenantId: tenantId.data, action: "alert.update", details: { alertId: id.data, enabled: parsed.data.enabled } },
          auditActor(request)
        );
      }
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
      if (removed) {
        void recordAudit(
          { tenantId: tenantId.data, action: "alert.delete", details: { alertId: id.data } },
          auditActor(request)
        );
      }
      return reply.code(removed ? 200 : 404).send({ removed });
    }
  );
}
