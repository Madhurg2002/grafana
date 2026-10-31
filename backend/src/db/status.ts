/**
 * Database availability state (docs/capabilities.md — Resilient boot).
 *
 * PostgreSQL is the API's only hard dependency, but a missing database used to
 * abort boot with `process.exit(1)` — so a deleted/suspended Postgres looked
 * exactly like a broken deploy, and the instance crash-looped until Render gave
 * up. This module holds the *observable* state instead: the schema supervisor
 * updates it, `/api/health` reports it, and data routes fail closed with a
 * diagnosable 503 while the background retry loop keeps trying.
 *
 * Default is `ready: true` (optimistic): a process that has not attempted a
 * connection yet must not block traffic, and unit tests that stub the schema
 * layer are unaffected.
 */

export interface DatabaseStatusSnapshot {
  /** Schema is migrated and queries can be served. */
  ready: boolean;
  /** The last successful bootstrap also applied every pending migration. */
  schemaReady: boolean;
  /** Bootstrap attempts since start (1 = first attempt in flight/failed). */
  attempts: number;
  lastError: string | null;
  /** Node/pg error code, e.g. ENOTFOUND, ECONNREFUSED, 28P01. */
  lastErrorCode: string | null;
  /** Operator-facing explanation of the code, when we recognise it. */
  hint: string | null;
  lastAttemptAt: string | null;
  readySince: string | null;
  /** Delay until the next automatic attempt; null once ready. */
  nextRetryInMs: number | null;
}

interface DatabaseStatusState extends DatabaseStatusSnapshot {
  /** Set once the first successful bootstrap has happened. */
  everReady: boolean;
}

const state: DatabaseStatusState = {
  ready: true,
  schemaReady: false,
  attempts: 0,
  lastError: null,
  lastErrorCode: null,
  hint: null,
  lastAttemptAt: null,
  readySince: null,
  nextRetryInMs: null,
  everReady: false,
};

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Maps a connection failure onto something an operator can act on. This is the
 * difference between "deploy failed" and "the Postgres instance was deleted".
 */
function hintFor(code: string | null): string | null {
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Database host does not resolve — the Postgres instance may have been deleted or suspended. Check DATABASE_URL and the database's status in the provider dashboard.";
    case "ECONNREFUSED":
      return "Database refused the connection — the instance is stopped, or the port/host is wrong.";
    case "ETIMEDOUT":
    case "ECONNRESET":
      return "Database connection timed out — the instance may be starting up or unreachable from this network.";
    case "28P01":
    case "28000":
      return "Database rejected the credentials in DATABASE_URL.";
    case "3D000":
      return "The database named in DATABASE_URL does not exist.";
    default:
      return null;
  }
}

export function getDatabaseStatus(): DatabaseStatusSnapshot {
  return {
    ready: state.ready,
    schemaReady: state.schemaReady,
    attempts: state.attempts,
    lastError: state.lastError,
    lastErrorCode: state.lastErrorCode,
    hint: state.hint,
    lastAttemptAt: state.lastAttemptAt,
    readySince: state.readySince,
    nextRetryInMs: state.nextRetryInMs,
  };
}

export function isDatabaseReady(): boolean {
  return state.ready;
}

/** Called by the supervisor after a successful migrate+connect. */
export function markDatabaseReady(): void {
  const now = new Date().toISOString();
  state.ready = true;
  state.schemaReady = true;
  state.lastError = null;
  state.lastErrorCode = null;
  state.hint = null;
  state.readySince = state.everReady ? state.readySince : now;
  state.everReady = true;
  state.nextRetryInMs = null;
}

/** Called by the supervisor when an attempt fails; keeps the API serving. */
export function markDatabaseUnreachable(error: unknown, nextRetryInMs: number | null = null): void {
  const code = errorCode(error);
  state.ready = false;
  state.schemaReady = false;
  state.attempts += 1;
  state.lastError = errorMessage(error);
  state.lastErrorCode = code;
  state.hint = hintFor(code);
  state.lastAttemptAt = new Date().toISOString();
  state.nextRetryInMs = nextRetryInMs;
}

/** Records the delay chosen for the next attempt (does not change readiness). */
export function scheduleDatabaseRetry(nextRetryInMs: number | null): void {
  state.nextRetryInMs = nextRetryInMs;
}

/** Test/diagnostic hook: restores the optimistic starting state. */
export function resetDatabaseStatus(): void {
  state.ready = true;
  state.schemaReady = false;
  state.attempts = 0;
  state.lastError = null;
  state.lastErrorCode = null;
  state.hint = null;
  state.lastAttemptAt = null;
  state.readySince = null;
  state.nextRetryInMs = null;
  state.everReady = false;
}
