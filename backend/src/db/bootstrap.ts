import { getPool } from "./schema.js";
import { initializeDatabase } from "./migrations/runner.js";
import { MIGRATIONS } from "./migrations/index.js";
import {
  getDatabaseStatus,
  markDatabaseReady,
  markDatabaseUnreachable,
  scheduleDatabaseRetry,
  type DatabaseStatusSnapshot,
} from "./status.js";

/**
 * Boot-time schema bootstrap.
 *
 * `bootstrapDatabase` is the strict, throw-on-failure form: CLI scripts
 * (`npm run db:migrate`) and tests should fail loudly. It retries briefly so a
 * PostgreSQL that is still starting (container orchestration) does not abort a
 * normal boot.
 */
export async function bootstrapDatabase(
  retries = 5,
  delayMs = 1500
): Promise<{ applied: string[]; skipped: string[] }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await initializeDatabase(getPool(), MIGRATIONS);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Database bootstrap failed");
}

export interface DatabaseSupervisorOptions {
  /** First retry delay; doubles per failure up to `maxDelayMs`. */
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Called after each successful attempt (schema migrated). */
  onReady?: () => void;
  /** Called after each failed attempt, with the delay scheduled next. */
  onFailure?: (status: DatabaseStatusSnapshot, nextRetryInMs: number) => void;
}

export interface DatabaseSupervisor {
  /** Cancels the pending retry; an in-flight attempt still finishes. */
  stop: () => void;
  /** Resolves after the first attempt, successful or not. */
  settled: Promise<void>;
}

/**
 * Keeps trying to migrate/connect in the background WITHOUT ever throwing, so a
 * missing database degrades the API (503 + `/api/health` diagnosis) instead of
 * crash-looping the whole service and failing the deploy.
 *
 * The timer is unref'd: a broken database must not keep the process alive after
 * the server has been shut down.
 */
export function startDatabaseSupervisor(
  options: DatabaseSupervisorOptions = {}
): DatabaseSupervisor {
  const initialDelayMs = options.initialDelayMs ?? 2_000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  let delay = initialDelayMs;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      // One shot per attempt; the supervisor owns the backoff.
      await bootstrapDatabase(1, 0);
      markDatabaseReady();
      options.onReady?.();
    } catch (error) {
      markDatabaseUnreachable(error, delay);
      options.onFailure?.(getDatabaseStatus(), delay);
      delay = Math.min(delay * 2, maxDelayMs);
      scheduleDatabaseRetry(delay);
      if (stopped) {
        return;
      }
      timer = setTimeout(() => {
        void attempt();
      }, delay);
      // Do not hold the event loop open purely to retry a dead database.
      timer.unref?.();
    }
  };

  const firstAttempt = attempt();

  return {
    stop: () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
    settled: firstAttempt.then(() => undefined),
  };
}
