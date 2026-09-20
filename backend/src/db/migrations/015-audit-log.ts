import { Migration } from "./runner.js";

/**
 * 015: append-only audit trail for workspace mutations.
 *
 * Edit-share links and org members can change dashboards, so owners need a
 * record of who did what. One row per mutation: actor (user id + email when
 * a session was presented), action, human-readable target, and small JSON
 * details. Never updated or deleted by the app — owners may prune manually.
 */
const sql = `
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email   TEXT,
  action        TEXT NOT NULL,
  target        TEXT,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created
  ON audit_log (tenant_id, created_at DESC);
`;

export const M015: Migration = {
  name: "015_audit_log",
  sql,
};
