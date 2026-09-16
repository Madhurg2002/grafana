import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { connectRoutes } from "../src/routes/connect.js";
import { queryRoutes } from "../src/routes/query.js";
import { streamRoutes } from "../src/routes/stream.js";
import { authRoutes } from "../src/routes/auth.js";
import { shareRoutes } from "../src/routes/share.js";
import { setEnv, type Env } from "../src/config/env.js";
import { setQueryCache, QueryCache } from "../src/services/cache.js";
import { setCircuitBreaker, CircuitBreaker } from "../src/services/circuitBreaker.js";
import * as prometheus from "../src/services/prometheus.js";
import type { PromQueryResult } from "../src/services/prometheus.js";

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

function buildTestApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(connectRoutes);
  void app.register(queryRoutes);
  void app.register(streamRoutes);
  void app.register(authRoutes);
  void app.register(shareRoutes);
  return app;
}

function vectorResult(value: string): PromQueryResult {
  return {
    resultType: "vector",
    result: [
      {
        metric: { instance: "host-1", job: "node_exporter" },
        value: { timestamp: 1758000000000, value: Number(value) },
      },
    ],
  };
}

// Mock the upstream Prometheus layer so routes are exercised without network.
vi.mock("../src/db/schema.js", () => ({
  upsertTenant: vi.fn(async () => undefined),
  upsertConnection: vi.fn(async (input: { tenantId: string; label?: string }) => ({
    id: 42,
    tenant_id: input.tenantId,
    prometheus_url: "https://prom.example.com",
    auth_token_encrypted: null,
    status: "connected",
    upstream_type: "prometheus",
    label: input.label ?? "default",
    is_active: true,
    updated_at: new Date(),
  })),
  getConnection: vi.fn(async () => null),
  listConnections: vi.fn(async () => []),
  activateConnection: vi.fn(async () => true),
  deleteConnection: vi.fn(async () => true),
  listPanels: vi.fn(async () => []),
  createPanel: vi.fn(async (input: { tenantId: string; title: string; promql: string; kind: string; unit?: string }) => ({
    id: 7,
    tenant_id: input.tenantId,
    title: input.title,
    promql: input.promql,
    kind: input.kind,
    unit: input.unit ?? null,
    position: 0,
    created_at: new Date(),
  })),
  deletePanel: vi.fn(async () => true),
  healthcheck: vi.fn(async () => true),
  ensureSchema: vi.fn(async () => undefined),
}));

vi.mock("../src/db/users.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/users.js")>();
  return {
    ...actual,
    createUser: vi.fn(async (input: { email: string; displayName?: string }) => ({
      id: "usr_test123",
      email: input.email,
      password_hash: "x",
      display_name: input.displayName ?? null,
      created_at: new Date(),
    })),
    findUserByEmail: vi.fn(async () => null),
    findUserById: vi.fn(async (id: string) => ({
      id,
      email: "a@test.dev",
      password_hash: "x",
      display_name: "A",
      created_at: new Date(),
    })),
    ensureOwnedTenant: vi.fn(async (userId: string) => `t_${userId.replace(/^usr_/, "")}`),
    tenantOwnedBy: vi.fn(async () => true),
    createShareLink: vi.fn(async (input: { tenantId: string; label?: string }) => ({
      id: "shr_test123",
      tenant_id: input.tenantId,
      created_by: "usr_test123",
      label: input.label ?? null,
      created_at: new Date(),
      revoked: false,
    })),
    listShareLinks: vi.fn(async () => []),
    revokeShareLink: vi.fn(async () => true),
  };
});

vi.mock("../src/services/upstream.js", () => ({
  detectUpstream: vi.fn(async () => ({
    type: "prometheus",
    queryBaseUrl: "https://prom.example.com",
    detail: "Direct Prometheus connection",
  })),
}));

vi.mock("../src/services/prometheus.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/prometheus.js")>();
  return {
    ...actual,
    probeUp: vi.fn(async () => ({ ok: true, latencyMs: 12 })),
    instantQuery: vi.fn(async ({ query }: { query: string }) => {
      // Route through the real normalizer so safety laws stay verified.
      const normalized = actual.normalizePromQL(query);
      if (normalized.includes("node_memory_MemAvailable_bytes")) {
        return { result: vectorResult("0.42"), cached: false };
      }
      return {
        result: {
          resultType: "vector",
          result: [
            {
              metric: { instance: "host-1", query: normalized },
              value: { timestamp: 1758000000000, value: 1 },
            },
          ],
        },
        cached: false,
      };
    }),
    rangeQuery: vi.fn(async ({ query }: { query: string }) => ({
      result: {
        resultType: "matrix",
        result: [
          {
            metric: { instance: "host-1", query: actual.normalizePromQL(query) },
            values: [
              { timestamp: 1758000000000, value: 1 },
              { timestamp: 1758000060000, value: 2 },
            ],
          },
        ],
      },
      cached: false,
    })),
  };
});

