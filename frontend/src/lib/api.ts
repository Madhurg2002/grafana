/**
 * Typed fetch wrapper for the backend proxy API.
 */

export interface QueryResponseBody {
  resultType: string;
  result: unknown[];
  cached: boolean;
  query: string;
  breaker?: string;
  degraded?: boolean;
  error?: string;
}

export interface ConnectResponse {
  ok: boolean;
  tenantId: string;
  status: "connected" | "error";
  latencyMs: number;
  upstreamType?: "prometheus" | "grafana";
  detail?: string;
  error?: string;
}

export interface ConnectionInfo {
  tenantId: string;
  status: "connected" | "error" | "unknown";
  upstreamType: "prometheus" | "grafana";
  upstreamHost: string | null;
  updatedAt: string;
}

export interface QueryRequest {
  tenantId: string;
  query: string;
  time?: string;
}

export interface QueryRangeRequest extends QueryRequest {
  start: string;
  end: string;
  step: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";

/** Base URL of the backend API (empty in dev — Vite proxy handles /api). */
export function apiBase(): string {
  return API_BASE.replace(/\/$/, "");
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return payload;
}

export function connectTenant(
  tenantId: string,
  prometheusUrl: string,
  authToken?: string,
  upstreamType?: "prometheus" | "grafana"
): Promise<ConnectResponse> {
  return postJson<ConnectResponse>("/api/connect", {
    tenantId,
    prometheusUrl,
    ...(authToken !== undefined && authToken.length > 0 ? { authToken } : {}),
    ...(upstreamType !== undefined ? { upstreamType } : {}),
  });
}

export function fetchConnectionInfo(tenantId: string): Promise<ConnectionInfo> {
  return authedJson<ConnectionInfo>(
    `/api/connection/${encodeURIComponent(tenantId)}`
  );
}

export function instantQuery(request: QueryRequest): Promise<QueryResponseBody> {
  return postJson<QueryResponseBody>("/api/query", request);
}

export function rangeQuery(request: QueryRangeRequest): Promise<QueryResponseBody> {
  return postJson<QueryResponseBody>("/api/query_range", request);
}

// ---------------------------------------------------------------------------
// Auth (email + password sessions; token kept in localStorage)
// ---------------------------------------------------------------------------

const TOKEN_KEY = "passthrough.token";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  tenantId: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) {
      localStorage.removeItem(TOKEN_KEY);
    } else {
      localStorage.setItem(TOKEN_KEY, token);
    }
  } catch {
    // Storage unavailable (private mode) — session lives for the tab only.
  }
}

async function authedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return payload;
}

export function signup(email: string, password: string, displayName?: string): Promise<AuthResponse> {
  return postJson<AuthResponse>("/api/auth/signup", {
    email,
    password,
    ...(displayName !== undefined && displayName.length > 0 ? { displayName } : {}),
  });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return postJson<AuthResponse>("/api/auth/login", { email, password });
}

export type ShareAccess =
  | "anyone_view"
  | "anyone_edit"
  | "email_view"
  | "email_edit";

export interface ShareLink {
  id: string;
  url: string;
  label: string;
  createdAt: string;
  access?: ShareAccess;
  allowedEmails?: string[];
  invited?: string[];
  skipped?: string[];
}

export function createShareLink(
  tenantId: string,
  label?: string,
  access?: ShareAccess,
  allowedEmails?: string[],
  invite?: boolean
): Promise<ShareLink> {
  return authedJson<ShareLink>("/api/share", {
    method: "POST",
    body: JSON.stringify({
      tenantId,
      ...(label !== undefined ? { label } : {}),
      ...(access !== undefined ? { access } : {}),
      ...(allowedEmails !== undefined && allowedEmails.length > 0
        ? { allowedEmails }
        : {}),
      ...(invite === true ? { invite: true } : {}),
    }),
  });
}

export interface ShareViewPayload {
  tenantId: string;
  label: string | null;
  createdAt: string;
  metrics: {
    hosts: Array<{ instance: string; job: string; up: number }>;
    hostsUp: number;
    hostsTotal: number;
    cpuPercent: number | null;
    ramPercent: number | null;
    networkRxSeries: Array<{ label: string; points: Array<{ timestamp: number; value: number }> }>;
    networkTxSeries: Array<{ label: string; points: Array<{ timestamp: number; value: number }> }>;
  };
  generatedAt: string;
  access?: ShareAccess;
  canEdit?: boolean;
}

export function fetchShareView(id: string, viewToken?: string): Promise<ShareViewPayload> {
  return authedJson<ShareViewPayload>(
    `/api/share/${encodeURIComponent(id)}/view`,
    viewToken !== undefined ? { headers: { authorization: `Bearer ${viewToken}` } } : {}
  );
}

export function fetchShareAccessToken(id: string): Promise<{ token: string; email: string; canEdit: boolean }> {
  return authedJson<{ token: string; email: string; canEdit: boolean }>(
    `/api/share/${encodeURIComponent(id)}/access-token`,
    { method: "POST" }
  );
}

// ---------------------------------------------------------------------------
// Multi-connection management (store several URIs, switch without reconnect)
// ---------------------------------------------------------------------------

