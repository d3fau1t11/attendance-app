import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import {
  generateRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "./jwt";

const SECRET = "x".repeat(48);
const T0 = 1_700_000_000_000;

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("salts, so identical passwords hash differently", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("embeds its parameters so old hashes stay verifiable", async () => {
    const hash = await hashPassword("test");
    expect(hash.split("$").slice(0, 4)).toEqual(["scrypt", "32768", "8", "1"]);
  });

  it("fails closed on a malformed stored hash", async () => {
    // A corrupted row must reject the login, not throw a 500.
    for (const bad of ["", "garbage", "scrypt$1$2", "bcrypt$a$b$c$d$e"]) {
      expect(await verifyPassword("test", bad)).toBe(false);
    }
  });

  it("normalises unicode so equivalent input verifies", async () => {
    // "é" composed vs. decomposed — the same password typed on two keyboards.
    const hash = await hashPassword("café");
    expect(await verifyPassword("café", hash)).toBe(true);
  });
});

describe("access tokens", () => {
  const claims = {
    sub: "user-1",
    companyId: "company-1",
    role: "employee" as const,
    employeeId: "employee-1",
  };

  it("round-trips claims", () => {
    const token = signAccessToken(claims, SECRET, 900, T0);
    const result = verifyAccessToken(token, SECRET, T0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe("user-1");
      expect(result.claims.companyId).toBe("company-1");
      expect(result.claims.role).toBe("employee");
    }
  });

  it("rejects a token signed with another secret", () => {
    const token = signAccessToken(claims, SECRET, 900, T0);
    expect(verifyAccessToken(token, "y".repeat(48), T0)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects an expired token", () => {
    const token = signAccessToken(claims, SECRET, 900, T0);
    expect(verifyAccessToken(token, SECRET, T0 + 901_000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("accepts a token one second before expiry", () => {
    const token = signAccessToken(claims, SECRET, 900, T0);
    expect(verifyAccessToken(token, SECRET, T0 + 899_000).ok).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const token = signAccessToken(claims, SECRET, 900, T0);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, role: "super_admin", iat: 0, exp: 9e9 }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(verifyAccessToken(`${header}.${forged}.${signature}`, SECRET, T0)).toEqual(
      { ok: false, reason: "bad_signature" },
    );
  });

  it("rejects the alg:none attack", () => {
    // A token whose header claims no signature is required must not verify.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
      .toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ ...claims, iat: 0, exp: 9e9 }),
    ).toString("base64url");
    expect(verifyAccessToken(`${header}.${body}.`, SECRET, T0).ok).toBe(false);
  });

  it("rejects structurally malformed tokens", () => {
    for (const bad of ["", "a", "a.b", "a.b.c.d"]) {
      expect(verifyAccessToken(bad, SECRET, T0).ok).toBe(false);
    }
  });
});

describe("refresh tokens", () => {
  it("generates unique, URL-safe tokens", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes base64url ≈ 43 chars.
    expect(a.length).toBeGreaterThanOrEqual(42);
  });
});
