import { apiRequest, NetworkError } from '../api/client';
import * as outbox from './store';

/**
 * Outbox drain.
 *
 * The server returns a per-event outcome rather than a single status, which is
 * what lets us distinguish three very different cases:
 *
 *   accepted / duplicate → done, mark synced
 *   rejected             → will never succeed (bad QR, outside geofence);
 *                          keep it and show the user why
 *   retry_later          → transient server fault; return to pending
 *
 * Collapsing these into "success/failure" would either silently discard real
 * attendance events or retry doomed ones forever.
 */

export type SyncOutcome = {
  attempted: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  /** True when the failure was connectivity rather than the server. */
  offline: boolean;
};

let syncing = false;

export async function syncOutbox(): Promise<SyncOutcome> {
  const empty: SyncOutcome = {
    attempted: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    offline: false,
  };

  // A concurrent drain would double-send; the server would dedupe, but the
  // wasted round-trips matter on a weak connection.
  if (syncing) return empty;
  syncing = true;

  try {
    await outbox.recoverStuck();
    const pending = await outbox.getPending(100);
    if (!pending.length) return empty;

    const ids = pending.map((event) => event.id);
    await outbox.markSyncing(ids);

    let response: {
      results: Array<{
        clientEventId: string;
        status: 'accepted' | 'duplicate' | 'rejected';
        code?: string;
        message?: string;
      }>;
    };

    try {
      response = await apiRequest('/api/attendance/sync', {
        method: 'POST',
        body: { events: pending.map((event) => event.payload) },
        timeoutMs: 30_000,
      });
    } catch (error) {
      // Offline or server unreachable: put everything back and try later.
      await outbox.markRetryable(
        pending.map((e) => e.clientEventId),
        error instanceof NetworkError ? 'Waiting for connection' : String(error),
      );
      return { ...empty, attempted: pending.length, offline: true };
    }

    const synced: string[] = [];
    const retry: string[] = [];
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const result of response.results ?? []) {
      if (result.status === 'accepted') {
        synced.push(result.clientEventId);
        accepted += 1;
      } else if (result.status === 'duplicate') {
        synced.push(result.clientEventId);
        duplicates += 1;
      } else if (result.code === 'retry_later') {
        retry.push(result.clientEventId);
      } else {
        await outbox.markRejected(
          result.clientEventId,
          result.message ?? 'The server did not accept this event.',
        );
        rejected += 1;
      }
    }

    await outbox.markSynced(synced);
    await outbox.markRetryable(retry, 'Server asked to retry later');
    await outbox.pruneSynced();

    return {
      attempted: pending.length,
      accepted,
      duplicates,
      rejected,
      offline: false,
    };
  } finally {
    syncing = false;
  }
}
