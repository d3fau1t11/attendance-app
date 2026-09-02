import { describe, expect, it } from "vitest";
import {
  applyObservation,
  durationMinutes,
  evaluateOpenSession,
  evaluateWorkdayOverrun,
  lateByMinutes,
  type EngineConfig,
  type SessionState,
} from "./engine";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

const config: EngineConfig = {
  exitGraceSeconds: 300, // 5 minutes
  heartbeatTimeoutSeconds: 1800, // 30 minutes
};

function openSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    status: "checked_in",
    checkInAt: T0,
    exitDetectedAt: null,
    exitGraceUntil: null,
    lastInsideAt: T0,
    lastHeartbeatAt: T0,
    ...overrides,
  };
}

describe("applyObservation", () => {
  it("starts a grace period on a confident exit", () => {
    const decision = applyObservation(
      openSession(),
      { verdict: "outside", occurredAt: T0 + 10 * MIN },
      config,
    );
    expect(decision).toEqual({
      kind: "start_grace",
      exitDetectedAt: T0 + 10 * MIN,
      exitGraceUntil: T0 + 15 * MIN,
    });
  });

  it("ignores an inconclusive fix entirely", () => {
    // Neither starts nor cancels a grace period — the whole point of the
    // three-valued verdict.
    const decision = applyObservation(
      openSession(),
      { verdict: "inconclusive", occurredAt: T0 + MIN },
      config,
    );
    expect(decision).toEqual({ kind: "no_change", reason: "inconclusive_fix" });
  });

  it("does not cancel a running grace period on an inconclusive fix", () => {
    const pending = openSession({
      status: "pending_exit",
      exitDetectedAt: T0 + 10 * MIN,
      exitGraceUntil: T0 + 15 * MIN,
    });
    const decision = applyObservation(
      pending,
      { verdict: "inconclusive", occurredAt: T0 + 12 * MIN },
      config,
    );
    expect(decision.kind).toBe("no_change");
  });

  it("cancels the grace period when the employee returns", () => {
    const pending = openSession({
      status: "pending_exit",
      exitDetectedAt: T0 + 10 * MIN,
      exitGraceUntil: T0 + 15 * MIN,
    });
    const decision = applyObservation(
      pending,
      { verdict: "inside", occurredAt: T0 + 12 * MIN },
      config,
    );
    expect(decision).toEqual({ kind: "cancel_grace", returnedAt: T0 + 12 * MIN });
  });

  it("does not restart the countdown on a repeated exit reading", () => {
    const pending = openSession({
      status: "pending_exit",
      exitDetectedAt: T0 + 10 * MIN,
      exitGraceUntil: T0 + 15 * MIN,
    });
    const decision = applyObservation(
      pending,
      { verdict: "outside", occurredAt: T0 + 13 * MIN },
      config,
    );
    // Otherwise a device reporting every 30s would extend the grace forever.
    expect(decision).toEqual({
      kind: "no_change",
      reason: "grace_already_running",
    });
  });

  it("discards observations older than what has been processed", () => {
    // Offline replay can deliver events out of order; a stale "inside" must not
    // resurrect a session that has since exited.
    const pending = openSession({
      status: "pending_exit",
      exitDetectedAt: T0 + 10 * MIN,
      exitGraceUntil: T0 + 15 * MIN,
      lastInsideAt: T0 + 9 * MIN,
    });
    const decision = applyObservation(
      pending,
      { verdict: "inside", occurredAt: T0 + 5 * MIN },
      config,
    );
    expect(decision).toEqual({ kind: "no_change", reason: "stale_observation" });
  });

  it("ignores observations against an already-closed session", () => {
    const closed = openSession({ status: "checked_out" });
    const decision = applyObservation(
      closed,
      { verdict: "outside", occurredAt: T0 + MIN },
      config,
    );
    expect(decision).toEqual({ kind: "no_change", reason: "session_not_open" });
  });
});

