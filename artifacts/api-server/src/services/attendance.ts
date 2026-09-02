import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  attendanceEvents,
  attendanceSessions,
  db,
  devices,
  employeeWorkplaces,
  sessionSignals,
  workplaces,
} from "@workspace/db";
import {
  applyObservation,
  detectAnomalies,
  durationMinutes,
  evaluateGeofence,
  lateByMinutes,
  type LocationFix,
} from "@workspace/attendance-core";
import { peekWorkplaceId, verifyQrToken } from "./qr";
import { workdayStartMs } from "../lib/time";
import { logger } from "../lib/logger";

/**
 * Attendance orchestration: the bridge between device reports and persisted
 * sessions.
 *
 * Division of responsibility — `@workspace/attendance-core` decides *what a
 * reading means* (pure, unit-tested); this module decides *what to write*
 * (transactional, database-aware). Keeping them apart is what lets the tricky
 * timing logic be tested without a database.
 */

export type DeviceContext = {
  installId?: string | null;
  model?: string | null;
  osName?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
};

export type CheckInInput = {
  companyId: string;
  employeeId: string;
  clientEventId: string;
  clientSequence?: number;
  qrToken: string;
  fix: LocationFix;
  occurredAt: Date;
  source?: "online" | "offline" | "background";
  device?: DeviceContext;
  /** Toggles reported by the device during this attempt. */
  providerToggleCount?: number;
};

export type CheckInResult =
  | { ok: true; sessionId: string; status: string; flags: string[]; alreadyExisted: boolean }
  | {
      ok: false;
      code:
        | "qr_invalid"
        | "qr_expired"
        | "workplace_not_found"
        | "not_assigned"
        | "outside_geofence"
        | "accuracy_too_poor"
        | "already_checked_in";
      message: string;
      /** Present on geofence rejections so the UI can tell the user how far off they are. */
      distanceM?: number;
    };

/** Timestamps from an untrusted device are clamped into a sane band. */
const MAX_CLOCK_SKEW_MS = 10 * 60_000;
const MAX_BACKDATE_MS = 7 * 24 * 60 * 60_000;

function clampOccurredAt(occurredAt: Date, now: number): Date {
  const t = occurredAt.getTime();
  if (!Number.isFinite(t)) return new Date(now);
  // A device clock running fast must not create attendance in the future.
  if (t > now + MAX_CLOCK_SKEW_MS) return new Date(now);
  // Nor may an offline replay claim a shift from last month.
  if (t < now - MAX_BACKDATE_MS) return new Date(now - MAX_BACKDATE_MS);
  return occurredAt;
}

async function upsertDevice(params: {
  companyId: string;
  employeeId: string;
  device?: DeviceContext;
}): Promise<{ deviceId: string | null; isKnown: boolean }> {
  const installId = params.device?.installId;
  if (!installId) return { deviceId: null, isKnown: true };

  const [existing] = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.employeeId, params.employeeId),
        eq(devices.installId, installId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(devices)
      .set({ lastSeenAt: new Date(), appVersion: params.device?.appVersion ?? existing.appVersion })
      .where(eq(devices.id, existing.id));
    return { deviceId: existing.id, isKnown: true };
  }

  const [created] = await db
    .insert(devices)
    .values({
      companyId: params.companyId,
      employeeId: params.employeeId,
      installId,
      model: params.device?.model ?? null,
      osName: params.device?.osName ?? null,
      osVersion: params.device?.osVersion ?? null,
      appVersion: params.device?.appVersion ?? null,
      lastSeenAt: new Date(),
    })
    .returning({ id: devices.id });

  return { deviceId: created?.id ?? null, isKnown: false };
}

/**
 * Check in.
 *
 * The order of checks matters: QR before geofence, because a bad QR is a
 * cheap rejection; geofence before any write, because we must never persist an
 * attendance record for someone outside the boundary.
 */
