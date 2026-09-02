import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  attendanceSessions,
  db,
  employeeWorkplaces,
  workplaces,
} from "@workspace/db";
import type { LocationFix } from "@workspace/attendance-core";
import {
  requireAuth,
  requireCompany,
  requireEmployee,
} from "../middlewares/auth";
import {
  checkIn,
  checkOut,
  recordObservation,
  recordSignal,
} from "../services/attendance";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** All attendance endpoints are employee-scoped and tenant-scoped. */
router.use("/attendance", requireAuth, requireCompany, requireEmployee);

function parseFix(body: Record<string, unknown>): LocationFix | null {
  const lat = Number(body.latitude);
  const lon = Number(body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    latitude: lat,
    longitude: lon,
    accuracyM: Number.isFinite(Number(body.accuracyM))
      ? Number(body.accuracyM)
      : Number.POSITIVE_INFINITY,
    timestamp: body.occurredAt
      ? new Date(String(body.occurredAt)).getTime()
      : Date.now(),
    isMocked: Boolean(body.isMocked),
  };
}

function parseDate(value: unknown, fallback = new Date()): Date {
  if (!value) return fallback;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/** Clamp a client-supplied row limit; a NaN would produce invalid SQL. */
function parseLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/**
 * Current status plus recent history — the mobile home screen's single source
 * of truth.
 */
router.get("/attendance/me", async (req, res) => {
  const auth = req.auth!;
  try {
    const sessions = await db
      .select({
        id: attendanceSessions.id,
        status: attendanceSessions.status,
        checkInAt: attendanceSessions.checkInAt,
        checkOutAt: attendanceSessions.checkOutAt,
        durationMinutes: attendanceSessions.durationMinutes,
        isLate: attendanceSessions.isLate,
        needsReview: attendanceSessions.needsReview,
        flags: attendanceSessions.flags,
        exitGraceUntil: attendanceSessions.exitGraceUntil,
        checkoutReason: attendanceSessions.checkoutReason,
        workplaceId: workplaces.id,
        workplaceName: workplaces.name,
        latitude: workplaces.latitude,
        longitude: workplaces.longitude,
        radiusM: workplaces.radiusM,
      })
      .from(attendanceSessions)
      .innerJoin(workplaces, eq(workplaces.id, attendanceSessions.workplaceId))
      .where(eq(attendanceSessions.employeeId, auth.employeeId!))
      .orderBy(desc(attendanceSessions.checkInAt))
      .limit(30);

    const active = sessions.find(
      (s) => s.status === "checked_in" || s.status === "pending_exit",
    );

    res.json({
      currentStatus: active?.status ?? "checked_out",
      activeSession: active
        ? {
            id: active.id,
            status: active.status,
            workplaceId: active.workplaceId,
            workplaceName: active.workplaceName,
            checkInAt: active.checkInAt.toISOString(),
            exitGraceUntil: active.exitGraceUntil?.toISOString() ?? null,
            geofence: {
              latitude: active.latitude,
              longitude: active.longitude,
              radiusM: active.radiusM,
            },
          }
        : null,
      sessions: sessions.map((s) => ({
        id: s.id,
        status: s.status,
        workplaceName: s.workplaceName,
        checkInAt: s.checkInAt.toISOString(),
        checkOutAt: s.checkOutAt?.toISOString() ?? null,
        durationMinutes: s.durationMinutes ?? null,
        isLate: s.isLate,
        needsReview: s.needsReview,
        flags: s.flags,
        checkoutReason: s.checkoutReason,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load attendance overview");
    res.status(503).json({
      code: "unavailable",
      message: "Attendance data is temporarily unavailable.",
    });
  }
});

/**
 * The workplaces this employee may attend, with geofence parameters.
 *
 * The app needs these to register OS geofences and to evaluate fixes locally
 * before spending a network round-trip.
 */
router.get("/attendance/my-workplaces", async (req, res) => {
  const auth = req.auth!;
  const rows = await db
    .select({
      id: workplaces.id,
      name: workplaces.name,
      address: workplaces.address,
      latitude: workplaces.latitude,
      longitude: workplaces.longitude,
      radiusM: workplaces.radiusM,
      exitBufferM: workplaces.exitBufferM,
      maxAccuracyM: workplaces.maxAccuracyM,
      exitGraceSeconds: workplaces.exitGraceSeconds,
      workStart: workplaces.workStart,
      workEnd: workplaces.workEnd,
      isPrimary: employeeWorkplaces.isPrimary,
    })
    .from(employeeWorkplaces)
    .innerJoin(workplaces, eq(workplaces.id, employeeWorkplaces.workplaceId))
    .where(
      and(
        eq(employeeWorkplaces.employeeId, auth.employeeId!),
        eq(workplaces.isActive, true),
      ),
    );

  res.json({ workplaces: rows });
});

router.post("/attendance/check-in", async (req, res) => {
  const auth = req.auth!;
  const body = req.body ?? {};
  const fix = parseFix(body);

  if (!body.qrToken || !fix) {
    res.status(400).json({
      code: "invalid_request",
      message: "A workplace code and a location reading are both required.",
    });
    return;
  }

  try {
    const result = await checkIn({
      companyId: auth.companyId!,
      employeeId: auth.employeeId!,
      clientEventId: String(body.clientEventId ?? ""),
      clientSequence: Number(body.clientSequence ?? 0),
      qrToken: String(body.qrToken),
      fix,
      occurredAt: parseDate(body.occurredAt),
      source: body.source === "offline" ? "offline" : "online",
      device: body.device,
      providerToggleCount: Number(body.providerToggleCount ?? 0),
    });

    if (!result.ok) {
      // 409 for "already checked in" (state conflict), 422 for a failed
      // verification — the client distinguishes these in its messaging.
      const status = result.code === "already_checked_in" ? 409 : 422;
      res.status(status).json({
        code: result.code,
        message: result.message,
        distanceM: result.distanceM,
      });
      return;
    }

    res.status(201).json({
      sessionId: result.sessionId,
      status: result.status,
      flags: result.flags,
      duplicate: result.alreadyExisted,
    });
  } catch (error) {
    req.log.error({ err: error }, "Check-in failed");
    res.status(500).json({
      code: "server_error",
      message: "Check-in could not be completed. No attendance was recorded.",
    });
  }
});

router.post("/attendance/check-out", async (req, res) => {
  const auth = req.auth!;
  const body = req.body ?? {};

  try {
    const result = await checkOut({
      companyId: auth.companyId!,
      employeeId: auth.employeeId!,
      clientEventId: String(body.clientEventId ?? ""),
      fix: parseFix(body),
      occurredAt: parseDate(body.occurredAt),
      source: body.source === "offline" ? "offline" : "online",
    });

    if (!result.ok) {
      res.status(409).json({ code: "not_checked_in", message: result.message });
      return;
    }
    res.json({ sessionId: result.sessionId, status: "checked_out" });
  } catch (error) {
    req.log.error({ err: error }, "Check-out failed");
    res.status(500).json({
      code: "server_error",
      message: "Check-out could not be completed.",
    });
  }
});

/**
 * Geofence transitions and heartbeats from the device, including from the
 * background task. Deliberately tolerant: an unusable observation is accepted
 * and ignored rather than erroring, so the background task never retries a
 * doomed request.
 */
router.post("/attendance/observations", async (req, res) => {
  const auth = req.auth!;
  const body = req.body ?? {};
  const eventType = String(body.eventType ?? "");

  if (!["geofence_enter", "geofence_exit", "heartbeat"].includes(eventType)) {
    res.status(400).json({
      code: "invalid_event_type",
      message: "Unsupported observation type.",
    });
    return;
  }

  try {
    const result = await recordObservation({
      companyId: auth.companyId!,
      employeeId: auth.employeeId!,
      clientEventId: String(body.clientEventId ?? ""),
      clientSequence: Number(body.clientSequence ?? 0),
      fix: parseFix(body),
      occurredAt: parseDate(body.occurredAt),
      eventType: eventType as "geofence_enter" | "geofence_exit" | "heartbeat",
      source: body.source === "offline" ? "offline" : "background",
    });
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Observation failed");
    res.status(500).json({
      code: "server_error",
      message: "The observation could not be recorded.",
    });
  }
});

/**
 * Batch replay of the device outbox.
 *
 * Returns a per-event outcome so the client knows exactly which rows to mark
 * synced and which to surface as rejected — a blanket success would strand
 * events that the server declined.
 */
router.post("/attendance/sync", async (req, res) => {
  const auth = req.auth!;
  const events = Array.isArray(req.body?.events) ? req.body.events : [];

  if (events.length > 200) {
    res.status(413).json({
      code: "batch_too_large",
      message: "Send at most 200 events per sync.",
    });
    return;
  }

  // Order matters: replaying a check-in after the check-out that followed it
  // would corrupt the session, so sort by the device's own sequence/time.
  const ordered = [...events].sort((a, b) => {
    const seq = Number(a?.clientSequence ?? 0) - Number(b?.clientSequence ?? 0);
    if (seq !== 0) return seq;
    return (
      new Date(a?.occurredAt ?? 0).getTime() -
      new Date(b?.occurredAt ?? 0).getTime()
    );
  });

  const results: Array<{
    clientEventId: string;
    status: "accepted" | "duplicate" | "rejected";
    code?: string;
    message?: string;
  }> = [];

  for (const event of ordered) {
    const clientEventId = String(event?.clientEventId ?? "");
    if (!clientEventId) {
      results.push({
        clientEventId: "",
        status: "rejected",
        code: "missing_client_event_id",
        message: "Event is missing its identifier.",
      });
      continue;
    }

    try {
      const type = String(event.eventType ?? "");
      const fix = parseFix(event);
      const occurredAt = parseDate(event.occurredAt);

      if (type === "check_in") {
        // A queued check-in with no usable fix can never be verified, and
        // retrying it forever would keep the outbox permanently "pending".
        // Reject it once, explicitly, so the device stops carrying it.
        if (!fix) {
          results.push({
            clientEventId,
            status: "rejected",
            code: "missing_location",
            message:
              "This check-in was saved without a location reading and cannot be verified.",
          });
          continue;
        }
        const result = await checkIn({
          companyId: auth.companyId!,
          employeeId: auth.employeeId!,
          clientEventId,
          clientSequence: Number(event.clientSequence ?? 0),
          qrToken: String(event.qrToken ?? ""),
          fix,
          occurredAt,
          source: "offline",
          device: event.device,
        });
        results.push(
          result.ok
            ? {
                clientEventId,
                status: result.alreadyExisted ? "duplicate" : "accepted",
              }
            : {
                clientEventId,
                status: "rejected",
                code: result.code,
                message: result.message,
              },
        );
        continue;
      }

      if (type === "check_out") {
        const result = await checkOut({
          companyId: auth.companyId!,
          employeeId: auth.employeeId!,
          clientEventId,
          fix,
          occurredAt,
          source: "offline",
        });
        results.push({
          clientEventId,
          status: result.ok ? "accepted" : "rejected",
          code: result.ok ? undefined : "not_checked_in",
          message: result.message,
        });
        continue;
      }

      if (["geofence_enter", "geofence_exit", "heartbeat"].includes(type)) {
        const result = await recordObservation({
          companyId: auth.companyId!,
          employeeId: auth.employeeId!,
          clientEventId,
          clientSequence: Number(event.clientSequence ?? 0),
          fix,
          occurredAt,
          eventType: type as "geofence_enter" | "geofence_exit" | "heartbeat",
          source: "offline",
        });
        results.push({
          clientEventId,
          status: result.decision === "duplicate_event" ? "duplicate" : "accepted",
        });
        continue;
      }

      results.push({
        clientEventId,
        status: "rejected",
        code: "unknown_event_type",
        message: `Unsupported event type "${type}".`,
      });
    } catch (error) {
      logger.error({ err: error, clientEventId }, "Sync event failed");
      // Not marked rejected: a server-side failure should be retried later
      // rather than causing the device to discard a real attendance event.
      results.push({
        clientEventId,
        status: "rejected",
        code: "retry_later",
        message: "Temporary server error; this event will be retried.",
      });
    }
  }

  res.json({
    accepted: results.filter((r) => r.status === "accepted").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    rejected: results.filter((r) => r.status === "rejected").length,
    results,
  });
});

/** Device-reported conditions (permissions, GPS, battery) for the audit trail. */
router.post("/attendance/signals", async (req, res) => {
  const auth = req.auth!;
  const signalType = String(req.body?.signalType ?? "");
  const allowed = [
    "gps_unavailable",
    "gps_accuracy_poor",
    "location_services_disabled",
    "permission_revoked",
    "background_permission_missing",
    "battery_optimisation_active",
    "device_offline",
    "app_terminated",
  ];

  if (!allowed.includes(signalType)) {
    res.status(400).json({
      code: "invalid_signal",
      message: "Unsupported signal type.",
    });
    return;
  }

  await recordSignal({
    companyId: auth.companyId!,
    employeeId: auth.employeeId!,
    signalType: signalType as "gps_unavailable",
    detail: req.body?.detail ? String(req.body.detail) : undefined,
    occurredAt: parseDate(req.body?.occurredAt),
  });

  res.status(202).json({ recorded: true });
});

/** Paged history for the employee's own record. */
router.get("/attendance/history", async (req, res) => {
  const auth = req.auth!;
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;

  const conditions = [eq(attendanceSessions.employeeId, auth.employeeId!)];
  if (from && !Number.isNaN(from.getTime())) {
    conditions.push(gte(attendanceSessions.checkInAt, from));
  }
  if (to && !Number.isNaN(to.getTime())) {
    conditions.push(lte(attendanceSessions.checkInAt, to));
  }

  const rows = await db
    .select({
      id: attendanceSessions.id,
      status: attendanceSessions.status,
      checkInAt: attendanceSessions.checkInAt,
      checkOutAt: attendanceSessions.checkOutAt,
      durationMinutes: attendanceSessions.durationMinutes,
      isLate: attendanceSessions.isLate,
      lateByMinutes: attendanceSessions.lateByMinutes,
      needsReview: attendanceSessions.needsReview,
      flags: attendanceSessions.flags,
      checkoutReason: attendanceSessions.checkoutReason,
      workplaceName: workplaces.name,
    })
    .from(attendanceSessions)
    .innerJoin(workplaces, eq(workplaces.id, attendanceSessions.workplaceId))
    .where(and(...conditions))
    .orderBy(desc(attendanceSessions.checkInAt))
    .limit(parseLimit(req.query.limit, 100, 365));

  res.json({
    sessions: rows.map((s) => ({
      ...s,
      checkInAt: s.checkInAt.toISOString(),
      checkOutAt: s.checkOutAt?.toISOString() ?? null,
    })),
  });
});

export default router;
