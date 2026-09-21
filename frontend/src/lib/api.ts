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

// ---------------------------------------------------------------------------
// Forgot-password flow (public, unauthenticated).
// ---------------------------------------------------------------------------

export interface RequestResetResult {
  status: "dispatched";
  /** Present only when email isn't configured — dev/test convenience. */
  devResetUrl?: string;
  mailReason?: string;
}

/** Asks the backend to email a password-reset link for the account. */
export function requestPasswordReset(email: string): Promise<RequestResetResult> {
  return postJson<RequestResetResult>("/api/auth/request-reset", { email });
}

/** Consumes a reset token and sets a new password; returns a fresh session. */
export function resetPassword(token: string, password: string): Promise<AuthResponse> {
  return postJson<AuthResponse>("/api/auth/reset", { token, password });
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  // Tenant-bearing endpoints (query/stream/panels) accept the user session
  // OR the workspace-scoped token — send whichever the client has.
  const userToken = getToken();
  const tenantToken = getTenantToken();
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

export function getTenantToken(): string | null {
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
  return deduplicatedQuery("instant", request, () =>
    enqueueBatch("instant", request)
  );
}

export function rangeQuery(request: QueryRangeRequest): Promise<QueryResponseBody> {
  return deduplicatedQuery("range", request, () =>
    enqueueBatch("range", request)
  );
}

const QUERY_DEDUPE_TTL_MS = 3_000;
const queryResponseCache = new Map<string, { expiresAt: number; value: QueryResponseBody }>();
const queryInFlight = new Map<string, Promise<QueryResponseBody>>();

interface PendingBatch<T extends QueryRequest | QueryRangeRequest> {
  request: T;
  resolve: (value: QueryResponseBody) => void;
  reject: (error: unknown) => void;
}

const instantBatchQueue: Array<PendingBatch<QueryRequest>> = [];
const rangeBatchQueue: Array<PendingBatch<QueryRangeRequest>> = [];
let instantBatchTimer: number | null = null;
let rangeBatchTimer: number | null = null;

function enqueueBatch(
  kind: "instant",
  request: QueryRequest
): Promise<QueryResponseBody>;
function enqueueBatch(
  kind: "range",
  request: QueryRangeRequest
): Promise<QueryResponseBody>;
function enqueueBatch(
  kind: "instant" | "range",
  request: QueryRequest | QueryRangeRequest
): Promise<QueryResponseBody> {
  return new Promise<QueryResponseBody>((resolve, reject) => {
    if (kind === "instant") {
      instantBatchQueue.push({ request: request as QueryRequest, resolve, reject });
      if (instantBatchTimer === null) {
        instantBatchTimer = window.setTimeout(() => {
          instantBatchTimer = null;
          void flushBatch("instant");
        }, 0);
      }
    } else {
      rangeBatchQueue.push({ request: request as QueryRangeRequest, resolve, reject });
      if (rangeBatchTimer === null) {
        rangeBatchTimer = window.setTimeout(() => {
          rangeBatchTimer = null;
          void flushBatch("range");
        }, 0);
      }
    }
  });
}

async function flushBatch(kind: "instant" | "range"): Promise<void> {
  const queue = kind === "instant" ? instantBatchQueue : rangeBatchQueue;
  const pending = queue.splice(0, queue.length);
  const byTenant = new Map<string, Array<PendingBatch<QueryRequest> | PendingBatch<QueryRangeRequest>>>();
  for (const item of pending) {
    const tenantQueue = byTenant.get(item.request.tenantId) ?? [];
    tenantQueue.push(item);
    byTenant.set(item.request.tenantId, tenantQueue);
  }

  await Promise.all(
    [...byTenant.values()].map(async (tenantQueue) => {
      const first = tenantQueue[0];
      if (first === undefined) return;
      try {
        const payload = await postJson<{ results: QueryResponseBody[] }>(
          kind === "instant" ? "/api/query/batch" : "/api/query_range/batch",
          { requests: tenantQueue.map((item) => item.request) }
        );
        tenantQueue.forEach((item, index) => {
          const result = payload.results[index];
          if (result === undefined) {
            item.reject(new Error("Batch response missing query result"));
          } else if (result.error !== undefined) {
            item.reject(new Error(result.error));
          } else {
            item.resolve(result);
          }
        });
      } catch (error) {
        tenantQueue.forEach((item) => item.reject(error));
      }
    })
  );
}

function deduplicatedQuery(
  kind: "instant" | "range",
  request: QueryRequest | QueryRangeRequest,
  run: () => Promise<QueryResponseBody>
): Promise<QueryResponseBody> {
  const key = `${kind}:${JSON.stringify(request)}`;
  const cached = queryResponseCache.get(key);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return Promise.resolve({ ...cached.value, cached: true });
  }
  const existing = queryInFlight.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const pending = run()
    .then((value) => {
      queryResponseCache.set(key, { expiresAt: Date.now() + QUERY_DEDUPE_TTL_MS, value });
      return value;
    })
    .finally(() => {
      queryInFlight.delete(key);
    });
  queryInFlight.set(key, pending);
  return pending;
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

// ---------------------------------------------------------------------------
// Audit trail (Profile → Activity)
// ---------------------------------------------------------------------------

export interface ActivityEntry {
  id: number;
  actorEmail: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/** Newest workspace activity (who created/edited/deleted what). */
export function fetchActivity(
  tenantId: string,
  limit = 100
): Promise<{ activity: ActivityEntry[] }> {
  return authedJson<{ activity: ActivityEntry[] }>(
    `/api/profile/activity?tenantId=${encodeURIComponent(tenantId)}&limit=${limit}`
  );
}

export function fetchShareAccessToken(id: string): Promise<{
  token: string;
  editToken?: string;
  viewToken?: string;
  email: string;
  canEdit: boolean;
}> {
  return authedJson<{
    token: string;
    editToken?: string;
    viewToken?: string;
    email: string;
    canEdit: boolean;
  }>(
    `/api/share/${encodeURIComponent(id)}/access-token`,
    { method: "POST", body: JSON.stringify({}) }
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

/** Edits a stored connection in place (label and/or URL/token rotation). */
export interface ConnectionPatch {
  label?: string;
  prometheusUrl?: string;
  /** Replacement bearer token; empty string clears the stored token. */
  authToken?: string;
}

export function updateConnection(
  tenantId: string,
  id: number,
  patch: ConnectionPatch
): Promise<{ connection: ConnectionSummary }> {
  return authedJson<{ connection: ConnectionSummary }>(
    `/api/connections/${encodeURIComponent(tenantId)}/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...(patch.label !== undefined && patch.label.trim().length > 0
          ? { label: patch.label.trim() }
          : {}),
        ...(patch.prometheusUrl !== undefined && patch.prometheusUrl.trim().length > 0
          ? { prometheusUrl: patch.prometheusUrl.trim() }
          : {}),
        ...(patch.authToken !== undefined ? { authToken: patch.authToken } : {}),
      }),
    }
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
    scopedHeaders(tenantToken ?? getTenantToken())
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
    scopedHeaders(tenantToken ?? getTenantToken())
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
    scopedHeaders(tenantToken ?? getTenantToken())
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
    scopedHeaders(tenantToken ?? getTenantToken())
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
    scopedHeaders(tenantToken ?? getTenantToken())
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
    scopedHeaders(tenantToken ?? getTenantToken())
  );
}

// ---------------------------------------------------------------------------
// Dashboard export / import (JSON)
// ---------------------------------------------------------------------------

/** Portable dashboard snapshot: page settings + its widgets in order. */
export interface DashboardExport {
  version: 1;
  page: {
    name: string;
    showBuiltins: boolean;
    refreshSeconds?: number;
    windowMinutes?: number;
    defaultSpan?: number;
  };
  widgets: Array<{
    kind: WidgetKind;
    title: string;
    promql: string;
    unit?: string;
    span: number;
  }>;
}

/** Downloads one page (with all widgets) as a portable JSON file. */
export async function exportPageJson(page: DashboardPage, widgets: PageWidget[]): Promise<void> {
  const payload: DashboardExport = {
    version: 1,
    page: {
      name: page.name,
      showBuiltins: page.show_builtins !== false,
      ...(page.refresh_seconds !== undefined ? { refreshSeconds: page.refresh_seconds } : {}),
      ...(page.window_minutes !== undefined ? { windowMinutes: page.window_minutes } : {}),
      ...(page.default_span !== undefined ? { defaultSpan: page.default_span } : {}),
    },
    widgets: widgets.map((w) => ({
      kind: w.kind,
      title: w.title,
      promql: w.promql,
      ...(w.unit ? { unit: w.unit } : {}),
      span: w.span,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const safe = page.name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "page";
  anchor.download = `dashboard-${safe}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Imports a dashboard JSON file: creates the page, then re-creates each
 * widget (server normalizes PromQL again — safety laws re-applied on import).
 * Returns the created page for the caller to activate.
 */
export async function importPageJson(
  tenantId: string,
  file: File,
  tenantToken?: string | null
): Promise<DashboardPage> {
  const text = await file.text();
  let parsed: DashboardExport;
  try {
    parsed = JSON.parse(text) as DashboardExport;
  } catch {
    throw new Error("Not a valid dashboard JSON file");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    parsed.version !== 1 ||
    parsed.page === null ||
    typeof parsed.page?.name !== "string" ||
    !Array.isArray(parsed.widgets)
  ) {
    throw new Error("Unrecognized dashboard export format");
  }
  const { page } = await createPage(
    tenantId,
    parsed.page.name,
    parsed.page.showBuiltins
  );
  for (const widget of parsed.widgets) {
    if (widget.kind === "hosts_table") {
      await createWidget(tenantId, page.id, { kind: widget.kind, title: widget.title }, tenantToken);
      continue;
    }
    if (typeof widget.promql !== "string" || widget.promql.trim().length === 0) {
      continue; // skip malformed rows instead of failing the whole import
    }
    await createWidget(tenantId, page.id, {
      kind: widget.kind,
      title: widget.title,
      promql: widget.promql,
      unit: widget.unit,
      span: widget.span,
    }, tenantToken);
  }
  return page;
}

export function makePageHome(
  tenantId: string,
  pageId: number,
  tenantToken?: string | null
): Promise<{ ok: boolean }> {
  return authedJson<{ ok: boolean }>(
    `/api/pages/${encodeURIComponent(tenantId)}/${pageId}/home`,
    { method: "POST" },
    scopedHeaders(tenantToken ?? getTenantToken())
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
    scopedHeaders(tenantToken ?? getTenantToken())
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

/**
 * Irreversibly deletes the signed-in account (privacy policy / data removal).
 * Requires the literal `DELETE` confirmation string server-side.
 */
export function deleteAccount(): Promise<{ deleted: boolean; email: string }> {
  return authedJson<{ deleted: boolean; email: string }>("/api/profile/me", {
    method: "DELETE",
    body: JSON.stringify({ confirm: "DELETE" }),
  });
}
