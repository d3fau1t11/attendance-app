import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, workplaces } from "@workspace/db";
import {
  requireAuth,
  requireCompany,
  requireRole,
} from "../middlewares/auth";
import {
  generateQrSecret,
  generateQrToken,
  secondsUntilRotation,
  verifyQrToken,
} from "../services/qr";
import { recordAudit } from "../services/audit";
import { renderKioskPage } from "../lib/kiosk-page";
import { qrToSvg } from "../lib/qr-encoder";

const router: IRouter = Router();

/** Workplace administration is company-admin and above. */
const adminOnly = [requireAuth, requireCompany, requireRole("company_admin")];

/**
 * A path segment that Postgres will accept as a `uuid`.
 *
 * Without this, a mistyped kiosk URL reaches the database and comes back as
 * "invalid input syntax for type uuid" — a 500 on a page someone is standing in
 * front of at the entrance. A 404 is both truthful and diagnosable.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bounds for the tuning knobs.
 *
 * These are admin-only fields, but the failure modes of a typo are silent and
 * site-wide: `radiusM: 0` means nobody can ever check in, and
 * `qrRotationSeconds: 0` divides by zero in the token counter so every scan
 * reports "expired". Clamping turns a fat-fingered zero into a working — if
 * unintended — setting rather than an outage nobody can explain.
 */
const LIMITS = {
  radiusM: { min: 10, max: 10_000, fallback: 150 },
  exitBufferM: { min: 0, max: 5_000, fallback: 50 },
  maxAccuracyM: { min: 5, max: 1_000, fallback: 100 },
  exitGraceSeconds: { min: 30, max: 86_400, fallback: 300 },
  heartbeatTimeoutSeconds: { min: 120, max: 86_400, fallback: 1_800 },
  lateGraceMinutes: { min: 0, max: 720, fallback: 10 },
  qrRotationSeconds: { min: 10, max: 3_600, fallback: 30 },
} as const;

type SettingKey = keyof typeof LIMITS;

/** Clamp a supplied setting, or `null` when it is absent or not a number. */
function clampSetting(key: SettingKey, value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function settingOrDefault(key: SettingKey, value: unknown): number {
  return clampSetting(key, value) ?? LIMITS[key].fallback;
}

router.get("/workplaces", requireAuth, requireCompany, async (req, res) => {
  const rows = await db
    .select()
    .from(workplaces)
    .where(eq(workplaces.companyId, req.auth!.companyId!));

  // The QR secret is never exposed over the API — it is the one credential that
  // would let someone mint valid codes off-site.
  res.json({
    workplaces: rows.map(({ qrSecret: _omitted, ...rest }) => rest),
  });
});

router.post("/workplaces", ...adminOnly, async (req, res) => {
  const body = req.body ?? {};
  const name = String(body.name ?? "").trim();
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);

  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    res.status(400).json({
      code: "invalid_request",
      message: "Name, latitude and longitude are required.",
    });
    return;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    res.status(400).json({
      code: "invalid_coordinates",
      message: "Latitude must be -90..90 and longitude -180..180.",
    });
    return;
  }

  const [created] = await db
    .insert(workplaces)
    .values({
      companyId: req.auth!.companyId!,
      name,
      address: body.address ? String(body.address) : null,
      latitude,
      longitude,
      radiusM: settingOrDefault("radiusM", body.radiusM),
      exitBufferM: settingOrDefault("exitBufferM", body.exitBufferM),
      maxAccuracyM: settingOrDefault("maxAccuracyM", body.maxAccuracyM),
      exitGraceSeconds: settingOrDefault(
        "exitGraceSeconds",
        body.exitGraceSeconds,
      ),
      heartbeatTimeoutSeconds: settingOrDefault(
        "heartbeatTimeoutSeconds",
        body.heartbeatTimeoutSeconds,
      ),
      qrMode: body.qrMode === "static" ? "static" : "rotating",
      qrSecret: generateQrSecret(),
      qrRotationSeconds: settingOrDefault(
        "qrRotationSeconds",
        body.qrRotationSeconds,
      ),
      timezone: String(body.timezone ?? "UTC"),
      workStart: String(body.workStart ?? "09:00:00"),
      workEnd: String(body.workEnd ?? "17:00:00"),
      lateGraceMinutes: settingOrDefault(
        "lateGraceMinutes",
        body.lateGraceMinutes,
      ),
    })
    .returning();

  await recordAudit({
    companyId: req.auth!.companyId,
    actorUserId: req.auth!.userId,
    action: "workplace.create",
    entityType: "workplace",
    entityId: created.id,
    metadata: { name },
    ipAddress: req.ip ?? null,
  });

  const { qrSecret: _omitted, ...safe } = created;
  res.status(201).json(safe);
});

