import type { FastifyInstance } from "fastify";
import { requireUser } from "../middleware/auth.js";
import {
  listSharesCreatedBy,
  listSharesForEmail,
  type ShareLinkRow,
} from "../db/users.js";

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
}
