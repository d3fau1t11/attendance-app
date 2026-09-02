import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { qrModeEnum } from "./enums";

/**
 * A physical branch/site with a geofence.
 *
 * The tuning columns below are per-workplace on purpose: a small office with
 * good sky view wants a tight radius, while a warehouse ringed by steel wants a
 * looser one. Hard-coding these globally is what makes naive implementations
 * produce false check-outs.
 */
export const workplaces = pgTable(
  "workplaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),

    // --- Geofence definition ---
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    /** Entry radius. A fix is "inside" when distance <= radius. */
    radiusM: integer("radius_m").notNull().default(150),
    /**
     * Hysteresis band. An exit only counts when the device is confidently
     * beyond `radius + exitBuffer`, which stops a jittery fix sitting exactly on
     * the boundary from flapping between states.
     */
    exitBufferM: integer("exit_buffer_m").notNull().default(50),
    /**
     * Fixes less accurate than this are discarded before they reach the state
     * machine — a 500m-accurate fix can neither prove presence nor absence.
     */
    maxAccuracyM: integer("max_accuracy_m").notNull().default(100),
    /**
     * How long an employee may be outside the geofence before the server closes
     * the session. Covers stepping out for a delivery, or a GPS glitch.
     */
    exitGraceSeconds: integer("exit_grace_seconds").notNull().default(300),
    /**
     * If no heartbeat arrives for this long while a session is open, the server
     * assumes the device died and closes the session for review rather than
     * letting it accrue hours indefinitely.
     */
    heartbeatTimeoutSeconds: integer("heartbeat_timeout_seconds")
      .notNull()
      .default(1800),

    // --- QR configuration ---
    qrMode: qrModeEnum("qr_mode").notNull().default("rotating"),
    /**
     * Per-workplace HMAC key for QR tokens. Never leaves the server: the kiosk
     * page renders tokens, and the API verifies them. Rotating this key
     * invalidates every previously issued/printed code for this site.
     */
    qrSecret: text("qr_secret").notNull(),
    /** Seconds per rotating-QR window. Ignored when `qrMode` is `static`. */
    qrRotationSeconds: integer("qr_rotation_seconds").notNull().default(30),

    // --- Working hours (interpreted in `timezone`) ---
    timezone: text("timezone").notNull().default("UTC"),
    workStart: time("work_start").notNull().default("09:00:00"),
    workEnd: time("work_end").notNull().default("17:00:00"),
    /** Minutes after `workStart` before an arrival is marked late. */
    lateGraceMinutes: integer("late_grace_minutes").notNull().default(10),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workplaces_company_name_idx").on(t.companyId, t.name),
    index("workplaces_company_idx").on(t.companyId),
  ],
);

export type Workplace = typeof workplaces.$inferSelect;
export type NewWorkplace = typeof workplaces.$inferInsert;
