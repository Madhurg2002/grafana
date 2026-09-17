import { describe, it, expect, afterEach } from "vitest";
import {
  encryptToken,
  decryptToken,
  redactToken,
  EncryptionError,
  deriveKey,
  resetKeyCache,
  rewrapPayload,
  currentKeyVersion,
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

  describe("key-versioned rotation", () => {
    const V1 = "c".repeat(64);
    const V2 = "d".repeat(64);

    afterEach(() => {
      delete process.env.ENCRYPTION_KEY_VERSION;
      delete process.env.ENCRYPTION_KEY_V1;
      delete process.env.ENCRYPTION_KEY_V2;
      resetKeyCache();
    });

    it("tags new payloads with the current version", () => {
      process.env.ENCRYPTION_KEY = V2; // current key
      process.env.ENCRYPTION_KEY_VERSION = "2";
      const payload = encryptToken("rotate-me");
      expect(payload.startsWith("v2!")).toBe(true);
      expect(decryptToken(payload)).toBe("rotate-me");
      expect(currentKeyVersion()).toBe(2);
    });

    it("still decrypts legacy untagged payloads after rotation", () => {
      process.env.ENCRYPTION_KEY = V2;
      process.env.ENCRYPTION_KEY_VERSION = "2";
      process.env.ENCRYPTION_KEY_V1 = V1; // old key kept for legacy rows
      const legacy = encryptToken("legacy-token", V1); // explicit key = untagged
      expect(legacy.startsWith("v")).toBe(false);
      expect(decryptToken(legacy)).toBe("legacy-token");
    });

    it("decrypts old-version tagged payloads via ENCRYPTION_KEY_V<n>", () => {
      process.env.ENCRYPTION_KEY = V1;
      const old = encryptToken("old-world"); // tagged v1 by default env
      expect(old.startsWith("v1!")).toBe(true);
      // Rotate: primary becomes V2, old key kept as ENCRYPTION_KEY_V1.
      process.env.ENCRYPTION_KEY = V2;
      process.env.ENCRYPTION_KEY_VERSION = "2";
      process.env.ENCRYPTION_KEY_V1 = V1;
      resetKeyCache();
      expect(decryptToken(old)).toBe("old-world");
    });

    it("rewrapPayload upgrades old-version payloads to the current version", () => {
      process.env.ENCRYPTION_KEY = V1;
      const old = encryptToken("needs-rotation");
      process.env.ENCRYPTION_KEY = V2;
      process.env.ENCRYPTION_KEY_VERSION = "2";
      process.env.ENCRYPTION_KEY_V1 = V1;
      resetKeyCache();
      const result = rewrapPayload(old);
      expect(result.rotated).toBe(true);
      expect(result.error).toBeNull();
      expect(result.payload.startsWith("v2!")).toBe(true);
      expect(decryptToken(result.payload)).toBe("needs-rotation");
    });

    it("rewrapPayload leaves current-version payloads untouched", () => {
      process.env.ENCRYPTION_KEY = V1;
      const current = encryptToken("already-current");
      const result = rewrapPayload(current);
      expect(result.rotated).toBe(false);
      expect(result.payload).toBe(current);
    });

    it("rewrapPayload reports an error instead of losing an undecryptable row", () => {
      process.env.ENCRYPTION_KEY = V2;
      process.env.ENCRYPTION_KEY_VERSION = "2";
      resetKeyCache();
      const stale = "v1!aabb:ccdd:eeff"; // malformed/undecryptable v1 payload
      const result = rewrapPayload(stale);
      expect(result.rotated).toBe(false);
      expect(result.error).not.toBeNull();
      expect(result.payload).toBe(stale); // original preserved
    });
  });
});
