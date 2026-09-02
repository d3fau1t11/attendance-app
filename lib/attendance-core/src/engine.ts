/**
 * The attendance state machine.
 *
 * Deliberately pure: it takes the current session state plus one observation
 * and returns a *decision*. It performs no I/O, reads no clock, and touches no
 * database — the caller supplies `now`. That makes every branch below testable,
 * including the ones that are impractical to reproduce on a real phone (a
 * battery dying mid-shift, a grace period expiring at a boundary).
 *
 * Authority lives here, on the server. The device only reports what it sees.
 * A client-side grace timer would die with the process, so the deadline is
 * persisted (`exitGraceUntil`) and enforced by the sweeper.
 */
import type { GeofenceVerdict } from "./geofence";

export type SessionStatus =
  | "checked_in"
  | "pending_exit"
  | "checked_out"
  | "needs_review";

export type CheckoutReason =
  | "manual"
  | "auto_geofence_exit"
  | "auto_heartbeat_lost"
  | "auto_workday_end"
  | "admin_override";

/** The subset of an attendance session the state machine reasons about. */
export type SessionState = {
  status: SessionStatus;
  checkInAt: number;
  /** When a confident exit was first observed, if any. */
  exitDetectedAt: number | null;
  /** Deadline to return before the session is auto-closed. */
  exitGraceUntil: number | null;
  /** Last fix that confidently placed the device inside the geofence. */
  lastInsideAt: number | null;
  /** Last contact of any kind from the device. */
  lastHeartbeatAt: number | null;
};

export type EngineConfig = {
  exitGraceSeconds: number;
  heartbeatTimeoutSeconds: number;
};

/** An observation reported by the device. */
export type Observation = {
  verdict: GeofenceVerdict;
  /** When the device observed it (epoch ms), not when it was received. */
  occurredAt: number;
};

export type Decision =
  | { kind: "no_change"; reason: string }
  | { kind: "start_grace"; exitDetectedAt: number; exitGraceUntil: number }
  | { kind: "cancel_grace"; returnedAt: number }
  | { kind: "confirm_inside"; at: number }
  | {
      kind: "close_session";
      status: Extract<SessionStatus, "checked_out" | "needs_review">;
      checkOutAt: number;
      reason: CheckoutReason;
      /** Flags to append; non-empty means the session lands in review. */
      flags: string[];
    };

const OPEN_STATUSES: readonly SessionStatus[] = ["checked_in", "pending_exit"];

export function isOpen(status: SessionStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/**
 * Apply one location observation to an open session.
 *
 * The `inconclusive` case is load-bearing: an uncertain fix must never start a
 * grace period and must never cancel one. Treating "I don't know" as either
 * "inside" or "outside" is exactly how naive implementations produce phantom
 * check-outs.
 */
export function applyObservation(
  session: SessionState,
  observation: Observation,
  config: EngineConfig,
): Decision {
  if (!isOpen(session.status)) {
    return { kind: "no_change", reason: "session_not_open" };
  }

  // Ignore observations older than what we've already processed. Offline
  // replay can deliver events out of order; stale data must not resurrect a
  // superseded state.
  const latestKnown = Math.max(
    session.lastInsideAt ?? 0,
    session.exitDetectedAt ?? 0,
  );
  if (observation.occurredAt < latestKnown) {
    return { kind: "no_change", reason: "stale_observation" };
  }

  if (observation.verdict === "inconclusive") {
    return { kind: "no_change", reason: "inconclusive_fix" };
  }

  if (observation.verdict === "inside") {
    if (session.status === "pending_exit") {
      // They came back inside the grace window — the exit was transient.
      return { kind: "cancel_grace", returnedAt: observation.occurredAt };
    }
    return { kind: "confirm_inside", at: observation.occurredAt };
  }

  // verdict === "outside"
  if (session.status === "pending_exit") {
    // Already counting down; a second exit reading changes nothing.
    return { kind: "no_change", reason: "grace_already_running" };
  }

  return {
    kind: "start_grace",
    exitDetectedAt: observation.occurredAt,
    exitGraceUntil: observation.occurredAt + config.exitGraceSeconds * 1000,
  };
}

/**
 * Decide whether an open session should be closed without any new observation.
 * This is the sweeper's brain, and it is what makes the system survive a phone
 * that is switched off, out of battery, or force-stopped.
 */
export function evaluateOpenSession(
  session: SessionState,
  now: number,
  config: EngineConfig,
): Decision {
  if (!isOpen(session.status)) {
    return { kind: "no_change", reason: "session_not_open" };
  }

  // Case 1: they left and the grace period ran out.
  //
  // The session closes at the moment they *left*, not at the moment the sweeper
  // noticed — nobody should be credited for the grace period they spent away.
  // This is a clean, trustworthy close, so it carries no review flag.
  if (
    session.status === "pending_exit" &&
    session.exitGraceUntil !== null &&
    now >= session.exitGraceUntil
  ) {
    return {
      kind: "close_session",
      status: "checked_out",
      checkOutAt: session.exitDetectedAt ?? session.exitGraceUntil,
      reason: "auto_geofence_exit",
      flags: [],
    };
  }

  // Case 2: the device went silent — powered off, killed, or offline long
  // enough that we can no longer vouch for the time.
  //
  // We close at the last moment we could *prove* presence and flag it, rather
  // than either inventing hours or discarding a real shift. A human decides.
  const lastContact = session.lastHeartbeatAt ?? session.checkInAt;
  const silenceMs = now - lastContact;
  if (silenceMs > config.heartbeatTimeoutSeconds * 1000) {
    return {
      kind: "close_session",
      status: "needs_review",
      checkOutAt: session.lastInsideAt ?? lastContact,
      reason: "auto_heartbeat_lost",
      flags: ["app_terminated"],
    };
  }

  return { kind: "no_change", reason: "session_healthy" };
}

/**
 * Close a session that is still open well past the end of the working day.
 * Prevents a forgotten session accruing hours indefinitely; always flagged,
 * because the true departure time is unknown.
 */
export function evaluateWorkdayOverrun(
  session: SessionState,
  workdayEndAt: number,
  now: number,
  marginMinutes: number,
): Decision {
  if (!isOpen(session.status)) {
    return { kind: "no_change", reason: "session_not_open" };
  }
  if (now < workdayEndAt + marginMinutes * 60_000) {
    return { kind: "no_change", reason: "within_workday" };
  }
  return {
    kind: "close_session",
    status: "needs_review",
    checkOutAt: session.lastInsideAt ?? workdayEndAt,
    reason: "auto_workday_end",
    flags: [],
  };
}

/** Whole minutes between check-in and check-out, floored at zero. */
export function durationMinutes(checkInAt: number, checkOutAt: number): number {
  return Math.max(0, Math.floor((checkOutAt - checkInAt) / 60_000));
}

/**
 * Lateness against the configured start time, honouring the grace window.
 * Returns 0 when on time so callers can treat the value as "minutes late".
 */
export function lateByMinutes(
  checkInAt: number,
  workStartAt: number,
  graceMinutes: number,
): number {
  const lateMs = checkInAt - (workStartAt + graceMinutes * 60_000);
  return lateMs <= 0 ? 0 : Math.floor(lateMs / 60_000);
}
