import { describe, it, expect } from "vitest";
import {
  encryptToken,
  decryptToken,
  redactToken,
  EncryptionError,
  deriveKey,
  resetKeyCache,
  KEY_LENGTH_BYTES,
} from "../src/db/encryption.js";

const KEY = "a".repeat(64); // 32 bytes hex

describe("AES-256-GCM token vault", () => {
  it("round-trips a plaintext token", () => {
    const payload = encryptToken("super-secret-token", KEY);
    const parts = payload.split(":");
    expect(parts).toHaveLength(3);
    expect(decryptToken(payload, KEY)).toBe("super-secret-token");
  });

  it("produces iv:authTag:ciphertext hex segments with correct lengths", () => {
    const payload = encryptToken("another-token", KEY);
    const [ivHex, authTagHex, cipherHex] = payload.split(":");
    expect(ivHex).toMatch(/^[0-9a-f]{24}$/); // 12 bytes
    expect(authTagHex).toMatch(/^[0-9a-f]{32}$/); // 16 bytes
    expect(cipherHex).toMatch(/^[0-9a-f]+$/);
    expect(Buffer.from(cipherHex, "hex").toString("utf8")).not.toContain("another-token");
  });

  it("uses a random IV so identical plaintexts encrypt differently", () => {
    const a = encryptToken("same-plaintext", KEY);
    const b = encryptToken("same-plaintext", KEY);
    expect(a).not.toBe(b);
    expect(decryptToken(a, KEY)).toBe("same-plaintext");
    expect(decryptToken(b, KEY)).toBe("same-plaintext");
  });

  it("rejects empty tokens", () => {
    expect(() => encryptToken("", KEY)).toThrow(EncryptionError);
  });

  it("throws on malformed payload", () => {
    expect(() => decryptToken("not-a-valid-payload", KEY)).toThrow(EncryptionError);
    expect(() => decryptToken("aa:bb", KEY)).toThrow(EncryptionError);
  });

  it("fails authentication when decrypted with the wrong key", () => {
    const payload = encryptToken("private", KEY);
    const wrongKey = "b".repeat(64);
    expect(() => decryptToken(payload, wrongKey)).toThrow(EncryptionError);
  });

  it("rejects invalid keys", () => {
    expect(() => encryptToken("x", "short-key")).toThrow(EncryptionError);
    expect(() => decryptToken("1:2:3", "zz".repeat(32))).toThrow(EncryptionError);
  });

  it("redacts tokens without leaking them", () => {
    expect(redactToken("abcdefghijklmnop")).toBe("****mnop");
    expect(redactToken("abc")).toBe("****");
  });

  it("derives stable 32-byte keys from seed material", () => {
    expect(deriveKey("seed")).toHaveLength(64);
    expect(deriveKey("seed")).toBe(deriveKey("seed"));
    expect(deriveKey("seed")).not.toBe(deriveKey("other"));
  });

  it("exposes the AES-256 key length", () => {
    expect(KEY_LENGTH_BYTES).toBe(32);
  });

  it("resets the cached key without error", () => {
    resetKeyCache();
    expect(() => encryptToken("roundtrip-after-reset", KEY)).not.toThrow();
  });
});
