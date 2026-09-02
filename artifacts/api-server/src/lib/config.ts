/**
 * Environment configuration, validated once at startup.
 *
 * Failing fast here is deliberate: a missing JWT secret should stop the process,
 * not surface as an authentication bug hours later. The only exception is the
 * development fallback below, which is loud about what it is doing.
 */
import { randomBytes } from "node:crypto";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required but was not set. Add it to your .env file.`,
    );
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number, received "${raw}".`);
  }
  return parsed;
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * In production the secret must be supplied. In development we generate an
 * ephemeral one so `pnpm dev` works on a fresh clone — tokens simply stop
 * validating across restarts, which is harmless locally.
 */
function resolveJwtSecret(): string {
  const provided = process.env.JWT_SECRET;
  if (provided && provided.length >= 32) return provided;

  if (isProduction) {
    throw new Error(
      "JWT_SECRET must be set to at least 32 characters in production.",
    );
  }

  if (provided) {
    // Present but too short — likelier a mistake than a deliberate choice.
    throw new Error(
      `JWT_SECRET must be at least 32 characters (received ${provided.length}).`,
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    "[config] JWT_SECRET not set — generating an ephemeral development secret. " +
      "Sessions will not survive a restart.",
  );
  return randomBytes(48).toString("hex");
}

export const config = {
  isProduction,
  port: optionalNumber("PORT", 5000),
  databaseUrl: required("DATABASE_URL"),

  jwtSecret: resolveJwtSecret(),
  /** Short-lived by design; the refresh token carries longevity. */
  accessTokenTtlSeconds: optionalNumber("ACCESS_TOKEN_TTL_SECONDS", 15 * 60),
  refreshTokenTtlSeconds: optionalNumber(
    "REFRESH_TOKEN_TTL_SECONDS",
    30 * 24 * 60 * 60,
  ),

  /**
   * How often the sweeper looks for sessions to auto-close. Lower means
   * tighter checkout timing but more database churn; 60s is well inside the
   * default 5-minute grace period.
   */
  sweeperIntervalMs: optionalNumber("SWEEPER_INTERVAL_MS", 60_000),
  sweeperEnabled: process.env.SWEEPER_ENABLED !== "false",

  /**
   * How long past a workplace's closing time a session may stay open before
   * the sweeper closes it for review. Covers the phone left charging on a desk
   * overnight, which keeps heartbeating from inside the geofence and so is
   * invisible to the heartbeat timeout.
   */
  workdayOverrunMarginMinutes: optionalNumber(
    "WORKDAY_OVERRUN_MARGIN_MINUTES",
    120,
  ),

  /** Failed logins allowed before an account is temporarily locked. */
  maxFailedLogins: optionalNumber("MAX_FAILED_LOGINS", 8),
  loginLockoutMinutes: optionalNumber("LOGIN_LOCKOUT_MINUTES", 15),
} as const;
