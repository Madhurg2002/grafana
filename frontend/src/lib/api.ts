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
