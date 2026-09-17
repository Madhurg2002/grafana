import { getPool, setPool } from "./schema.js";
import { initializeDatabase } from "./migrations/runner.js";
import { MIGRATIONS } from "./migrations/index.js";

/**
 * Standalone migration CLI for controlled schema updates.
 *
 *   npm run db:migrate        # apply pending migrations, then exit
 *   npm run db:migrate:status # list applied vs pending, change nothing
 *
 * Usage model (standard release pattern, like `prisma migrate deploy`):
 *   - Run it before deployment when the hosting platform supports a release
 *     step, or from another migration-capable environment.
 *   - The server also applies pending migrations during boot as a bounded
 *     safety net for platforms without a release step.
 *   - Safe to run repeatedly and concurrently with a running server
 *     (advisory lock + checksum-verified idempotent migrations).
 */
export async function migrate(): Promise<void> {
  const pool = getPool();
  try {
    const { applied, skipped } = await initializeDatabase(pool, MIGRATIONS);
    if (applied.length > 0) {
      console.log(`[db:migrate] applied: ${applied.join(", ")}`);
    }
    if (skipped.length > 0) {
      console.log(`[db:migrate] up-to-date (skipped): ${skipped.join(", ")}`);
    }
    if (applied.length === 0 && skipped.length === 0) {
      console.log("[db:migrate] no migrations registered");
    }
  } finally {
    await pool.end();
    setPool(undefined);
  }
}

// CLI entry (`npm run db:migrate`) — not when imported as a module.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");

if (invokedDirectly) {
  migrate().catch((error: unknown) => {
    console.error(
      "[db:migrate] failed —",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  });
}
