import type { FastifyRequest, FastifyReply } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";

/**
 * Lightweight HMAC-signed tenant authentication (JWT-shaped without the
 * external dependency). Signed with JWT_SECRET; used to bind requests to a
 * tenant identity.
 */

export interface TenantClaims {
  tenantId: string;
  issuedAt: number;
}

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

export function issueTenantToken(tenantId: string): string {
  const claims: TenantClaims = { tenantId, issuedAt: Date.now() };
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function verifyTenantToken(token: string): TenantClaims | null {
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
    const claims = JSON.parse(base64UrlDecode(payload)) as TenantClaims;
    if (typeof claims.tenantId !== "string" || typeof claims.issuedAt !== "number") {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends FastifyRequest {
  tenantId?: string;
}

/**
 * Extracts the tenant identity from `Authorization: Bearer <token>` or the
 * `x-tenant-id` header (dev convenience). Falls back to the body/query param.
 */
export function resolveTenantId(
  request: FastifyRequest,
  fallback?: string
): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader !== undefined && authHeader.startsWith("Bearer ")) {
    const claims = verifyTenantToken(authHeader.slice(7));
    if (claims !== null) {
      return claims.tenantId;
    }
  }
  const headerTenant = request.headers["x-tenant-id"];
  if (typeof headerTenant === "string" && headerTenant.length > 0) {
    return headerTenant;
  }
  return fallback ?? null;
}

export async function requireTenant(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const tenantId = resolveTenantId(request);
  if (tenantId === null) {
    await reply.code(401).send({ error: "Missing tenant identity" });
    return null;
  }
  return tenantId;
}
