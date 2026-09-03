import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Workplace QR tokens.
 *
 * Rotating mode is the default. The payload carries no secret — it is an HMAC
 * over a time counter, so:
 *
 *   - a screenshot shared with a colleague stops working within one window;
 *   - the code can be rendered by any display that can reach the kiosk page;
 *   - verification is a pure recomputation, needing no stored nonce table.
 *
 * The QR is only ever *one* of the signals. Possession of a valid code proves
 * proximity to a display, not presence — the geofence check is what proves
 * location, and both must pass.
 */

export type QrMode = "rotating" | "static";

/** `v1.<workplaceId>.<counter>.<hmac>` — versioned so the format can evolve. */
const TOKEN_VERSION = "v1";

/**
 * Windows of clock skew tolerated on either side of the current counter.
 *
 * Tolerates up to 5 rotation steps (~2.5 minutes) to account for mobile phone
 * clock drift and network transmission latency when scanning real-time QR codes.
 */
const SKEW_WINDOWS = 5;

export function generateQrSecret(): string {
  return randomBytes(32).toString("hex");
}

function computeHmac(
  workplaceId: string,
  counter: number,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${TOKEN_VERSION}.${workplaceId}.${counter}`)
    .digest("hex")
    .slice(0, 32); // 128 bits — ample against forgery, keeps the QR small.
}

function counterFor(rotationSeconds: number, now: number): number {
  return Math.floor(now / 1000 / rotationSeconds);
}

/**
 * Issue the token for the current window.
 *
 * In `static` mode the counter is pinned to 0, producing a stable code suitable
 * for printing — for entrances with no screen. The tradeoff is explicit: a
 * printed code can be photographed, so such workplaces lean entirely on the
 * geofence for location proof.
 */
export function generateQrToken(params: {
  workplaceId: string;
  secret: string;
  mode: QrMode;
  rotationSeconds: number;
  now?: number;
}): string {
  const { workplaceId, secret, mode, rotationSeconds } = params;
  const now = params.now ?? Date.now();
  const counter = mode === "static" ? 0 : counterFor(rotationSeconds, now);

  return [
    TOKEN_VERSION,
    workplaceId,
    counter,
    computeHmac(workplaceId, counter, secret),
  ].join(".");
}

export type QrVerifyResult =
  | { ok: true; workplaceId: string }
  | {
      ok: false;
      reason: "malformed" | "wrong_workplace" | "expired" | "bad_signature";
    };

/**
 * Verify a scanned token against a workplace's secret.
 *
 * Comparison is constant-time to avoid leaking HMAC bytes, though the practical
 * risk is low given the short window.
 */
export function verifyQrToken(params: {
  token: string;
  workplaceId: string;
  secret: string;
  mode: QrMode;
  rotationSeconds: number;
  now?: number;
}): QrVerifyResult {
  const { token, workplaceId, secret, mode, rotationSeconds } = params;
  const now = params.now ?? Date.now();

  const parts = token.trim().split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, reason: "malformed" };
  }

  const [, tokenWorkplaceId, counterRaw, providedHmac] = parts;
  if (tokenWorkplaceId !== workplaceId) {
    return { ok: false, reason: "wrong_workplace" };
  }

  const counter = Number(counterRaw);
  if (!Number.isInteger(counter) || counter < 0) {
    return { ok: false, reason: "malformed" };
  }

  const acceptable =
    mode === "static"
      ? [0]
      : Array.from(
          { length: SKEW_WINDOWS * 2 + 1 },
          (_, i) => counterFor(rotationSeconds, now) - SKEW_WINDOWS + i,
        );

  if (!acceptable.includes(counter)) {
    // A stale screenshot lands here — the signature is genuine but the window
    // has passed.
    return { ok: false, reason: "expired" };
  }

  const expected = computeHmac(workplaceId, counter, secret);
  const a = Buffer.from(providedHmac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true, workplaceId };
}

/**
 * Extract the workplace id from a token without verifying it.
 *
 * Needed because verification requires the workplace's secret, which we can
 * only load once we know which workplace the scan claims to be for. The result
 * must be treated as untrusted until `verifyQrToken` succeeds.
 */
export function peekWorkplaceId(token: string): string | null {
  const parts = token.trim().split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
  return parts[1] || null;
}

/** Seconds until the current rotating window ends — drives the kiosk countdown. */
export function secondsUntilRotation(
  rotationSeconds: number,
  now: number = Date.now(),
): number {
  const elapsed = (now / 1000) % rotationSeconds;
  return Math.max(0, Math.ceil(rotationSeconds - elapsed));
}
