import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../middleware/auth.js";
import {
  deleteUserAccount,
  listSharesCreatedBy,
  listSharesForEmail,
  searchUsers,
  tenantOwnedBy,
  type ShareLinkRow,
} from "../db/users.js";
import { listAudit } from "../services/audit.js";

export interface ProfileShare {
  id: string;
  url: string;
  label: string;
  createdAt: string;
  access: ShareLinkRow["access"];
  revoked: boolean;
  allowedEmails: string[];
  invitedEmails: string[];
}

function toShare(row: ShareLinkRow): ProfileShare {
  return {
    id: row.id,
    url: `/share/${row.id}`,
    label: row.label ?? "dashboard",
    createdAt: row.created_at.toISOString(),
    access: row.access,
    revoked: row.revoked,
    allowedEmails: row.allowed_emails,
    invitedEmails: row.invited_emails,
  };
}

/**
 * GET /api/profile/shares — one place to see:
 *  - links the user created (revoked ones included, marked revoked)
 *  - email-restricted links shared with this user's address
 */
export async function profileRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/users/search?q= — people picker for the share dialog.
   * Matches email or display-name prefix; returns only safe fields.
   */
  app.get("/api/users/search", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) {
      return reply;
    }
    const parsed = z
      .object({ q: z.string().min(2).max(64) })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.code(200).send({ users: [] }); // too-short query = no results
    }
    const rows = await searchUsers(parsed.data.q);
    return reply.code(200).send({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
      })),
    });
  });

  app.get("/api/profile/shares", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) {
      return reply; // 401 already sent
    }
    const [created, sharedWithMe] = await Promise.all([
      listSharesCreatedBy(user.sub),
      listSharesForEmail(user.email),
    ]);
    return reply.code(200).send({
      created: created.map(toShare),
      sharedWithMe: sharedWithMe
        .filter((row) => row.created_by !== user.sub)
        .map(toShare),
    });
  });

  /**
   * GET /api/profile/activity?tenantId=... — newest audit entries for a
   * workspace the user owns (append-only trail; see services/audit.ts).
   */
  app.get("/api/profile/activity", async (request, reply) => {
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
    if (!(await tenantOwnedBy(parsed.data.tenantId, user.sub))) {
      return reply.code(403).send({ error: "You do not own this workspace" });
    }
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = z.coerce.number().int().min(1).max(500).safeParse(limitRaw ?? "100");
    const entries = await listAudit(parsed.data.tenantId, limit.success ? limit.data : 100);
    return reply.code(200).send({
      activity: entries.map((row) => ({
        id: row.id,
        actorEmail: row.actor_email,
        action: row.action,
        target: row.target,
        details: row.details,
        createdAt: row.created_at,
      })),
    });
  });

  /**
   * DELETE /api/profile/me — irreversible account deletion (privacy policy).
   * Requires the literal word "DELETE" as confirmation. Removes the account,
   * its owned workspace (dashboards, connections, alerts, shares), and org
   * memberships. Sessions die on next request (user lookup fails).
   */
  app.delete("/api/profile/me", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) {
      return reply;
    }
    const parsed = z
      .object({ confirm: z.literal("DELETE") })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Send { \"confirm\": \"DELETE\" } to confirm account deletion",
      });
    }
    const deleted = await deleteUserAccount(user.sub);
    if (deleted === null) {
      return reply.code(404).send({ error: "Account no longer exists" });
    }
    return reply.code(200).send({ deleted: true, email: deleted.email });
  });
}
