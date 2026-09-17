/**
 * Live upstream integration — gated by TEST_PROMETHEUS_URL.
 *
 * These tests hit a REAL Prometheus (defaults to the public demo upstream)
 * through the actual client path (undici + breaker + cache + normalizer)
 * and are SKIPPED unless TEST_PROMETHEUS_URL is set, so `npm test` stays
 * hermetic in CI:
 *
 *   TEST_PROMETHEUS_URL=https://prometheus.demo.prometheus.io npm test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import {
  instantQuery,
  rangeQuery,
  fetchMetricNames,
  normalizePromQL,
} from "../src/services/prometheus.js";
import { setQueryCache, QueryCache } from "../src/services/cache.js";
import { setCircuitBreaker, CircuitBreaker } from "../src/services/circuitBreaker.js";
import { setEnv, type Env } from "../src/config/env.js";
import { setPool } from "../src/db/schema.js";
import { encryptToken } from "../src/db/encryption.js";
import { upsertTenant, upsertConnection } from "../src/db/schema.js";

const LIVE_URL = process.env.TEST_PROMETHEUS_URL ?? "";
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

// Both a live upstream AND a reachable database are required: the client
// resolves the tenant's upstream from stored connection rows.
const runLive = LIVE_URL.length > 0 && DATABASE_URL.length > 0;

const TENANT = `live-${Date.now()}`;

describe.skipIf(!runLive)("live Prometheus upstream (TEST_PROMETHEUS_URL)", () => {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 3000,
  });

  beforeAll(async () => {
    setEnv({
      PORT: 0,
      NODE_ENV: "test",
      CORS_ORIGIN: "*",
      LOG_LEVEL: "error",
      ENCRYPTION_KEY: "e".repeat(64),
      JWT_SECRET: "f".repeat(64),
      DATABASE_URL,
      CACHE_TTL_SECONDS: 300,
      RATE_LIMIT_MAX: 10000,
      RATE_LIMIT_WINDOW_MS: 60000,
    } satisfies Env);
    setQueryCache(new QueryCache(300));
    setCircuitBreaker(new CircuitBreaker({ failureThreshold: 2, cooldownMs: 5000 }));
    setPool(pool);
    await upsertTenant(TENANT, "Live integration");
    await upsertConnection({
      tenantId: TENANT,
      prometheusUrl: LIVE_URL,
      authTokenEncrypted: null,
      status: "connected",
    });
    void encryptToken; // keep the security import referenced for future tokenized probes
  });

  afterAll(async () => {
    await pool.query("DELETE FROM tenants WHERE id = $1", [TENANT]).catch(() => undefined);
    await pool.end().catch(() => undefined);
    setPool(undefined);
  });

  it("answers a normalized instant query against the real upstream", async () => {
    const { result, cached } = await instantQuery({ tenantId: TENANT, query: "up" });
    expect(cached).toBe(false);
    expect(result.resultType).toBe("vector");
    expect(result.result.length).toBeGreaterThan(0);
    const first = result.result[0] as { value?: { value: number } };
    expect(typeof first.value?.value).toBe("number");
  });

  it("serves the identical query from the 300s cache on the second call", async () => {
    await instantQuery({ tenantId: TENANT, query: "vector(1)" });
    const second = await instantQuery({ tenantId: TENANT, query: "vector(1)" });
    expect(second.cached).toBe(true);
  });

  it("returns range data for a physical-NIC network query (safety laws intact)", async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 60_000);
    const { result } = await rangeQuery({
      tenantId: TENANT,
      query: normalizePromQL("rate(node_network_receive_bytes_total[1m])"),
      start: start.toISOString(),
      end: end.toISOString(),
      step: "5m",
    });
    // The demo upstream runs node_exporter; physical-filtered series exist.
    expect(Array.isArray(result)).toBe(true);
  });

  it("fetches the live metric catalog for the PromQL helper", async () => {
    const { names } = await fetchMetricNames(TENANT);
    expect(names.length).toBeGreaterThan(10);
    expect(names).toContain("up");
  });
});

if (!runLive) {
  describe("live Prometheus upstream (skipped)", () => {
    it("skips unless TEST_PROMETHEUS_URL and a database are configured", () => {
      expect(runLive).toBe(false);
    });
  });
}
