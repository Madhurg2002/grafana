import { randomBytes } from "node:crypto";
import type { QueryResult } from "pg";
import { getPool } from "./schema.js";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: Date;
}

export interface OrganizationRow {
  id: string;
  name: string;
  invite_code: string;
  created_by: string | null;
  created_at: Date;
}

export interface OrgMemberRow {
  org_id: string;
  user_id: string;
  role: "owner" | "member";
  created_at: Date;
  /** Joined for client payloads. */
  email?: string;
  display_name?: string | null;
}

export type ShareAccess =
  | "anyone_view"
  | "anyone_edit"
  | "email_view"
  | "email_edit"
  | "org_view"
  | "org_edit";

export interface ShareLinkRow {
  id: string;
  tenant_id: string;
  created_by: string | null;
  label: string | null;
  created_at: Date;
  revoked: boolean;
  access: ShareAccess;
  allowed_emails: string[];
  invited_emails: string[];
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  displayName?: string;
}): Promise<UserRow> {
  const result: QueryResult<UserRow> = await getPool().query(
    `INSERT INTO users (id, email, password_hash, display_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, password_hash, display_name, created_at`,
    [newId("usr"), input.email.toLowerCase(), input.passwordHash, input.displayName ?? null]
  );
  return result.rows[0] as UserRow;
}

/**
 * Prefix search over users by email or display name (share dialog picker).
 * Never returns password hashes; capped results; min 2 chars to avoid
 * enumerating the whole user base.
 */
