import { Migration } from "./runner.js";

/**
 * 020: alert transition history.
 *
 * `alerts` only holds the CURRENT state; the audit log records configuration
 * changes. Neither answers "what fired overnight, when, and with what value" —
 * which is exactly what you need after an incident, especially for alerts that
 * were acknowledged (and therefore silent).
 *
 * One row per firing/resolved transition. Rows cascade with their alert, so
 * deleting an alert (or the owning account) removes its history too.
 */
const sql = `
CREATE TABLE IF NOT EXISTS alert_events (
  id           SERIAL PRIMARY KEY,
  alert_id     INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('firing', 'resolved')),
  value        DOUBLE PRECISION,
  threshold    DOUBLE PRECISION NOT NULL,
  comparator   TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_events_alert
  ON alert_events (alert_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_tenant
  ON alert_events (tenant_id, created_at DESC);
`;

export const M020: Migration = {
  name: "020_alert_events",
  sql,
};
