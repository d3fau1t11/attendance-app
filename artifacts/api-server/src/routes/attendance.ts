import { Router, type IRouter, type Request, type Response } from "express";
import { supabaseRequest, readSupabase } from "../lib/supabase";

const router: IRouter = Router();
const demoEmployeeId = "mobile-demo-employee";

type SessionRow = {
  id: string;
  status: "checked_in" | "checked_out" | "needs_review";
  workplace_name: string;
  check_in_at: string;
  check_out_at: string | null;
  duration_minutes: number | null;
};

router.get("/attendance/me", async (req, res) => {
  try {
    const sessions = await readSupabase<SessionRow[]>(
      `attendance_sessions?employee_id=eq.${demoEmployeeId}&select=id,status,workplace_name,check_in_at,check_out_at,duration_minutes&order=check_in_at.desc&limit=20`,
    );
    const activeSession = sessions.find((session) => session.status === "checked_in");
    res.json({
      employeeName: "Abebe",
      currentStatus: activeSession ? "checked_in" : "checked_out",
      activeSession: activeSession
        ? {
            id: activeSession.id,
            status: activeSession.status,
            workplaceName: activeSession.workplace_name,
            checkInAt: activeSession.check_in_at,
            checkOutAt: activeSession.check_out_at,
            durationMinutes: activeSession.duration_minutes ?? 0,
          }
        : null,
      sessions: sessions.map((session) => ({
        id: session.id,
        status: session.status,
        workplaceName: session.workplace_name,
        checkInAt: session.check_in_at,
        checkOutAt: session.check_out_at,
        durationMinutes: session.duration_minutes ?? 0,
      })),
      pendingEvents: 0,
    });
  } catch (error) {
    req.log.error({ err: error }, "Unable to load attendance overview");
    res.status(503).json({ message: "Attendance data is temporarily unavailable." });
  }
});

async function recordEvent(req: Request, res: Response) {
  const body = req.body as {
    eventId?: string;
    eventType?: "check_in" | "check_out";
    workplaceId?: string;
    occurredAt?: string;
    latitude?: number;
    longitude?: number;
    accuracyMeters?: number;
    qrToken?: string;
    isMockLocation?: boolean;
    source?: string;
  };
  if (!body.eventId || !body.eventType || !body.workplaceId || !body.occurredAt || body.latitude == null || body.longitude == null || body.accuracyMeters == null || !body.qrToken) {
    res.status(400).json({ message: "Complete QR and location verification data is required." });
    return;
  }
  const response = await supabaseRequest("attendance_events", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      event_id: body.eventId,
      employee_id: demoEmployeeId,
      event_type: body.eventType,
      workplace_id: body.workplaceId,
      occurred_at: body.occurredAt,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy_meters: body.accuracyMeters,
      qr_token: body.qrToken,
      is_mock_location: body.isMockLocation ?? false,
      source: body.source ?? "online",
    }),
  });
  if (!response.ok) {
    res.status(502).json({ message: "The attendance event could not be saved." });
    return;
  }
  res.status(201).json({
    id: body.eventId,
    status: body.isMockLocation ? "needs_review" : body.eventType === "check_in" ? "checked_in" : "checked_out",
    workplaceName: body.workplaceId,
    checkInAt: body.occurredAt,
    checkOutAt: body.eventType === "check_out" ? body.occurredAt : null,
    durationMinutes: 0,
  });
}

router.post("/attendance/check-in", recordEvent);
router.post("/attendance/check-out", recordEvent);

router.post("/attendance/events/sync", async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  let accepted = 0;
  const duplicateEventIds: string[] = [];
  const needsReview: string[] = [];
  for (const event of events) {
    try {
      const response = await supabaseRequest("attendance_events", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          event_id: event.eventId,
          employee_id: demoEmployeeId,
          event_type: event.eventType,
          workplace_id: event.workplaceId,
          occurred_at: event.occurredAt,
          latitude: event.latitude,
          longitude: event.longitude,
          accuracy_meters: event.accuracyMeters,
          qr_token: event.qrToken,
          is_mock_location: event.isMockLocation ?? false,
          source: "offline",
        }),
      });
      if (response.status === 409) duplicateEventIds.push(event.eventId);
      else if (response.ok) {
        accepted += 1;
        if (event.isMockLocation) needsReview.push(event.eventId);
      }
    } catch (error) {
      req.log.warn({ err: error }, "Offline event sync failed");
    }
  }
  res.json({ accepted, duplicateEventIds, needsReview });
});

export default router;