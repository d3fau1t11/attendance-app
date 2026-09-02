import { and, eq, inArray } from "drizzle-orm";
import {
  attendanceEvents,
  attendanceSessions,
  db,
  sessionSignals,
  workplaces,
} from "@workspace/db";
import { durationMinutes, evaluateOpenSession, evaluateWorkdayOverrun } from "@workspace/attendance-core";
import { config } from "../lib/config";
import { workdayEndMs } from "../lib/time";
import { logger } from "../lib/logger";
import { recordAudit } from "./audit";

/**
 * Server-side session sweeper.
 *
 * This is what makes automatic check-out real rather than theatre. A grace
 * timer running on the phone dies when the process dies — precisely the moment
 * it is most needed (battery flat, app force-stopped, device switched off).
 * Because the deadline is persisted on the session row, the server can close it
 * regardless of what happened to the device.
 *
 * Every close records an event and an audit entry, so an employee can always be
 * shown *why* their session ended.
 */

/**
 * Arbitrary but stable key for the Postgres advisory lock. Ensures only one
 * instance sweeps at a time if the API is ever scaled horizontally — without
 * it, two workers could close the same session twice.
 */
const SWEEPER_LOCK_KEY = 0x4154_5445; // "ATTE"

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runSweep(now: number = Date.now()): Promise<number> {
  // `pg_try_advisory_lock` returns immediately rather than queueing, which is
  // what we want: if another instance is mid-sweep, skip this tick.
  const lockResult = await db.execute<{ locked: boolean }>(
    `select pg_try_advisory_lock(${SWEEPER_LOCK_KEY}) as locked`,
  );
  const acquired = (lockResult.rows?.[0] as { locked?: boolean } | undefined)?.locked;
  if (!acquired) {
    logger.debug("Sweep skipped; another instance holds the lock");
    return 0;
  }

  try {
    const open = await db
      .select({
        session: attendanceSessions,
        workplace: workplaces,
      })
      .from(attendanceSessions)
      .innerJoin(
        workplaces,
        eq(workplaces.id, attendanceSessions.workplaceId),
      )
      .where(
        inArray(attendanceSessions.status, ["checked_in", "pending_exit"]),
      );

    let closed = 0;

    for (const { session, workplace } of open) {
      const state = {
        status: session.status as "checked_in" | "pending_exit",
        checkInAt: session.checkInAt.getTime(),
        exitDetectedAt: session.exitDetectedAt?.getTime() ?? null,
        exitGraceUntil: session.exitGraceUntil?.getTime() ?? null,
        lastInsideAt: session.lastInsideAt?.getTime() ?? null,
        lastHeartbeatAt: session.lastHeartbeatAt?.getTime() ?? null,
      };

      let decision = evaluateOpenSession(state, now, {
        exitGraceSeconds: workplace.exitGraceSeconds,
        heartbeatTimeoutSeconds: workplace.heartbeatTimeoutSeconds,
      });

      // A phone sitting on a desk inside the geofence keeps heartbeating, so
      // neither the grace timer nor the heartbeat timeout will ever fire. The
      // workday boundary is the only thing that stops such a session accruing
      // hours forever; it always closes for review, because the real departure
      // time is unknown.
      if (decision.kind === "no_change") {
        decision = evaluateWorkdayOverrun(
          state,
          workdayEndMs(workplace, session.checkInAt),
          now,
          config.workdayOverrunMarginMinutes,
        );
      }

      if (decision.kind !== "close_session") continue;

      // Re-bound as a `const` so the narrowing survives into the transaction
      // callback below — TypeScript discards it for a reassignable `let`.
      const close = decision;
      const checkOutAt = new Date(close.checkOutAt);

      try {
        const didClose = await db.transaction(async (tx) => {
          const updated = await tx
            .update(attendanceSessions)
            .set({
              status: close.status,
              checkOutAt,
              checkoutReason: close.reason,
              durationMinutes: durationMinutes(
                session.checkInAt.getTime(),
                close.checkOutAt,
              ),
              exitGraceUntil: null,
              needsReview: session.needsReview || close.flags.length > 0,
              flags: [...new Set([...session.flags, ...close.flags])],
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(attendanceSessions.id, session.id),
                // Guard against a race with a device that checked out in the
                // meantime: only close if it is still open.
                inArray(attendanceSessions.status, [
                  "checked_in",
                  "pending_exit",
                ]),
              ),
            )
            .returning({ id: attendanceSessions.id });

          // The guard matched nothing: the device closed this session between
          // the scan above and now. Stop here rather than attaching a
          // synthesised check-out to a session that already ended properly.
          if (updated.length === 0) return false;

          // Synthesised events are marked `system` so they are never confused
          // with something the device actually reported.
          await tx.insert(attendanceEvents).values({
            companyId: session.companyId,
            employeeId: session.employeeId,
            sessionId: session.id,
            workplaceId: session.workplaceId,
            clientEventId: `system-${session.id}-${close.reason}`,
            eventType: "check_out",
            source: "system",
            occurredAt: checkOutAt,
          });

          for (const flag of close.flags) {
            await tx.insert(sessionSignals).values({
              companyId: session.companyId,
              employeeId: session.employeeId,
              sessionId: session.id,
              signalType: flag as "app_terminated",
              detail:
                "Session closed by the server after the device stopped reporting.",
              occurredAt: checkOutAt,
            });
          }

          return true;
        });

        if (!didClose) continue;

        await recordAudit({
          companyId: session.companyId,
          action: `attendance.${close.reason}`,
          entityType: "attendance_session",
          entityId: session.id,
          metadata: {
            checkOutAt: checkOutAt.toISOString(),
            status: close.status,
            flags: close.flags,
          },
        });

        closed += 1;
      } catch (error) {
        logger.error(
          { err: error, sessionId: session.id },
          "Failed to auto-close session",
        );
      }
    }

    if (closed > 0) logger.info({ closed }, "Sweeper closed sessions");
    return closed;
  } finally {
    await db.execute(`select pg_advisory_unlock(${SWEEPER_LOCK_KEY})`);
  }
}

export function startSweeper(): void {
  if (!config.sweeperEnabled) {
    logger.warn("Sweeper disabled by configuration");
    return;
  }
  if (timer) return;

  timer = setInterval(() => {
    // Skip if the previous tick is still going — a slow database should not
    // pile up overlapping sweeps.
    if (running) return;
    running = true;
    runSweep()
      .catch((error) => logger.error({ err: error }, "Sweep failed"))
      .finally(() => {
        running = false;
      });
  }, config.sweeperIntervalMs);

  // Do not hold the process open solely for the sweeper.
  timer.unref?.();

  logger.info(
    { intervalMs: config.sweeperIntervalMs },
    "Attendance sweeper started",
  );
}

export function stopSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
