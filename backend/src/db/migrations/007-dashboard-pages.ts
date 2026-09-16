import { Migration } from "./runner.js";

/**
 * 007: multiple dashboard pages per tenant ("Home" + user-created pages).
 *
 * Each page is an ordered group of panels; the first page (lowest position)
 * acts as Home. Panels reference their page so different prespecified views
 * live on different pages.
 */
const M007_DASHBOARD_PAGES = `
CREATE TABLE IF NOT EXISTS dashboard_pages (
  id         SERIAL PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_pages_tenant
  ON dashboard_pages (tenant_id, position);

ALTER TABLE dashboard_panels
  ADD COLUMN IF NOT EXISTS page_id INTEGER;

-- Attach existing panels to the tenant's first (Home) page.
INSERT INTO dashboard_pages (tenant_id, name, position)
SELECT DISTINCT tenant_id, 'Home', 0
FROM dashboard_panels
ON CONFLICT DO NOTHING;

UPDATE dashboard_panels p
SET page_id = pg.id
FROM dashboard_pages pg
WHERE p.page_id IS NULL
  AND pg.tenant_id = p.tenant_id
  AND pg.name = 'Home';
`;

export const M007: Migration = {
  name: "007_dashboard_pages",
  sql: M007_DASHBOARD_PAGES,
};
