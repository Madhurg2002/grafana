import { Migration } from "./runner.js";

/**
 * 008: organizations + org-scoped share access.
 *
 * - organizations: shared workspaces a user can create or join by invite code.
 * - org_members: user ↔ org membership with an owner/member role, so panels
 *   and pages created inside an org tenant are visible to everyone in the org.
 * - share_links.access gains two enum values (`org_view`, `org_edit`) that
 *   grant access to every member of the link's tenant's owning org.
 *
 * Postgres CHECK constraints are immutable in place, so the access column is
 * migrated by dropping and re-adding the constraint with the wider enum.
 */
const M008_ORGS = `
CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members (user_id);

-- Widen the share access enum to include org audience values.
ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_access_check;
ALTER TABLE share_links
  ADD CONSTRAINT share_links_access_check
  CHECK (access IN ('anyone_view', 'anyone_edit', 'email_view', 'email_edit',
                    'org_view', 'org_edit'));

-- Each tenant belongs to at most one org; nullable = personal workspace.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_org ON tenants (org_id);

-- "Set as home" flag for dashboard pages (renaming the legacy first page).
ALTER TABLE dashboard_pages ADD COLUMN IF NOT EXISTS is_home BOOLEAN NOT NULL DEFAULT FALSE;
`;

export const M008: Migration = {
  name: "008_orgs",
  sql: M008_ORGS,
};
