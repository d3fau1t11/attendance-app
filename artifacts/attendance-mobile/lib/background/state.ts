import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GeofenceConfig } from '@workspace/attendance-core';

/**
 * State shared between the UI and the headless background task.
 *
 * The background task runs in a fresh JS context with no React tree, so it
 * cannot read component state or context. AsyncStorage is the handoff point.
 *
 * Deliberately NOT SecureStore: this is non-sensitive operational state
 * (a workplace centre and radius), and SecureStore access from a headless task
 * is less reliable on Android.
 */

const KEY_GEOFENCE = 'attendance.active.geofence';
const KEY_LAST_FIX = 'attendance.last.fix';

export type ActiveGeofence = GeofenceConfig & {
  workplaceId: string;
  workplaceName: string;
};

export async function setActiveGeofence(
  geofence: ActiveGeofence | null,
): Promise<void> {
  if (geofence) {
    await AsyncStorage.setItem(KEY_GEOFENCE, JSON.stringify(geofence));
  } else {
    await AsyncStorage.removeItem(KEY_GEOFENCE);
  }
}

export async function getActiveGeofence(): Promise<ActiveGeofence | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_GEOFENCE);
    return raw ? (JSON.parse(raw) as ActiveGeofence) : null;
  } catch {
    return null;
  }
}

export type LastFixSummary = {
  at: number;
  verdict: 'inside' | 'outside' | 'inconclusive';
  distanceM: number;
  accuracyM: number;
};

/**
 * Last evaluated fix, written by the background task and read by the UI.
 *
 * Only the verdict and rounded distance are stored — never a coordinate. The
 * app has no reason to keep a location history on the device, and not writing
 * one means there is none to leak.
 */
export async function setLastFixSummary(summary: LastFixSummary): Promise<void> {
  await AsyncStorage.setItem(KEY_LAST_FIX, JSON.stringify(summary)).catch(
    () => {},
  );
}

export async function getLastFixSummary(): Promise<LastFixSummary | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_FIX);
    return raw ? (JSON.parse(raw) as LastFixSummary) : null;
  } catch {
    return null;
  }
}

export async function clearBackgroundState(): Promise<void> {
  await AsyncStorage.multiRemove([KEY_GEOFENCE, KEY_LAST_FIX]).catch(() => {});
}
