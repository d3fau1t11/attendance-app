import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { departments } from "./departments";
import { users } from "./users";
import { workplaces } from "./workplaces";

/**
 * The attendance-bearing record for a person. Split from `users` so that
 * employment data (department, manager, employee code) is independent of login
 * identity.
 */
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    /** Self-reference: the employee record of this person's manager. */
    managerId: uuid("manager_id"),
    employeeCode: text("employee_code").notNull(),
    jobTitle: text("job_title"),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("employees_company_code_idx").on(t.companyId, t.employeeCode),
    uniqueIndex("employees_user_idx").on(t.userId),
    index("employees_company_idx").on(t.companyId),
    index("employees_department_idx").on(t.departmentId),
  ],
);

/**
 * Which workplaces an employee may check in at. An employee assigned to two
 * branches can legitimately attend either.
 */
export const employeeWorkplaces = pgTable(
  "employee_workplaces",
  {
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.employeeId, t.workplaceId] }),
    index("employee_workplaces_workplace_idx").on(t.workplaceId),
  ],
);

/**
 * Explicit grants defining what a `manager` can see. Without a row here a
 * manager sees nothing beyond their own attendance, which is the safe default.
 * A grant is either department-wide or workplace-wide.
 */
export const managerScopes = pgTable(
  "manager_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "cascade",
    }),
    workplaceId: uuid("workplace_id").references(() => workplaces.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("manager_scopes_user_idx").on(t.managerUserId)],
);

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type EmployeeWorkplace = typeof employeeWorkplaces.$inferSelect;
export type ManagerScope = typeof managerScopes.$inferSelect;
