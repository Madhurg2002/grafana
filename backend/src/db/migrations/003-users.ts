import { Migration } from "./runner.js";

/**
 * 003: user accounts + shareable dashboard links.
 *
 * - users: email + scrypt password hash (never plaintext).
 * - tenants gain owner_id so each user owns their monitoring workspace.
 * - share_links: unauthenticated read-only snapshots of a tenant dashboard.
 */

const M003_USERS_AND_SHARES = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_owner_id ON tenants (owner_id);

CREATE TABLE IF NOT EXISTS share_links (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tenant_id, label)
);

CREATE INDEX IF NOT EXISTS idx_share_links_tenant_id ON share_links (tenant_id);
`;

export const M003: Migration = {
  name: "003_users_and_share_links",
  sql: M003_USERS_AND_SHARES,
};
