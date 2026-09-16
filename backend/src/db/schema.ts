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
  created_at: Date;
  updated_at: Date;
}

export interface UpsertConnectionInput {
  tenantId: string;
  prometheusUrl: string;
  /** Already-encrypted payload (iv:authTag:ciphertext). */
  authTokenEncrypted: string | null;
  status: "connected" | "error" | "unknown";
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
  const executor = client ?? (await getPool().connect());
  try {
    await executor.query(SCHEMA_DDL);
  } finally {
    if (!client) {
      executor.release();
    }
  }
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
  const result: QueryResult<ConnectionRow> = await getPool().query(
    `INSERT INTO prometheus_connections
       (tenant_id, prometheus_url, auth_token_encrypted, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE SET
       prometheus_url = EXCLUDED.prometheus_url,
       auth_token_encrypted = COALESCE(EXCLUDED.auth_token_encrypted,
                                       prometheus_connections.auth_token_encrypted),
       status = EXCLUDED.status,
       updated_at = NOW()
     RETURNING id, tenant_id, prometheus_url, auth_token_encrypted,
               status, created_at, updated_at`,
    [input.tenantId, input.prometheusUrl, input.authTokenEncrypted, input.status]
  );
  return result.rows[0];
}

export async function getConnection(tenantId: string): Promise<ConnectionRow | null> {
  const result = await getPool().query<ConnectionRow>(
    `SELECT id, tenant_id, prometheus_url, auth_token_encrypted,
            status, created_at, updated_at
     FROM prometheus_connections WHERE tenant_id = $1`,
    [tenantId]
  );
  return result.rows[0] ?? null;
}

export async function healthcheck(): Promise<boolean> {
  const result = await getPool().query<QueryResultRow>("SELECT 1 AS ok");
  return result.rowCount === 1;
}
