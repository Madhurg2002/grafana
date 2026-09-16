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

export interface ShareLinkRow {
  id: string;
  tenant_id: string;
  created_by: string | null;
  label: string | null;
  created_at: Date;
  revoked: boolean;
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

export async function createShareLink(input: {
  tenantId: string;
  createdBy: string;
  label?: string;
}): Promise<ShareLinkRow> {
  const result: QueryResult<ShareLinkRow> = await getPool().query(
    `INSERT INTO share_links (id, tenant_id, created_by, label)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, label) DO UPDATE SET revoked = FALSE
     RETURNING id, tenant_id, created_by, label, created_at, revoked`,
    [newId("shr"), input.tenantId, input.createdBy, input.label ?? null]
  );
  return result.rows[0] as ShareLinkRow;
}

export async function getShareLink(id: string): Promise<ShareLinkRow | null> {
  const result = await getPool().query<ShareLinkRow>(
    "SELECT id, tenant_id, created_by, label, created_at, revoked FROM share_links WHERE id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function listShareLinks(tenantId: string): Promise<ShareLinkRow[]> {
  const result = await getPool().query<ShareLinkRow>(
    `SELECT id, tenant_id, created_by, label, created_at, revoked
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