export async function checkIn(input: CheckInInput): Promise<CheckInResult> {
  const now = Date.now();
  const occurredAt = clampOccurredAt(input.occurredAt, now);

  // --- 1. Resolve and verify the QR token -------------------------------
  const claimedWorkplaceId = peekWorkplaceId(input.qrToken);
  if (!claimedWorkplaceId) {
    return {
      ok: false,
      code: "qr_invalid",
      message: "That is not a valid workplace code.",
    };
  }

  const [workplace] = await db
    .select()
    .from(workplaces)
    .where(
      and(
        eq(workplaces.id, claimedWorkplaceId),
        eq(workplaces.companyId, input.companyId),
        eq(workplaces.isActive, true),
      ),
    )
    .limit(1);

  if (!workplace) {
    return {
      ok: false,
      code: "workplace_not_found",
      message: "This workplace code is not recognised.",
    };
  }

  const qr = verifyQrToken({
    token: input.qrToken,
    workplaceId: workplace.id,
    secret: workplace.qrSecret,
    mode: workplace.qrMode,
    rotationSeconds: workplace.qrRotationSeconds,
    now,
  });

  if (!qr.ok) {
    return qr.reason === "expired"
      ? {
          ok: false,
          code: "qr_expired",
          message:
            "That code has expired. Scan the code currently on screen at the entrance.",
        }
      : {
          ok: false,
          code: "qr_invalid",
          message: "That is not a valid workplace code.",
        };
  }

  // --- 2. Is this employee allowed to attend here? ----------------------
  const [assignment] = await db
    .select({ employeeId: employeeWorkplaces.employeeId })
    .from(employeeWorkplaces)
    .where(
      and(
        eq(employeeWorkplaces.employeeId, input.employeeId),
        eq(employeeWorkplaces.workplaceId, workplace.id),
      ),
    )
    .limit(1);

  if (!assignment) {
    return {
      ok: false,
      code: "not_assigned",
      message: "You are not assigned to this workplace.",
    };
  }

  // --- 3. Geofence -------------------------------------------------------
  const evaluation = evaluateGeofence(input.fix, {
    latitude: workplace.latitude,
    longitude: workplace.longitude,
    radiusM: workplace.radiusM,
    exitBufferM: workplace.exitBufferM,
    maxAccuracyM: workplace.maxAccuracyM,
  });

  if (evaluation.reason === "accuracy_too_poor") {
    // Explicitly NOT an attendance record. Telling the user why beats silently
    // failing or, worse, recording a check-in we cannot stand behind.
    return {
      ok: false,
      code: "accuracy_too_poor",
      message:
        "Your GPS signal is too weak to confirm your location. Move to an open area and try again.",
      distanceM: evaluation.distanceM,
    };
  }

  if (evaluation.verdict !== "inside") {
    return {
      ok: false,
      code: "outside_geofence",
      message: `You are about ${Math.round(evaluation.distanceM)}m from ${workplace.name}. Move closer and try again.`,
      distanceM: evaluation.distanceM,
    };
  }

  // --- 4. Anti-fraud signals (advisory only) -----------------------------
  const { deviceId, isKnown } = await upsertDevice({
    companyId: input.companyId,
    employeeId: input.employeeId,
    device: input.device,
  });

  const [previousEvent] = await db
    .select({
      latitude: attendanceEvents.latitude,
      longitude: attendanceEvents.longitude,
      accuracyM: attendanceEvents.accuracyM,
      occurredAt: attendanceEvents.occurredAt,
    })
    .from(attendanceEvents)
    .where(
      and(
        eq(attendanceEvents.employeeId, input.employeeId),
        sql`${attendanceEvents.latitude} is not null`,
      ),
    )
    .orderBy(desc(attendanceEvents.occurredAt))
    .limit(1);

  const anomalies = detectAnomalies({
    current: input.fix,
    previous:
      previousEvent?.latitude != null && previousEvent.longitude != null
        ? {
            latitude: previousEvent.latitude,
            longitude: previousEvent.longitude,
            accuracyM: previousEvent.accuracyM ?? 0,
            timestamp: previousEvent.occurredAt.getTime(),
          }
        : null,
    providerToggleCount: input.providerToggleCount,
    isKnownDevice: isKnown,
  });

  // --- 5. Create the session --------------------------------------------
  // Lateness is measured against the start time as written in the workplace's
  // own timezone, not the server's.
  const minutesLate = lateByMinutes(
    occurredAt.getTime(),
    workdayStartMs(workplace, occurredAt),
    workplace.lateGraceMinutes,
  );
  const isLate = minutesLate > 0;

  try {
    return await db.transaction(async (tx) => {
      // Idempotency: a replayed offline event must not open a second session.
      const [duplicate] = await tx
        .select({ sessionId: attendanceEvents.sessionId })
        .from(attendanceEvents)
        .where(
          and(
            eq(attendanceEvents.employeeId, input.employeeId),
            eq(attendanceEvents.clientEventId, input.clientEventId),
          ),
        )
        .limit(1);

      if (duplicate) {
        return {
          ok: true as const,
          sessionId: duplicate.sessionId ?? "",
          status: "checked_in",
          flags: anomalies.flags,
          alreadyExisted: true,
        };
      }

      const [session] = await tx
        .insert(attendanceSessions)
        .values({
          companyId: input.companyId,
          employeeId: input.employeeId,
          workplaceId: workplace.id,
          status: "checked_in",
          checkInAt: occurredAt,
          lastInsideAt: occurredAt,
          lastHeartbeatAt: occurredAt,
          isLate,
          lateByMinutes: isLate ? minutesLate : null,
          flags: anomalies.flags,
          needsReview: anomalies.flags.length > 0,
          reviewNote: anomalies.notes.join(" ") || null,
        })
        .returning({ id: attendanceSessions.id });

      await tx.insert(attendanceEvents).values({
        companyId: input.companyId,
        employeeId: input.employeeId,
        sessionId: session.id,
        workplaceId: workplace.id,
        clientEventId: input.clientEventId,
        clientSequence: input.clientSequence ?? 0,
        eventType: "check_in",
        source: input.source ?? "online",
        occurredAt,
        latitude: input.fix.latitude,
        longitude: input.fix.longitude,
        accuracyM: input.fix.accuracyM,
        distanceM: evaluation.distanceM,
        isInside: true,
        isMockLocation: Boolean(input.fix.isMocked),
        deviceId,
      });

      for (const flag of anomalies.flags) {
        await tx.insert(sessionSignals).values({
          companyId: input.companyId,
          employeeId: input.employeeId,
          sessionId: session.id,
          signalType: flag,
          detail: anomalies.notes.join(" "),
          occurredAt,
        });
      }

      return {
        ok: true as const,
        sessionId: session.id,
        status: "checked_in",
        flags: anomalies.flags,
        alreadyExisted: false,
      };
    });
  } catch (error) {
    // The partial unique index on open sessions rejects a concurrent double
    // check-in. Surfacing it as a clean conflict is correct — the session the
    // user wanted already exists.
    if (isUniqueViolation(error, "attendance_sessions_one_open_idx")) {
      return {
        ok: false,
        code: "already_checked_in",
        message: "You are already checked in.",
      };
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as { code?: string; constraint?: string; message?: string };
  if (e?.code !== "23505") return false;
  if (!constraint) return true;
  return (
    e.constraint === constraint || Boolean(e.message?.includes(constraint))
  );
}

export type ObservationInput = {
  companyId: string;
  employeeId: string;
  clientEventId: string;
  clientSequence?: number;
  /** `null` when the device only reports a transition it cannot substantiate. */
  fix: LocationFix | null;
  occurredAt: Date;
  eventType: "geofence_enter" | "geofence_exit" | "heartbeat";
  source?: "online" | "offline" | "background";
};

export type ObservationResult = {
  applied: boolean;
  sessionId: string | null;
  status: string | null;
  /** What the engine decided, for logging and client display. */
  decision: string;
};

/**
 * Apply a location observation to the caller's open session.
 *
 * Heartbeats deliberately do not persist coordinates — only whether the device
 * was inside. That is the whole privacy posture: the system knows presence, not
 * a movement trail.
 */
export async function recordObservation(
  input: ObservationInput,
): Promise<ObservationResult> {
  const now = Date.now();
  const occurredAt = clampOccurredAt(input.occurredAt, now);

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.employeeId, input.employeeId),
          inArray(attendanceSessions.status, ["checked_in", "pending_exit"]),
        ),
      )
      .limit(1);

    if (!session) {
      return {
        applied: false,
        sessionId: null,
        status: null,
        decision: "no_open_session",
      };
    }

    // Idempotency for replayed offline observations.
    const [duplicate] = await tx
      .select({ id: attendanceEvents.id })
      .from(attendanceEvents)
      .where(
        and(
          eq(attendanceEvents.employeeId, input.employeeId),
          eq(attendanceEvents.clientEventId, input.clientEventId),
        ),
      )
      .limit(1);

    if (duplicate) {
      return {
        applied: false,
        sessionId: session.id,
        status: session.status,
        decision: "duplicate_event",
      };
    }

    const [workplace] = await tx
      .select()
      .from(workplaces)
      .where(eq(workplaces.id, session.workplaceId))
      .limit(1);

    if (!workplace) {
      return {
        applied: false,
        sessionId: session.id,
        status: session.status,
        decision: "workplace_missing",
      };
    }

    const evaluation = input.fix
      ? evaluateGeofence(input.fix, {
          latitude: workplace.latitude,
          longitude: workplace.longitude,
          radiusM: workplace.radiusM,
          exitBufferM: workplace.exitBufferM,
          maxAccuracyM: workplace.maxAccuracyM,
        })
      : null;

    // A bare geofence_exit callback with no usable fix is trusted only as far
    // as the OS reported it; we still require the engine to agree when a fix is
    // available.
    const verdict =
      evaluation?.verdict ??
      (input.eventType === "geofence_exit"
        ? "outside"
        : input.eventType === "geofence_enter"
          ? "inside"
          : "inconclusive");

    const decision = applyObservation(
      {
        status: session.status as "checked_in" | "pending_exit",
        checkInAt: session.checkInAt.getTime(),
        exitDetectedAt: session.exitDetectedAt?.getTime() ?? null,
        exitGraceUntil: session.exitGraceUntil?.getTime() ?? null,
        lastInsideAt: session.lastInsideAt?.getTime() ?? null,
        lastHeartbeatAt: session.lastHeartbeatAt?.getTime() ?? null,
      },
      { verdict, occurredAt: occurredAt.getTime() },
      {
        exitGraceSeconds: workplace.exitGraceSeconds,
        heartbeatTimeoutSeconds: workplace.heartbeatTimeoutSeconds,
      },
    );

    // Persist the observation. Coordinates only when this is a transition that
    // needs to be auditable — never for a routine heartbeat.
    const isEvidence =
      input.eventType === "geofence_enter" || input.eventType === "geofence_exit";

    await tx.insert(attendanceEvents).values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      sessionId: session.id,
      workplaceId: workplace.id,
      clientEventId: input.clientEventId,
      clientSequence: input.clientSequence ?? 0,
      eventType: input.eventType,
      source: input.source ?? "online",
      occurredAt,
      latitude: isEvidence ? (input.fix?.latitude ?? null) : null,
      longitude: isEvidence ? (input.fix?.longitude ?? null) : null,
      accuracyM: input.fix?.accuracyM ?? null,
      distanceM: evaluation?.distanceM ?? null,
      isInside: evaluation ? evaluation.verdict === "inside" : null,
      isMockLocation: Boolean(input.fix?.isMocked),
    });

    const patch: Record<string, unknown> = {
      lastHeartbeatAt: occurredAt,
      updatedAt: new Date(),
    };

    switch (decision.kind) {
      case "confirm_inside":
        patch.lastInsideAt = occurredAt;
        break;
      case "start_grace":
        patch.status = "pending_exit";
        patch.exitDetectedAt = new Date(decision.exitDetectedAt);
        patch.exitGraceUntil = new Date(decision.exitGraceUntil);
        break;
      case "cancel_grace":
        patch.status = "checked_in";
        patch.exitDetectedAt = null;
        patch.exitGraceUntil = null;
        patch.lastInsideAt = occurredAt;
        break;
      default:
        break;
    }

    await tx
      .update(attendanceSessions)
      .set(patch)
      .where(eq(attendanceSessions.id, session.id));

    // A mocked fix during an open session is worth flagging even though the
    // session continues — the reviewer sees it alongside the rest.
    if (input.fix?.isMocked) {
      await tx.insert(sessionSignals).values({
        companyId: input.companyId,
        employeeId: input.employeeId,
        sessionId: session.id,
        signalType: "mock_location_detected",
        detail: "Device reported a mocked location during an open session.",
        occurredAt,
      });
      await tx
        .update(attendanceSessions)
        .set({
          needsReview: true,
          flags: sql`array_append(${attendanceSessions.flags}, 'mock_location_detected')`,
        })
        .where(eq(attendanceSessions.id, session.id));
    }

    return {
      applied: decision.kind !== "no_change",
      sessionId: session.id,
      status: (patch.status as string) ?? session.status,
      decision: decision.kind,
    };
  });
}

