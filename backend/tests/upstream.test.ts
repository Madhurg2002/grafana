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
    expect(result.base).toBe("https://::::"); // https inferred (no usable host)
  });

  describe("scheme inference", () => {
    it("infers https for public hostnames without a scheme or port", () => {
      expect(normalizeUpstreamInput("prometheus.demo.prometheus.io").base).toBe(
        "https://prometheus.demo.prometheus.io"
      );
    });

    it("keeps http for private ranges, loopback, and bare IPv4", () => {
      expect(normalizeUpstreamInput("10.0.0.5:9090").base).toBe("http://10.0.0.5:9090");
      expect(normalizeUpstreamInput("localhost:9090").base).toBe("http://localhost:9090");
      expect(normalizeUpstreamInput("192.168.1.10:9090").base).toBe("http://192.168.1.10:9090");
      expect(normalizeUpstreamInput("prometheus.internal").base).toBe("http://prometheus.internal");
    });

    it("honors an explicit https scheme verbatim", () => {
      const result = normalizeUpstreamInput("https://prom.example.com");
      expect(result.base).toBe("https://prom.example.com");
      expect(result.addedScheme).toBe(false);
    });
  });

  describe("detectUpstream — scheme fallback", () => {
    it("falls back to http when the inferred https base is dead", async () => {
      const probe: ProbeFn = async (url) => {
        if (url.startsWith("https://")) {
          throw new Error("TLS handshake failed");
        }
        return {
          status: 200,
          body: { status: "success", data: { resultType: "vector", result: [] } },
        };
      };
      const result = await detectUpstream("prometheus.demo.prometheus.io", { probe });
      expect(result.type).toBe("prometheus");
      expect(result.queryBaseUrl).toBe("http://prometheus.demo.prometheus.io");
      expect(result.detail).toContain("inferred http");
    });

    it("prefers the inferred https base when it answers", async () => {
      const seen: string[] = [];
      const probe: ProbeFn = async (url) => {
        seen.push(url);
        return {
          status: 200,
          body: { status: "success", data: { resultType: "vector", result: [] } },
        };
      };
      const result = await detectUpstream("prometheus.demo.prometheus.io", { probe });
      expect(result.type).toBe("prometheus");
      expect(result.queryBaseUrl).toBe("https://prometheus.demo.prometheus.io");
      expect(seen[0]?.startsWith("https://")).toBe(true);
    });
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
