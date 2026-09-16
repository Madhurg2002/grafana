import { request } from "undici";
import { CircuitOpenError, getCircuitBreaker } from "./circuitBreaker.js";
import { getQueryCache } from "./cache.js";
import { getConnection } from "../db/schema.js";
import { decryptToken } from "../db/encryption.js";

/**
 * Prometheus HTTP client + PromQL safety normalizer.
 *
 * Targets `/api/v1/query` and `/api/v1/query_range` directly (no Grafana).
 * Every outgoing call is wrapped in the circuit breaker; successful payload
 * bodies are cached in the LRU cache (300s TTL) keyed by tenant+query+params.
 */

// ---------------------------------------------------------------------------
// PromQL safety laws (AGENTS.md)
// ---------------------------------------------------------------------------

export const PHYSICAL_DEVICE_FILTER = 'device=~"eth.*|ens.*|eno.*|bond.*"';
export const MEMORY_METRIC = "node_memory_MemAvailable_bytes";
export const FORBIDDEN_MEMORY_METRIC = "node_memory_MemFree_bytes";
export const MIN_RATE_WINDOW = "5m";

interface MetricSelector {
  metric: string;
  /** Matched braces content (without braces) or null when selector has none. */
  selector: string | null;
}

/** Finds the first `metric{...}` or bare `metric` selector in the query. */
export function findSelector(query: string, metricName: string): MetricSelector | null {
  const index = query.indexOf(metricName);
  if (index === -1) {
    return null;
  }
  // Ensure word boundary (avoid matching a superstring metric).
  const after = query[index + metricName.length];
  if (after && /[a-zA-Z0-9_:]/.test(after)) {
    // Try to find the exact metric further along (e.g. via aggregation args).
    const rest = query.slice(index + metricName.length);
    const nested = rest.indexOf(metricName);
    if (nested === -1) {
      return null;
    }
    return findSelectorFrom(query, index + metricName.length + nested, metricName);
  }
  return findSelectorFrom(query, index, metricName);
}

function findSelectorFrom(query: string, start: number, metricName: string): MetricSelector {
  const openBrace = query.indexOf("{", start);
  const metricEnd = start + metricName.length;
  if (openBrace === metricEnd) {
    const closeBrace = query.indexOf("}", openBrace);
    if (closeBrace === -1) {
      return { metric: metricName, selector: null };
    }
    return {
      metric: metricName,
      selector: query.slice(openBrace + 1, closeBrace),
    };
  }
  return { metric: metricName, selector: null };
}

function hasDeviceMatcher(selector: string): boolean {
  // Positive physical filter present?
  if (/device\s*=~\s*"(eth|ens|eno|bond)/.test(selector)) {
    return true;
  }
  // A negative matcher without a physical allow-list is a violation.
  return false;
}

function hasAnyDeviceMatcher(selector: string): boolean {
  return /device\s*[=!~]=?\s*["'`]/.test(selector) || /device\s*!=/.test(selector);
}

/**
 * Injects (or replaces) the physical device matcher on a metric selector.
 * NEVER emits `device!="lo"` alone — always the physical allow-list.
 */
function injectDeviceFilter(selector: string | null): string {
  if (selector === null) {
    return `{${PHYSICAL_DEVICE_FILTER}}`;
  }
  if (hasDeviceMatcher(selector)) {
    // Preserve the user's physical allow-list, normalized into braces.
    return `{${selector}}`;
  }
  if (hasAnyDeviceMatcher(selector)) {
    // Replace unsafe device matchers (e.g. device!="lo") with the safe list.
    const stripped = selector
      .replace(/,?\s*device\s*(!~|!=|=~|=)\s*"[^"]*"/g, "")
      .replace(/,\s*$/, "")
      .trim();
    const prefix = stripped.length > 0 ? `${stripped},` : "";
    return `{${prefix}${PHYSICAL_DEVICE_FILTER}}`;
  }
  const trimmed = selector.trim();
  const prefix = trimmed.length > 0 && trimmed !== "" ? `${trimmed},` : "";
  return `{${prefix}${PHYSICAL_DEVICE_FILTER}}`;
}

/** Enforces a minimum `[5m]` range on `rate(...)` calls. */
export function enforceRateWindow(query: string): string {
  // Match rate(<expr>[<window>]) including optional preceding whitespace.
  return query.replace(
    /rate\s*\(([^()[\]]*?)\[\s*([0-9]+(?:\.[0-9]+)?)(ms|s|m|h|d|w|y)\s*\]\s*\)/g,
    (match, expr: string, value: string, unit: string) => {
      const windowMs = toMillis(Number(value), unit);
      const minimumMs = toMillis(5, "m");
      if (windowMs >= minimumMs) {
        return match;
      }
      return `rate(${expr}[5m])`;
    }
  );
}

function toMillis(value: number, unit: string): number {
  const factors: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  };
  return value * (factors[unit] ?? 0);
}