/** Manual check-out from the app. */
export async function checkOut(input: {
  companyId: string;
  employeeId: string;
  clientEventId: string;
  fix: LocationFix | null;
  occurredAt: Date;
  source?: "online" | "offline" | "background";
}): Promise<{ ok: boolean; sessionId: string | null; message?: string }> {
  const now = Date.now();
  const occurredAt = clampOccurredAt(input.occurredAt, now);

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.employeeId, input.employeeId),
          inArray(attendanceSessions.status, ["checked_in", "pending_exit"]),
        ),
      )
      .limit(1);

    if (!session) {
      return { ok: false, sessionId: null, message: "You are not checked in." };
    }

    const [duplicate] = await tx
      .select({ id: attendanceEvents.id })
      .from(attendanceEvents)
      .where(
        and(
          eq(attendanceEvents.employeeId, input.employeeId),
          eq(attendanceEvents.clientEventId, input.clientEventId),
        ),
      )
      .limit(1);

    if (duplicate) return { ok: true, sessionId: session.id };

    await tx.insert(attendanceEvents).values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      sessionId: session.id,
      workplaceId: session.workplaceId,
      clientEventId: input.clientEventId,
      eventType: "check_out",
      source: input.source ?? "online",
      occurredAt,
      latitude: input.fix?.latitude ?? null,
      longitude: input.fix?.longitude ?? null,
      accuracyM: input.fix?.accuracyM ?? null,
      isMockLocation: Boolean(input.fix?.isMocked),
    });

    await tx
      .update(attendanceSessions)
      .set({
        status: "checked_out",
        checkOutAt: occurredAt,
        checkoutReason: "manual",
        durationMinutes: durationMinutes(
          session.checkInAt.getTime(),
          occurredAt.getTime(),
        ),
        exitGraceUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(attendanceSessions.id, session.id));

    return { ok: true, sessionId: session.id };
  });
}

/** Record a device-side condition that interrupted tracking. */
export async function recordSignal(input: {
  companyId: string;
  employeeId: string;
  signalType:
    | "gps_unavailable"
    | "gps_accuracy_poor"
    | "location_services_disabled"
    | "permission_revoked"
    | "background_permission_missing"
    | "battery_optimisation_active"
    | "device_offline"
    | "app_terminated";
  detail?: string;
  occurredAt: Date;
}): Promise<void> {
  const [session] = await db
    .select({ id: attendanceSessions.id })
    .from(attendanceSessions)
    .where(
      and(
        eq(attendanceSessions.employeeId, input.employeeId),
        inArray(attendanceSessions.status, ["checked_in", "pending_exit"]),
      ),
    )
    .limit(1);

  await db.insert(sessionSignals).values({
    companyId: input.companyId,
    employeeId: input.employeeId,
    sessionId: session?.id ?? null,
    signalType: input.signalType,
    detail: input.detail ?? null,
    occurredAt: input.occurredAt,
  });

  logger.info(
    { employeeId: input.employeeId, signal: input.signalType },
    "Device signal recorded",
  );
}
