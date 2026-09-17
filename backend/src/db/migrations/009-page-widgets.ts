import { Migration } from "./runner.js";

/**
 * 009: pages become fully user-modifiable dashboards.
 *
 * Each dashboard page carries:
 *  - a default grid span (how many grid columns its widgets stretch across)
 *  - its own refresh cadence and default time window (range controls)
 * Widgets (`page_widgets`) replace ad-hoc panel placement: every visible
 * thing on a page — a gauge, sparkline, stat, or the hosts table — is a
 * widget row with an explicit grid span and position, so the user can
 * compose anything (including Grafana-style wide screens) themselves.
 */
const M009_PAGE_WIDGETS = `
ALTER TABLE dashboard_pages
  ADD COLUMN IF NOT EXISTS default_span SMALLINT NOT NULL DEFAULT 1
    CHECK (default_span >= 1 AND default_span <= 3),
  ADD COLUMN IF NOT EXISTS refresh_seconds INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS window_minutes INTEGER NOT NULL DEFAULT 60;

CREATE TABLE IF NOT EXISTS page_widgets (
  id         SERIAL PRIMARY KEY,
  page_id    INTEGER NOT NULL REFERENCES dashboard_pages(id) ON DELETE CASCADE,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'stat'
    CHECK (kind IN ('stat', 'gauge', 'sparkline', 'hosts_table')),
  title      TEXT NOT NULL,
  promql     TEXT NOT NULL DEFAULT '',
  unit       TEXT,
  span       SMALLINT NOT NULL DEFAULT 1 CHECK (span >= 1 AND span <= 3),
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_widgets_page
  ON page_widgets (page_id, position);

-- Seed widgets from any pre-existing custom panels so nothing disappears.
INSERT INTO page_widgets (page_id, tenant_id, kind, title, promql, unit, span, position)
SELECT p.id, p.tenant_id, mp.kind, mp.title, mp.promql, mp.unit, 1, mp.position
FROM dashboard_panels mp
JOIN dashboard_pages p ON p.tenant_id = mp.tenant_id
WHERE mp.page_id = p.id
ON CONFLICT DO NOTHING;
`;

export const M009: Migration = {
  name: "009_page_widgets",
  sql: M009_PAGE_WIDGETS,
};