/**
 * Applies ALL safety laws to a PromQL expression:
 *  1. Physical network scrubbing (`eth.*|ens.*|eno.*|bond.*`).
 *  2. `node_memory_MemFree_bytes` → `node_memory_MemAvailable_bytes`.
 *  3. Minimum `[5m]` range vector for every `rate()`.
 */
export function normalizePromQL(query: string): string {
  let normalized = query;

  // Law 2 — memory metric standardization (before selector surgery).
  normalized = normalized.replace(
    /node_memory_MemFree_bytes/g,
    MEMORY_METRIC
  );

  // Law 1 — physical device scrubbing on network metrics.
  for (const metric of [
    "node_network_receive_bytes_total",
    "node_network_transmit_bytes_total",
  ]) {
    if (!normalized.includes(metric)) {
      continue;
    }
    const found = findSelector(normalized, metric);
    if (found === null) {
      continue;
    }
    const bareMetricIndex = normalized.indexOf(metric);
    const safeSelector = injectDeviceFilter(found.selector);
    if (found.selector === null) {
      normalized =
        normalized.slice(0, bareMetricIndex + metric.length) +
        safeSelector +
        normalized.slice(bareMetricIndex + metric.length);
    } else {
      const start = normalized.indexOf(`{`, bareMetricIndex + metric.length);
      const end = normalized.indexOf(`}`, start);
      if (start !== -1 && end !== -1) {
        normalized =
          normalized.slice(0, start + 1) +
          safeSelector.slice(1, -1) +
          normalized.slice(end);
      }
    }
  }

  // Law 3 — minimum rate window.
  normalized = enforceRateWindow(normalized);

  return normalized;
}

// ---------------------------------------------------------------------------
// Prometheus HTTP client
// ---------------------------------------------------------------------------

export interface PromValue {
  timestamp: number;
  value: number;
}

export type PromResultValue =
  | { metric: Record<string, string>; value: PromValue }
  | { metric: Record<string, string>; values: PromValue[] };

export interface PromQueryResult {
  resultType: "vector" | "matrix" | "scalar" | "string";
  result: PromResultValue[];
}

export interface PromResponse {
  status: "success" | "error";
  data?: { resultType: string; result: unknown };
  errorType?: string;
  error?: string;
}

export interface QueryOptions {
  tenantId: string;
  query: string;
  time?: string;
}

export interface QueryRangeOptions extends QueryOptions {
  start: string;
  end: string;
  step: string;
}

export class PrometheusClientError extends Error {
  public readonly statusCode?: number;
  public constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "PrometheusClientError";
    this.statusCode = statusCode;
  }
}

function parsePromValue(pair: [number, string]): PromValue {
  return { timestamp: pair[0] * 1000, value: Number(pair[1]) };
}

interface RawResultItem {
  metric: Record<string, string>;
  value?: [number, string];
  values?: Array<[number, string]>;
}

function mapResult(raw: unknown): PromQueryResult {
  const data = raw as { resultType?: string; result?: RawResultItem[] };
  const resultType = (data.resultType ?? "vector") as PromQueryResult["resultType"];
  const result: PromResultValue[] = (data.result ?? []).map((item) => {
    if (item.values !== undefined) {
      return {
        metric: item.metric,
        values: item.values.map(parsePromValue),
      };
    }
    return {
      metric: item.metric,
      value: parsePromValue(item.value ?? [Date.now() / 1000, "0"]),
    };
  });
  return { resultType, result };
}

function toCacheKey(prefix: string, tenantId: string, params: URLSearchParams): string {
  return `${prefix}:${tenantId}:${params.toString()}`;
}

interface TenantUpstream {
  authHeader: string | null;
  baseUrl: string;
}

/** Resolves the per-tenant upstream: stored URL (Prometheus or Grafana proxy) + token. */
async function resolveTenantUpstream(tenantId: string): Promise<TenantUpstream> {
  const connection = await getConnection(tenantId);
  if (connection === null) {
    throw new PrometheusClientError(
      `No Prometheus connection for tenant "${tenantId}" — connect first via /api/connect`,
      409
    );
  }
  const authHeader =
    connection.auth_token_encrypted === null
      ? null
      : `Bearer ${decryptToken(
          connection.auth_token_encrypted,
          process.env.ENCRYPTION_KEY
        )}`;
  // Fallback: deployments predating per-tenant URLs use the env default.
  const baseUrl =
    connection.prometheus_url ?? process.env.PROMETHEUS_BASE_URL ?? "";
  if (baseUrl.length === 0) {
    throw new PrometheusClientError(
      "No upstream URL configured for this tenant or deployment",
      500
    );
  }
  return { authHeader, baseUrl: baseUrl.replace(/\/$/, "") };
}

