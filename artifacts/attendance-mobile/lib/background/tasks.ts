import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { evaluateGeofence, type LocationFix } from '@workspace/attendance-core';
import { apiRequest } from '../api/client';
import { getAccessToken } from '../api/config';
import * as outbox from '../outbox/store';
import { syncOutbox } from '../outbox/sync';
import { getActiveGeofence, setLastFixSummary } from './state';

/**
 * Background location tasks.
 *
 * CRITICAL: `TaskManager.defineTask` must run at module scope, and this module
 * must be imported from the app entry (`app/_layout.tsx`). Android relaunches
 * the JS runtime headlessly to deliver these events — if the definition lives
 * inside a component effect, the task is unregistered at that moment and the
 * event is dropped silently.
 *
 * Two mechanisms run together, deliberately:
 *
 *   GEOFENCE_TASK   OS-level enter/exit. Works with the app swiped away and
 *                   costs almost no battery, but Android may delay delivery by
 *                   minutes and occasionally miss a transition.
 *   LOCATION_TASK   Foreground-service location updates, active only while a
 *                   session is open. Provides heartbeats and prompt exit
 *                   detection at the cost of a persistent notification.
 *
 * Neither alone is sufficient: geofencing is too unreliable to be the only
 * signal, and a foreground service cannot be justified when off-shift.
 */

export const GEOFENCE_TASK = 'attendance-geofence';
export const LOCATION_TASK = 'attendance-location-updates';

/**
 * Report an observation, falling back to the outbox when the network fails.
 * Everything the background task produces goes through here so that no event is
 * ever lost to a dead connection.
 */
async function reportObservation(params: {
  eventType: 'geofence_enter' | 'geofence_exit' | 'heartbeat';
  fix: LocationFix | null;
  occurredAt: Date;
}): Promise<void> {
  // Without a session there is nobody to attribute the event to; queueing it
  // would only produce a rejection later.
  const token = await getAccessToken();
  if (!token) return;

  const payload: Record<string, unknown> = {
    eventType: params.eventType,
    occurredAt: params.occurredAt.toISOString(),
    source: 'background',
  };

  if (params.fix) {
    payload.latitude = params.fix.latitude;
    payload.longitude = params.fix.longitude;
    payload.accuracyM = params.fix.accuracyM;
    payload.isMocked = Boolean(params.fix.isMocked);
  }

  // Always queue first, then try to send. If the process is killed between the
  // two, the event survives and syncs later — the reverse order can lose it.
  const queued = await outbox.enqueue({
    eventType: params.eventType,
    payload,
    occurredAt: params.occurredAt,
  });

  try {
    await apiRequest('/api/attendance/observations', {
      method: 'POST',
      body: queued.payload,
      timeoutMs: 10_000,
    });
    await outbox.markSynced([queued.clientEventId]);
  } catch {
    // Left pending; the next foreground sync or connectivity change drains it.
  }
}

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[geofence] task error', error.message);
    return;
  }

  const { eventType, region } = (data ?? {}) as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };
  if (!region) return;

  const occurredAt = new Date();
  const isEnter = eventType === Location.GeofencingEventType.Enter;

  // The geofence callback carries no coordinates, so fetch one. It may fail
  // (GPS cold, permissions revoked) — the transition is still reported, because
  // the OS observing a boundary crossing is itself evidence.
  let fix: LocationFix | null = null;
  try {
    const position = await Location.getLastKnownPositionAsync({
      maxAge: 60_000,
      requiredAccuracy: 200,
    });
    if (position) {
      fix = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM: position.coords.accuracy ?? 9999,
        timestamp: position.timestamp,
        isMocked: position.mocked ?? false,
      };
    }
  } catch {
    // Ignored deliberately — see above.
  }

  await reportObservation({
    eventType: isEnter ? 'geofence_enter' : 'geofence_exit',
    fix,
    occurredAt,
  });
});

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[location] task error', error.message);
    return;
  }

  const { locations } = (data ?? {}) as { locations: Location.LocationObject[] };
  if (!locations?.length) return;

  // Batched updates arrive oldest-first; only the newest reflects current state.
  const latest = locations[locations.length - 1];
  const fix: LocationFix = {
    latitude: latest.coords.latitude,
    longitude: latest.coords.longitude,
    accuracyM: latest.coords.accuracy ?? 9999,
    timestamp: latest.timestamp,
    isMocked: latest.mocked ?? false,
  };

  const geofence = await getActiveGeofence();
  if (!geofence) return;

  const evaluation = evaluateGeofence(fix, geofence);
  await setLastFixSummary({
    at: Date.now(),
    verdict: evaluation.verdict,
    distanceM: Math.round(evaluation.distanceM),
    accuracyM: Math.round(fix.accuracyM),
  });

  // A heartbeat is sent regardless of verdict: server-side, silence is what
  // triggers a flagged auto-checkout, so staying in touch matters even when
  // the fix itself is inconclusive.
  await reportObservation({
    eventType:
      evaluation.verdict === 'outside'
        ? 'geofence_exit'
        : evaluation.verdict === 'inside'
          ? 'heartbeat'
          : 'heartbeat',
    fix,
    occurredAt: new Date(latest.timestamp),
  });

  // Opportunistically drain anything queued while offline.
  await syncOutbox().catch(() => {});
});

/**
 * Register OS geofences for the workplaces this employee may attend.
 *
 * Called after login and whenever assignments change. Re-calling replaces the
 * previous set, which is the documented way to update regions.
 */
export async function startGeofencing(
  regions: Array<{ id: string; latitude: number; longitude: number; radiusM: number }>,
): Promise<void> {
  if (!regions.length) {
    await stopGeofencing();
    return;
  }

  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    regions.map((region) => ({
      identifier: region.id,
      latitude: region.latitude,
      longitude: region.longitude,
      // Android enforces a practical floor around 100m; a smaller radius
      // produces unreliable callbacks rather than tighter detection.
      radius: Math.max(100, region.radiusM),
      notifyOnEnter: true,
      notifyOnExit: true,
    })),
  );
}

export async function stopGeofencing(): Promise<void> {
  const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(
    () => false,
  );
  if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
}

/**
 * Start the foreground service. Only while a session is open — a persistent
 * notification off-shift would be both intrusive and hard to justify.
 */
export async function startLocationUpdates(workplaceName: string): Promise<void> {
  const already = await Location.hasStartedLocationUpdatesAsync(
    LOCATION_TASK,
  ).catch(() => false);
  if (already) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    // Balanced against battery: frequent enough that an exit is noticed within
    // a minute or two, sparse enough not to drain a shift's worth of charge.
    timeInterval: 60_000,
    distanceInterval: 25,
    deferredUpdatesInterval: 60_000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Attendance tracking active',
      notificationBody: `Confirming you are at ${workplaceName}. Location is used only to check the workplace boundary.`,
      notificationColor: '#0f8f6b',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopLocationUpdates(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(
    LOCATION_TASK,
  ).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

/** Diagnostics for the profile screen. */
export async function getTrackingStatus(): Promise<{
  geofencingActive: boolean;
  locationUpdatesActive: boolean;
}> {
  const [geofencingActive, locationUpdatesActive] = await Promise.all([
    Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false),
    Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false),
  ]);
  return { geofencingActive, locationUpdatesActive };
}
