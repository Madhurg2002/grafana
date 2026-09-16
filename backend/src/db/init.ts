import { getPool, setPool } from "./schema.js";
import { initializeDatabase } from "./migrations/runner.js";
import { MIGRATIONS } from "./migrations/index.js";

/**
 * Standalone database initializer.
 *
 * Usage: npm run db:init
 * Safe to run repeatedly and concurrently with a running server
 * (advisory lock + idempotent migrations).
 */
export async function initialize(): Promise<void> {
  const pool = getPool();
  try {
    const { applied, skipped } = await initializeDatabase(pool, MIGRATIONS);
    if (applied.length > 0) {
      console.log(`[db:init] applied: ${applied.join(", ")}`);
    }
    if (skipped.length > 0) {
      console.log(`[db:init] up-to-date (skipped): ${skipped.join(", ")}`);
    }
    if (applied.length === 0 && skipped.length === 0) {
      console.log("[db:init] no migrations registered");
    }
  } finally {
    await pool.end();
    setPool(undefined);
  }
}

// Run directly (`npm run db:init` / tsx src/db/init.ts) — not under import.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");

if (invokedDirectly) {
  initialize().catch((error: unknown) => {
    console.error(
      "[db:init] failed —",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  });
}
