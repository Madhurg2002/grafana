/**
 * Integration tests for the PostgreSQL schema layer.
 *
 * These run automatically when a PostgreSQL instance is reachable at
 * DATABASE_URL (see `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres`).
 * Without a database they SKIP gracefully so `npm test` stays green in CI.
 */
import { describe, it, expect, afterAll } from "vitest";
import { Pool } from "pg";
import {
  getPool,
  setPool,
  ensureSchema,
  upsertTenant,
  upsertConnection,
  getConnection,
  tenantExists,
  healthcheck,
} from "../src/db/schema.js";
import { encryptToken, decryptToken } from "../src/db/encryption.js";

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

let dbAvailable = false;
const probe = new Pool({
  connectionString: DATABASE_URL || undefined,
  connectionTimeoutMillis: 1500,
  max: 1,
});
try {
  await probe.query("SELECT 1");
  dbAvailable = true;
} catch {
  dbAvailable = false;
} finally {
  void probe.end().catch(() => undefined);
}

const TENANT = `it-${Date.now()}`;

describe.skipIf(!dbAvailable)("PostgreSQL schema integration", () => {
  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM tenants WHERE id = $1", [TENANT]);
    await pool.end();
    setPool(undefined);
  });

  it("healthcheck returns true", async () => {
    await expect(healthcheck()).resolves.toBe(true);
  });

  it("ensureSchema is idempotent", async () => {
    await ensureSchema();
    await ensureSchema();
  });

  it("upserts a tenant and checks existence", async () => {
    await upsertTenant(TENANT, "Integration Tenant");
    await expect(tenantExists(TENANT)).resolves.toBe(true);
  });

  it("persists connection with encrypted token (never plaintext)", async () => {
    const token = "it-secret-token-xyz";
    const encrypted = encryptToken(token);
    await upsertConnection({
      tenantId: TENANT,
      prometheusUrl: "https://prom-it.example.com",
      authTokenEncrypted: encrypted,
      status: "connected",
    });

    const stored = await getConnection(TENANT);
    expect(stored).not.toBeNull();
    expect(stored?.auth_token_encrypted).not.toContain(token);
    expect(stored?.auth_token_encrypted?.split(":")).toHaveLength(3);
    expect(decryptToken(stored?.auth_token_encrypted ?? "")).toBe(token);
    expect(stored?.status).toBe("connected");
  });

  it("updates an existing connection without duplicating rows", async () => {
    await upsertConnection({
      tenantId: TENANT,
      prometheusUrl: "https://prom-it2.example.com",
      authTokenEncrypted: null,
      status: "error",
    });
    const rows = await getConnection(TENANT);
    expect(rows?.prometheus_url).toBe("https://prom-it2.example.com");
    // Token is retained by COALESCE on conflict.
    expect(rows?.auth_token_encrypted).not.toBeNull();
    expect(rows?.status).toBe("error");
  });
});

if (!dbAvailable) {
  describe("PostgreSQL schema integration (skipped)", () => {
    it("skips when no database is reachable", () => {
      expect(dbAvailable).toBe(false);
    });
  });
}
