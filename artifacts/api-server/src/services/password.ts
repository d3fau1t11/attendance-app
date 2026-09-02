import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

/**
 * scrypt parameters. N=2^15 with r=8 costs roughly 100ms and ~32MB per hash on
 * commodity hardware — expensive enough to make offline cracking painful,
 * cheap enough that a login does not stall the event loop noticeably.
 *
 * scrypt is used in preference to argon2/bcrypt because it ships inside Node:
 * no native module means nothing to compile on Windows, in CI, or on Replit.
 */
const SCRYPT_N = 32_768;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * scrypt's default maxmem (32MB) is below what N=2^15 needs
 * (128 * N * r ≈ 32MB plus overhead), so it must be raised explicitly or the
 * call throws.
 */
const MAX_MEM = 128 * SCRYPT_N * SCRYPT_r * 2;

/**
 * Hash a password into a self-describing string:
 *
 *   scrypt$N$r$p$<salt-hex>$<key-hex>
 *
 * Embedding the parameters means stored hashes stay verifiable after the cost
 * factors are raised — old rows verify with their own parameters, and can be
 * re-hashed on next successful login.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: MAX_MEM,
  })) as Buffer;

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_r,
    SCRYPT_p,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash, so a corrupted row
 * fails closed as a rejected login instead of a 500.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "hex");
    expected = Buffer.from(parts[5], "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = (await scryptAsync(
      password.normalize("NFKC"),
      salt,
      expected.length,
      { N, r, p, maxmem: 128 * N * r * 2 },
    )) as Buffer;

    // Constant-time comparison: a length check first, since timingSafeEqual
    // throws on mismatched lengths.
    return (
      derived.length === expected.length && timingSafeEqual(derived, expected)
    );
  } catch {
    return false;
  }
}
