import { getPool } from "./schema.js";
import { initializeDatabase } from "./migrations/runner.js";
import { MIGRATIONS } from "./migrations/index.js";

/**
 * Boot-time schema bootstrap with a bounded wait: if PostgreSQL is still
 * starting (container orchestration), retry briefly before giving up.
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