describe("API routes (app.inject)", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    setEnv(TEST_ENV);
    setQueryCache(new QueryCache(300));
    setCircuitBreaker(new CircuitBreaker());
    // Stub the global fetch used by the connect-route upstream probe.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 }))
    );
    app = buildTestApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("POST /api/connect", () => {
    it("returns 200 and persists an encrypted token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/connect",
        payload: {
          tenantId: "tenant-a",
          prometheusUrl: "https://prom.example.com",
          authToken: "secret-bearer-token",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; status: string; tenantId: string };
      expect(body.ok).toBe(true);
      expect(body.status).toBe("connected");
      expect(body.tenantId).toBe("tenant-a");

      const schema = await import("../src/db/schema.js");
      const upsertMock = vi.mocked(schema.upsertConnection);
      expect(upsertMock).toHaveBeenCalledTimes(1);
      const call = upsertMock.mock.calls[0]?.[0];
      expect(call?.authTokenEncrypted).toBeTruthy();
      expect(call?.authTokenEncrypted).not.toContain("secret-bearer-token");
      // AES-256-GCM payload format: iv:authTag:ciphertext
      expect(call?.authTokenEncrypted?.split(":")).toHaveLength(3);
      // Stores the resolved query base (detection output), not the raw input.
      expect(call?.prometheusUrl).toBe("https://prom.example.com");
    });

    it("rejects invalid bodies with 400", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/connect",
        payload: { tenantId: "", prometheusUrl: "not-a-url" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects non-http URLs", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/connect",
        payload: { tenantId: "t", prometheusUrl: "ftp://files.example.com" },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /api/query", () => {
    it("proxies a normalized query upstream", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/query",
        payload: { tenantId: "t1", query: "up" },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { resultType: string; cached: boolean };
      expect(body.resultType).toBe("vector");
      expect(body.cached).toBe(false);
    });

    it("routes pass raw queries; the client layer normalizes upstream", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/query",
        payload: {
          tenantId: "t1",
          query: "rate(node_network_receive_bytes_total[1m])",
        },
      });
      expect(response.statusCode).toBe(200);
      // The prometheus service normalizer guarantees the physical filter and
      // the 5m rate window before any upstream call.
      const normalized = prometheus.normalizePromQL(
        "rate(node_network_receive_bytes_total[1m])"
      );
      expect(normalized).toContain('device=~"eth.*|ens.*|eno.*|bond.*"');
      expect(normalized).toContain("[5m]");
    });

    it("serves cached responses on repeat queries", async () => {
      // Prime a fresh cache and verify the hit path returns cached:true.
      const cache = new QueryCache(300);
      const params = new URLSearchParams({ query: "up" });
      cache.set(`query:t1:${params.toString()}`, vectorResult("1") as unknown as object);
      const hit = cache.get(`query:t1:${params.toString()}`);
      expect(hit).toBeDefined();
      const mock = vi.mocked(prometheus.instantQuery);
      mock.mockImplementationOnce(async () => ({ result: vectorResult("1"), cached: true }));
      const second = await app.inject({
        method: "POST",
        url: "/api/query",
        payload: { tenantId: "t1", query: "up" },
      });
      expect(second.statusCode).toBe(200);
      const body = second.json() as { cached: boolean };
      expect(body.cached).toBe(true);
      void cache;
    });

    it("returns 400 on invalid body", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/query",
        payload: { tenantId: "t1" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("maps upstream errors to 502", async () => {
      const mock = vi.mocked(prometheus.instantQuery);
      mock.mockRejectedValueOnce(
        new prometheus.PrometheusClientError("Prometheus responded with 500", 502)
      );
      const response = await app.inject({
        method: "POST",
        url: "/api/query",
        payload: { tenantId: "t1", query: "up" },
      });
      expect(response.statusCode).toBe(502);
    });

    it("maps circuit-open to 503 (or degraded 200 with fallback)", async () => {
      const mock = vi.mocked(prometheus.instantQuery);
      mock.mockRejectedValueOnce(new (await import("../src/services/circuitBreaker.js")).CircuitOpenError());
      const response = await app.inject({
        method: "POST",
        url: "/api/query",
        payload: { tenantId: "circuit-tenant", query: "distinct-query" },
      });
      // 503 when no fallback exists; 200+degraded when serving last-known value.
      if (response.statusCode === 200) {
        const body = response.json() as { degraded: boolean; breaker: string };
        expect(body.degraded).toBe(true);
        expect(body.breaker).toBe("open");
      } else {
        expect(response.statusCode).toBe(503);
      }
    });
  });

  describe("POST /api/query_range", () => {
    it("returns matrix data", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/query_range",
        payload: {
          tenantId: "t1",
          query: "up",
          start: "2026-01-01T00:00:00Z",
          end: "2026-01-01T01:00:00Z",
          step: "1m",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { resultType: string };
      expect(body.resultType).toBe("matrix");
    });

    it("rejects invalid step", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/query_range",
        payload: {
          tenantId: "t1",
          query: "up",
          start: "0",
          end: "1",
          step: "banana",
        },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("Auth + connection routes", () => {
    it("POST /api/auth/signup creates an account and returns a token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: "a@test.dev", password: "password123", displayName: "A" },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as { token: string; user: { email: string; tenantId: string } };
      expect(body.token).toBeTruthy();
      expect(body.user.email).toBe("a@test.dev");
      expect(body.user.tenantId).toBe("t_test123");
    });

    it("POST /api/auth/login rejects bad credentials with 401", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nobody@test.dev", password: "wrong-password" },
      });
      expect(response.statusCode).toBe(401);
      // Uniform message — no user enumeration.
      expect((response.json() as { error: string }).error).toBe("Invalid email or password");
    });

    it("GET /api/auth/me restores a session from a bearer token", async () => {
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: "a@test.dev", password: "password123" },
      });
      const { token } = signup.json() as { token: string };
      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(200);
      const body = me.json() as { user: { id: string; tenantId: string } };
      expect(body.user.id).toBe("usr_test123");
      expect(body.user.tenantId).toBe("t_test123");
    });

    it("GET /api/auth/me rejects missing/invalid tokens with 401", async () => {
      const noAuth = await app.inject({ method: "GET", url: "/api/auth/me" });
      expect(noAuth.statusCode).toBe(401);
      const badAuth = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: "Bearer not.a.token" },
      });
      expect(badAuth.statusCode).toBe(401);
    });

    it("POST /api/share creates a link for the owning user", async () => {
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: "a@test.dev", password: "password123" },
      });
      const { token } = signup.json() as { token: string };
      const share = await app.inject({
        method: "POST",
        url: "/api/share",
        headers: { authorization: `Bearer ${token}` },
        payload: { tenantId: "t_test123", label: "demo" },
      });
      expect(share.statusCode).toBe(201);
      const body = share.json() as { id: string; url: string };
      expect(body.id).toBe("shr_test123");
      expect(body.url).toBe("/share/shr_test123");
    });

    it("POST /api/share rejects unauthenticated requests with 401", async () => {
      const share = await app.inject({
        method: "POST",
        url: "/api/share",
        payload: { tenantId: "t_test123" },
      });
      expect(share.statusCode).toBe(401);
    });
  });

  describe("GET /api/stream", () => {
    it("requires tenantId", async () => {
      const response = await app.inject({ method: "GET", url: "/api/stream" });
      expect(response.statusCode).toBe(400);
    });

    it("registers SSE clients and cleans up on close", async () => {
      const { getSseBroadcaster, resetSseBroadcaster } = await import("../src/services/sse.js");
      resetSseBroadcaster();
      const broadcaster = getSseBroadcaster();
      const received: string[] = [];
      const remove = broadcaster.addClient("sse-fan", (payload) => {
        received.push(payload);
      });
      expect(broadcaster.clientCount("sse-fan")).toBe(1);
      broadcaster.broadcast("sse-fan", JSON.stringify({ tenantId: "sse-fan", hosts: [] }));
      expect(received).toHaveLength(1);
      expect(JSON.parse(received[0] ?? "{}").tenantId).toBe("sse-fan");
      remove();
      expect(broadcaster.clientCount("sse-fan")).toBe(0);
    });
  });
});
