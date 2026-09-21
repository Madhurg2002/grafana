import { Migration } from "./runner.js";

/**
 * 016: single-use password-reset tokens.
 *
 * A forgotten password must not permanently lock an account. Flow:
 * request-reset issues a random 256-bit token; only its SHA-256 hash is
 * stored (a DB leak cannot be replayed against /api/auth/reset), with a
 * 30-minute expiry and single-use semantics (the consumed row is deleted).
 * Tokens are bound to the user id that requested them.
 */
const sql = `
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user
  ON password_reset_tokens (user_id);
`;

export const M016: Migration = {
  name: "016_password_reset_tokens",
  sql,
};
