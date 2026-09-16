import { describe, it, expect } from "vitest";
import {
  normalizePromQL,
  enforceRateWindow,
  findSelector,
  PHYSICAL_DEVICE_FILTER,
  MEMORY_METRIC,
  FORBIDDEN_MEMORY_METRIC,
} from "../src/services/prometheus.js";

describe("promql normalizer — physical device scrubbing", () => {
  it("injects the physical filter on bare network metrics", () => {
    const out = normalizePromQL("rate(node_network_receive_bytes_total[5m])");
    expect(out).toContain(PHYSICAL_DEVICE_FILTER);
    expect(out).toBe(
      'rate(node_network_receive_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])'
    );
  });

  it("injects the filter on selectors without device matchers", () => {
    const out = normalizePromQL(
      'node_network_transmit_bytes_total{job="node"}'
    );
    expect(out).toBe(
      `node_network_transmit_bytes_total{job="node",${PHYSICAL_DEVICE_FILTER}}`
    );
  });

  it("replaces unsafe device!=\"lo\" with the physical allow-list", () => {
    const out = normalizePromQL(
      'rate(node_network_receive_bytes_total{device!="lo"}[5m])'
    );
    expect(out).toContain(PHYSICAL_DEVICE_FILTER);
    expect(out).not.toContain('device!="lo"');
  });

  it("preserves an existing physical filter without duplicating it", () => {
    const q = 'node_network_receive_bytes_total{device=~"eth.*"}';
    expect(normalizePromQL(q)).toBe(q);
  });

  it("handles both receive and transmit metrics in one query", () => {
    const out = normalizePromQL(
      "rate(node_network_receive_bytes_total[5m]) + rate(node_network_transmit_bytes_total[5m])"
    );
    expect(out.match(/eth\.\*\|ens\.\*\|eno\.\*\|bond\.\*/g) ?? []).toHaveLength(2);
  });

  it("leaves non-network queries untouched by device law", () => {
    const q = "up";
    expect(normalizePromQL(q)).toBe("up");
  });
});

describe("promql normalizer — memory metric law", () => {
  it("rewrites MemFree to MemAvailable", () => {
    const out = normalizePromQL(FORBIDDEN_MEMORY_METRIC);
    expect(out).toBe(MEMORY_METRIC);
    expect(out).not.toContain("MemFree");
  });

  it("rewrites MemFree inside functions", () => {
    const out = normalizePromQL("1 - (node_memory_MemFree_bytes / node_memory_MemTotal_bytes)");
    expect(out).toContain(MEMORY_METRIC);
    expect(out).not.toContain(FORBIDDEN_MEMORY_METRIC);
  });
});

describe("promql normalizer — rate window law", () => {
  it("upgrades sub-5m rate windows to [5m]", () => {
    expect(enforceRateWindow("rate(up[1m])")).toBe("rate(up[5m])");
    expect(enforceRateWindow("rate(up[30s])")).toBe("rate(up[5m])");
    expect(enforceRateWindow("rate(up[2m])")).toBe("rate(up[5m])");
  });

  it("keeps windows of 5m or larger", () => {
    expect(enforceRateWindow("rate(up[5m])")).toBe("rate(up[5m])");
    expect(enforceRateWindow("rate(up[10m])")).toBe("rate(up[10m])");
    expect(enforceRateWindow("rate(up[1h])")).toBe("rate(up[1h])");
  });

  it("normalizes rate windows through the full normalizer", () => {
    const out = normalizePromQL("rate(node_network_receive_bytes_total[1m])");
    expect(out).toContain("[5m]");
    expect(out).toContain(PHYSICAL_DEVICE_FILTER);
  });
});

describe("findSelector", () => {
  it("locates a selector with braces", () => {
    const found = findSelector('sum by (job) (node_network_receive_bytes_total{a="b"})',
      "node_network_receive_bytes_total");
    expect(found?.selector).toBe('a="b"');
  });

  it("returns null selector for bare metrics", () => {
    const found = findSelector("node_network_receive_bytes_total", "node_network_receive_bytes_total");
    expect(found?.selector).toBeNull();
  });

  it("returns null when the metric is absent", () => {
    expect(findSelector("up", "node_network_receive_bytes_total")).toBeNull();
  });
});
