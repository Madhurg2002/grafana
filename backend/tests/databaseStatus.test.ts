import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Resilient boot (docs/capabilities.md): the API must stay up and explain
 * itself when PostgreSQL is missing, instead of exiting and failing the deploy.
 *
 * The migration runner is stubbed so the supervisor's backoff can be driven
 * deterministically; `healthcheck` is stubbed so the health surface is exercised
 * without a pool.
 */

const initializeDatabase = vi.hoisted(() => vi.fn());

vi.mock("../src/db/migrations/runner.js", () => ({ initializeDatabase }));
vi.mock("../src/db/schema.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/schema.js")>();
  return { ...actual, healthcheck: vi.fn(async () => false) };
});

import { setEnv, type Env } from "../src/config/env.js";
import {
  getDatabaseStatus,
  isDatabaseReady,
  markDatabaseReady,
  markDatabaseUnreachable,
  resetDatabaseStatus,
} from "../src/db/status.js";
import { startDatabaseSupervisor } from "../src/db/bootstrap.js";

const TEST_ENV: Env = {
  PORT: 0,
  NODE_ENV: "test",
  CORS_ORIGIN: "*",
  LOG_LEVEL: "error",
  ENCRYPTION_KEY: "c".repeat(64),
  JWT_SECRET: "d".repeat(64),
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  CACHE_TTL_SECONDS: 300,
  RATE_LIMIT_MAX: 10000,
  RATE_LIMIT_WINDOW_MS: 60000,
};

function dnsError(host: string): Error {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
}

describe("database status", () => {
  beforeEach(() => {
    resetDatabaseStatus();
  });

  it("starts optimistic so an un-attempted database never blocks traffic", () => {
    expect(isDatabaseReady()).toBe(true);
    expect(getDatabaseStatus()).toMatchObject({ ready: true, attempts: 0, lastError: null });
  });

  it("explains an unresolvable host as a deleted or suspended instance", () => {
    markDatabaseUnreachable(dnsError("dpg-example-host"), 2000);
    const status = getDatabaseStatus();
    expect(isDatabaseReady()).toBe(false);
    expect(status.attempts).toBe(1);
    expect(status.lastErrorCode).toBe("ENOTFOUND");
    expect(status.lastError).toContain("dpg-example-host");
    expect(status.hint).toContain("deleted or suspended");
    expect(status.nextRetryInMs).toBe(2000);
  });

  it("maps other connection failures onto actionable hints", () => {
    markDatabaseUnreachable(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    expect(getDatabaseStatus().hint).toContain("refused the connection");
    markDatabaseUnreachable(Object.assign(new Error("password authentication failed"), { code: "28P01" }));
    expect(getDatabaseStatus().hint).toContain("rejected the credentials");
    markDatabaseUnreachable(new Error("something odd"));
    expect(getDatabaseStatus().hint).toBeNull();
  });

  it("clears the failure once the schema is ready again", () => {
    markDatabaseUnreachable(dnsError("dpg-gone"), 4000);
    markDatabaseReady();
    const status = getDatabaseStatus();
    expect(status.ready).toBe(true);
    expect(status.schemaReady).toBe(true);
    expect(status.lastError).toBeNull();
    expect(status.hint).toBeNull();
    expect(status.nextRetryInMs).toBeNull();
    expect(status.readySince).not.toBeNull();
  });
});

describe("database supervisor", () => {
  beforeEach(() => {
    resetDatabaseStatus();
    initializeDatabase.mockReset();
  });

  it("survives a failed bootstrap, reports why, and recovers on retry", async () => {
    initializeDatabase
      .mockRejectedValueOnce(dnsError("dpg-example-host"))
      .mockResolvedValue({ applied: ["019_alert_acknowledgement"], skipped: [] });
    const onReady = vi.fn();
    const onFailure = vi.fn();

    const supervisor = startDatabaseSupervisor({
      initialDelayMs: 5,
      maxDelayMs: 20,
      onReady,
      onFailure,
    });

    // The first attempt resolves (no throw escapes) even though it failed.
    await supervisor.settled;
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[1]).toBe(5);
    expect(onReady).not.toHaveBeenCalled();
    expect(getDatabaseStatus()).toMatchObject({ ready: false, lastErrorCode: "ENOTFOUND" });

    // Background retry flips it back to ready without a restart.
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(getDatabaseStatus().ready).toBe(true);
    expect(getDatabaseStatus().hint).toBeNull();
    supervisor.stop();
  });

  it("backs off exponentially up to the cap", async () => {
    initializeDatabase.mockRejectedValue(dnsError("dpg-gone"));
    const delays: number[] = [];
    const supervisor = startDatabaseSupervisor({
      initialDelayMs: 5,
      maxDelayMs: 10,
      onFailure: (_status, nextRetryInMs) => delays.push(nextRetryInMs),
    });
    await supervisor.settled;
    await vi.waitFor(() => expect(delays.length).toBeGreaterThanOrEqual(3), { timeout: 2000 });
    // Each failure reports the delay it just used: 5 → doubles to 10 → capped.
    expect(delays.slice(0, 3)).toEqual([5, 10, 10]);
    supervisor.stop();
  });
});

describe("health surface without a database", () => {
  beforeEach(() => {
    setEnv(TEST_ENV);
    resetDatabaseStatus();
  });

  it("keeps liveness at 200 and reports the diagnosis in the body", async () => {
    markDatabaseUnreachable(dnsError("dpg-example-host"), 2000);
    const { buildApp } = await import("../src/index.js");
    const app = await buildApp();

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    const body = health.json() as {
      status: string;
      db: boolean;
      database: { ready: boolean; hint: string | null; lastErrorCode: string | null };
    };
    expect(body.db).toBe(false);
    expect(body.status).toBe("degraded");
    expect(body.database.ready).toBe(false);
    expect(body.database.lastErrorCode).toBe("ENOTFOUND");
    expect(body.database.hint).toContain("deleted or suspended");
    await app.close();
  });

  it("fails readiness and data routes with a diagnosable 503", async () => {
    const { buildApp } = await import("../src/index.js");
    const app = await buildApp();
    markDatabaseUnreachable(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }), 1000);

    const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
    expect(ready.statusCode).toBe(503);
    const readyBody = ready.json() as { error: string; details: Array<{ path: string; message: string }> };
    expect(readyBody.error).toBe("Database unavailable");
    expect(readyBody.details[0]?.path).toBe("database");
    expect(readyBody.details[0]?.message).toContain("refused the connection");

    const blocked = await app.inject({
      method: "POST",
      url: "/api/query",
      payload: { tenantId: "tenant-1", promql: "up" },
    });
    expect(blocked.statusCode).toBe(503);
    expect((blocked.json() as { error: string }).error).toBe("Database unavailable");

    // Once the schema is ready the guard steps aside for the same route.
    markDatabaseReady();
    const allowed = await app.inject({
      method: "POST",
      url: "/api/query",
      payload: { tenantId: "tenant-1", promql: "up" },
    });
    expect(allowed.statusCode).not.toBe(503);
    await app.close();
  });
});
