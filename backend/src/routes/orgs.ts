import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../middleware/auth.js";
import { hashPassword, verifyPassword } from "../services/passwords.js";
import {
  attachTenantToOrg,
  createOrganization,
  detachTenantFromOrg,
  findUserById,
  joinOrganization,
  listOrgMembers,
  listUserOrganizations,
  regenerateInviteCode,
  tenantOwnedBy,
  updateDisplayName,
  updatePassword,
} from "../db/users.js";

const createOrgSchema = z.object({
  name: z.string().min(2).max(64).regex(/^[a-zA-Z0-9-_ ]+$/),
});

const joinOrgSchema = z.object({
  inviteCode: z.string().min(8).max(64),
});

const attachSchema = z.object({
  orgId: z.string().min(4).max(64),
  tenantId: z.string().min(1).max(128),
});

const detachSchema = z.object({
  tenantId: z.string().min(1).max(128),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

const profileSchema = z.object({
  displayName: z.string().min(1).max(80),
});

/** Registers org + account-settings routes (all require a signed-in user). */
export async function orgRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/orgs — create an org; creator becomes its owner. */
  app.post<{ Body: unknown }>("/api/orgs", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) return reply;
    const parsed = createOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Org name must be 2–64 chars (letters, digits, spaces, - _)",
      });
    }
    const org = await createOrganization({
      userId: user.sub,
      name: parsed.data.name.trim(),
    });
    return reply.code(201).send({
      id: org.id,
      name: org.name,
      inviteCode: org.invite_code,
      role: "owner",
    });
  });

  /** POST /api/orgs/join — join an org by invite code. */
  app.post<{ Body: unknown }>("/api/orgs/join", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) return reply;
    const parsed = joinOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "A valid invite code is required" });
    }
    const org = await joinOrganization(user.sub, parsed.data.inviteCode);
    if (org === null) {
      return reply.code(404).send({ error: "No org matches that invite code" });
    }
    const memberships = await listUserOrganizations(user.sub);
    const role = memberships.find((o) => o.id === org.id)?.role ?? "member";
    return reply.code(200).send({
      id: org.id,
      name: org.name,
      role,
    });
  });

  /** GET /api/orgs — orgs the user belongs to (invite codes for owners). */
  app.get("/api/orgs", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) return reply;
    const orgs = await listUserOrganizations(user.sub);
    return reply.code(200).send({
      orgs: orgs.map((org) => ({
        id: org.id,
        name: org.name,
        role: org.role,
        // Only owners see (and can rotate) the invite code.
        inviteCode: org.role === "owner" ? org.invite_code : undefined,
      })),
    });
  });

  /** GET /api/orgs/:id/members — roster (members only). */
  app.get<{ Params: { id: string } }>(
    "/api/orgs/:id/members",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (user === null) return reply;
      const { isOrgMember } = await import("../db/users.js");
      if (!(await isOrgMember(request.params.id, user.sub))) {
        return reply.code(403).send({ error: "Not a member of this org" });
      }
      const members = await listOrgMembers(request.params.id);
      return reply.code(200).send({
        members: members.map((m) => ({
          email: m.email ?? "unknown",
          displayName: m.display_name,
          role: m.role,
        })),
      });
    }
  );

  /** POST /api/orgs/:id/invite/rotate — owners rotate the invite code. */
  app.post<{ Params: { id: string } }>(
    "/api/orgs/:id/invite/rotate",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (user === null) return reply;
      const code = await regenerateInviteCode(request.params.id, user.sub);
      if (code === null) {
        return reply
          .code(403)
          .send({ error: "Only the org owner can rotate the invite code" });
      }
      return reply.code(200).send({ inviteCode: code });
    }
  );

  /**
   * POST /api/orgs/attach — attach one of the user's tenants to an org they
   * belong to. Every org share of that tenant then covers all members.
   */
  app.post<{ Body: unknown }>("/api/orgs/attach", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) return reply;
    const parsed = attachSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "orgId and tenantId are required" });
    }
    const ok = await attachTenantToOrg(
      parsed.data.tenantId,
      parsed.data.orgId,
      user.sub
    );
    if (!ok) {
      return reply
        .code(403)
        .send({ error: "You must belong to the org to attach a workspace" });
    }
    return reply.code(200).send({ attached: true });
  });

  /** DELETE /api/orgs/attach — detach a tenant from its org (owner only). */
  app.delete<{ Body: unknown }>("/api/orgs/attach", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) return reply;
    const parsed = detachSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "tenantId is required" });
    }
    const owned = await tenantOwnedBy(parsed.data.tenantId, user.sub);
    if (!owned) {
      return reply.code(403).send({ error: "You do not own this workspace" });
    }
    await detachTenantFromOrg(parsed.data.tenantId);
    return reply.code(200).send({ attached: false });
  });

  // ---------------------------------------------------------------------
  // Account settings
  // ---------------------------------------------------------------------

  /** POST /api/auth/change-password — verifies the current password first. */
  app.post<{ Body: unknown }>("/api/auth/change-password", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) return reply;
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "New password must be at least 8 characters",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const row = await findUserById(user.sub);
    if (row === null) {
      return reply.code(401).send({ error: "Account no longer exists" });
    }
    const currentOk = await verifyPassword(
      parsed.data.currentPassword,
      row.password_hash
    );
    if (!currentOk) {
      return reply.code(403).send({ error: "Current password is incorrect" });
    }
    const nextHash = await hashPassword(parsed.data.newPassword);
    await updatePassword(user.sub, nextHash);
    return reply.code(200).send({ updated: true });
  });

  /** PATCH /api/auth/profile — update display name. */
  app.patch<{ Body: unknown }>("/api/auth/profile", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (user === null) return reply;
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Display name must be 1–80 chars" });
    }
    await updateDisplayName(user.sub, parsed.data.displayName.trim());
    const row = await findUserById(user.sub);
    return reply.code(200).send({
      user: {
        id: user.sub,
        email: row?.email ?? user.email,
        displayName: row?.display_name ?? parsed.data.displayName,
      },
    });
  });
}
