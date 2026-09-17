import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../middleware/auth.js";
import {
  createShareLink,
  getShareLink,
  listShareLinks,
  recordInvitedEmails,
  revokeShareLink,
  tenantOwnedBy,
  type ShareAccess,
} from "../db/users.js";
import { instantQuery, rangeQuery } from "../services/prometheus.js";
import { DEFAULT_PUBLIC_QUERIES } from "../services/publicQueries.js";
import { sendShareInvite } from "../services/email.js";
import { signViewToken, verifyViewToken } from "../services/shareTokens.js";

const accessSchema = z.enum([
  "anyone_view",
  "anyone_edit",
  "email_view",
  "email_edit",
]);

const createSchema = z.object({
  tenantId: z.string().min(1).max(128),
  label: z.string().min(1).max(64).optional(),
  access: accessSchema.optional(),
  allowedEmails: z.array(z.string().email().max(254)).max(50).optional(),
  invite: z.boolean().optional(),
});

const inviteSchema = z.object({
  emails: z.array(z.string().email().max(254)).min(1).max(50),
});

export interface ShareViewHost {
  instance: string;
  job: string;
  up: number;
}

export interface ShareSeriesPoint {
  timestamp: number;
  value: number;
}

export interface ShareSeries {
  label: string;
  points: ShareSeriesPoint[];
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
    networkRxSeries: ShareSeries[];
    networkTxSeries: ShareSeries[];
  };
  generatedAt: string;
  access: ShareAccess;
  canEdit: boolean;
}

function scalarFrom(result: unknown[]): number | null {
  if (result.length === 0) {
    return null;
  }
  const first = result[0] as { value?: { value: number } };
  return typeof first.value?.value === "number" ? first.value.value : null;
}

