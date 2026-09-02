import { createHash } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db, refreshTokens } from "@workspace/db";
import { config } from "../lib/config";
import { generateRefreshToken } from "./jwt";

/**
 * Refresh-token lifecycle.
 *
 * Tokens are opaque random strings; only their SHA-256 digest is stored, so a
 * database leak does not yield usable sessions. SHA-256 (rather than scrypt) is
 * appropriate here because the token is 256 bits of entropy — there is no
 * dictionary to attack, and refresh happens often enough that a slow hash would
 * be a needless cost.
 *
 * Rotation with reuse detection: every refresh mints a new token and marks the
 * old one replaced. Presenting an already-replaced token means it leaked, so
 * the entire chain for that user is revoked.
 */

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(params: {
  userId: string;
  userAgent?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = generateRefreshToken();
  const expiresAt = new Date(
    Date.now() + config.refreshTokenTtlSeconds * 1000,
  );

  await db.insert(refreshTokens).values({
    userId: params.userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: params.userAgent ?? null,
  });

  return { token, expiresAt };
}

export type RefreshOutcome =
  | { ok: true; userId: string; token: string; expiresAt: Date }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "reused" };

/**
 * Exchange a refresh token for a new one.
 *
 * Runs in a transaction so a double-submit (common when a flaky network makes
 * the client retry) cannot mint two valid successors.
 */
export async function rotateRefreshToken(
  presented: string,
  userAgent?: string | null,
): Promise<RefreshOutcome> {
  const presentedHash = hashToken(presented);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, presentedHash))
      .limit(1);

    if (!existing) return { ok: false, reason: "not_found" as const };

    // A replaced token being presented again means someone is holding a copy
    // they should not have. Revoke everything for that user and force a login.
    if (existing.replacedByTokenHash) {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, existing.userId),
            isNull(refreshTokens.revokedAt),
          ),
        );
      return { ok: false, reason: "reused" as const };
    }

    if (existing.revokedAt) return { ok: false, reason: "revoked" as const };
    if (existing.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: "expired" as const };
    }

    const token = generateRefreshToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(
      Date.now() + config.refreshTokenTtlSeconds * 1000,
    );

    await tx.insert(refreshTokens).values({
      userId: existing.userId,
      tokenHash,
      expiresAt,
      userAgent: userAgent ?? existing.userAgent,
    });

    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedByTokenHash: tokenHash })
      .where(eq(refreshTokens.id, existing.id));

    return {
      ok: true as const,
      userId: existing.userId,
      token,
      expiresAt,
    };
  });
}

/** Revoke a single token — used on explicit sign-out. */
export async function revokeRefreshToken(token: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.tokenHash, hashToken(token)),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

/** Revoke every live token for a user — used on password change or lockout. */
export async function revokeAllForUser(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
    );
}

/** Housekeeping: drop expired rows so the table does not grow without bound. */
export async function purgeExpiredTokens(): Promise<void> {
  await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, new Date()));
}

export { hashToken };
