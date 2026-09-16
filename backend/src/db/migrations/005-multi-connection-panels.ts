import { Migration } from "./runner.js";

/**
 * 005: multiple upstream connections per tenant + custom dashboard panels.
 *
 * - Drop the one-connection-per-tenant UNIQUE so users can store several
 *   Prometheus/Grafana URIs and switch between them without re-entering.
 * - `is_active` marks the connection queries/SSE resolve to (one per tenant).
 * - `dashboard_panels`: user-defined chart views (Grafana-style custom
 *   panels) — title, PromQL, and visualization kind, ordered.
 */

const M005_MULTI_CONNECTION_AND_PANELS = `
-- Multiple connections per tenant: replace UNIQUE(tenant_id) with a
-- partial unique index enforcing at most one ACTIVE connection.
ALTER TABLE prometheus_connections
  ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- First make every pre-existing row active (it was THE connection).
UPDATE prometheus_connections SET is_active = TRUE WHERE is_active = FALSE;

-- Drop the flat UNIQUE constraint if present (name varies by vintage).
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'prometheus_connections'::regclass
    AND contype = 'u'
    AND conkey @> ARRAY[
      (SELECT attnum::smallint FROM pg_attribute
       WHERE attrelid = 'prometheus_connections'::regclass
         AND attname = 'tenant_id')
    ]
    AND array_length(conkey, 1) = 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE prometheus_connections DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Exactly one active connection per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prometheus_connections_active
  ON prometheus_connections (tenant_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_prometheus_connections_tenant_active
  ON prometheus_connections (tenant_id, is_active);

-- Custom dashboard panels (user-defined "views").
CREATE TABLE IF NOT EXISTS dashboard_panels (
  id         SERIAL PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  promql     TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'sparkline'
    CHECK (kind IN ('sparkline', 'gauge', 'stat')),
  unit       TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, title)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_panels_tenant
  ON dashboard_panels (tenant_id, position);
`;

export const M005: Migration = {
  name: "005_multi_connection_and_panels",
  sql: M005_MULTI_CONNECTION_AND_PANELS,
};
