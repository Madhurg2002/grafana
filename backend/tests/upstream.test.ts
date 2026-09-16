import { describe, it, expect, vi } from "vitest";
import { detectUpstream, normalizeUpstreamInput, type ProbeFn } from "../src/services/upstream.js";

/**
 * Builds a ProbeFn from a simple routing table so each scenario can simulate
 * Prometheus-only hosts, Grafana-only hosts, and dual-purpose hosts.
 */
function probeRouter(routes: Record<string, { status: number; body: unknown }>): ProbeFn {
  return async (url) => {
    for (const [suffix, response] of Object.entries(routes)) {
      if (url.includes(suffix)) {
        return { status: response.status, body: response.body };
      }
    }
    throw new Error(`unrouted probe: ${url}`);
  };
}

const PROM_BODY = { status: "success", data: { resultType: "vector", result: [] } };
const GRAFANA_HEALTH = { database: "ok", version: "10.4.0" };
const DS_LIST = [
  { uid: "prom-uid-1", id: 1, type: "prometheus", name: "Prometheus" },
  { uid: "loki-uid", id: 2, type: "loki", name: "Loki" },
];

describe("detectUpstream — direct Prometheus", () => {
  it("classifies a reachable Prometheus and returns it as the query base", async () => {
    const detection = await detectUpstream("https://prom.example.com", {
      probe: probeRouter({ "/api/v1/query": { status: 200, body: PROM_BODY } }),
    });
    expect(detection.type).toBe("prometheus");
    expect(detection.queryBaseUrl).toBe("https://prom.example.com");
    expect(detection.detail).toContain("Direct Prometheus");
  });

  it("prefers Prometheus when a host serves both APIs", async () => {
    const detection = await detectUpstream("https://dual.example.com", {
      probe: probeRouter({
        "/api/v1/query": { status: 200, body: PROM_BODY },
        "/api/health": { status: 200, body: GRAFANA_HEALTH },
      }),
    });
    expect(detection.type).toBe("prometheus");
  });

  it("rejects a host whose /api/v1/query returns success=false", async () => {
    await expect(
      detectUpstream("https://broken.example.com", {
        probe: probeRouter({ "/api/v1/query": { status: 200, body: { status: "error" } } }),
      })
    ).rejects.toThrow(/neither a reachable Prometheus nor a Grafana/i);
  });
});

describe("detectUpstream — Grafana", () => {
  it("resolves the Prometheus datasource through the proxy path", async () => {
    const detection = await detectUpstream("https://grafana.example.com", {
      authToken: "sa-token",
      probe: probeRouter({
        "/api/health": { status: 200, body: GRAFANA_HEALTH },
        "/api/datasources": { status: 200, body: DS_LIST },
      }),
    });
    expect(detection.type).toBe("grafana");
    expect(detection.queryBaseUrl).toBe(
      "https://grafana.example.com/api/datasources/proxy/uid/prom-uid-1"
    );
    expect(detection.detail).toContain("Prometheus");
  });

  it("falls back to the first datasource when none is typed prometheus", async () => {
    const detection = await detectUpstream("https://grafana.example.com", {
      authToken: "sa-token",
      probe: probeRouter({
        "/api/health": { status: 200, body: GRAFANA_HEALTH },
        "/api/datasources": { status: 200, body: [{ uid: "ds-any", type: "prometheus" }] },
      }),
    });
    expect(detection.type).toBe("grafana");
    expect(detection.queryBaseUrl).toContain("/proxy/uid/ds-any");
  });

  it("requires a service-account token when Grafana has auth enabled", async () => {
    await expect(
      detectUpstream("https://grafana.example.com", {
        probe: probeRouter({
          "/api/health": { status: 200, body: GRAFANA_HEALTH },
          "/api/datasources": { status: 401, body: { message: "Unauthorized" } },
        }),
      })
    ).rejects.toThrow(/service-account token|token lacks datasource access/i);
  });

  it("reports a clear error when Grafana exposes no usable datasource", async () => {
    await expect(
      detectUpstream("https://grafana.example.com", {
        authToken: "sa-token",
        probe: probeRouter({
          "/api/health": { status: 200, body: GRAFANA_HEALTH },
          "/api/datasources": { status: 200, body: [] },
        }),
      })
    ).rejects.toThrow(/Grafana detected/i);
  });
});

describe("normalizeUpstreamInput", () => {
  it("prefixes http:// for bare ip:port pastes", () => {
    const result = normalizeUpstreamInput("10.32.3.119:9090");
    expect(result.base).toBe("http://10.32.3.119:9090");
    expect(result.addedScheme).toBe(true);
  });

  it("strips Grafana dashboard paths back to the mount prefix", () => {
    const result = normalizeUpstreamInput(
      "https://onexaura.com/monitor/d/fbq7qzu9zopvkc/node-exporter?orgId=1&refresh=5m"
    );
    expect(result.base).toBe("https://onexaura.com/monitor");
    expect(result.strippedUiPath).toBe(true);
  });

  it("handles root-level Grafana dashboard links", () => {
    expect(normalizeUpstreamInput("https://g.example.com/d/abcde/dashboard").base).toBe(
      "https://g.example.com"
    );
  });

  it("keeps genuine sub-path mounts intact", () => {
    expect(normalizeUpstreamInput("https://ops.example.com/prom/").base).toBe(
      "https://ops.example.com/prom"
    );
  });

  it("trims whitespace and trailing slashes", () => {
    expect(normalizeUpstreamInput("  https://prom.example.com/  ").base).toBe(
      "https://prom.example.com"
    );
  });

  it("returns unparseable input for probing to fail with a clear error", () => {
    const result = normalizeUpstreamInput("::::");
    expect(result.base).toBe("http://::::");
  });
});

describe("detectUpstream — unreachable hosts", () => {
  it("fails with a clear message for dead URLs", async () => {
    await expect(
      detectUpstream("https://void.example.com", {
        probe: async () => {
          throw new Error("ECONNREFUSED");
        },
      })
    ).rejects.toThrow(/neither a reachable Prometheus nor a Grafana/i);
  });
});
