import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, type Role } from "../services/jwt";
import { config } from "../lib/config";

/**
 * Authentication and authorisation middleware.
 *
 * Two rules hold across the whole API:
 *
 *  1. Every authenticated request carries a `companyId`, and handlers filter by
 *     `req.auth.companyId` rather than by anything in the request body. A
 *     client cannot reach another tenant's data by supplying a different id.
 *  2. Employees are confined to their own records. Managers see only what
 *     `manager_scopes` grants them. This is checked here, not in each handler.
 */

export type AuthContext = {
  userId: string;
  companyId: string | null;
  role: Role;
  employeeId: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Ranking used by `requireRole`; higher grants everything below it. */
const ROLE_RANK: Record<Role, number> = {
  employee: 0,
  manager: 1,
  company_admin: 2,
  super_admin: 3,
};

function extractBearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

/**
 * Reject the request unless it carries a valid, unexpired access token.
 *
 * `token_expired` is returned as a distinct code so the mobile client can tell
 * "refresh me" apart from "log in again" and avoid bouncing the user to the
 * login screen on a routine 15-minute expiry.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({
      code: "unauthenticated",
      message: "Sign in to continue.",
    });
    return;
  }

  const result = verifyAccessToken(token, config.jwtSecret);
  if (!result.ok) {
    if (result.reason === "expired") {
      res.status(401).json({
        code: "token_expired",
        message: "Your session expired. Refreshing…",
      });
      return;
    }
    res.status(401).json({
      code: "invalid_token",
      message: "Sign in to continue.",
    });
    return;
  }

  req.auth = {
    userId: result.claims.sub,
    companyId: result.claims.companyId,
    role: result.claims.role,
    employeeId: result.claims.employeeId,
  };
  next();
}

/** Require at least the given role. Must run after `requireAuth`. */
export function requireRole(minimum: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ code: "unauthenticated", message: "Sign in to continue." });
      return;
    }
    if (ROLE_RANK[req.auth.role] < ROLE_RANK[minimum]) {
      res.status(403).json({
        code: "forbidden",
        message: "You do not have access to this resource.",
      });
      return;
    }
    next();
  };
}

/**
 * Require a tenant-scoped identity.
 *
 * A `super_admin` has a null `companyId`; routes that operate on company data
 * need one, so such a caller must act through an explicit company context
 * rather than implicitly against all tenants.
 */
export function requireCompany(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    res.status(401).json({ code: "unauthenticated", message: "Sign in to continue." });
    return;
  }
  if (!req.auth.companyId) {
    res.status(403).json({
      code: "company_scope_required",
      message: "This action must be performed within a company context.",
    });
    return;
  }
  next();
}

/**
 * Require the caller to have an employee record — the attendance endpoints are
 * meaningless for an admin-only login.
 */
export function requireEmployee(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth?.employeeId) {
    res.status(403).json({
      code: "employee_required",
      message: "This account is not linked to an employee record.",
    });
    return;
  }
  next();
}

/**
 * Whether the caller may read another employee's data.
 *
 * Employees may only ever read themselves. Managers are handled by the caller,
 * which must consult `manager_scopes` — this helper deliberately returns false
 * for managers so that forgetting the scope lookup fails closed.
 */
export function canAccessEmployee(
  auth: AuthContext,
  targetEmployeeId: string,
): boolean {
  if (auth.role === "super_admin" || auth.role === "company_admin") return true;
  return auth.employeeId === targetEmployeeId;
}