describe("evaluateOpenSession", () => {
  it("leaves a healthy session alone", () => {
    const decision = evaluateOpenSession(
      openSession({ lastHeartbeatAt: T0 + 5 * MIN }),
      T0 + 6 * MIN,
      config,
    );
    expect(decision).toEqual({ kind: "no_change", reason: "session_healthy" });
  });

  it("does not close while the grace period is still running", () => {
    const pending = openSession({
      status: "pending_exit",
      exitDetectedAt: T0 + 10 * MIN,
      exitGraceUntil: T0 + 15 * MIN,
      lastHeartbeatAt: T0 + 12 * MIN,
    });
    expect(evaluateOpenSession(pending, T0 + 13 * MIN, config).kind).toBe(
      "no_change",
    );
  });

  it("closes at the moment of exit, not the moment of detection", () => {
    // The employee must not be credited for the 5 minutes they were away
    // during the grace window, nor for the sweeper's polling delay.
    const pending = openSession({
      status: "pending_exit",
      exitDetectedAt: T0 + 10 * MIN,
      exitGraceUntil: T0 + 15 * MIN,
      lastHeartbeatAt: T0 + 14 * MIN,
    });
    const decision = evaluateOpenSession(pending, T0 + 17 * MIN, config);
    expect(decision).toEqual({
      kind: "close_session",
      status: "checked_out",
      checkOutAt: T0 + 10 * MIN,
      reason: "auto_geofence_exit",
      flags: [],
    });
  });

  it("closes a silent session for review rather than inventing hours", () => {
    // Phone switched off / force-stopped: we close at the last provable
    // presence and flag it, instead of accruing time or discarding the shift.
    const stale = openSession({
      lastHeartbeatAt: T0 + 20 * MIN,
      lastInsideAt: T0 + 20 * MIN,
    });
    const decision = evaluateOpenSession(stale, T0 + 60 * MIN, config);
    expect(decision).toEqual({
      kind: "close_session",
      status: "needs_review",
      checkOutAt: T0 + 20 * MIN,
      reason: "auto_heartbeat_lost",
      flags: ["app_terminated"],
    });
  });

  it("falls back to check-in time when a session never sent a heartbeat", () => {
    const decision = evaluateOpenSession(
      openSession({ lastHeartbeatAt: null, lastInsideAt: null }),
      T0 + 45 * MIN,
      config,
    );
    expect(decision).toMatchObject({
      kind: "close_session",
      checkOutAt: T0,
      reason: "auto_heartbeat_lost",
    });
  });

  it("prioritises an expired grace period over heartbeat silence", () => {
    // Both conditions hold; the geofence exit is the better-evidenced story and
    // should produce a clean close rather than a flagged one.
    const pending = openSession({
      status: "pending_exit",
      exitDetectedAt: T0 + 10 * MIN,
      exitGraceUntil: T0 + 15 * MIN,
      lastHeartbeatAt: T0 + 10 * MIN,
    });
    const decision = evaluateOpenSession(pending, T0 + 90 * MIN, config);
    expect(decision).toMatchObject({
      status: "checked_out",
      reason: "auto_geofence_exit",
    });
  });
});

describe("evaluateWorkdayOverrun", () => {
  const workdayEnd = T0 + 8 * 60 * MIN;

  it("leaves sessions alone during the working day", () => {
    expect(
      evaluateWorkdayOverrun(openSession(), workdayEnd, T0 + 4 * 60 * MIN, 120)
        .kind,
    ).toBe("no_change");
  });

  it("flags a session still open long after the workday ended", () => {
    const decision = evaluateWorkdayOverrun(
      openSession({ lastInsideAt: workdayEnd - 30 * MIN }),
      workdayEnd,
      workdayEnd + 180 * MIN,
      120,
    );
    expect(decision).toMatchObject({
      kind: "close_session",
      status: "needs_review",
      reason: "auto_workday_end",
      checkOutAt: workdayEnd - 30 * MIN,
    });
  });
});

describe("durationMinutes", () => {
  it("floors partial minutes", () => {
    expect(durationMinutes(T0, T0 + 90_000)).toBe(1);
  });

  it("never returns a negative duration", () => {
    expect(durationMinutes(T0, T0 - 60_000)).toBe(0);
  });
});

describe("lateByMinutes", () => {
  it("returns 0 within the grace window", () => {
    expect(lateByMinutes(T0 + 8 * MIN, T0, 10)).toBe(0);
  });

  it("counts minutes past the grace window", () => {
    expect(lateByMinutes(T0 + 25 * MIN, T0, 10)).toBe(15);
  });

  it("returns 0 for an early arrival", () => {
    expect(lateByMinutes(T0 - 20 * MIN, T0, 10)).toBe(0);
  });
});
