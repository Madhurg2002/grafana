import { Migration } from "./runner.js";

/**
 * 012: user lookup for share-search.
 *
 * `lower(email)` lets POST /api/users/search find people by email prefix
 * without a sequential scan. Display-name search uses the same shape.
 */
const sql = `
CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_lower_display_name ON users (lower(display_name));
`;

export const M012: Migration = {
  name: "012_user_lookup_indexes",
  sql,
};
