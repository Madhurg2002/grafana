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
  /** Tenant-scoped token: read access to this workspace without an account. */
  tenantToken?: string;
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
  // Tenant-bearing endpoints (query/stream/panels) accept the user session
  // OR the workspace-scoped token — send whichever the client has.
  const userToken = getToken();
  const tenantToken = loadTenantToken();
  const auth = userToken ?? tenantToken;
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth !== null ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return payload;
}

const TENANT_TOKEN_STORAGE_KEY = "passthrough.tenantToken";

function loadTenantToken(): string | null {
  try {
    return localStorage.getItem(TENANT_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
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

async function authedJson<T>(path: string, init: RequestInit = {}, extraHeaders: Record<string, string> = {}): Promise<T> {
  const token = getToken();
  // Only send a JSON content-type when there is a body — Fastify 400s a
  // body-less POST that declares application/json (breaks access-token).
  const hasBody = init.body !== undefined && init.body !== null;
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    details?: Array<{ path: string; message: string }>;
  };
  if (!response.ok) {
    // Surface zod field-level detail so "Invalid request body" is diagnosable.
    const detail =
      payload.details !== undefined && payload.details.length > 0
        ? payload.details.map((d) => `${d.path || "body"}: ${d.message}`).join("; ")
        : "";
    throw new Error(detail.length > 0 ? `${payload.error ?? "Request failed"} — ${detail}` : payload.error ?? `Request failed with ${response.status}`);
  }
  return payload;
}

/**
 * Extra auth headers a caller can pass to `authedJson` — used to send the
 * workspace-scoped token on tenant endpoints when the user has no session.
 */
export function scopedHeaders(tenantToken: string | null): Record<string, string> {
  return tenantToken !== null ? { authorization: `Bearer ${tenantToken}` } : {};
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
  | "email_edit"
  | "org_view"
  | "org_edit";

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
  /** Composed pages rendered server-side — present when the tenant has pages. */
  pages?: Array<{
    id: number;
    name: string;
    isHome: boolean;
    showBuiltins: boolean;
    widgets: Array<{
      id: number;
      kind: "sparkline" | "gauge" | "stat" | "hosts_table";
      title: string;
      unit: string | null;
      span: number;
      value: number | null;
      series: Array<{ label: string; points: Array<{ timestamp: number; value: number }> }>;
    }>;
  }>;
  access?: ShareAccess;
  canEdit?: boolean;
}

export function fetchShareView(id: string, viewToken?: string): Promise<ShareViewPayload> {
  return authedJson<ShareViewPayload>(
    `/api/share/${encodeURIComponent(id)}/view`,
    viewToken !== undefined ? { headers: { authorization: `Bearer ${viewToken}` } } : {}
  );
}

export function revokeShareLink(id: string): Promise<{ revoked: boolean }> {
  return authedJson<{ revoked: boolean }>(
    `/api/share/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export interface ProfileShare {
  id: string;
  url: string;
  label: string;
  createdAt: string;
  access: ShareAccess;
  revoked: boolean;
  allowedEmails: string[];
  invitedEmails: string[];
}

export function fetchProfileShares(): Promise<{
  created: ProfileShare[];
  sharedWithMe: ProfileShare[];
}> {
  return authedJson<{ created: ProfileShare[]; sharedWithMe: ProfileShare[] }>(
    "/api/profile/shares"
  );
}

export function fetchShareAccessToken(id: string): Promise<{ token: string; email: string; canEdit: boolean }> {
  return authedJson<{ token: string; email: string; canEdit: boolean }>(
    `/api/share/${encodeURIComponent(id)}/access-token`,
    { method: "POST" }
  );
}

/** People picker for the share dialog — email or display-name prefix. */
export function searchUsers(query: string): Promise<
  Array<{ id: string; email: string; displayName: string | null }>
> {
  return authedJson(`/api/users/search?q=${encodeURIComponent(query)}`);
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
  page_id: number | null;
  created_at: string;
}

export function listPanels(tenantId: string, pageId?: number): Promise<{ panels: DashboardPanel[] }> {
  return authedJson<{ panels: DashboardPanel[] }>(
    `/api/panels/${encodeURIComponent(tenantId)}${
      pageId !== undefined ? `?pageId=${pageId}` : ""
    }`
  );
}

export function createPanel(
  tenantId: string,
  panel: { title: string; promql: string; kind: PanelKind; unit?: string; pageId?: number }
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
        ...(panel.pageId !== undefined ? { pageId: panel.pageId } : {}),
      }),
    }
  );
}

// ---------------------------------------------------------------------------
// Dashboard pages ("Home" + custom groupings)
// ---------------------------------------------------------------------------

export interface DashboardPage {
  id: number;
  tenant_id: string;
  name: string;
  position: number;
  is_home?: boolean;
  default_span?: number;
  refresh_seconds?: number;
  window_minutes?: number;
  /** Whether the fixed built-in essentials strip renders above this page's widgets. */
  show_builtins?: boolean;
}

export function listPages(
  tenantId: string,
  tenantToken?: string | null
): Promise<{ pages: DashboardPage[] }> {
  return authedJson<{ pages: DashboardPage[] }>(
    `/api/pages/${encodeURIComponent(tenantId)}`,
    {},
    scopedHeaders(tenantToken ?? loadTenantToken())
  );
}

export function createPage(
  tenantId: string,
  name: string,
  showBuiltins = true
): Promise<{ page: DashboardPage }> {
  return authedJson<{ page: DashboardPage }>(
    `/api/pages/${encodeURIComponent(tenantId)}`,
    { method: "POST", body: JSON.stringify({ name, showBuiltins }) }
  );
}

export function renamePage(tenantId: string, id: number, name: string): Promise<{ ok: boolean }> {
  return authedJson<{ ok: boolean }>(
    `/api/pages/${encodeURIComponent(tenantId)}/${id}`,
    { method: "PATCH", body: JSON.stringify({ name }) }
  );
}

export function deletePage(tenantId: string, id: number): Promise<{ ok: boolean }> {
  return authedJson<{ ok: boolean }>(
    `/api/pages/${encodeURIComponent(tenantId)}/${id}`,
    { method: "DELETE" }
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

// ---------------------------------------------------------------------------
// Page widgets — everything visible on a dashboard page (migration 009)
// ---------------------------------------------------------------------------

export type WidgetKind = "stat" | "gauge" | "sparkline" | "hosts_table";

export interface PageWidget {
  id: number;
  page_id: number;
  tenant_id: string;
  kind: WidgetKind;
  title: string;
  promql: string;
  unit: string | null;
  span: number;
  position: number;
  created_at: string;
}

export function listWidgets(
  tenantId: string,
  pageId: number,
  tenantToken?: string | null
): Promise<{ widgets: PageWidget[] }> {
  return authedJson<{ widgets: PageWidget[] }>(
    `/api/pages/${encodeURIComponent(tenantId)}/${pageId}/widgets`,
    {},
    scopedHeaders(tenantToken ?? loadTenantToken())
  );
}

export function createWidget(
  tenantId: string,
  pageId: number,
  widget: {
    kind: WidgetKind;
    title: string;
    promql?: string;
    unit?: string;
    span?: number;
  },
  tenantToken?: string | null
): Promise<{ widget: PageWidget }> {
  return authedJson<{ widget: PageWidget }>(
    `/api/pages/${encodeURIComponent(tenantId)}/${pageId}/widgets`,
    {
      method: "POST",
      body: JSON.stringify({
        kind: widget.kind,
        title: widget.title,
        ...(widget.promql !== undefined && widget.promql.length > 0
          ? { promql: widget.promql }
          : {}),
        ...(widget.unit !== undefined && widget.unit.length > 0
          ? { unit: widget.unit }
          : {}),
        ...(widget.span !== undefined ? { span: widget.span } : {}),
      }),
    },
    scopedHeaders(tenantToken ?? loadTenantToken())
  );
}

export function updateWidget(
  tenantId: string,
  widgetId: number,
  patch: { title?: string; promql?: string; unit?: string | null; span?: number; kind?: WidgetKind },
  tenantToken?: string | null
): Promise<{ widget: PageWidget }> {
  return authedJson<{ widget: PageWidget }>(
    `/api/pages/${encodeURIComponent(tenantId)}/widgets/${widgetId}`,
    { method: "PATCH", body: JSON.stringify(patch) },
    scopedHeaders(tenantToken ?? loadTenantToken())
  );
}

export function deleteWidget(
  tenantId: string,
  widgetId: number,
  tenantToken?: string | null
): Promise<{ removed: boolean }> {
  return authedJson<{ removed: boolean }>(
    `/api/pages/${encodeURIComponent(tenantId)}/widgets/${widgetId}`,
    { method: "DELETE" },
    scopedHeaders(tenantToken ?? loadTenantToken())
  );
}

export function reorderWidgets(
  tenantId: string,
  pageId: number,
  positions: Array<{ id: number; position: number }>,
  tenantToken?: string | null
): Promise<{ ok: boolean }> {
  return authedJson<{ ok: boolean }>(
    `/api/pages/${encodeURIComponent(tenantId)}/${pageId}/widgets/reorder`,
    { method: "POST", body: JSON.stringify({ positions }) },
    scopedHeaders(tenantToken ?? loadTenantToken())
  );
}

export function makePageHome(
  tenantId: string,
  pageId: number,
  tenantToken?: string | null
): Promise<{ ok: boolean }> {
  return authedJson<{ ok: boolean }>(
    `/api/pages/${encodeURIComponent(tenantId)}/${pageId}/home`,
    { method: "POST" },
    scopedHeaders(tenantToken ?? loadTenantToken())
  );
}

export function updatePageSettings(
  tenantId: string,
  pageId: number,
  settings: {
    defaultSpan?: number;
    refreshSeconds?: number;
    windowMinutes?: number;
    showBuiltins?: boolean;
  },
  tenantToken?: string | null
): Promise<{ ok: boolean }> {
  return authedJson<{ ok: boolean }>(
    `/api/pages/${encodeURIComponent(tenantId)}/${pageId}/settings`,
    { method: "PATCH", body: JSON.stringify(settings) },
    scopedHeaders(tenantToken ?? loadTenantToken())
  );
}

// ---------------------------------------------------------------------------
// Organizations — shared workspaces so sharing covers the whole team
// ---------------------------------------------------------------------------

export interface OrgSummary {
  id: string;
  name: string;
  role: "owner" | "member";
  inviteCode?: string;
}

export interface OrgMember {
  email: string;
  displayName: string | null;
  role: "owner" | "member";
}

export function listOrgs(): Promise<{ orgs: OrgSummary[] }> {
  return authedJson<{ orgs: OrgSummary[] }>("/api/orgs");
}

export function createOrg(name: string): Promise<OrgSummary> {
  return authedJson<OrgSummary>("/api/orgs", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function joinOrg(inviteCode: string): Promise<{ id: string; name: string; role: string }> {
  return authedJson<{ id: string; name: string; role: string }>("/api/orgs/join", {
    method: "POST",
    body: JSON.stringify({ inviteCode }),
  });
}

export function listOrgMembers(orgId: string): Promise<{ members: OrgMember[] }> {
  return authedJson<{ members: OrgMember[] }>(
    `/api/orgs/${encodeURIComponent(orgId)}/members`
  );
}

export function rotateInviteCode(orgId: string): Promise<{ inviteCode: string }> {
  return authedJson<{ inviteCode: string }>(
    `/api/orgs/${encodeURIComponent(orgId)}/invite/rotate`,
    { method: "POST" }
  );
}

export function attachTenantToOrg(orgId: string, tenantId: string): Promise<{ attached: boolean }> {
  return authedJson<{ attached: boolean }>("/api/orgs/attach", {
    method: "POST",
    body: JSON.stringify({ orgId, tenantId }),
  });
}

export function detachTenantFromOrg(tenantId: string): Promise<{ attached: boolean }> {
  return authedJson<{ attached: boolean }>("/api/orgs/attach", {
    method: "DELETE",
    body: JSON.stringify({ tenantId }),
  });
}

// ---------------------------------------------------------------------------
// Threshold alerts (migration 011 + evaluator)
// ---------------------------------------------------------------------------

export type AlertComparator = ">" | "<" | ">=" | "<=" | "==";
export type AlertState = "pending" | "firing" | "resolved";

export interface Alert {
  id: number;
  tenant_id: string;
  title: string;
  promql: string;
  comparator: AlertComparator;
  threshold: number;
  for_seconds: number;
  webhook_url: string | null;
  enabled: boolean;
  state: AlertState;
  first_breach_at: string | null;
  firing_time: string | null;
  resolved_time: string | null;
  last_value: number | null;
  last_eval_at: string | null;
  created_at: string;
}

export function listAlerts(tenantId: string): Promise<{ alerts: Alert[] }> {
  return authedJson<{ alerts: Alert[] }>(
    `/api/alerts/${encodeURIComponent(tenantId)}`
  );
}

export function createAlert(
  tenantId: string,
  alert: {
    title: string;
    promql: string;
    comparator: AlertComparator;
    threshold: number;
    forSeconds?: number;
    webhookUrl?: string;
  }
): Promise<{ alert: Alert }> {
  return authedJson<{ alert: Alert }>(
    `/api/alerts/${encodeURIComponent(tenantId)}`,
    { method: "POST", body: JSON.stringify(alert) }
  );
}

export function setAlertEnabled(
  tenantId: string,
  alertId: number,
  enabled: boolean
): Promise<{ ok: boolean }> {
  return authedJson<{ ok: boolean }>(
    `/api/alerts/${encodeURIComponent(tenantId)}/${alertId}`,
    { method: "PATCH", body: JSON.stringify({ enabled }) }
  );
}

export function deleteAlert(tenantId: string, alertId: number): Promise<{ removed: boolean }> {
  return authedJson<{ removed: boolean }>(
    `/api/alerts/${encodeURIComponent(tenantId)}/${alertId}`,
    { method: "DELETE" }
  );
}

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------

export function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ updated: boolean }> {
  return authedJson<{ updated: boolean }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function updateProfile(displayName: string): Promise<{
  user: { id: string; email: string; displayName: string | null };
}> {
  return authedJson<{
    user: { id: string; email: string; displayName: string | null };
  }>("/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify({ displayName }),
  });
}
