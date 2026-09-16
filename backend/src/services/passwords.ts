import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/**
 * Password hashing with Node's native scrypt.
 * Format: scrypt$<saltHex>$<hashHex> — self-describing for future upgrades.
 */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const salt = Buffer.from(parts[1] ?? "", "hex");
  const expected = Buffer.from(parts[2] ?? "", "hex");
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = await scrypt(password, salt, expected.length);
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}
