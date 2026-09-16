import { request } from "undici";

/**
 * Upstream detection: users paste EITHER a Prometheus URL or a Grafana URL.
 * For Grafana we resolve the managed Prometheus datasource and build the
 * datasource-proxy base so `/api/v1/query(_range)` keeps working unchanged.
 */

export type UpstreamType = "prometheus" | "grafana";

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Grafana UI path segments — when a user pastes a dashboard/explore link we
 * cut back to the mount prefix so the API lives at <prefix>/api/...
 */
const GRAFANA_UI_SEGMENTS = new Set([
  "d",
  "dashboards",
  "explore",
  "alerting",
  "profile",
  "orgs",
  "connections",
  "admin",
  "onboarding",
  "login",
  "logout",
  "signup",
]);

export interface NormalizedUpstreamInput {
  /** Scheme + host + surviving mount prefix (no trailing slash). */
  base: string;
  /** True when an http:// scheme was added for a bare host[:port] paste. */
  addedScheme: boolean;
  /** True when a Grafana UI path / query string / fragment was stripped. */
  strippedUiPath: boolean;
}

/**
 * Accepts everything users actually paste:
 *  - bare `10.0.0.5:9090` or `prometheus.internal:9090` → http:// prefixed
 *  - Grafana dashboard links `https://host/monitor/d/<uid>/slug?orgId=1`
 *    → truncated to `https://host/monitor`
 *  - trailing slashes / query strings / fragments → stripped
 */
export function normalizeUpstreamInput(rawInput: string): NormalizedUpstreamInput {
  const candidate = rawInput.trim().replace(/\s+/g, "");
  const addedScheme = !SCHEME_RE.test(candidate);
  const withScheme = addedScheme ? `http://${candidate}` : candidate;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    // Not parseable even with a scheme — hand it back untouched; detection
    // will fail with a clear probe error.
    return { base: withScheme.replace(/\/+$/, ""), addedScheme, strippedUiPath: false };
  }
  const hadTail = parsed.search.length > 0 || parsed.hash.length > 0;
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const uiIndex = segments.findIndex((segment) => GRAFANA_UI_SEGMENTS.has(segment.toLowerCase()));
  const kept = uiIndex >= 0 ? segments.slice(0, uiIndex) : segments;
  const base = `${parsed.protocol}//${parsed.host}${kept.length > 0 ? `/${kept.join("/")}` : ""}`;
  return { base, addedScheme, strippedUiPath: uiIndex >= 0 || hadTail };
}

export interface DetectionResult {
  type: UpstreamType;
  /** Effective base URL to use for /api/v1/query(_range). */
  queryBaseUrl: string;
  /** Human-readable detail for the connect response. */
  detail: string;
}

export interface ProbeFn {
  (url: string, headers: Record<string, string>): Promise<{
    status: number;
    body: unknown;
  }>;
}

const DEFAULT_PROBE: ProbeFn = async (url, headers) => {
  const response = await request(url, {
    method: "GET",
    headers,
    bodyTimeout: 3000,
    headersTimeout: 3000,
  });
  const body: unknown = await response.body.json().catch(() => null);
  return { status: response.statusCode, body };
};

interface GrafanaDatasource {
  uid?: string;
  id?: number;
  type?: string;
  name?: string;
}

export interface DetectOptions {
  authToken?: string;
  probe?: ProbeFn;
}

/** Classifies a pasted URL and returns the query base for it. */
export async function detectUpstream(
  rawUrl: string,
  options: DetectOptions = {}
): Promise<DetectionResult> {
  const probe = options.probe ?? DEFAULT_PROBE;
  const normalized = normalizeUpstreamInput(rawUrl);
  const base = normalized.base;
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.authToken !== undefined && options.authToken.length > 0) {
    headers.authorization = `Bearer ${options.authToken}`;
  }

  // 1) Direct Prometheus probe — the cheapest signal.
  try {
    const prom = await probe(
      `${base}/api/v1/query?query=up`,
      headers
    );
    const body = prom.body as { status?: string } | null;
    if (prom.status === 200 && body?.status === "success") {
      return {
        type: "prometheus",
        queryBaseUrl: base,
        detail: "Direct Prometheus connection",
      };
    }
  } catch {
    // Not (reachable as) Prometheus — try Grafana below.
  }

  // 2) Grafana probe: /api/health returns {"database":"ok","version":...}.
  let grafanaReachable = false;
  try {
    const health = await probe(`${base}/api/health`, headers);
    const body = health.body as { version?: string; database?: string } | null;
    if (health.status === 200 && (body?.version !== undefined || body?.database !== undefined)) {
      grafanaReachable = true;
    }
  } catch {
    grafanaReachable = false;
  }

  if (grafanaReachable && options.authToken !== undefined && options.authToken.length > 0) {
    // Resolve a Prometheus datasource through Grafana's API.
    const ds = await probe(
      `${base}/api/datasources?type=prometheus`,
      headers
    );
    const list = Array.isArray(ds.body) ? (ds.body as GrafanaDatasource[]) : [];
    const promDs = list.find((d) => d.type === "prometheus") ?? list[0];
    if (promDs !== undefined && promDs.uid !== undefined) {
      return {
        type: "grafana",
        queryBaseUrl: `${base}/api/datasources/proxy/uid/${promDs.uid}`,
        detail: `Grafana detected — routing queries through datasource "${promDs.name ?? promDs.uid}"`,
      };
    }
    if (ds.status === 401 || ds.status === 403) {
      throw new Error(
        "Grafana detected but the token lacks datasource access — use a Grafana service-account token with Viewer+ permissions"
      );
    }
  }

  if (grafanaReachable) {
    throw new Error(
      "Grafana detected — provide a Grafana service-account token so the app can locate its Prometheus datasource"
    );
  }

  throw new Error(
    `URL is neither a reachable Prometheus nor a Grafana instance (probed ${base}) — check the URL/token and try again`
  );
}