export async function searchUsers(
  query: string,
  limit = 8
): Promise<Array<Pick<UserRow, "id" | "email" | "display_name">>> {
  const prefix = query.trim().toLowerCase();
  if (prefix.length < 2) {
    return [];
  }
  const pattern = `${prefix.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const result = await getPool().query<
    Pick<UserRow, "id" | "email" | "display_name">
  >(
    `SELECT id, email, display_name
     FROM users
     WHERE lower(email) LIKE $1 OR lower(display_name) LIKE $1
     ORDER BY lower(email)
     LIMIT $2`,
    [pattern, limit]
  );
  return result.rows;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await getPool().query<UserRow>(
    "SELECT id, email, password_hash, display_name, created_at FROM users WHERE email = $1",
    [email.toLowerCase()]
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await getPool().query<UserRow>(
    "SELECT id, email, password_hash, display_name, created_at FROM users WHERE id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

/** Creates the user's personal tenant on signup (idempotent). */
export async function ensureOwnedTenant(
  userId: string,
  name: string
): Promise<string> {
  const tenantId = `t_${userId.replace(/^usr_/, "")}`;
  await getPool().query(
    `INSERT INTO tenants (id, name, owner_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id`,
    [tenantId, name, userId]
  );
  return tenantId;
}

export async function tenantOwnedBy(
  tenantId: string,
  userId: string
): Promise<boolean> {
  const result = await getPool().query<{ id: string }>(
    "SELECT id FROM tenants WHERE id = $1 AND owner_id = $2",
    [tenantId, userId]
  );
  return result.rowCount === 1;
}

/** True when the tenant belongs to a named account (vs a legacy no-account workspace). */
export async function tenantHasOwner(tenantId: string): Promise<boolean> {
  const result = await getPool().query<{ owner_id: string | null }>(
    "SELECT owner_id FROM tenants WHERE id = $1",
    [tenantId]
  );
  const owner = result.rows[0]?.owner_id;
  return owner !== null && owner !== undefined;
}

/**
 * View access: the owner, or any member of the tenant's org.
 * Org sharing works by attaching the tenant to an org — every member of
 * that org can then read the workspace's dashboards.
 */
export async function canViewTenant(tenantId: string, userId: string): Promise<boolean> {
  if (await tenantOwnedBy(tenantId, userId)) {
    return true;
  }
  const orgId = await getTenantOrg(tenantId);
  return orgId !== null && (await isOrgMember(orgId, userId));
}

/**
 * Edit access: the owner, or any member of the tenant's org (collaborative
 * editing is the point of sharing a workspace to an org).
 */
export async function canEditTenant(tenantId: string, userId: string): Promise<boolean> {
  return canViewTenant(tenantId, userId);
}

export async function createShareLink(input: {
  tenantId: string;
  createdBy: string;
  label?: string;
  access?: ShareAccess;
  allowedEmails?: string[];
}): Promise<ShareLinkRow> {
  const access = input.access ?? "anyone_view";
  const result: QueryResult<ShareLinkRow> = await getPool().query(
    `INSERT INTO share_links (id, tenant_id, created_by, label, access, allowed_emails)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, created_by, label, created_at, revoked,
               access, allowed_emails, invited_emails`,
    [
      newId("shr"),
      input.tenantId,
      input.createdBy,
      input.label ?? null,
      access,
      (input.allowedEmails ?? []).map((e) => e.trim().toLowerCase()),
    ]
  );
  return result.rows[0] as ShareLinkRow;
}

/** Records that invite emails were dispatched for a share link. */
export async function recordInvitedEmails(
  id: string,
  emails: string[]
): Promise<void> {
  await getPool().query(
    `UPDATE share_links
     SET invited_emails = (
       SELECT array_agg(DISTINCT e)
       FROM unnest(invited_emails || $2::text[]) AS e
     )
     WHERE id = $1`,
    [id, emails.map((e) => e.trim().toLowerCase())]
  );
}

export async function getShareLink(id: string): Promise<ShareLinkRow | null> {
  const result = await getPool().query<ShareLinkRow>(
    `SELECT id, tenant_id, created_by, label, created_at, revoked,
            access, allowed_emails, invited_emails
     FROM share_links WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function listShareLinks(tenantId: string): Promise<ShareLinkRow[]> {
  const result = await getPool().query<ShareLinkRow>(
    `SELECT id, tenant_id, created_by, label, created_at, revoked,
            access, allowed_emails, invited_emails
     FROM share_links WHERE tenant_id = $1 AND revoked = FALSE
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return result.rows;
}

export async function revokeShareLink(id: string, userId: string): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE share_links SET revoked = TRUE
     WHERE id = $1 AND tenant_id IN (SELECT id FROM tenants WHERE owner_id = $2)`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Profile data — everything the signed-in user can see about sharing:
 *  - created:  links they made (including revoked, so revocation is visible)
 *  - sharedWithMe: links restricting access to this user's email
 *  - revokedSharedWithMe: restricted links that were since revoked
 */
export async function listSharesCreatedBy(userId: string): Promise<ShareLinkRow[]> {
  const result = await getPool().query<ShareLinkRow>(
    `SELECT id, tenant_id, created_by, label, created_at, revoked,
            access, allowed_emails, invited_emails
     FROM share_links WHERE created_by = $1
     ORDER BY created_at DESC LIMIT 200`,
    [userId]
  );
  return result.rows;
}

export async function listSharesForEmail(email: string): Promise<ShareLinkRow[]> {
  const result = await getPool().query<ShareLinkRow>(
    `SELECT id, tenant_id, created_by, label, created_at, revoked,
            access, allowed_emails, invited_emails
     FROM share_links
     WHERE $1 = ANY(allowed_emails)
     ORDER BY created_at DESC LIMIT 200`,
    [email.toLowerCase()]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Account settings: password change (verifies the current password first).
// ---------------------------------------------------------------------------

export async function updatePassword(
  userId: string,
  passwordHash: string
): Promise<boolean> {
  const result = await getPool().query(
    "UPDATE users SET password_hash = $1 WHERE id = $2",
    [passwordHash, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateDisplayName(userId: string, name: string): Promise<boolean> {
  const result = await getPool().query(
    "UPDATE users SET display_name = $1 WHERE id = $2",
    [name, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Organizations: shared workspaces. Sharing to an org = every member can
// open (and, with edit rights, modify) the tenant's dashboards.
// ---------------------------------------------------------------------------

export async function createOrganization(input: {
  userId: string;
  name: string;
}): Promise<OrganizationRow> {
  const org = await getPool().query<OrganizationRow>(
    `INSERT INTO organizations (id, name, invite_code, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, invite_code, created_by, created_at`,
    [newId("org"), input.name, newId("inv"), input.userId]
  );
  const row = org.rows[0] as OrganizationRow;
  await getPool().query(
    `INSERT INTO org_members (org_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT DO NOTHING`,
    [row.id, input.userId]
  );
  return row;
}

export async function joinOrganization(
  userId: string,
  inviteCode: string
): Promise<OrganizationRow | null> {
  const org = await getPool().query<OrganizationRow>(
    "SELECT id, name, invite_code, created_by, created_at FROM organizations WHERE invite_code = $1",
    [inviteCode.trim()]
  );
  const row = org.rows[0] ?? null;
  if (row === null) {
    return null;
  }
  await getPool().query(
    `INSERT INTO org_members (org_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT DO NOTHING`,
    [row.id, userId]
  );
  return row;
}

export async function listUserOrganizations(userId: string): Promise<Array<OrganizationRow & { role: string }>> {
  const result = await getPool().query<OrganizationRow & { role: string }>(
    `SELECT o.id, o.name, o.invite_code, o.created_by, o.created_at, m.role
     FROM organizations o
     JOIN org_members m ON m.org_id = o.id
     WHERE m.user_id = $1
     ORDER BY o.created_at`,
    [userId]
  );
  return result.rows;
}

export async function listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const result = await getPool().query<OrgMemberRow>(
    `SELECT m.org_id, m.user_id, m.role, m.created_at,
            u.email, u.display_name
     FROM org_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1
     ORDER BY m.created_at`,
    [orgId]
  );
  return result.rows;
}

export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const result = await getPool().query<{ user_id: string }>(
    "SELECT user_id FROM org_members WHERE org_id = $1 AND user_id = $2",
    [orgId, userId]
  );
  return result.rowCount === 1;
}

export async function regenerateInviteCode(orgId: string, userId: string): Promise<string | null> {
  // Only owners rotate the invite code.
  const owner = await getPool().query<{ role: string }>(
    "SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2",
    [orgId, userId]
  );
  if (owner.rows[0]?.role !== "owner") {
    return null;
  }
  const code = newId("inv");
  await getPool().query("UPDATE organizations SET invite_code = $1 WHERE id = $2", [
    code,
    orgId,
  ]);
  return code;
}

export async function attachTenantToOrg(
  tenantId: string,
  orgId: string,
  userId: string
): Promise<boolean> {
  const member = await isOrgMember(orgId, userId);
  if (!member) {
    return false;
  }
  const result = await getPool().query(
    "UPDATE tenants SET org_id = $1 WHERE id = $2",
    [orgId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getTenantOrg(tenantId: string): Promise<string | null> {
  const result = await getPool().query<{ org_id: string | null }>(
    "SELECT org_id FROM tenants WHERE id = $1",
    [tenantId]
  );
  return result.rows[0]?.org_id ?? null;
}

/** Detaches a tenant from any org (its org shares then stop granting access). */
export async function detachTenantFromOrg(tenantId: string): Promise<void> {
  await getPool().query("UPDATE tenants SET org_id = NULL WHERE id = $1", [tenantId]);
}

// ---------------------------------------------------------------------------
// Account deletion (privacy policy / GDPR-style data removal).
// ---------------------------------------------------------------------------

/**
 * Hard-deletes a user account and every trace of it, in one transaction:
 *  - the owned tenant (dashboards, widgets, connections, alerts, panels,
 *    share links) cascades away via the `tenants` FKs;
 *  - the owned workspace's audit trail is purged explicitly (audit_log has
 *    no tenant FK, so a tenant cascade would NOT cover it);
 *  - audit rows in OTHER workspaces that name this account as actor are
 *    anonymized (email blanked, id cleared) — history stays attributable
 *    to a since-deleted account without keeping personal data;
 *  - the account's email is scrubbed from every share allow-list and
 *    invite list, so a future re-registration cannot inherit old access;
 *  - org memberships cascade (`org_members.user_id ON DELETE CASCADE`);
 *  - orgs the user created keep living (`created_by ON DELETE SET NULL`);
 *  - share links they created keep their targets (creator set to NULL).
 *
 * Returns the deleted email so the client can confirm which account went.
 */
export async function deleteUserAccount(
  userId: string
): Promise<{ email: string } | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ email: string; tenant_id: string | null }>(
      `SELECT u.email, t.id AS tenant_id
       FROM users u
       LEFT JOIN tenants t ON t.owner_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    const row = current.rows[0];
    if (row === undefined) {
      await client.query("ROLLBACK");
      return null;
    }
    if (row.tenant_id !== null) {
      // Cascades: connections, pages, widgets, alerts, share links, panels.
      await client.query("DELETE FROM tenants WHERE id = $1", [row.tenant_id]);
      // audit_log is FK-less, so the cascade above cannot reach it — purge
      // this workspace's trail explicitly or actor PII would survive.
      await client.query("DELETE FROM audit_log WHERE tenant_id = $1", [
        row.tenant_id,
      ]);
    }
    // Anonymize actor references in OTHER workspaces' trails (own rows are
    // gone via the purge above when a tenant existed).
    await client.query(
      `UPDATE audit_log
       SET actor_email = '(deleted account)', actor_user_id = NULL
       WHERE actor_user_id = $1`,
      [userId]
    );
    // Scrub the email from share allow/invite lists everywhere. The lists
    // store lowercased addresses; the raw email is covered for legacy rows.
    const email = row.email;
    const lowerEmail = email.toLowerCase();
    await client.query(
      `UPDATE share_links
       SET allowed_emails = array_remove(allowed_emails, $1),
           invited_emails = array_remove(invited_emails, $1)
       WHERE $1 = ANY(allowed_emails) OR $1 = ANY(invited_emails)`,
      [email]
    );
    if (lowerEmail !== email) {
      await client.query(
        `UPDATE share_links
         SET allowed_emails = array_remove(allowed_emails, $1),
             invited_emails = array_remove(invited_emails, $1)
         WHERE $1 = ANY(allowed_emails) OR $1 = ANY(invited_emails)`,
        [lowerEmail]
      );
    }
    // Org membership rows cascade on user delete; created orgs survive.
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("COMMIT");
    return { email: row.email };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