export interface ConnectionSummary {
  id: number;
  label: string;
  status: "connected" | "error" | "unknown";
  upstreamType: "prometheus" | "grafana";
  upstreamHost: string | null;
  isActive: boolean;
  hasToken: boolean;
  updatedAt: string;
}

export function listConnections(tenantId: string): Promise<{ connections: ConnectionSummary[] }> {
  return authedJson<{ connections: ConnectionSummary[] }>(
    `/api/connections/${encodeURIComponent(tenantId)}`
  );
}

export function activateConnection(
  tenantId: string,
  id: number
): Promise<{ activated: boolean; id: number; label: string }> {
  return authedJson<{ activated: boolean; id: number; label: string }>(
    `/api/connections/${encodeURIComponent(tenantId)}/${id}/activate`,
    { method: "POST" }
  );
}

export function deleteConnection(tenantId: string, id: number): Promise<{ removed: boolean }> {
  return authedJson<{ removed: boolean }>(
    `/api/connections/${encodeURIComponent(tenantId)}/${id}`,
    { method: "DELETE" }
  );
}

export function connectWithLabel(
  tenantId: string,
  prometheusUrl: string,
  options: { authToken?: string; label?: string } = {}
): Promise<ConnectResponse> {
  return authedJson<ConnectResponse>("/api/connect", {
    method: "POST",
    body: JSON.stringify({
      tenantId,
      prometheusUrl,
      ...(options.label !== undefined && options.label.length > 0
        ? { label: options.label }
        : {}),
      ...(options.authToken !== undefined && options.authToken.length > 0
        ? { authToken: options.authToken }
        : {}),
    }),
  });
}

// ---------------------------------------------------------------------------
// Custom dashboard panels (user-defined views)
// ---------------------------------------------------------------------------

export type PanelKind = "sparkline" | "gauge" | "stat";

export interface DashboardPanel {
  id: number;
  tenant_id: string;
  title: string;
  promql: string;
  kind: PanelKind;
  unit: string | null;
  position: number;
  created_at: string;
}

export function listPanels(tenantId: string): Promise<{ panels: DashboardPanel[] }> {
  return authedJson<{ panels: DashboardPanel[] }>(
    `/api/panels/${encodeURIComponent(tenantId)}`
  );
}

export function createPanel(
  tenantId: string,
  panel: { title: string; promql: string; kind: PanelKind; unit?: string }
): Promise<{ panel: DashboardPanel }> {
  return authedJson<{ panel: DashboardPanel }>(
    `/api/panels/${encodeURIComponent(tenantId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        title: panel.title,
        promql: panel.promql,
        kind: panel.kind,
        ...(panel.unit !== undefined && panel.unit.length > 0 ? { unit: panel.unit } : {}),
      }),
    }
  );
}

export function deletePanel(tenantId: string, id: number): Promise<{ removed: boolean }> {
  return authedJson<{ removed: boolean }>(
    `/api/panels/${encodeURIComponent(tenantId)}/${id}`,
    { method: "DELETE" }
  );
}

export function reorderPanel(tenantId: string, id: number, position: number): Promise<{ ok: boolean }> {
  return authedJson<{ ok: boolean }>(
    `/api/panels/${encodeURIComponent(tenantId)}/${id}/reorder`,
    { method: "POST", body: JSON.stringify({ position }) }
  );
}

// ---------------------------------------------------------------------------
// PromQL helper — metric catalog, label values, curated recipes
// ---------------------------------------------------------------------------

export function fetchMetricNames(tenantId: string): Promise<{ names: string[]; cached: boolean }> {
  return authedJson<{ names: string[]; cached: boolean }>(
    `/api/metrics/${encodeURIComponent(tenantId)}`
  );
}

export function fetchLabelValues(
  tenantId: string,
  label: string
): Promise<{ label: string; values: string[]; cached: boolean }> {
  return authedJson<{ label: string; values: string[]; cached: boolean }>(
    `/api/labels/${encodeURIComponent(tenantId)}/${encodeURIComponent(label)}`
  );
}

export interface PromqlRecipe {
  title: string;
  promql: string;
  kind: string;
  unit: string;
  available?: boolean;
  missingMetrics?: string[];
}

export function fetchRecipes(): Promise<{ recipes: PromqlRecipe[] }> {
  return authedJson<{ recipes: PromqlRecipe[] }>("/api/promql/recipes");
}

export function fetchRecipesForTenant(
  tenantId: string
): Promise<{ recipes: PromqlRecipe[] }> {
  return authedJson<{ recipes: PromqlRecipe[] }>(
    `/api/promql/recipes/${encodeURIComponent(tenantId)}`
  );
}

export function fetchMetricSeries(
  tenantId: string,
  metric: string
): Promise<{ metric: string; series: Array<Record<string, string>>; cached: boolean }> {
  return authedJson<{
    metric: string;
    series: Array<Record<string, string>>;
    cached: boolean;
  }>(`/api/promql/series/${encodeURIComponent(tenantId)}/${encodeURIComponent(metric)}`);
}