/** Maps a range-vector payload into labeled point series for sparklines. */
function seriesFrom(result: unknown[]): ShareSeries[] {
  return result.slice(0, 30).map((entry) => {
    const item = entry as {
      metric?: Record<string, string>;
      values?: Array<{ timestamp: number; value: number }>;
    };
    const instance = item.metric?.instance ?? "series";
    const device = item.metric?.device;
    return {
      label: device !== undefined ? `${instance} · ${device}` : instance,
      points: item.values ?? [],
    };
  });
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
      // Field-level detail so bad payloads are diagnosable from the client.
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const { tenantId, label, access, allowedEmails, invite } = parsed.data;
    const owned = await tenantOwnedBy(tenantId, user.sub);
    if (!owned) {
      return reply.code(403).send({ error: "You do not own this tenant" });
    }
    if ((access ?? "anyone_view").startsWith("email") && (allowedEmails ?? []).length === 0) {
      return reply
        .code(400)
        .send({ error: "Email-restricted shares need at least one allowed email" });
    }
    const link = await createShareLink({
      tenantId,
      createdBy: user.sub,
      label: label ?? "default",
      access: access as ShareAccess | undefined,
      allowedEmails,
    });

    let invited: string[] = [];
    let skipped: string[] = [];
    if (invite === true && (allowedEmails ?? []).length > 0) {
      const origin = request.headers.origin ?? "";
      const emailResult = await sendShareInvite({
        to: allowedEmails as string[],
        shareUrl: `${origin}/share/${link.id}`,
        label: link.label ?? "dashboard",
        canEdit: (access ?? "anyone_view").endsWith("edit"),
      });
      if (emailResult.sent.length > 0) {
        await recordInvitedEmails(link.id, emailResult.sent);
        invited = emailResult.sent;
      }
      // Email not configured (or all sends failed) — tell the client so the
      // dialog can fall back to copy-the-link instead of a silent no-op.
      skipped = emailResult.skipped.length > 0 ? emailResult.skipped : emailResult.failed;
    }

    return reply.code(201).send({
      id: link.id,
      url: `/share/${link.id}`,
      label: link.label,
      createdAt: link.created_at,
      access: link.access,
      allowedEmails: link.allowed_emails,
      invited,
      skipped,
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
        access: link.access,
        allowedEmails: link.allowed_emails,
        invitedEmails: link.invited_emails,
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

  // (Re)send invite emails for an existing link (owner only).
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/share/:id/invite",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (user === null) {
        return reply;
      }
      const parsed = inviteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Provide 1–50 valid emails" });
      }
      const link = await getShareLink(request.params.id);
      if (link === null || link.revoked) {
        return reply.code(404).send({ error: "Share link not found or revoked" });
      }
      const owned = await tenantOwnedBy(link.tenant_id, user.sub);
      if (!owned) {
        return reply.code(403).send({ error: "You do not own this tenant" });
      }
      const origin = request.headers.origin ?? "";
      const result = await sendShareInvite({
        to: parsed.data.emails,
        shareUrl: `${origin}/share/${link.id}`,
        label: link.label ?? "dashboard",
        canEdit: link.access.endsWith("edit"),
      });
      if (result.sent.length > 0) {
        await recordInvitedEmails(link.id, result.sent);
      }
      return reply.code(200).send({
        sent: result.sent,
        failed: result.failed,
        reason: result.reason,
      });
    }
  );

  // Public view — unauthenticated, but email-restricted links must prove
  // access via a short-lived signed view token (issued below).
  app.get<{ Params: { id: string }; Querystring: { email?: string; token?: string } }>(
    "/api/share/:id/view",
    async (request, reply) => {
    const link = await getShareLink(request.params.id);
    if (link === null || link.revoked) {
      return reply.code(404).send({ error: "Share link not found or revoked" });
    }
    if (link.access.startsWith("email")) {
      const email = request.query.email?.toLowerCase() ?? "";
      const token = request.query.token ?? "";
      const allowed = link.allowed_emails.includes(email);
      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      const tokenOk =
        (token.length > 0 && verifyViewToken(link.id, email, token)) ||
        (bearer.length > 0 && verifyViewToken(link.id, email, bearer));
      if (!allowed || !tokenOk) {
        return reply.code(403).send({
          error: "This share is restricted — sign in with an allowed email",
        });
      }
    }

    const metrics: ShareViewPayload["metrics"] = {
      hosts: [],
      hostsUp: 0,
      hostsTotal: 0,
      cpuPercent: null,
      ramPercent: null,
      networkRxSeries: [],
      networkTxSeries: [],
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

      // Network sparklines — same 60m/5m window the live dashboard uses.
      const end = new Date();
      const start = new Date(end.getTime() - 60 * 60_000);
      const rangeCommon = {
        tenantId: link.tenant_id,
        start: start.toISOString(),
        end: end.toISOString(),
        step: "5m" as const,
      };
      const [rx, tx] = await Promise.all([
        rangeQuery({ ...rangeCommon, query: DEFAULT_PUBLIC_QUERIES.networkRx }),
        rangeQuery({ ...rangeCommon, query: DEFAULT_PUBLIC_QUERIES.networkTx }),
      ]);
      metrics.networkRxSeries = seriesFrom(rx.result.result);
      metrics.networkTxSeries = seriesFrom(tx.result.result);
    } catch {
      // Upstream degraded — return whatever we have; client shows stale state.
    }

    const payload: ShareViewPayload = {
      tenantId: link.tenant_id,
      label: link.label,
      createdAt: link.created_at.toISOString(),
      metrics,
      generatedAt: new Date().toISOString(),
      access: link.access,
      canEdit: link.access.endsWith("edit"),
    };
    return reply.code(200).send(payload);
  }
  );

  /**
   * POST /api/share/:id/access-token — exchange a signed-in session for a
   * short-lived view token bound to the user's email. Email-restricted share
   * views call this first, then pass the token with every snapshot fetch.
   */
  app.post<{ Params: { id: string } }>("/api/share/:id/access-token", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) {
      return reply;
    }
    const link = await getShareLink(request.params.id);
    if (link === null || link.revoked) {
      return reply.code(404).send({ error: "Share link not found or revoked" });
    }
    const email = user.email.toLowerCase();
    if (!link.allowed_emails.includes(email)) {
      return reply.code(403).send({ error: "This email is not on the allow-list" });
    }
    return reply.code(200).send({
      token: signViewToken(link.id, email),
      email,
      canEdit: link.access.endsWith("edit"),
    });
  });
}
