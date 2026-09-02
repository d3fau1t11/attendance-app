import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { employees } from "./employees";
import {
  attendanceEventTypeEnum,
  checkoutReasonEnum,
  eventSourceEnum,
  sessionStatusEnum,
  signalTypeEnum,
} from "./enums";
import { workplaces } from "./workplaces";

/**
 * One period of attendance at a workplace.
 *
 * The server is the sole authority over `status`: devices report observations,
 * and `services/attendance-engine.ts` decides what they mean. A client-side
 * grace timer would die with the process, so the deadline lives here.
 */
export const attendanceSessions = pgTable(
  "attendance_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id, { onDelete: "restrict" }),

    status: sessionStatusEnum("status").notNull().default("checked_in"),
    checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull(),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    checkoutReason: checkoutReasonEnum("checkout_reason"),

    /**
     * When the confident geofence exit was observed. On auto-checkout the
     * session closes at *this* time, not at the moment the sweeper noticed —
     * an employee should not be paid for the grace period they spent away.
     */
    exitDetectedAt: timestamp("exit_detected_at", { withTimezone: true }),
    /** Deadline for returning before the sweeper closes the session. */
    exitGraceUntil: timestamp("exit_grace_until", { withTimezone: true }),

    /** Last fix that confidently placed the device inside the geofence. */
    lastInsideAt: timestamp("last_inside_at", { withTimezone: true }),
    /** Last contact of any kind. Silence here implies a dead/offline device. */
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),

    /** Persisted at close so reports need no recomputation. */
    durationMinutes: integer("duration_minutes"),
    isLate: boolean("is_late").notNull().default(false),
    lateByMinutes: integer("late_by_minutes"),
    isEarlyDeparture: boolean("is_early_departure").notNull().default(false),

    /**
     * Anti-fraud / data-quality markers (values from `signalTypeEnum`). A
     * non-empty array routes the session into the admin review queue. Flags
     * never auto-reject attendance — detection is best-effort and evadable, so
     * a human adjudicates.
     */
    flags: text("flags").array().notNull().default(sql`ARRAY[]::text[]`),
    needsReview: boolean("needs_review").notNull().default(false),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The keystone invariant: at most one open session per employee. Enforced
    // by the database, so a double-tap or a replayed offline event cannot
    // create overlapping sessions no matter what the application logic does.
    uniqueIndex("attendance_sessions_one_open_idx")
      .on(t.employeeId)
      .where(sql`${t.status} in ('checked_in', 'pending_exit')`),
    index("attendance_sessions_employee_time_idx").on(
      t.employeeId,
      t.checkInAt.desc(),
    ),
    index("attendance_sessions_company_time_idx").on(
      t.companyId,
      t.checkInAt.desc(),
    ),
    index("attendance_sessions_workplace_idx").on(t.workplaceId),
    // Drives the sweeper: find open sessions whose grace has expired.
    index("attendance_sessions_sweep_idx")
      .on(t.status, t.exitGraceUntil)
      .where(sql`${t.status} in ('checked_in', 'pending_exit')`),
    index("attendance_sessions_review_idx")
      .on(t.companyId)
      .where(sql`${t.needsReview}`),
  ],
);

/**
 * Append-only ledger. Nothing here is ever updated — a session's history can
 * always be reconstructed, which is what makes an attendance dispute auditable.
 *
 * Coordinates are stored ONLY on rows that are evidence for a decision
 * (check-in, check-out, geofence transitions). Heartbeats deliberately carry no
 * lat/lng: the system records *whether* someone was inside the authorised area,
 * not a trail of where they went.
 */
export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => attendanceSessions.id, {
      onDelete: "set null",
    }),
    workplaceId: uuid("workplace_id").references(() => workplaces.id, {
      onDelete: "set null",
    }),

    /**
     * Device-generated UUID. Combined with the unique index below this makes
     * offline replay idempotent at the database level: re-syncing the same
     * queued event is a no-op rather than a duplicate attendance record.
     */
    clientEventId: text("client_event_id").notNull(),
    /** Device-monotonic counter, preserving order within one device's outbox. */
    clientSequence: integer("client_sequence").notNull().default(0),

    eventType: attendanceEventTypeEnum("event_type").notNull(),
    source: eventSourceEnum("source").notNull().default("online"),

    /** When the event happened on the device. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** When the server received it. A wide gap implies an offline replay. */
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    accuracyM: doublePrecision("accuracy_m"),
    /** Server-computed distance to the workplace centre at `occurredAt`. */
    distanceM: doublePrecision("distance_m"),
    isInside: boolean("is_inside"),

    /** Android's mock-location indicator, as reported by the OS. */
    isMockLocation: boolean("is_mock_location").notNull().default(false),
    deviceId: uuid("device_id"),
    /** Free-form diagnostics (battery state, provider, app version). */
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("attendance_events_dedupe_idx").on(
      t.employeeId,
      t.clientEventId,
    ),
    index("attendance_events_session_idx").on(t.sessionId, t.occurredAt),
    index("attendance_events_employee_time_idx").on(
      t.employeeId,
      t.occurredAt.desc(),
    ),
  ],
);

/**
 * Conditions that interrupted or degraded attendance tracking. These exist so
 * the product never has to silently invent a record: if GPS died for an hour,
 * that hour is explained rather than assumed present or assumed absent.
 */
export const sessionSignals = pgTable(
  "session_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => attendanceSessions.id, {
      onDelete: "cascade",
    }),
    signalType: signalTypeEnum("signal_type").notNull(),
    detail: text("detail"),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("session_signals_session_idx").on(t.sessionId),
    index("session_signals_employee_time_idx").on(
      t.employeeId,
      t.occurredAt.desc(),
    ),
  ],
);

export type AttendanceSession = typeof attendanceSessions.$inferSelect;
export type NewAttendanceSession = typeof attendanceSessions.$inferInsert;
export type AttendanceEvent = typeof attendanceEvents.$inferSelect;
export type NewAttendanceEvent = typeof attendanceEvents.$inferInsert;
export type SessionSignal = typeof sessionSignals.$inferSelect;
export type NewSessionSignal = typeof sessionSignals.$inferInsert;
