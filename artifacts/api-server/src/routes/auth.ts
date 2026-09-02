import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, employees, users } from "@workspace/db";
import { config } from "../lib/config";
import { requireAuth } from "../middlewares/auth";
import { signAccessToken } from "../services/jwt";
import { verifyPassword } from "../services/password";
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../services/tokens";
import { recordAudit } from "../services/audit";

const router: IRouter = Router();

/**
 * Uniform failure response for login.
 *
 * Deliberately identical for "no such user", "wrong password" and "inactive
 * account" so the endpoint cannot be used to enumerate valid email addresses.
 */
const LOGIN_FAILED = {
  code: "invalid_credentials",
  message: "Email or password is incorrect.",
} as const;

/**
 * A well-formed hash that no password matches, verified against when the
 * address is unknown so the response time does not reveal that fact.
 */
const DUMMY_HASH = "scrypt$32768$8$1$00000000000000000000000000000000$00";

/**
 * How many accounts sharing one address we are willing to test a password
 * against. Email is unique *per tenant* (`users_company_email_idx`), so the
 * same person can hold accounts at two companies on a shared deployment. The
 * cap bounds the work a single login request can cause.
 */
const MAX_LOGIN_CANDIDATES = 5;

async function buildSession(userId: string, userAgent: string | null) {
  const [row] = await db
    .select({
      id: users.id,
      companyId: users.companyId,
      role: users.role,
      email: users.email,
      fullName: users.fullName,
      isActive: users.isActive,
      employeeId: employees.id,
    })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || !row.isActive) return null;

  const accessToken = signAccessToken(
    {
      sub: row.id,
      companyId: row.companyId,
      role: row.role,
      employeeId: row.employeeId ?? null,
    },
    config.jwtSecret,
    config.accessTokenTtlSeconds,
  );

  const refresh = await issueRefreshToken({ userId: row.id, userAgent });

  return {
    accessToken,
    refreshToken: refresh.token,
    expiresIn: config.accessTokenTtlSeconds,
    user: {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      companyId: row.companyId,
      employeeId: row.employeeId ?? null,
    },
  };
}

router.post("/auth/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");

  if (!email || !password) {
    res.status(400).json({
      code: "missing_credentials",
      message: "Email and password are required.",
    });
    return;
  }

  // Fetch every account holding this address, not just the first row. Picking
  // one arbitrarily would make login non-deterministic on a shared deployment:
  // the same person at two companies would sometimes be handed the wrong
  // account's hash and be permanently unable to sign in. The password decides
  // which account was meant.
  const candidates = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .orderBy(users.createdAt)
    .limit(MAX_LOGIN_CANDIDATES);

  let user: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (await verifyPassword(password, candidate.passwordHash)) {
      user = candidate;
      break;
    }
  }

  if (!user) {
    // Spend the cost of a hash comparison even when the address is unknown, so
    // the response time does not reveal whether it is registered.
    if (candidates.length === 0) await verifyPassword(password, DUMMY_HASH);

    // Only attribute the failure when there is exactly one account it could
    // have been. Otherwise a wrong password aimed at tenant A would count
    // towards locking tenant B's unrelated account.
    const [only] = candidates;
    if (candidates.length === 1) {
      const failures = only.failedLoginCount + 1;
      const shouldLock = failures >= config.maxFailedLogins;
      await db
        .update(users)
        .set({
          failedLoginCount: failures,
          lockedUntil: shouldLock
            ? new Date(Date.now() + config.loginLockoutMinutes * 60_000)
            : only.lockedUntil,
        })
        .where(eq(users.id, only.id));
      await recordAudit({
        companyId: only.companyId,
        actorUserId: only.id,
        action: "auth.login_failed",
        metadata: { failures, locked: shouldLock },
        ipAddress: req.ip ?? null,
      });
    }
    res.status(401).json(LOGIN_FAILED);
    return;
  }

  if (!user.isActive) {
    res.status(401).json(LOGIN_FAILED);
    return;
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    res.status(423).json({
      code: "account_locked",
      message:
        "Too many failed attempts. Try again later or contact your administrator.",
    });
    return;
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  const session = await buildSession(user.id, req.header("user-agent") ?? null);
  if (!session) {
    res.status(401).json(LOGIN_FAILED);
    return;
  }

  await recordAudit({
    companyId: user.companyId,
    actorUserId: user.id,
    action: "auth.login",
    ipAddress: req.ip ?? null,
  });

  res.json(session);
});

router.post("/auth/refresh", async (req, res) => {
  const presented = String(req.body?.refreshToken ?? "");
  if (!presented) {
    res.status(400).json({
      code: "missing_refresh_token",
      message: "A refresh token is required.",
    });
    return;
  }

  const outcome = await rotateRefreshToken(
    presented,
    req.header("user-agent") ?? null,
  );

  if (!outcome.ok) {
    // `reused` means a leaked token was replayed; every session for that user
    // has just been revoked, so the client must sign in again.
    res.status(401).json({
      code: outcome.reason === "reused" ? "token_reuse_detected" : "invalid_refresh_token",
      message: "Your session has ended. Please sign in again.",
    });
    return;
  }

  const [row] = await db
    .select({
      id: users.id,
      companyId: users.companyId,
      role: users.role,
      email: users.email,
      fullName: users.fullName,
      isActive: users.isActive,
      employeeId: employees.id,
    })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(eq(users.id, outcome.userId))
    .limit(1);

  if (!row || !row.isActive) {
    res.status(401).json({
      code: "invalid_refresh_token",
      message: "Your session has ended. Please sign in again.",
    });
    return;
  }

  res.json({
    accessToken: signAccessToken(
      {
        sub: row.id,
        companyId: row.companyId,
        role: row.role,
        employeeId: row.employeeId ?? null,
      },
      config.jwtSecret,
      config.accessTokenTtlSeconds,
    ),
    refreshToken: outcome.token,
    expiresIn: config.accessTokenTtlSeconds,
    user: {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      companyId: row.companyId,
      employeeId: row.employeeId ?? null,
    },
  });
});

router.post("/auth/logout", async (req, res) => {
  const presented = String(req.body?.refreshToken ?? "");
  if (presented) await revokeRefreshToken(presented);
  res.status(204).send();
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const auth = req.auth!;
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      companyId: users.companyId,
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      jobTitle: employees.jobTitle,
    })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(and(eq(users.id, auth.userId), eq(users.isActive, true)))
    .limit(1);

  if (!row) {
    res.status(404).json({ code: "not_found", message: "Account not found." });
    return;
  }

  res.json({
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    companyId: row.companyId,
    employeeId: row.employeeId ?? null,
    employeeCode: row.employeeCode ?? null,
    jobTitle: row.jobTitle ?? null,
  });
});

export default router;
