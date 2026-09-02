import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

/**
 * Refresh tokens, stored as SHA-256 digests so a database leak does not hand
 * over usable sessions.
 *
 * `replacedBy` implements rotation-with-reuse-detection: each refresh mints a
 * new token and marks the old one replaced. If an already-replaced token is
 * presented again, the whole chain is treated as compromised and revoked.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedByTokenHash: text("replaced_by_token_hash"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_idx").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
  ],
);

/**
 * Append-only record of who changed what. Written for every mutation that
 * affects attendance, employees, workplaces, or roles.
 *
 * `actorUserId` is nullable because the sweeper acts with no human actor.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** e.g. `attendance.auto_checkout`, `employee.create`, `auth.login_failed`. */
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    /** Before/after diff or request context. Never contains raw credentials. */
    metadata: jsonb("metadata"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_logs_company_time_idx").on(t.companyId, t.createdAt.desc()),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
