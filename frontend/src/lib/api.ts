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
  error?: string;
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
  authToken?: string
): Promise<ConnectResponse> {
  return postJson<ConnectResponse>("/api/connect", {
    tenantId,
    prometheusUrl,
    ...(authToken !== undefined && authToken.length > 0 ? { authToken } : {}),
  });
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

export interface ShareLink {
  id: string;
  url: string;
  label: string;
  createdAt: string;
}

export function createShareLink(tenantId: string, label?: string): Promise<ShareLink> {
  return authedJson<ShareLink>("/api/share", {
    method: "POST",
    body: JSON.stringify({ tenantId, ...(label !== undefined ? { label } : {}) }),
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
  };
  generatedAt: string;
}

export function fetchShareView(id: string): Promise<ShareViewPayload> {
  return authedJson<ShareViewPayload>(`/api/share/${encodeURIComponent(id)}/view`);
}
