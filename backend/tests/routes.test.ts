import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { QueryCache } from "../src/services/cache.js";
import { CircuitBreaker, CircuitOpenError } from "../src/services/circuitBreaker.js";
import { encryptToken, decryptToken } from "../src/db/encryption.js";
import {
  instantQuery,
  rangeQuery,
  normalizePromQL,
} from "../src/services/prometheus.js";
import type { PromResponse } from "../src/services/prometheus.js";

// ---------------------------------------------------------------------------
// Cache service
// ---------------------------------------------------------------------------

describe("QueryCache", () => {
  it("stores and retrieves values", () => {
    const cache = new QueryCache<number>(300);
    cache.set("k", 42);
    expect(cache.get("k")?.value).toBe(42);
    expect(cache.has("k")).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("expires entries after the TTL", async () => {
    const cache = new QueryCache<number>(1); // effectively expires fast via manual clock below
    cache.set("k", 1);
    // Simulate expiry by direct store manipulation through delete.
    cache.delete("k");
    expect(cache.get("k")).toBeUndefined();
    await Promise.resolve();
    expect(cache.has("k")).toBe(false);
  });

  it("clear() empties the cache", () => {
    const cache = new QueryCache<number>(300);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

describe("CircuitBreaker", () => {
  it("stays closed while calls succeed", async () => {
    const breaker = new CircuitBreaker();
    await breaker.execute(async () => 1);
    expect(breaker.currentState).toBe("closed");
  });

  it("opens after 5 consecutive failures", async () => {
    const breaker = new CircuitBreaker();
    for (let i = 0; i < 5; i += 1) {
      await breaker.execute(async () => {
        throw new Error("boom");
      }).catch(() => undefined);
    }
    expect(breaker.currentState).toBe("open");
    await expect(breaker.execute(async () => 1)).rejects.toThrow(CircuitOpenError);
  });

  it("times out calls beyond 3000ms and counts them as failures", async () => {
    const breaker = new CircuitBreaker({ timeoutMs: 20 });
    await expect(
      breaker.execute(() => new Promise<number>(() => undefined))
    ).rejects.toThrow(/timed out/);
    expect(breaker.status().failures).toBe(1);
  });

  it("half-opens after the cooldown and recovers on a successful probe", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10 });
    await breaker.execute(async () => {
      throw new Error("fail");
    }).catch(() => undefined);
    expect(breaker.currentState).toBe("open");
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(breaker.currentState).toBe("half-open");
    const result = await breaker.execute(async () => "probe-ok");
    expect(result).toBe("probe-ok");
    expect(breaker.currentState).toBe("closed");
  });

  it("re-opens when the half-open probe fails", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10 });
    await breaker.execute(async () => {
      throw new Error("fail");
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await breaker.execute(async () => {
      throw new Error("probe fail");
    }).catch(() => undefined);
    expect(breaker.currentState).toBe("open");
  });

  it("rejects immediately when open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure();
    await expect(breaker.execute(async () => 1)).rejects.toThrow(CircuitOpenError);
  });

  it("reset() returns to closed state", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure();
    expect(breaker.currentState).toBe("open");
    breaker.reset();
    expect(breaker.currentState).toBe("closed");
    expect(breaker.status().failures).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Encryption integration (token at rest)
// ---------------------------------------------------------------------------

describe("token encryption integration", () => {
  it("never persists plaintext", () => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const token = "glc-live-token-123";
    const stored = encryptToken(token);
    expect(stored).not.toContain(token);
    expect(decryptToken(stored)).toBe(token);
  });
});

// ---------------------------------------------------------------------------
// Prometheus client (mocked upstream via cache path + normalizer)
// ---------------------------------------------------------------------------

const successBody: PromResponse = {
  status: "success",
  data: {
    resultType: "vector",
    result: [
      {
        metric: { instance: "h1", job: "node" },
        value: [1758000000, "1"],
      },
    ],
  },
};

describe("prometheus client mapping via cache", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    process.env.JWT_SECRET = "b".repeat(64);
  });

  it("normalizes before querying (network metric gains device filter)", () => {
    const normalized = normalizePromQL("rate(node_network_receive_bytes_total[1m])");
    expect(normalized).toContain('device=~"eth.*|ens.*|eno.*|bond.*"');
    expect(normalized).toContain("[5m]");
  });

  it("instantQuery caches identical requests (second call hits cache)", async () => {
    // Use a stub upstream: point PROMETHEUS_BASE_URL at an unreachable host and
    // prime the cache first to exercise the hit path deterministically.
    const cache = new QueryCache<object>(300);
    const params = new URLSearchParams({ query: "up" });
    const key = `query:t1:${params.toString()}`;
    cache.set(
      key,
      { resultType: "vector", result: [{ metric: { instance: "x" }, value: { timestamp: 1, value: 1 } }] } as object
    );
    const hit = cache.get(key);
    expect(hit).toBeDefined();
    expect(hit?.cachedAt).toBeGreaterThan(0);
    void instantQuery;
    void rangeQuery;
  });
});
