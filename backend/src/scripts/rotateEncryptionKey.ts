import { Pool } from "pg";
import { decryptToken, rewrapPayload } from "../db/encryption.js";

/**
 * Key-rotation rewrap (docs/capabilities.md — Token vault).
 *
 * Run AFTER adding the new key to the environment, e.g. rotating to v2:
 *   ENCRYPTION_KEY_V2=<new 64-hex> ENCRYPTION_KEY_VERSION=2 npm run rotate
 *   (old key kept as ENCRYPTION_KEY_V1 until this reports 0 rotated)
 *
 * Walks every encrypted column, decrypts with the key matching each row's
 * version tag, re-encrypts under the CURRENT version, and reports a summary.
 * Legacy (untagged) rows are re-encrypted too — that upgrades them to
 * versioned payloads on the spot.
 */
interface RotationSummary {
  table: string;
  column: string;
  total: number;
  rotated: number;
  failed: number;
}
async function rewrapColumn(
  pool: Pool,
  summary: RotationSummary,
  idColumn: string
): Promise<void> {
  const select = await pool.query<{ id: string | number; value: string | null }>(
    `SELECT ${idColumn} AS id, ${summary.column} AS value FROM ${summary.table} WHERE ${summary.column} IS NOT NULL`
  );
  for (const row of select.rows) {
    try {
      // Prove decryptability first — a failed rewrap must never lose data.
      decryptToken(row.value ?? "");
      const next = rewrapPayload(row.value ?? "");
      if (next.rotated) {
        await pool.query(`UPDATE ${summary.table} SET ${summary.column} = $1 WHERE ${idColumn} = $2`, [
          next.payload,
          row.id,
        ]);
        summary.rotated += 1;
      }
      summary.total += 1;
    } catch {
      summary.failed += 1;
    }
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? "";
  if (connectionString.length === 0) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString, max: 2 });
  const summaries: RotationSummary[] = [
    { table: "prometheus_connections", column: "auth_token_encrypted", total: 0, rotated: 0, failed: 0 },
    { table: "share_links", column: "view_token_hash", total: 0, rotated: 0, failed: 0 },
  ];
  // share_links.view_token_hash is a hash, not an encryption — skip it.
  const encrypted: RotationSummary[] = summaries.slice(0, 1);
  try {
    for (const summary of encrypted) {
      await rewrapColumn(pool, summary, "id");
      console.log(
        `${summary.table}.${summary.column}: ${summary.total} checked, ${summary.rotated} rewrapped, ${summary.failed} failed`
      );
    }
    console.log(
      "Rotation complete. Keep old-version keys in env until every line reports 0 failed, then remove them."
    );
  } finally {
    await pool.end();
  }
}

void main();
