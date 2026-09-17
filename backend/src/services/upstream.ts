import { request } from "undici";

/**
 * Upstream detection: users paste EITHER a Prometheus URL or a Grafana URL.
 * For Grafana we resolve the managed Prometheus datasource and build the
 * datasource-proxy base so `/api/v1/query(_range)` keeps working unchanged.
 */

export type UpstreamType = "prometheus" | "grafana";

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/** Port that only makes sense for plain HTTP — used to decide https inference. */
const PLAIN_HTTP_PORTS = new Set(["", "80", "8080", "9090", "3000", "8000"]);

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
 *  - bare `prometheus.demo.prometheus.io` (no port/scheme) → https:// when the
 *    host is not loopback/private and carries no plain-HTTP port — public
 *    hosts virtually always serve TLS, and the detector still falls back to
 *    http:// if the https probe fails
 *  - `demo.prometheus.io/` or `https://demo.prometheus.io:9090/` → scheme,
 *    port and trailing slash all honored
 *  - Grafana dashboard links `https://host/monitor/d/<uid>/slug?orgId=1`
 *    → truncated to `https://host/monitor`
 *  - trailing slashes / query strings / fragments → stripped
 */
export function normalizeUpstreamInput(rawInput: string): NormalizedUpstreamInput {
  const candidate = rawInput.trim().replace(/\s+/g, "");
  const addedScheme = !SCHEME_RE.test(candidate);
  const inferredHttps =
    addedScheme &&
    shouldInferHttps(candidate);
  const prefix = addedScheme ? (inferredHttps ? "https://" : "http://") : "";
  const withScheme = `${prefix}${candidate}`;
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

/**
 * Heuristic for scheme-less pastes: loopback, *.local, private-range hosts
 * and explicit plain-HTTP ports stay http://; anything else (a public
 * hostname like prometheus.demo.prometheus.io) infers https://.
 */
function shouldInferHttps(candidate: string): boolean {
  if (PLAIN_HTTP_PORTS.has("") === false) {
    // Extract an explicit port if present (the last :segment after the host).
    const hostPart = candidate.split("/")[0] ?? candidate;
    const portMatch = /:(\d{1,5})$/.exec(hostPart);
    if (portMatch !== null && !PLAIN_HTTP_PORTS.has(portMatch[1] ?? "")) {
      return true; // e.g. :8443 — almost certainly TLS
    }
  }
  const host = candidate.split("/")[0]?.split(":")[0] ?? candidate;
  if (/^(localhost|127\.|\[::1\]|0\.0\.0\.0|::1)$/i.test(host)) {
    return false;
  }
  if (/\.(local|internal|lan|corp|home|intranet)$/i.test(host)) {
    return false;
  }
  // RFC1918 / link-local / container ranges.
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|172\.17\.)/.test(host)) {
    return false;
  }
  // Bare IPv4 without a port: likely an internal node — try http first.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return false;
  }
  return true; // public hostname with no port → TLS is the norm
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
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.authToken !== undefined && options.authToken.length > 0) {
    headers.authorization = `Bearer ${options.authToken}`;
  }

  // Scheme-less pastes get TWO candidate bases (https first, then http) so a
  // wrong inference never blocks the connection — the first base that
  // answers wins. Explicit-scheme pastes keep their single base.
  const candidateBases = normalized.addedScheme
    ? Array.from(
        new Set([
          normalized.base,
          normalized.base.startsWith("https://")
            ? `http://${normalized.base.slice("https://".length)}`
            : `https://${normalized.base.slice("http://".length)}`,
        ])
      )
    : [normalized.base];

  let lastProbeError: unknown = null;
  for (const base of candidateBases) {
    const detected = await detectOnBase(base, headers, probe, normalized.base);
    if (detected !== null) {
      return detected;
    }
  }
  throw new Error(
    `URL is neither a reachable Prometheus nor a Grafana instance (probed ${candidateBases.join(", ")})${
      lastProbeError instanceof Error ? ` — ${lastProbeError.message}` : ""
    } — check the URL/token and try again`
  );

  /** Probes one candidate base for Prometheus-ness, then Grafana-ness. */
  async function detectOnBase(
    base: string,
    headers: Record<string, string>,
    probe: ProbeFn,
    originalBase: string
  ): Promise<DetectionResult | null> {
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
        detail:
          base === originalBase
            ? "Direct Prometheus connection"
            : `Direct Prometheus connection (inferred ${new URL(base).protocol.replace(":", "")})`,
      };
    }
  } catch (error) {
    lastProbeError = error;
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

  return null; // this base answered as neither Prometheus nor Grafana
  }
}
