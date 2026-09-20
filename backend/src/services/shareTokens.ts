import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";

/**
 * Short-lived signed view tokens for email-restricted share links.
 *
 * Format: base64url(payload).hmac — payload = shareId|email|expiryMs.
 * Bound to BOTH the share id and the viewer's email, so a token leaked
 * from one share can't open another and can't be reused with a
 * different address. 1-hour TTL keeps leaked links short-lived.
 */

const TOKEN_TTL_MS = 60 * 60 * 1000;

function hmac(payload: string): string {
  return createHmac("sha256", getEnv().JWT_SECRET).update(payload).digest("base64url");
}

export function signViewToken(shareId: string, email: string): string {
  const payload = `${shareId}|${email.toLowerCase()}|${Date.now() + TOKEN_TTL_MS}`;
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  return `${encoded}.${hmac(encoded)}`;
}

export function verifyViewToken(
  shareId: string,
  email: string,
  token: string
): boolean {
  const [encoded, signature] = token.split(".");
  if (encoded === undefined || signature === undefined) {
    return false;
  }
  const expected = hmac(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return false;
  }
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const [tokenShare, tokenEmail, expiryRaw] = payload.split("|");
  const expiry = Number(expiryRaw);
  return (
    tokenShare === shareId &&
    tokenEmail === email.toLowerCase() &&
    Number.isFinite(expiry) &&
    expiry > Date.now()
  );
}

/**
 * Returns the allow-list email bound to a signature-valid view token, or
 * null when the signature or share binding fails. Expiry is intentionally
 * NOT checked here — callers pair this with `verifyViewToken` for the
 * full validation. This lets the snapshot route identify the viewer from
 * the token alone instead of requiring a client-supplied ?email= param
 * (which no first-party client sends and which would be spoofable).
 */
export function viewTokenEmail(shareId: string, token: string): string | null {
  const [encoded, signature] = token.split(".");
  if (encoded === undefined || signature === undefined) {
    return null;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(hmac(encoded));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const payload = Buffer.from(encoded, "base64url").toString("utf8");
    const [tokenShare, tokenEmail] = payload.split("|");
    if (tokenShare !== shareId || typeof tokenEmail !== "string" || tokenEmail.length === 0) {
      return null;
    }
    return tokenEmail;
  } catch {
    return null;
  }
}
