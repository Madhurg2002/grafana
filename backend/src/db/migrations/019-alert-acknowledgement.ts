import { Migration } from "./runner.js";

/**
 * 019: alert acknowledgement ("someone is on it").
 *
 * An acknowledgement does NOT change the alert's evaluated state — the rule
 * keeps transitioning pending/firing/resolved and keeps recording history.
 * It only silences OUTBOUND notifications, so a known incident stops paging
 * the team while the dashboard still shows the truth.
 *
 *  - acknowledged_at: when the ack was taken (NULL = not acknowledged)
 *  - acknowledged_until: NULL = indefinite; otherwise the ack auto-expires
 *  - acknowledged_by: the verified email that took the ack (display only —
 *    never an internal user id)
 */
const sql = `
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by TEXT;

-- The header badge and the firing endpoint both read firing alerts per tenant.
CREATE INDEX IF NOT EXISTS idx_alerts_firing
  ON alerts (tenant_id, state)
  WHERE state = 'firing';
`;

export const M019: Migration = {
  name: "019_alert_acknowledgement",
  sql,
};
