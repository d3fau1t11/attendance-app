import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { employees } from "./employees";

/**
 * Devices an employee has used. `installId` is generated once per app install
 * and kept in SecureStore, so a reinstall registers a new device.
 *
 * Purpose is anti-fraud signal, not access control: attendance from an
 * unrecognised device is *flagged* for review, never blocked — blocking would
 * strand someone whose phone broke.
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    installId: text("install_id").notNull(),
    model: text("model"),
    osName: text("os_name"),
    osVersion: text("os_version"),
    appVersion: text("app_version"),
    /** True once an admin (or first-use policy) accepts this device. */
    isTrusted: boolean("is_trusted").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("devices_employee_install_idx").on(t.employeeId, t.installId),
    index("devices_company_idx").on(t.companyId),
  ],
);

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