async function promRequest(
  path: "/api/v1/query" | "/api/v1/query_range",
  params: URLSearchParams,
  tenantId: string
): Promise<PromResponse> {
  const upstream = await resolveTenantUpstream(tenantId);

  const breaker = getCircuitBreaker();
  try {
    return await breaker.execute(async () => {
      const headers: Record<string, string> = {
        accept: "application/json",
      };
      if (upstream.authHeader !== null) {
        headers.authorization = upstream.authHeader;
      }
      const url = `${upstream.baseUrl}${path}`;
      const response = await request(url, {
        method: "GET",
        headers,
        query: Object.fromEntries(params.entries()),
        bodyTimeout: 3000,
        headersTimeout: 3000,
      });

      if (response.statusCode >= 400) {
        await response.body.dump();
        throw new PrometheusClientError(
          `Prometheus responded with ${response.statusCode}`,
          response.statusCode
        );
      }
      const body = (await response.body.json()) as PromResponse;
      if (body.status === "error") {
        throw new PrometheusClientError(
          body.error ?? "Prometheus query error",
          response.statusCode
        );
      }
      return body;
    });
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      throw error;
    }
    if (error instanceof PrometheusClientError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "unknown error";
    throw new PrometheusClientError(`Upstream request failed — ${message}`);
  }
}

/** Instant query via `/api/v1/query` (cached, breaker-wrapped, normalized). */
export async function instantQuery(options: QueryOptions): Promise<{
  result: PromQueryResult;
  cached: boolean;
}> {
  const normalized = normalizePromQL(options.query);
  const params = new URLSearchParams({ query: normalized });
  if (options.time !== undefined) {
    params.set("time", options.time);
  }

  const cache = getQueryCache();
  const key = toCacheKey("query", options.tenantId, params);
  const hit = cache.get(key);
  if (hit !== undefined) {
    return { result: hit.value as PromQueryResult, cached: true };
  }

  const response = await promRequest("/api/v1/query", params, options.tenantId);
  const mapped = mapResult(response.data);
  cache.set(key, mapped as never);
  return { result: mapped, cached: false };
}

/** Range query via `/api/v1/query_range` (cached, breaker-wrapped, normalized). */
export async function rangeQuery(options: QueryRangeOptions): Promise<{
  result: PromQueryResult;
  cached: boolean;
}> {
  const normalized = normalizePromQL(options.query);
  const params = new URLSearchParams({
    query: normalized,
    start: options.start,
    end: options.end,
    step: options.step,
  });

  const cache = getQueryCache();
  const key = toCacheKey("query_range", options.tenantId, params);
  const hit = cache.get(key);
  if (hit !== undefined) {
    return { result: hit.value as PromQueryResult, cached: true };
  }

  const response = await promRequest("/api/v1/query_range", params, options.tenantId);
  const mapped = mapResult(response.data);
  cache.set(key, mapped as never);
  return { result: mapped, cached: false };
}

/** Probes `up` against a candidate Prometheus URL for onboarding checks. */
export async function probeUp(
  baseUrl: string,
  authToken?: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const breaker = getCircuitBreaker();
  const startedAt = Date.now();
  try {
    const response = await breaker.execute(async () => {
      const headers: Record<string, string> = { accept: "application/json" };
      if (authToken !== undefined && authToken.length > 0) {
        headers.authorization = `Bearer ${authToken}`;
      }
      const url = `${baseUrl.replace(/\/$/, "")}/api/v1/query`;
      const res = await request(url, {
        method: "GET",
        headers,
        query: { query: "up" },
        bodyTimeout: 3000,
        headersTimeout: 3000,
      });
      if (res.statusCode >= 400) {
        await res.body.dump();
        throw new PrometheusClientError(`Probe failed with ${res.statusCode}`, res.statusCode);
      }
      const body = (await res.body.json()) as PromResponse;
      if (body.status === "error") {
        throw new PrometheusClientError(body.error ?? "Probe query error");
      }
      return body;
    });
    return { ok: response.status === "success", latencyMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, latencyMs: Date.now() - startedAt, error: message };
  }
}
