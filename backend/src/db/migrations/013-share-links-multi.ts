import { Migration } from "./runner.js";

/**
 * 013: allow MULTIPLE share links per tenant.
 *
 * 003 enforced UNIQUE (tenant_id, label) — upsert semantics: creating a new
 * link with the same label replaced the old one, so a view link and an edit
 * link could never coexist. Dropping the constraint makes every create a
 * fresh link; revoking one never affects the others.
 *
 * The upsert in createShareLink becomes a plain INSERT (code updated in the
 * same commit).
 */
const sql = `
ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_tenant_id_label_key;
`;

export const M013: Migration = {
  name: "013_share_links_multi",
  sql,
};
