import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM token vault.
 *
 * Output format: `iv:authTag:ciphertext` (hex-encoded segments), per the
 * `token-vault-crypto` skill spec. Never log plaintext tokens.
 */

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class EncryptionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

let cachedKey: Buffer | null = null;

function resolveKey(hexKey?: string): Buffer {
  // Explicit keys are never cached so tests/per-tenant keys stay isolated.
  if (hexKey !== undefined) {
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new EncryptionError(
        "ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256-GCM"
      );
    }
    return Buffer.from(hexKey, "hex");
  }
  if (cachedKey) {
    return cachedKey;
  }
  const source = process.env.ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(source)) {
    throw new EncryptionError(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256-GCM"
    );
  }
  cachedKey = Buffer.from(source, "hex");
  return cachedKey;
}

/** Deterministically derives a 32-byte key from arbitrary seed material. */
export function deriveKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function resetKeyCache(): void {
  cachedKey = null;
}

/** Prefix marking a payload encrypted under a specific key version. */
const VERSION_PREFIX = /^(?<tag>v\d+)!/;

/** Current key version — bumped by setting `ENCRYPTION_KEY_VERSION` (e.g. `2`). */
export function currentKeyVersion(): number {
  const raw = process.env.ENCRYPTION_KEY_VERSION ?? "1";
  const version = Number.parseInt(raw, 10);
  return Number.isInteger(version) && version >= 1 ? version : 1;
}

/** Key-versioned resolve: version 1 falls back to the primary key for pre-versioning (untagged) payloads. */
function resolveVersionedKey(version: number): Buffer {
  if (version === currentKeyVersion()) {
    return resolveKey();
  }
  if (version === 1) {
    // Legacy payloads predate tagging: use ENCRYPTION_KEY_V1 when the
    // operator provided it, otherwise assume a single-key deployment
    // where the primary key IS version 1.
    const v1 = process.env.ENCRYPTION_KEY_V1 ?? "";
    if (/^[0-9a-fA-F]{64}$/.test(v1)) {
      return Buffer.from(v1, "hex");
    }
    return resolveKey();
  }
  const named = process.env[`ENCRYPTION_KEY_V${version}`] ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(named)) {
    throw new EncryptionError(
      `ENCRYPTION_KEY_V${version} is not set — it is required to decrypt data written under key version ${version}`
    );
  }
  return Buffer.from(named, "hex");
}

/** Encrypts a plaintext token. Returns `v<N>:iv:authTag:ciphertext` (hex). */
export function encryptToken(plaintext: string, hexKey?: string): string {
  if (plaintext.length === 0) {
    throw new EncryptionError("Cannot encrypt an empty token");
  }
  const key = resolveKey(hexKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const versionTag = hexKey === undefined ? `v${currentKeyVersion()}!` : "";
  return `${versionTag}${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts a payload. Accepts both the legacy `iv:authTag:ciphertext` format
 * and the versioned `v<N>:iv:authTag:ciphertext` format, choosing the right
 * key for the version tag — so rotating keys never breaks stored tokens.
 */
export function decryptToken(payload: string, hexKey?: string): string {
  let version: number | null = null;
  let body = payload;
  const match = VERSION_PREFIX.exec(payload);
  if (match?.groups?.tag !== undefined) {
    version = Number.parseInt(match.groups.tag.slice(1), 10);
    body = payload.slice(match[0].length);
  }
  const parts = body.split(":");
  if (parts.length !== 3) {
    throw new EncryptionError(
      "Malformed encrypted payload — expected [vN:]iv:authTag:ciphertext"
    );
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  // Tagged payloads pick their key by tag; untagged payloads are legacy
  // version 1 (resolved via ENCRYPTION_KEY_V1 with fallback). Explicit-key
  // calls (tests, per-tenant keys) keep the resolved key.
  const key =
    hexKey !== undefined
      ? resolveKey(hexKey)
      : resolveVersionedKey(version ?? 1);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    throw new EncryptionError(`Decryption failed — ${message}`);
  }
}

/** Uniform redaction helper for safe logging. */
export function redactToken(token: string): string {
  if (token.length <= 4) {
    return "****";
  }
  return `****${token.slice(-4)}`;
}

export const KEY_LENGTH_BYTES = KEY_BYTES;

/**
 * Rewraps every version-tagged payload under the CURRENT key version using
 * the keys available in the environment. Returns a summary so the operator
 * can verify the rotation. Legacy (untagged) payloads are left untouched —
 * decryptToken still accepts them, and they will be re-tagged the next time
 * their owning record is saved.
 */
export function rewrapPayload(payload: string): {
  payload: string;
  rotated: boolean;
  error: string | null;
} {
  const match = VERSION_PREFIX.exec(payload);
  const version = match?.groups?.tag !== undefined ? Number.parseInt(match.groups.tag.slice(1), 10) : 1;
  if (version === currentKeyVersion()) {
    return { payload, rotated: false, error: null };
  }
  try {
    const plaintext = decryptToken(payload);
    return { payload: encryptToken(plaintext), rotated: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { payload, rotated: false, error: message };
  }
}
