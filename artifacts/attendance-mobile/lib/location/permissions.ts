import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';

/**
 * Location readiness.
 *
 * Every failure mode in the brief maps to a distinct, named state with its own
 * remedy. The alternative — a single "location unavailable" — leaves the user
 * with no idea whether to grant a permission, walk outside, or disable battery
 * optimisation.
 *
 * Nothing here ever fabricates attendance. A blocked state means the check-in
 * does not happen and the user is told exactly why.
 */

export type LocationReadiness =
  | 'ready'
  /** Foreground permission not granted. */
  | 'permission_denied'
  /** Permission permanently denied — must be changed in system settings. */
  | 'permission_blocked'
  /** Background permission missing; automatic checkout will not work. */
  | 'background_permission_missing'
  /** Device-wide location services are switched off. */
  | 'services_disabled'
  /** Permissions fine, but no usable fix could be obtained. */
  | 'gps_unavailable';

export type ReadinessReport = {
  status: LocationReadiness;
  /** Foreground granted — enough to check in, not enough for auto-checkout. */
  canCheckIn: boolean;
  /** Background granted — required for exit detection with the app closed. */
  canTrackInBackground: boolean;
  title: string;
  message: string;
  /** Label for the remedial action, when one exists. */
  actionLabel?: string;
};

const REPORTS: Record<LocationReadiness, Omit<ReadinessReport, 'status' | 'canCheckIn' | 'canTrackInBackground'>> = {
  ready: {
    title: 'Location ready',
    message: 'Your location will be checked against the workplace boundary.',
  },
  permission_denied: {
    title: 'Location permission needed',
    message:
      'Attendance cannot be recorded without confirming you are at the workplace. Your location is only checked against the workplace boundary — no movement history is stored.',
    actionLabel: 'Grant permission',
  },
  permission_blocked: {
    title: 'Location permission blocked',
    message:
      'Location access was denied permanently. Open Settings and allow location for this app, then return here.',
    actionLabel: 'Open settings',
  },
  background_permission_missing: {
    title: 'Allow location all the time',
    message:
      'Without background location, you will not be checked out automatically when you leave — your session may be closed for review instead. Choose "Allow all the time" in Settings.',
    actionLabel: 'Open settings',
  },
  services_disabled: {
    title: 'Location services are off',
    message:
      'Turn on location services (GPS) on your device to record attendance.',
    actionLabel: 'Open location settings',
  },
  gps_unavailable: {
    title: 'Cannot get a GPS fix',
    message:
      'Your device could not determine its position. Move to an open area, away from thick walls, and try again.',
    actionLabel: 'Retry',
  },
};

function report(
  status: LocationReadiness,
  canCheckIn: boolean,
  canTrackInBackground: boolean,
): ReadinessReport {
  return { status, canCheckIn, canTrackInBackground, ...REPORTS[status] };
}

/** Inspect current permissions without prompting. */
export async function checkReadiness(): Promise<ReadinessReport> {
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(
    () => false,
  );
  if (!servicesEnabled) return report('services_disabled', false, false);

  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) {
    // `canAskAgain === false` means the OS will no longer show a prompt, so
    // asking again is pointless — send the user to Settings instead.
    return foreground.canAskAgain
      ? report('permission_denied', false, false)
      : report('permission_blocked', false, false);
  }

  const background = await Location.getBackgroundPermissionsAsync().catch(
    () => ({ granted: false }) as Location.PermissionResponse,
  );

  if (!background.granted) {
    return report('background_permission_missing', true, false);
  }

  return report('ready', true, true);
}

/**
 * Request permissions in the order Android requires: foreground first, then
 * background as a separate prompt. Asking for background up front is rejected
 * outright by the OS.
 */
export async function requestForeground(): Promise<ReadinessReport> {
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(
    () => false,
  );
  if (!servicesEnabled) return report('services_disabled', false, false);

  const result = await Location.requestForegroundPermissionsAsync();
  if (!result.granted) {
    return result.canAskAgain
      ? report('permission_denied', false, false)
      : report('permission_blocked', false, false);
  }
  return checkReadiness();
}

/**
 * Request background ("Allow all the time") permission.
 *
 * On Android 11+ the system no longer shows an in-app dialog for this — it
 * opens Settings — so the UI must explain why before calling this.
 */
export async function requestBackground(): Promise<ReadinessReport> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return requestForeground();

  await Location.requestBackgroundPermissionsAsync().catch(() => undefined);
  return checkReadiness();
}

export async function openAppSettings(): Promise<void> {
  await Linking.openSettings().catch(() => {});
}

export async function openLocationSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS,
    ).catch(() => {});
    return;
  }
  await Linking.openSettings().catch(() => {});
}

/**
 * Ask Android to exempt the app from battery optimisation.
 *
 * Aggressive OEM battery management (Xiaomi, Huawei, Samsung especially) will
 * freeze the process and silently stop geofence delivery — the single most
 * common cause of missed automatic check-outs in the field. There is no
 * reliable API to *detect* this, so the app offers the exemption and is honest
 * that it cannot verify the result.
 */
export async function requestBatteryOptimisationExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const packageName =
    Constants.expoConfig?.android?.package ?? 'com.replit.attendancemobile';

  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: `package:${packageName}` },
    );
  } catch {
    // Some OEMs block this intent; fall back to the general settings screen.
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
    ).catch(() => {});
  }
}

export type FixResult =
  | { ok: true; fix: { latitude: number; longitude: number; accuracyM: number; timestamp: number; isMocked: boolean } }
  | { ok: false; reason: 'timeout' | 'unavailable' | 'permission' };

/**
 * Obtain a single high-accuracy fix.
 *
 * Wrapped in an explicit timeout because `getCurrentPositionAsync` can hang
 * indefinitely indoors, leaving a "Verifying…" spinner with no resolution.
 */
export async function getCurrentFix(timeoutMs = 15_000): Promise<FixResult> {
  const readiness = await checkReadiness();
  if (!readiness.canCheckIn) return { ok: false, reason: 'permission' };

  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: true,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    if (!position) return { ok: false, reason: 'timeout' };

    return {
      ok: true,
      fix: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM: position.coords.accuracy ?? 9999,
        timestamp: position.timestamp,
        // Android-only; undefined elsewhere, which reads as "not mocked".
        isMocked: position.mocked ?? false,
      },
    };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
