import type { FastifyRequest, FastifyReply } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";
import { canEditTenant, tenantHasOwner } from "../db/users.js";

/**
 * HMAC-signed session tokens (JWT-shaped, no external dependency).
 * Two token types:
 *  - user tokens: { sub: userId, email, exp } — login sessions
 *  - legacy tenant tokens: { tenantId, issuedAt } — kept for API compat
 */

export interface UserClaims {
  sub: string;
  email: string;
  exp: number;
  type: "user";
}

export interface TenantClaims {
  tenantId: string;
  issuedAt: number;
  type: "tenant";
}

export type SessionClaims = UserClaims | TenantClaims;

const USER_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

function sign(data: string): string {
  const env = getEnv();
  return base64UrlEncode(
    createHmac("sha256", env.JWT_SECRET).update(data).digest()
  );
}

export function issueUserToken(userId: string, email: string): string {
  const claims: UserClaims = {
    sub: userId,
    email,
    exp: Date.now() + USER_TOKEN_TTL_MS,
    type: "user",
  };
  const payload = base64UrlEncode(JSON.stringify(claims));
  return `${payload}.${sign(payload)}`;
}

export function issueTenantToken(tenantId: string): string {
  const claims: TenantClaims = { tenantId, issuedAt: Date.now(), type: "tenant" };
  const payload = base64UrlEncode(JSON.stringify(claims));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payload, signature] = parts;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const claims = JSON.parse(base64UrlDecode(payload)) as SessionClaims;
    if (claims.type === "user") {
      if (typeof claims.sub !== "string" || typeof claims.exp !== "number") {
        return null;
      }
      if (claims.exp < Date.now()) {
        return null; // expired
      }
      return claims;
    }
    if (typeof claims.tenantId !== "string" || typeof claims.issuedAt !== "number") {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

/** Back-compat wrapper. */
export function verifyTenantToken(token: string): TenantClaims | null {
  const claims = verifyToken(token);
  return claims !== null && claims.type === "tenant" ? claims : null;
}

export interface AuthedRequest extends FastifyRequest {
  userId?: string;
  email?: string;
  tenantId?: string;
}

/**
 * Extracts and verifies the session from `Authorization: Bearer <token>`.
 * Populates request.userId/email for user tokens.
 */
export function resolveSession(request: FastifyRequest): SessionClaims | null {
  const authHeader = request.headers.authorization;
  if (authHeader !== undefined && authHeader.startsWith("Bearer ")) {
    return verifyToken(authHeader.slice(7));
  }
  return null;
}

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<UserClaims | null> {
  const claims = resolveSession(request);
  if (claims === null || claims.type !== "user") {
    await reply.code(401).send({ error: "Authentication required" });
    return null;
  }
  (request as AuthedRequest).userId = claims.sub;
  (request as AuthedRequest).email = claims.email;
  return claims;
}

export async function requireTenant(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const claims = resolveSession(request);
  if (claims === null) {
    await reply.code(401).send({ error: "Missing tenant identity" });
    return null;
  }
  if (claims.type === "user") {
    // User sessions resolve to their owned tenant implicitly via ownership checks.
    (request as AuthedRequest).userId = claims.sub;
    return claims.sub;
  }
  return claims.tenantId;
}

/**
 * Tenant authorization for metric-bearing routes (query/stream/panels/etc).
 *
 * A tenant is readable when EITHER:
 *  - the caller presents the tenant's short-lived scoped token (issued when
 *    the tenant was connected), or
 *  - the caller's user session may view the tenant (owner or org member).
 *
 * Legacy workspaces created before accounts existed (no owner row) stay
 * reachable so the no-account connect flow keeps working.
 */
export async function requireTenantAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  tenantId: string
): Promise<boolean> {
  // EventSource (SSE) cannot send Authorization headers — allow the token
  // via `?token=` as a fallback for the stream endpoint.
  const queryToken =
    typeof (request.query as { token?: unknown } | null)?.token === "string"
      ? ((request.query as { token: string }).token as string)
      : "";
  const claims =
    resolveSession(request) ?? (queryToken.length > 0 ? verifyToken(queryToken) : null);
  if (claims === null) {
    await reply.code(401).send({ error: "Authentication required" });
    return false;
  }
  if (claims.type === "user") {
    (request as AuthedRequest).userId = claims.sub;
    (request as AuthedRequest).email = claims.email;
    if (await canEditTenant(tenantId, claims.sub)) {
      return true;
    }
    // Not visible via org/ownership — fall through to legacy check below.
    if (await tenantHasOwner(tenantId)) {
      await reply.code(403).send({ error: "You do not have access to this workspace" });
      return false;
    }
    return true; // legacy owner-less workspace stays open
  }
  // Tenant-scoped token.
  if (claims.tenantId !== tenantId) {
    await reply.code(403).send({ error: "Token does not grant access to this workspace" });
    return false;
  }
  return true;
}
