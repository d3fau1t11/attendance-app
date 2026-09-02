import * as SQLite from 'expo-sqlite';

/**
 * Offline event outbox.
 *
 * SQLite rather than AsyncStorage because two writers exist — the UI and the
 * headless background location task — and a single JSON blob would lose events
 * to last-write-wins races. SQLite gives real atomic appends.
 *
 * Invariants:
 *   - Every event carries a client-generated id; the server's unique index on
 *     (employee_id, client_event_id) makes replay idempotent.
 *   - `sequence` is monotonic per device, so the server can restore ordering
 *     even when events arrive out of order after a long offline spell.
 *   - Nothing is deleted until the server confirms it, so a crash mid-sync
 *     cannot lose an attendance event.
 */

export type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'rejected';

export type OutboxEvent = {
  id: number;
  clientEventId: string;
  sequence: number;
  eventType:
    | 'check_in'
    | 'check_out'
    | 'geofence_enter'
    | 'geofence_exit'
    | 'heartbeat';
  payload: Record<string, unknown>;
  occurredAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('attendance.db');
      // WAL lets the background task write while the UI reads.
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_event_id TEXT NOT NULL UNIQUE,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox(status, sequence);
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

/** Monotonic per-device counter, persisted so it survives restarts. */
async function nextSequence(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'sequence'`,
  );
  const next = (row ? Number(row.value) : 0) + 1;
  await db.runAsync(
    `INSERT INTO meta (key, value) VALUES ('sequence', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(next)],
  );
  return next;
}

function makeClientEventId(): string {
  // Random + time, sufficient for a per-device identifier that the server
  // dedupes on. Not a UUID because expo-crypto is not a dependency here.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function enqueue(params: {
  eventType: OutboxEvent['eventType'];
  payload: Record<string, unknown>;
  occurredAt: Date;
}): Promise<OutboxEvent> {
  const db = await getDb();
  const sequence = await nextSequence(db);
  const clientEventId = makeClientEventId();
  const occurredAt = params.occurredAt.toISOString();

  const payload = {
    ...params.payload,
    clientEventId,
    clientSequence: sequence,
    occurredAt,
    eventType: params.eventType,
  };

  const result = await db.runAsync(
    `INSERT INTO outbox (client_event_id, sequence, event_type, payload, occurred_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      clientEventId,
      sequence,
      params.eventType,
      JSON.stringify(payload),
      occurredAt,
    ],
  );

  return {
    id: result.lastInsertRowId,
    clientEventId,
    sequence,
    eventType: params.eventType,
    payload,
    occurredAt,
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
}

type Row = {
  id: number;
  client_event_id: string;
  sequence: number;
  event_type: OutboxEvent['eventType'];
  payload: string;
  occurred_at: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

function toEvent(row: Row): OutboxEvent {
  return {
    id: row.id,
    clientEventId: row.client_event_id,
    sequence: row.sequence,
    eventType: row.event_type,
    payload: JSON.parse(row.payload),
    occurredAt: row.occurred_at,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

/** Oldest-first, so replay preserves the order events actually happened in. */
export async function getPending(limit = 100): Promise<OutboxEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM outbox WHERE status IN ('pending','syncing')
     ORDER BY sequence ASC LIMIT ?`,
    [limit],
  );
  return rows.map(toEvent);
}

export async function countPending(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM outbox WHERE status IN ('pending','syncing')`,
  );
  return row?.n ?? 0;
}

export async function countRejected(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM outbox WHERE status = 'rejected'`,
  );
  return row?.n ?? 0;
}

export async function markSyncing(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = 'syncing', attempts = attempts + 1
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
}

export async function markSynced(clientEventIds: string[]): Promise<void> {
  if (!clientEventIds.length) return;
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = 'synced', last_error = NULL
     WHERE client_event_id IN (${clientEventIds.map(() => '?').join(',')})`,
    clientEventIds,
  );
}

/**
 * A permanent rejection (bad QR, outside geofence). Kept rather than deleted so
 * the user can be told the event was not accepted instead of it vanishing.
 */
export async function markRejected(
  clientEventId: string,
  reason: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = 'rejected', last_error = ? WHERE client_event_id = ?`,
    [reason, clientEventId],
  );
}

/** Return a failed batch to `pending` so the next sync retries it. */
export async function markRetryable(
  clientEventIds: string[],
  reason: string,
): Promise<void> {
  if (!clientEventIds.length) return;
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = 'pending', last_error = ?
     WHERE client_event_id IN (${clientEventIds.map(() => '?').join(',')})`,
    [reason, ...clientEventIds],
  );
}

export async function getRejected(limit = 20): Promise<OutboxEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM outbox WHERE status = 'rejected' ORDER BY sequence DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toEvent);
}

export async function dismissRejected(clientEventId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox WHERE client_event_id = ?`, [
    clientEventId,
  ]);
}

/** Housekeeping: drop synced rows older than a week. */
export async function pruneSynced(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM outbox WHERE status = 'synced' AND created_at < datetime('now', '-7 days')`,
  );
}

/**
 * Recover rows stuck in `syncing` — the app was killed mid-sync. Safe because
 * the server deduplicates on `clientEventId`.
 */
export async function recoverStuck(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET status = 'pending' WHERE status = 'syncing'`);
}

/** Wipe everything — used on sign-out so events do not leak between accounts. */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox`);
  await db.runAsync(`DELETE FROM meta WHERE key = 'sequence'`);
}
