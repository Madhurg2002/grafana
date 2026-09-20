import { getPool } from "../db/schema.js";

/**
 * Append-only audit trail (migration 015) — records WHO changed WHAT in a
 * workspace. Written by the mutating routes (widgets, pages, connections,
 * alerts, shares). Never updated or deleted by app code.
 *
 * Identity: `actor_user_id` + `actor_email` come from the verified session —
 * never from the request body. Share-bound workspace tokens have no user
 * identity, so actor fields stay NULL (the action itself is still recorded).
 */

export type AuditAction =
  | "widget.create"
  | "widget.update"
  | "widget.delete"
  | "widget.reorder"
  | "page.create"
  | "page.update"
  | "page.delete"
  | "connection.create"
  | "connection.update"
  | "connection.delete"
  | "connection.activate"
  | "alert.create"
  | "alert.update"
  | "alert.delete"
  | "share.create"
  | "share.revoke";

export interface AuditActor {
  userId?: string;
  email?: string;
}

export interface AuditEntry {
  tenantId: string;
  action: AuditAction;
  target?: string;
  details?: Record<string, unknown>;
}

export async function recordAudit(entry: AuditEntry, actor: AuditActor = {}): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, target, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.tenantId,
        actor.userId ?? null,
        actor.email ?? null,
        entry.action,
        entry.target ?? null,
        entry.details === undefined ? null : JSON.stringify(entry.details),
      ]
    );
  } catch {
    // Auditing must never break the mutation it observes (e.g. table not
    // migrated yet). Failures are swallowed by design.
  }
}

export interface AuditRow {
  id: number;
  tenant_id: string;
  actor_email: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

/** Newest-first activity for one tenant, capped. */
export async function listAudit(
  tenantId: string,
  limit = 100
): Promise<AuditRow[]> {
  const capped = Math.max(1, Math.min(limit, 500));
  const result = await getPool().query<AuditRow>(
    `SELECT id, tenant_id, actor_email, action, target, details, created_at
     FROM audit_log
     WHERE tenant_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [tenantId, capped]
  );
  return result.rows as AuditRow[];
}
