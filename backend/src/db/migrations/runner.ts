import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

/**
 * Minimal, dependency-free migration runner for the Prometheus Passthrough DB.
 *
 * Guarantees:
 *  - Applied migrations are tracked in `schema_migrations` (name + checksum).
 *  - Each migration runs inside a transaction (all-or-nothing).
 *  - A Postgres advisory lock serializes concurrent instances (safe for
 *    multi-instance deployments).
 *  - Editing an already-applied migration aborts startup (checksum mismatch).
 */

export interface Migration {
  name: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const ADVISORY_LOCK_KEY = 81370042;

export function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex").slice(0, 16);
}

/** Executes every pending migration in order; skips already-applied ones. */
export async function runMigrations(
  pool: Pool,
  migrations: Migration[]
): Promise<MigrationResult> {
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query(MIGRATIONS_TABLE_SQL);
    // Serialize concurrent instances (Render multi-instance, pm2 cluster...).
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    try {
      for (const migration of migrations) {
        const sum = checksum(migration.sql);
        const existing = await client.query<{ checksum: string }>(
          "SELECT checksum FROM schema_migrations WHERE name = $1",
          [migration.name]
        );
        if (existing.rowCount === 1) {
          const recorded = existing.rows[0]?.checksum;
          if (recorded !== sum) {
            throw new Error(
              `Migration "${migration.name}" was modified after it was applied (checksum mismatch). Create a new migration instead.`
            );
          }
          skipped.push(migration.name);
          continue;
        }
        await client.query("BEGIN");
        try {
          await client.query(migration.sql);
          await client.query(
            "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
            [migration.name, sum]
          );
          await client.query("COMMIT");
          applied.push(migration.name);
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return { applied, skipped };
}

/** Ensures the database schema is current. Called on boot and via the CLI. */
export async function initializeDatabase(
  pool: Pool,
  migrations: Migration[]
): Promise<MigrationResult> {
  return runMigrations(pool, migrations);
}

export type ClientLike = Pick<PoolClient, "query" | "release">;
