import { Migration } from "./runner.js";

/**
 * 006: share-link access control.
 *
 * - access: who may open the link (anyone / specific emails) and whether
 *   they get view-only or edit rights.
 * - allowed_emails: for email-restricted shares, the allow-list (lowercased).
 * - invited_emails: record of addresses invite emails were sent to.
 */
const M006_SHARE_ACCESS = `
ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS access TEXT NOT NULL DEFAULT 'anyone_view'
    CHECK (access IN ('anyone_view', 'anyone_edit', 'email_view', 'email_edit')),
  ADD COLUMN IF NOT EXISTS allowed_emails TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS invited_emails TEXT[] NOT NULL DEFAULT '{}';
`;

export const M006: Migration = {
  name: "006_share_access",
  sql: M006_SHARE_ACCESS,
};
