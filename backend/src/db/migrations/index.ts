import type { Migration } from "./runner.js";
import { M003 } from "./003-users.js";
import { M004 } from "./004-upstream-type.js";
import { M005 } from "./005-multi-connection-panels.js";
import { M006 } from "./006-share-access.js";
import { M007 } from "./007-dashboard-pages.js";
import { M008 } from "./008-orgs.js";
import { M009 } from "./009-page-widgets.js";
import { M010 } from "./010-page-show-builtins.js";
import { M011 } from "./011-alerts.js";
import { M012 } from "./012-user-lookup-index.js";
import { M013 } from "./013-share-links-multi.js";
import { M014 } from "./014-connections-label-unique.js";
import { M015 } from "./015-audit-log.js";

/**
 * Ordered, immutable migrations. Once applied, a migration's SQL MUST NOT be
 * edited (checksum verification will abort boot) — add a new migration instead.
 */

const M001_CORE_TABLES = `
-- Multi-tenant identities.
CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One Prometheus connection per tenant; auth tokens are stored ENCRYPTED
-- (AES-256-GCM, iv:authTag:ciphertext) — never in plaintext.
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

const M002_INDEXES_AND_TRIGGERS = `
-- Hot lookup path: resolve a tenant's connection on every proxied query.
CREATE INDEX IF NOT EXISTS idx_prometheus_connections_tenant_id
  ON prometheus_connections (tenant_id);

-- Dashboard ordering / newest-tenant listings.
CREATE INDEX IF NOT EXISTS idx_tenants_created_at
  ON tenants (created_at DESC);

-- Keep updated_at truthful on connection edits.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prometheus_connections_updated_at
  ON prometheus_connections;

CREATE TRIGGER trg_prometheus_connections_updated_at
  BEFORE UPDATE ON prometheus_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

export const MIGRATIONS: Migration[] = [
  { name: "001_core_tables", sql: M001_CORE_TABLES },
  { name: "002_indexes_and_triggers", sql: M002_INDEXES_AND_TRIGGERS },
  M003,
  M004,
  M005,
  M006,
  M007,
  M008,
  M009,
  M010,
  M011,
  M012,
  M013,
  M014,
  M015,
];
