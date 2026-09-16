import { Migration } from "./runner.js";

/**
 * 004: track whether a tenant's connection targets a raw Prometheus or a
 * Grafana-managed Prometheus (resolved through Grafana's datasource proxy).
 */
const M004_UPSTREAM_TYPE = `
ALTER TABLE prometheus_connections
  ADD COLUMN IF NOT EXISTS upstream_type TEXT NOT NULL DEFAULT 'prometheus'
  CHECK (upstream_type IN ('prometheus', 'grafana'));
`;

export const M004: Migration = {
  name: "004_upstream_type",
  sql: M004_UPSTREAM_TYPE,
};
