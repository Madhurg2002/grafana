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

/** Encrypts a plaintext token. Returns `iv:authTag:ciphertext` (hex). */
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
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Decrypts an `iv:authTag:ciphertext` payload back to plaintext. */
export function decryptToken(payload: string, hexKey?: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new EncryptionError(
      "Malformed encrypted payload — expected iv:authTag:ciphertext"
    );
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = resolveKey(hexKey);
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
