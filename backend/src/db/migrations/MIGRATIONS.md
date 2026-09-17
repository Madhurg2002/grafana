# Database Migrations

This project uses **one** migration system: TypeScript migration files in
`backend/src/db/migrations/`, applied by a checksum-verified runner.
There is no Drizzle/ORM layer — the schema lives in `db/schema.ts` helpers
and the DDL in `SCHEMA_DDL` plus per-migration SQL.

## Quick Reference

```bash
# List applied / pending / MODIFIED / orphan migrations (read-only)
npm run db:migrate:status        # from backend/; root: npm run db:migrate:status --workspace backend

# Apply all pending migrations
npm run db:migrate

# Rollback — NOT supported by design. Write a forward migration instead.
```

## File Layout

| File | Purpose |
| :--- | :--- |
| `runner.ts` | The engine: advisory lock, per-migration transaction, checksum ledger |
| `index.ts` | **Registration order** — every migration must be added here |
| `003-users.ts` … `011-alerts.ts` | One schema change per file, `Migration` objects |
| `../migrate.ts` | CLI entry (`npm run db:migrate`) |
| `../migrateStatus.ts` | CLI entry (`npm run db:migrate:status`) |

## Adding a Migration

1. Create `backend/src/db/migrations/0NN-short-description.ts` exporting a
   `Migration { name, sql }` (see `010-page-show-builtins.ts` for the pattern).
2. Register it in `index.ts` **in order** — the array order is apply order.
3. Make the SQL idempotent (`IF NOT EXISTS`, guarded `ALTER TABLE ... ADD COLUMN`
   via a `DO` block when needed).
4. Test: `npm run db:migrate:status` should show it `pending`, then
   `npm run db:migrate` applies it, then `status` shows `applied`.

## Guarantees (runner.ts)

* **Advisory lock** (`pg_advisory_lock`): concurrent deploys/pods serialize;
  the second runner waits, then applies nothing (ledger already populated).
* **Atomic**: each migration and its ledger INSERT share one transaction —
  a crash can never leave the schema changed but unrecorded.
* **Checksum guard**: editing an applied migration **fails closed** at apply
  time (`MODIFIED` in status, hard error in `db:migrate`). This is
  deliberately stricter than name-keyed runners that silently skip edited
  files and let DBs diverge.

## Applied Migrations Are Immutable

Once a migration has run anywhere (dev/staging/prod), treat the file as
frozen. To change the schema it produced, **add a new migration** with a
later number. Never edit `003-*.ts`–`011-*.ts` in place.

## How Migrations Run in Production

* On platforms with a release step, run `npm run db:migrate` before the new
  revision serves traffic. The free-tier Render configuration has no
  pre-deploy command.
* `bootstrapDatabase` applies pending migrations at boot with bounded retries,
  which is the fallback for platforms without a release step.
* After a deploy, confirm with `npm run db:migrate:status`.

## Query Observability (dev aid)

The pool (`db/schema.ts`) can log query timing without any code change:

```bash
DB_LOG_QUERIES=1        # log every query with duration (noisy)
DB_LOG_SLOW_MS=100      # log only queries at/above this duration
```

`getDbQueryCount()` exposes the total query count since process start for
diagnostics/tests. Both default to **off** so production logs stay clean.
