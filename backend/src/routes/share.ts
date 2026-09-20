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
  getTenantOrg,
  isOrgMember,
  type ShareAccess,
} from "../db/users.js";
import { instantQuery, rangeQuery } from "../services/prometheus.js";
import { listPages, listWidgets, type WidgetKind } from "../db/schema.js";
import { DEFAULT_PUBLIC_QUERIES } from "../services/publicQueries.js";
import { sendShareInvite } from "../services/email.js";
import { signViewToken, verifyViewToken, viewTokenEmail } from "../services/shareTokens.js";
import { issueTenantToken, resolveSession, type AuthedRequest } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.js";

const accessSchema = z.enum([
  "anyone_view",
  "anyone_edit",
  "email_view",
  "email_edit",
  "org_view",
  "org_edit",
]);

const createSchema = z.object({
  tenantId: z.string().min(1).max(128),
  label: z.string().min(1).max(64).optional(),
  access: accessSchema.optional(),
  allowedEmails: z.array(z.string().email().max(254)).max(50).optional(),
  invite: z.boolean().optional(),
  /** Which page of the tenant to snapshot (defaults to the home page). */
  pageId: z.number().int().positive().optional(),
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

export interface ShareViewWidget {
  id: number;
  kind: WidgetKind;
  title: string;
  unit: string | null;
  span: number;
  /** Latest value for stat/gauge widgets (null when upstream degraded). */
  value: number | null;
  /** Time series for sparkline widgets. */
  series: ShareSeries[];
}

export interface ShareViewPage {
  id: number;
  name: string;
  isHome: boolean;
  showBuiltins: boolean;
  widgets: ShareViewWidget[];
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
  /** The tenant's composed pages with server-rendered widget values.
   *  Absent/empty for links created before pages existed — clients fall
   *  back to the fixed built-in layout. */
  pages?: ShareViewPage[];
  generatedAt: string;
  access: ShareAccess;
  canEdit: boolean;
}

/** Upper bound on widgets rendered into one snapshot (cost guard). */
const MAX_SNAPSHOT_WIDGETS = 40;

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
    if ((access ?? "anyone_view").startsWith("org")) {
      const orgId = await getTenantOrg(tenantId);
      if (orgId === null) {
        return reply.code(400).send({
          error:
            "This workspace isn't attached to an org yet — attach it first (Profile → Organizations)",
        });
      }
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

    void recordAudit(
      {
        tenantId,
        action: "share.create",
        target: link.label ?? "dashboard",
        details: { shareId: link.id, access: link.access, invitedCount: invited.length },
      },
      (() => {
        const authed = request as AuthedRequest;
        return {
          ...(authed.userId !== undefined ? { userId: authed.userId } : {}),
          ...(authed.email !== undefined ? { email: authed.email } : {}),
        };
      })()
    );

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
    if (revoked) {
      const link = await getShareLink(request.params.id);
      if (link !== null) {
        void recordAudit(
          {
            tenantId: link.tenant_id,
            action: "share.revoke",
            target: link.label ?? "dashboard",
            details: { shareId: request.params.id },
          },
          { userId: user.sub, email: user.email }
        );
      }
    }
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
      // The signed view token is bound to the viewer's allow-listed email,
      // so derive the identity from the token itself. The ?email= query
      // param remains as a fallback for direct API callers; first-party
      // clients send only the token.
      const queryEmail = request.query.email?.toLowerCase().trim() ?? "";
      const token = request.query.token ?? "";
      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      const presented = token.length > 0 ? token : bearer;
      const tokenEmail =
        presented.length > 0 ? viewTokenEmail(link.id, presented) : null;
      const email = queryEmail.length > 0 ? queryEmail : (tokenEmail ?? "");
      const allowed = email.length > 0 && link.allowed_emails.includes(email);
      const tokenOk =
        presented.length > 0 &&
        email.length > 0 &&
        verifyViewToken(link.id, email, presented);
      if (!allowed || !tokenOk) {
        return reply.code(403).send({
          error: "This share is restricted — sign in with an allowed email",
        });
      }
    }
    if (link.access.startsWith("org")) {
      const claims = resolveSession(request);
      const orgId = await getTenantOrg(link.tenant_id);
      const member =
        claims !== null &&
        claims.type === "user" &&
        orgId !== null &&
        (await isOrgMember(orgId, claims.sub));
      if (!member) {
        return reply.code(403).send({
          error: "This share is restricted to members of its organization — sign in with a member account",
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

    // Share-view parity: embed the tenant's composed pages with values
    // rendered server-side through the same breaker/cache/normalizer stack.
    // Each widget degrades independently — one bad query never fails the
    // whole snapshot.
    const pages: ShareViewPage[] = [];
    try {
      const pageRows = await listPages(link.tenant_id);
      let widgetBudget = MAX_SNAPSHOT_WIDGETS;
      for (const page of pageRows) {
        if (widgetBudget <= 0) {
          break;
        }
        const widgetRows = (await listWidgets(page.id, link.tenant_id)).slice(0, widgetBudget);
        widgetBudget -= widgetRows.length;
        const end = new Date();
        const start = new Date(end.getTime() - 60 * 60_000);
        const renderedWidgets: ShareViewWidget[] = await Promise.all(
          widgetRows.map(async (widget) => {
            const base = {
              id: widget.id,
              kind: widget.kind,
              title: widget.title,
              unit: widget.unit,
              span: widget.span,
            };
            if (widget.kind === "hosts_table") {
              return { ...base, value: null, series: [] };
            }
            try {
              if (widget.kind === "sparkline") {
                const ranged = await rangeQuery({
                  tenantId: link.tenant_id,
                  query: widget.promql,
                  start: start.toISOString(),
                  end: end.toISOString(),
                  step: "5m" as const,
                });
                return { ...base, value: null, series: seriesFrom(ranged.result.result) };
              }
              const instant = await instantQuery({ tenantId: link.tenant_id, query: widget.promql });
              return { ...base, value: scalarFrom(instant.result.result), series: [] };
            } catch {
              return { ...base, value: null, series: [] };
            }
          })
        );
        pages.push({
          id: page.id,
          name: page.name,
          isHome: page.is_home ?? false,
          showBuiltins: page.show_builtins ?? true,
          widgets: renderedWidgets,
        });
      }
    } catch {
      // Pages unavailable — snapshot still serves the built-in layout.
    }

    const claims = resolveSession(request);
    const isOwner = claims !== null && claims.type === "user" && (await tenantOwnedBy(link.tenant_id, claims.sub));
    const payload: ShareViewPayload = {
      tenantId: link.tenant_id,
      label: link.label,
      createdAt: link.created_at.toISOString(),
      metrics,
      ...(pages.length > 0 ? { pages } : {}),
      generatedAt: new Date().toISOString(),
      access: link.access,
      canEdit: link.access.endsWith("edit") || isOwner,
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
    const link = await getShareLink(request.params.id);
    if (link === null || link.revoked) {
      return reply.code(404).send({ error: "Share link not found or revoked" });
    }

    // Public edit links receive a short-lived workspace token without
    // requiring an account. View-only links never receive a write token.
    if (link.access === "anyone_edit") {
      const editToken = issueTenantToken(link.tenant_id, 60 * 60 * 1000, link.id);
      return reply.code(200).send({
        token: editToken,
        editToken,
        viewToken: editToken,
        email: "",
        canEdit: true,
      });
    }

    const user = await requireUser(request, reply);
    if (user === null) {
      return reply;
    }
    const email = user.email.toLowerCase();
    if (link.access === "email_edit" && !link.allowed_emails.includes(email)) {
      return reply.code(403).send({ error: "This email is not on the allow-list" });
    }
    if (link.access === "org_edit") {
      const orgId = await getTenantOrg(link.tenant_id);
      if (orgId === null || !(await isOrgMember(orgId, user.sub))) {
        return reply.code(403).send({ error: "This account is not a member of the workspace organization" });
      }
    }
    if (link.access === "email_view") {
      const viewToken = signViewToken(link.id, email);
      return reply.code(200).send({
        token: viewToken,
        viewToken,
        email,
        canEdit: false,
      });
    }
    if (!link.access.endsWith("edit")) {
      return reply.code(403).send({ error: "This share is view-only" });
    }
    const editToken = issueTenantToken(link.tenant_id, 60 * 60 * 1000, link.id);
    return reply.code(200).send({
      // Organization edit shares continue reading through the user's session;
      // email edit shares need a signed view token for the snapshot route.
      token: link.access === "email_edit" ? signViewToken(link.id, email) : editToken,
      ...(link.access === "email_edit"
        ? { viewToken: signViewToken(link.id, email) }
        : {}),
      editToken,
      email,
      canEdit: true,
    });
  });
}
