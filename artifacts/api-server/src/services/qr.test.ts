import { describe, expect, it } from "vitest";
import {
  generateQrSecret,
  generateQrToken,
  peekWorkplaceId,
  secondsUntilRotation,
  verifyQrToken,
} from "./qr";

const WORKPLACE = "8b1d4c2a-0000-4000-8000-000000000001";
const SECRET = "a".repeat(64);
const ROTATION = 30;
const T0 = 1_700_000_000_000;

function token(now: number, mode: "rotating" | "static" = "rotating") {
  return generateQrToken({
    workplaceId: WORKPLACE,
    secret: SECRET,
    mode,
    rotationSeconds: ROTATION,
    now,
  });
}

function verify(
  t: string,
  now: number,
  overrides: Partial<Parameters<typeof verifyQrToken>[0]> = {},
) {
  return verifyQrToken({
    token: t,
    workplaceId: WORKPLACE,
    secret: SECRET,
    mode: "rotating",
    rotationSeconds: ROTATION,
    now,
    ...overrides,
  });
}

describe("generateQrSecret", () => {
  it("produces a 256-bit hex secret", () => {
    expect(generateQrSecret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    expect(generateQrSecret()).not.toBe(generateQrSecret());
  });
});

describe("rotating tokens", () => {
  it("accepts a token from the current window", () => {
    expect(verify(token(T0), T0)).toEqual({ ok: true, workplaceId: WORKPLACE });
  });

  it("changes when the window advances", () => {
    expect(token(T0)).not.toBe(token(T0 + ROTATION * 1000));
  });

  it("is stable within a single window", () => {
    expect(token(T0)).toBe(token(T0 + 5_000));
  });

  it("tolerates one window of clock skew in each direction", () => {
    // A phone whose clock is slightly off, or a scan landing right on the
    // rotation boundary, must still work.
    const current = token(T0);
    expect(verify(current, T0 + ROTATION * 1000).ok).toBe(true);
    expect(verify(current, T0 - ROTATION * 1000).ok).toBe(true);
  });

  it("rejects a screenshot two windows old", () => {
    // The whole point of rotation: a shared screenshot stops working quickly.
    const stale = token(T0);
    const result = verify(stale, T0 + ROTATION * 1000 * 2.5);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token signed with a different secret", () => {
    const forged = generateQrToken({
      workplaceId: WORKPLACE,
      secret: "b".repeat(64),
      mode: "rotating",
      rotationSeconds: ROTATION,
      now: T0,
    });
    expect(verify(forged, T0)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a token minted for another workplace", () => {
    const other = generateQrToken({
      workplaceId: "8b1d4c2a-0000-4000-8000-000000000002",
      secret: SECRET,
      mode: "rotating",
      rotationSeconds: ROTATION,
      now: T0,
    });
    expect(verify(other, T0)).toEqual({ ok: false, reason: "wrong_workplace" });
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "nonsense", "v1.a.b", "v2.a.1.deadbeef"]) {
      expect(verify(bad, T0).ok).toBe(false);
    }
  });

  it("rejects a tampered counter", () => {
    const parts = token(T0).split(".");
    parts[2] = String(Number(parts[2]) + 1);
    // Wrong signature for that counter — and one window ahead is within skew,
    // so this specifically proves the HMAC is checked, not just the window.
    expect(verify(parts.join("."), T0)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});

describe("static tokens", () => {
  it("never expires", () => {
    const t = token(T0, "static");
    const oneYearLater = T0 + 365 * 24 * 3600 * 1000;
    expect(
      verify(t, oneYearLater, { mode: "static" }),
    ).toEqual({ ok: true, workplaceId: WORKPLACE });
  });

  it("is identical across time", () => {
    expect(token(T0, "static")).toBe(token(T0 + 999_999_999, "static"));
  });
});

describe("peekWorkplaceId", () => {
  it("extracts the workplace id without the secret", () => {
    expect(peekWorkplaceId(token(T0))).toBe(WORKPLACE);
  });

  it("returns null for junk", () => {
    expect(peekWorkplaceId("not-a-token")).toBeNull();
  });
});

describe("secondsUntilRotation", () => {
  it("counts down within the window", () => {
    const atWindowStart = Math.floor(T0 / 1000 / ROTATION) * ROTATION * 1000;
    expect(secondsUntilRotation(ROTATION, atWindowStart)).toBe(ROTATION);
    expect(secondsUntilRotation(ROTATION, atWindowStart + 10_000)).toBe(20);
  });
});
