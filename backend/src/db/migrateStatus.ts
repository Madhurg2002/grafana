import { getPool, setPool } from "./schema.js";
import { checksum } from "./migrations/runner.js";
import { MIGRATIONS } from "./migrations/index.js";

/**
 * Read-only migration status — `npm run db:migrate:status`.
 *
 * Prints each registered migration with its state (applied / pending /
 * MODIFIED, i.e. checksum drift against schema_migrations) without touching
 * anything. Mirrors the `migrate:status` convention from the platform
 * migrations doc; here drift FAILS CLOSED at apply-time too, so a MODIFIED
 * row is a loud signal, not a silent skip.
 */
export async function status(): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);
    const { rows } = await pool.query<{ name: string; checksum: string; applied_at: Date }>(
      "SELECT name, checksum, applied_at FROM schema_migrations"
    );
    const appliedByName = new Map(rows.map((row) => [row.name, row]));
    let pendingCount = 0;
    let modifiedCount = 0;
    for (const migration of MIGRATIONS) {
      const recorded = appliedByName.get(migration.name);
      if (recorded === undefined) {
        pendingCount += 1;
        console.log(`pending   ${migration.name}`);
        continue;
      }
      if (recorded.checksum !== checksum(migration.sql)) {
        modifiedCount += 1;
        console.log(`MODIFIED  ${migration.name} — applied content differs from the file (apply will fail closed)`);
        continue;
      }
      console.log(`applied   ${migration.name}  (${recorded.applied_at.toISOString()})`);
    }
    const unregistered = rows.filter((row) => !MIGRATIONS.some((m) => m.name === row.name));
    for (const row of unregistered) {
      console.log(`orphan    ${row.name} — applied but no longer registered`);
    }
    console.log(
      `\n${MIGRATIONS.length - pendingCount - modifiedCount} applied, ${pendingCount} pending, ${modifiedCount} modified, ${unregistered.length} orphan`
    );
    if (modifiedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
    setPool(undefined);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");

if (invokedDirectly) {
  void status();
}