router.patch("/workplaces/:id", ...adminOnly, async (req, res) => {
  const body = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  // Whitelisted so a client cannot overwrite `qrSecret` or `companyId`.
  for (const key of Object.keys(LIMITS) as SettingKey[]) {
    const value = clampSetting(key, body[key]);
    if (value !== null) patch[key] = value;
  }
  for (const key of ["name", "address", "timezone", "workStart", "workEnd"]) {
    if (body[key] !== undefined) patch[key] = String(body[key]);
  }
  if (body.qrMode === "rotating" || body.qrMode === "static") {
    patch.qrMode = body.qrMode;
  }
  if (typeof body.isActive === "boolean") patch.isActive = body.isActive;

  const [updated] = await db
    .update(workplaces)
    .set(patch)
    .where(
      and(
        eq(workplaces.id, req.params.id),
        eq(workplaces.companyId, req.auth!.companyId!),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ code: "not_found", message: "Workplace not found." });
    return;
  }

  await recordAudit({
    companyId: req.auth!.companyId,
    actorUserId: req.auth!.userId,
    action: "workplace.update",
    entityType: "workplace",
    entityId: updated.id,
    metadata: patch,
    ipAddress: req.ip ?? null,
  });

  const { qrSecret: _omitted, ...safe } = updated;
  res.json(safe);
});

/** Rotate the QR secret, invalidating every previously issued or printed code. */
router.post("/workplaces/:id/rotate-secret", ...adminOnly, async (req, res) => {
  const [updated] = await db
    .update(workplaces)
    .set({ qrSecret: generateQrSecret(), updatedAt: new Date() })
    .where(
      and(
        eq(workplaces.id, req.params.id),
        eq(workplaces.companyId, req.auth!.companyId!),
      ),
    )
    .returning({ id: workplaces.id });

  if (!updated) {
    res.status(404).json({ code: "not_found", message: "Workplace not found." });
    return;
  }

  await recordAudit({
    companyId: req.auth!.companyId,
    actorUserId: req.auth!.userId,
    action: "workplace.rotate_qr_secret",
    entityType: "workplace",
    entityId: updated.id,
    ipAddress: req.ip ?? null,
  });

  res.json({ rotated: true });
});

/**
 * Current QR token as JSON. Polled by the kiosk page so the displayed code
 * stays live without a full reload.
 */
router.get("/workplaces/:id/qr-token", async (req, res) => {
  const [workplace] = await db
    .select()
    .from(workplaces)
    .where(eq(workplaces.id, req.params.id))
    .limit(1);

  if (!workplace || !workplace.isActive) {
    res.status(404).json({ code: "not_found", message: "Workplace not found." });
    return;
  }

  res.json({
    token: generateQrToken({
      workplaceId: workplace.id,
      secret: workplace.qrSecret,
      mode: workplace.qrMode,
      rotationSeconds: workplace.qrRotationSeconds,
    }),
    mode: workplace.qrMode,
    rotationSeconds: workplace.qrRotationSeconds,
    expiresInSeconds:
      workplace.qrMode === "static"
        ? null
        : secondsUntilRotation(workplace.qrRotationSeconds),
    workplaceName: workplace.name,
  });
});

/**
 * Render a QR token as SVG.
 *
 * The token is verified before rendering, so this cannot be used as a generic
 * "encode arbitrary text as a QR" endpoint pointed at our domain.
 */
router.get("/workplaces/:id/qr.svg", async (req, res) => {
  const token = String(req.query.t ?? "");

  const [workplace] = await db
    .select()
    .from(workplaces)
    .where(eq(workplaces.id, req.params.id))
    .limit(1);

  if (!workplace || !workplace.isActive) {
    res.status(404).type("svg").send("<svg xmlns='http://www.w3.org/2000/svg'/>");
    return;
  }

  const verification = verifyQrToken({
    token,
    workplaceId: workplace.id,
    secret: workplace.qrSecret,
    mode: workplace.qrMode,
    rotationSeconds: workplace.qrRotationSeconds,
  });

  if (!verification.ok) {
    res.status(400).type("svg").send("<svg xmlns='http://www.w3.org/2000/svg'/>");
    return;
  }

  res
    .type("svg")
    .setHeader("Cache-Control", "no-store")
    .send(qrToSvg(token, { size: 320 }));
});

/**
 * Self-contained kiosk display for the entrance.
 *
 * Intentionally unauthenticated: it is meant to run on a screen at the door,
 * and possession of a code proves nothing on its own — the geofence check is
 * what establishes presence. It renders its own QR client-side so no external
 * request is needed.
 */
router.get("/workplaces/:id/kiosk", async (req, res) => {
  const [workplace] = await db
    .select()
    .from(workplaces)
    .where(eq(workplaces.id, req.params.id))
    .limit(1);

  if (!workplace || !workplace.isActive) {
    res.status(404).type("html").send("<h1>Workplace not found</h1>");
    return;
  }

  res.type("html").send(
    renderKioskPage({
      workplaceId: workplace.id,
      workplaceName: workplace.name,
      rotationSeconds: workplace.qrRotationSeconds,
      isStatic: workplace.qrMode === "static",
    }),
  );
});

export default router;
