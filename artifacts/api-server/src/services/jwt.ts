import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256 JWT implementation.
 *
 * Hand-rolled rather than pulled from npm because the requirement is narrow
 * (sign and verify our own short-lived access tokens) and this avoids adding a
 * dependency to the auth path. Refresh tokens are opaque random strings stored
 * hashed in the database — see `services/tokens.ts` — so the JWT here only ever
 * carries a 15-minute access claim.
 */

export type Role = "super_admin" | "company_admin" | "manager" | "employee";

export type AccessTokenClaims = {
  /** User id. */
  sub: string;
  /** Tenant scope. Null only for a platform-level super admin. */
  companyId: string | null;
  role: Role;
  /** Present when the user has an employee record. */
  employeeId: string | null;
  /** Issued-at and expiry, epoch seconds. */
  iat: number;
  exp: number;
};

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function sign(data: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(data).digest());
}

export function signAccessToken(
  claims: Omit<AccessTokenClaims, "iat" | "exp">,
  secret: string,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const payload: AccessTokenClaims = { ...claims, iat, exp: iat + ttlSeconds };

  const header = base64UrlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`, secret);

  return `${header}.${body}.${signature}`;
}

export type VerifyResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Verify and decode an access token.
 *
 * Note the algorithm is fixed to HS256 and read from our own construction
 * rather than from the token header — accepting the header's `alg` is the
 * classic JWT vulnerability (`alg: none`, or HMAC-vs-RSA confusion).
 */
export function verifyAccessToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`, secret);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(base64UrlDecode(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof claims.exp !== "number" || typeof claims.sub !== "string") {
    return { ok: false, reason: "malformed" };
  }

  if (Math.floor(now / 1000) >= claims.exp) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, claims };
}

/** Opaque refresh token: 32 random bytes, URL-safe. */
export function generateRefreshToken(): string {
  return base64UrlEncode(randomBytes(32));
}
