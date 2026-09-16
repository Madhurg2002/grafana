import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

/**
 * PostgreSQL access for multi-tenant metadata. Prometheus auth tokens are
 * ALWAYS persisted encrypted (AES-256-GCM) — see `encryption.ts`.
 */

export interface TenantRow {
  id: string;
  name: string;
  created_at: Date;
}

export interface ConnectionRow {
  id: number;
  tenant_id: string;
  prometheus_url: string;
  auth_token_encrypted: string | null;
  status: "connected" | "error" | "unknown";
  /** 'prometheus' | 'grafana' — defaults to 'prometheus' for legacy rows. */
  upstream_type?: string;
  /** Human label distinguishing multiple connections per tenant. */
  label?: string;
  /** True for the connection queries/SSE currently resolve to. */
  is_active?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertConnectionInput {
  tenantId: string;
  prometheusUrl: string;
  /** Already-encrypted payload (iv:authTag:ciphertext). */
  authTokenEncrypted: string | null;
  status: "connected" | "error" | "unknown";
  /** Detected upstream flavor; defaults to 'prometheus'. */
  upstreamType?: "prometheus" | "grafana";
  /** Human label for multi-connection switching (e.g. "prod", "staging"). */
  label?: string;
  /** Set false to store the connection without switching to it. */
  activate?: boolean;
}

const globalForPool = globalThis as unknown as { __PG_POOL__?: Pool };

export function getPool(): Pool {
  if (!globalForPool.__PG_POOL__) {
    globalForPool.__PG_POOL__ = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalForPool.__PG_POOL__;
}

export function setPool(pool: Pool | undefined): void {
  globalForPool.__PG_POOL__ = pool;
}

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prometheus_connections (
  id                   SERIAL PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prometheus_url       TEXT NOT NULL,
  auth_token_encrypted TEXT,
  status               TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('connected', 'error', 'unknown')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);
`;

export async function ensureSchema(client?: PoolClient): Promise<void> {
  // Delegates to the versioned migration runner (keeps legacy callers safe).
  const { initializeDatabase } = await import("./migrations/runner.js");
  const { MIGRATIONS } = await import("./migrations/index.js");
  const pool = getPool();
  if (client !== undefined) {
    await initializeDatabase(pool, MIGRATIONS);
    return;
  }
  await initializeDatabase(pool, MIGRATIONS);
}

export async function upsertTenant(tenantId: string, name: string): Promise<TenantRow> {
  const result: QueryResult<TenantRow> = await getPool().query(
    `INSERT INTO tenants (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, created_at`,
    [tenantId, name]
  );
  return result.rows[0];
}

export async function tenantExists(tenantId: string): Promise<boolean> {
  const result = await getPool().query<Pick<TenantRow, "id">>(
    "SELECT id FROM tenants WHERE id = $1",
    [tenantId]
  );
  return result.rowCount === 1;
}

export async function upsertConnection(input: UpsertConnectionInput): Promise<ConnectionRow> {
  const label = input.label ?? "default";
  const activate = input.activate ?? true;
  const result: QueryResult<ConnectionRow> = await getPool().query(
    `INSERT INTO prometheus_connections
       (tenant_id, prometheus_url, auth_token_encrypted, status, upstream_type, label, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, label) DO UPDATE SET
       prometheus_url = EXCLUDED.prometheus_url,
       auth_token_encrypted = COALESCE(EXCLUDED.auth_token_encrypted,
                                       prometheus_connections.auth_token_encrypted),
       status = EXCLUDED.status,
       upstream_type = EXCLUDED.upstream_type,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()
     RETURNING id, tenant_id, prometheus_url, auth_token_encrypted,
               status, upstream_type, label, is_active, created_at, updated_at`,
    [
      input.tenantId,
      input.prometheusUrl,
      input.authTokenEncrypted,
      input.status,
      input.upstreamType ?? "prometheus",
      label,
      activate,
    ]
  );
  if (activate) {
    // Exactly one active connection per tenant (deferred to dodge the
    // partial-unique index within the same statement batch).
    await getPool().query(
      `UPDATE prometheus_connections
       SET is_active = (label = $2)
       WHERE tenant_id = $1`,
      [input.tenantId, label]
    );
  }
  return result.rows[0];
}

export async function getConnection(tenantId: string): Promise<ConnectionRow | null> {
  const result = await getPool().query<ConnectionRow>(
    `SELECT id, tenant_id, prometheus_url, auth_token_encrypted,
            status, upstream_type, label, is_active, created_at, updated_at
     FROM prometheus_connections
     WHERE tenant_id = $1
     ORDER BY is_active DESC, updated_at DESC
     LIMIT 1`,
    [tenantId]
  );
  return result.rows[0] ?? null;
}

export interface PanelRow {
  id: number;
  tenant_id: string;
  title: string;
  promql: string;
  kind: "sparkline" | "gauge" | "stat";
  unit: string | null;
  position: number;
  created_at: Date;
}

export async function listConnections(tenantId: string): Promise<Array<ConnectionRow>> {
  const result = await getPool().query<ConnectionRow>(
    `SELECT id, tenant_id, prometheus_url, auth_token_encrypted,
            status, upstream_type, label, is_active, created_at, updated_at
     FROM prometheus_connections
     WHERE tenant_id = $1
     ORDER BY is_active DESC, updated_at DESC`,
    [tenantId]
  );
  return result.rows;
}

/** Switches the tenant's active connection; returns the newly active row. */
export async function activateConnection(
  tenantId: string,
  connectionId: number
): Promise<ConnectionRow | null> {
  const owned = await getPool().query<{ id: number }>(
    "SELECT id FROM prometheus_connections WHERE id = $1 AND tenant_id = $2",
    [connectionId, tenantId]
  );
  if (owned.rowCount !== 1) {
    return null;
  }
  await getPool().query("BEGIN");
  try {
    await getPool().query(
      "UPDATE prometheus_connections SET is_active = FALSE WHERE tenant_id = $1",
      [tenantId]
    );
    const updated = await getPool().query<ConnectionRow>(
      `UPDATE prometheus_connections SET is_active = TRUE
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, tenant_id, prometheus_url, auth_token_encrypted,
                 status, upstream_type, label, is_active, created_at, updated_at`,
      [connectionId, tenantId]
    );
    await getPool().query("COMMIT");
    return updated.rows[0] ?? null;
  } catch (error) {
    await getPool().query("ROLLBACK");
    throw error;
  }
}

export async function deleteConnection(tenantId: string, connectionId: number): Promise<boolean> {
  const result = await getPool().query(
    "DELETE FROM prometheus_connections WHERE id = $1 AND tenant_id = $2",
    [connectionId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Custom dashboard panels (user-defined views)
// ---------------------------------------------------------------------------

export async function listPanels(tenantId: string): Promise<PanelRow[]> {
  const result = await getPool().query<PanelRow>(
    `SELECT id, tenant_id, title, promql, kind, unit, position, created_at
     FROM dashboard_panels WHERE tenant_id = $1 ORDER BY position, id`,
    [tenantId]
  );
  return result.rows;
}

export async function createPanel(input: {
  tenantId: string;
  title: string;
  promql: string;
  kind: "sparkline" | "gauge" | "stat";
  unit?: string;
}): Promise<PanelRow> {
  const result = await getPool().query<PanelRow>(
    `INSERT INTO dashboard_panels (tenant_id, title, promql, kind, unit, position)
     VALUES ($1, $2, $3, $4, $5,
             COALESCE((SELECT MAX(position) + 1 FROM dashboard_panels WHERE tenant_id = $1), 0))
     ON CONFLICT (tenant_id, title) DO UPDATE SET
       promql = EXCLUDED.promql, kind = EXCLUDED.kind, unit = EXCLUDED.unit
     RETURNING id, tenant_id, title, promql, kind, unit, position, created_at`,
    [input.tenantId, input.title, input.promql, input.kind, input.unit ?? null]
  );
  return result.rows[0];
}

export async function deletePanel(tenantId: string, panelId: number): Promise<boolean> {
  const result = await getPool().query(
    "DELETE FROM dashboard_panels WHERE id = $1 AND tenant_id = $2",
    [panelId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

export interface PanelPosition {
  id: number;
  position: number;
}

/** Persists new panel positions (tenant-scoped so IDs can't cross tenants). */
export async function reorderPanels(
  tenantId: string,
  positions: PanelPosition[]
): Promise<boolean> {
  if (positions.length === 0) {
    return true;
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const { id, position } of positions) {
      const result = await client.query(
        "UPDATE dashboard_panels SET position = $1 WHERE id = $2 AND tenant_id = $3",
        [position, id, tenantId]
      );
      if ((result.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return false;
      }
    }
    await client.query("COMMIT");
    return true;
  } catch {
    await client.query("ROLLBACK");
    return false;
  } finally {
    client.release();
  }
}

export async function healthcheck(): Promise<boolean> {
  const result = await getPool().query<QueryResultRow>("SELECT 1 AS ok");
  return result.rowCount === 1;
}
