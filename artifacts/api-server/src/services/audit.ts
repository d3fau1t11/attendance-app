import { auditLogs, db } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Append-only audit trail.
 *
 * Writes are best-effort by design: an audit failure must never break the
 * business operation that triggered it. Failures are logged loudly so the gap
 * is visible rather than silent.
 */
export async function recordAudit(entry: {
  companyId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      companyId: entry.companyId ?? null,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
      ipAddress: entry.ipAddress ?? null,
    });
  } catch (error) {
    logger.error({ err: error, action: entry.action }, "Audit write failed");
  }
}
