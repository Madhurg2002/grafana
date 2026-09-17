import { Migration } from "./runner.js";

/**
 * 011: threshold alerting (the biggest Grafana-parity gap).
 *
 * `alerts` rows are evaluated by the background evaluator service:
 *  - promql: any single-value expression; the evaluator runs it on the
 *    tenant's ACTIVE upstream via the normalizer/breaker/cache stack.
 *  - comparator + threshold: fires when `value </>/<=/>=/== threshold`.
 *  - for_seconds: value must breach continuously for this long before
 *    firing (defaults 0 = immediately).
 *  - webhook_url: where the notification POSTs (optional — the alert's
 *    firing state is always visible in the UI regardless).
 * State machine: pending → firing (breach for ≥ for_seconds) → resolved
 * (value back inside threshold); firing_time/resolved_time recorded.
 */
const M011_ALERTS = `
CREATE TABLE IF NOT EXISTS alerts (
  id            SERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  promql        TEXT NOT NULL,
  comparator    TEXT NOT NULL DEFAULT '>'
    CHECK (comparator IN ('>', '<', '>=', '<=', '==')),
  threshold     DOUBLE PRECISION NOT NULL,
  for_seconds   INTEGER NOT NULL DEFAULT 0
    CHECK (for_seconds >= 0 AND for_seconds <= 86400),
  webhook_url   TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  state         TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'firing', 'resolved')),
  first_breach_at  TIMESTAMPTZ,
  firing_time      TIMESTAMPTZ,
  resolved_time    TIMESTAMPTZ,
  last_value       DOUBLE PRECISION,
  last_eval_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, title)
);

CREATE INDEX IF NOT EXISTS idx_alerts_tenant
  ON alerts (tenant_id, enabled);
`;

export const M011: Migration = {
  name: "011_alerts",
  sql: M011_ALERTS,
};
