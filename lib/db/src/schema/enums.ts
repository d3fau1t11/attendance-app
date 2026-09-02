import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Role hierarchy, ordered from most to least privileged.
 *
 * - `super_admin`  — platform operator; crosses company boundaries.
 * - `company_admin`— HR/owner; full access within their own company.
 * - `manager`      — scoped to the departments/workplaces granted in `manager_scopes`.
 * - `employee`     — can only ever read/write their own attendance.
 */
export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "company_admin",
  "manager",
  "employee",
]);

/**
 * Attendance session lifecycle.
 *
 * `pending_exit` is the grace-period state: the device reported a confident
 * geofence exit, but the employee may still return before the deadline. Only
 * the server may move a session out of this state — see `services/sweeper.ts`.
 */
export const sessionStatusEnum = pgEnum("session_status", [
  "checked_in",
  "pending_exit",
  "checked_out",
  "needs_review",
]);

/**
 * How a session ended. Distinguishes a trustworthy close from one the server
 * had to infer, which is what drives the "needs review" queue for admins.
 */
export const checkoutReasonEnum = pgEnum("checkout_reason", [
  "manual",
  "auto_geofence_exit",
  "auto_heartbeat_lost",
  "auto_workday_end",
  "admin_override",
]);

/**
 * Append-only attendance ledger event types. Every state change of a session is
 * explained by at least one of these rows.
 */
export const attendanceEventTypeEnum = pgEnum("attendance_event_type", [
  "check_in",
  "check_out",
  "geofence_enter",
  "geofence_exit",
  "heartbeat",
]);

/**
 * Where an event came from. `offline` events were replayed from the device
 * outbox after connectivity returned; `system` events were synthesised by the
 * server sweeper rather than reported by a device.
 */
export const eventSourceEnum = pgEnum("event_source", [
  "online",
  "offline",
  "background",
  "system",
]);

/**
 * Non-attendance conditions worth recording against a session. These explain
 * gaps in coverage so an admin can tell "was not at work" apart from
 * "the phone could not tell us".
 */
export const signalTypeEnum = pgEnum("signal_type", [
  "gps_unavailable",
  "gps_accuracy_poor",
  "location_services_disabled",
  "permission_revoked",
  "background_permission_missing",
  "battery_optimisation_active",
  "device_offline",
  "app_terminated",
  "mock_location_detected",
  "impossible_travel",
  "provider_toggle_churn",
  "duplicate_coordinates",
  "unknown_device",
]);

/**
 * Rotating QR is the default: the payload is an HMAC over a time counter, so a
 * shared screenshot stops working within one window. `static` exists for
 * entrances with no screen to display a rotating code.
 */
export const qrModeEnum = pgEnum("qr_mode", ["rotating", "static"]);
