import { Migration } from "./runner.js";

/**
 * 014: the (tenant_id, label) unique index upsertConnection expects.
 *
 * upsertConnection has always issued `ON CONFLICT (tenant_id, label)`, but
 * no migration ever created that unique index — m001's UNIQUE(tenant_id)
 * was dropped by m005, and `label` was added without a unique constraint.
 * Re-connecting an existing upstream therefore 500'd in production
 * (42P10: no unique or exclusion constraint matching the ON CONFLICT
 * specification). Local/dev DBs masked it: their SCHEMA_DDL-era tables
 * carried a (tenant_id, label) unique from an earlier vintage.
 *
 * UNIQUE index (not constraint) so the partial-active index from m005 and
 * this one compose: many labeled connections per tenant, at most one
 * active. Re-connecting the same label updates in place — the documented
 * upsert semantics.
 */
const sql = `
CREATE UNIQUE INDEX IF NOT EXISTS uq_prometheus_connections_tenant_label
  ON prometheus_connections (tenant_id, label);
`;

export const M014: Migration = {
  name: "014_connections_tenant_label_unique",
  sql,
};
