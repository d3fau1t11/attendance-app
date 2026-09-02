import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { userRoleEnum } from "./enums";

/**
 * Authentication identity. Kept separate from `employees` because not every
 * user is an employee (a super admin has no attendance record) and not every
 * employee necessarily logs in.
 *
 * `passwordHash` is a scrypt digest produced by `services/password.ts` — chosen
 * over argon2/bcrypt because it ships in Node's stdlib and needs no native
 * build step on Windows or in CI.
 *
 * `companyId` is nullable purely so a platform-level `super_admin` can exist
 * outside any tenant.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: userRoleEnum("role").notNull().default("employee"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Set after N consecutive failed logins; cleared on success. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Email is unique per tenant rather than globally, so the same person can
    // hold accounts at two companies on a shared deployment.
    uniqueIndex("users_company_email_idx").on(t.companyId, t.email),
    index("users_email_idx").on(t.email),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
