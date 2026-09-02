/**
 * Anti-fraud heuristics.
 *
 * Every function here produces a *flag*, never a rejection. Spoofing detection
 * is fundamentally evadable — rooted devices can hide the mock-location bit,
 * and a patient attacker can fake a plausible walk. Treating any of these as
 * proof would punish employees for GPS physics; treating them as evidence for a
 * human reviewer is honest about what they actually are.
 */
import { impliedSpeedKmh, type LocationFix } from "./geofence";

export type AnomalyFlag =
  | "mock_location_detected"
  | "impossible_travel"
  | "provider_toggle_churn"
  | "duplicate_coordinates"
  | "unknown_device";

/**
 * Above this, movement between two fixes is faster than a car in traffic and
 * implies teleportation rather than commuting. Set high enough that a genuine
 * fix arriving after a long GPS gap (which reads as a fast jump) is tolerated.
 */
export const IMPOSSIBLE_SPEED_KMH = 300;

/**
 * How many times location services may be toggled during one session before it
 * looks like someone is cycling GPS to inject a position rather than fighting a
 * flaky phone.
 */
export const PROVIDER_TOGGLE_LIMIT = 5;

/**
 * Real GPS never repeats a coordinate to full float precision — there is always
 * sub-metre jitter. Byte-identical readings suggest a fixed injected value.
 */
export const DUPLICATE_COORDINATE_LIMIT = 3;

export type AnomalyInput = {
  current: LocationFix;
  /** The previous accepted fix for this employee, if any. */
  previous?: LocationFix | null;
  /** Count of location-services toggles observed this session. */
  providerToggleCount?: number;
  /** Recent fixes used to spot exact repeats. */
  recentFixes?: readonly LocationFix[];
  /** False when the device has not been seen for this employee before. */
  isKnownDevice?: boolean;
};

export type AnomalyResult = {
  flags: AnomalyFlag[];
  /** Human-readable notes, one per flag, for the admin review queue. */
  notes: string[];
};

export function detectAnomalies(input: AnomalyInput): AnomalyResult {
  const flags: AnomalyFlag[] = [];
  const notes: string[] = [];

  if (input.current.isMocked) {
    flags.push("mock_location_detected");
    notes.push("Device reported the location as mocked.");
  }

  if (input.previous) {
    const speed = impliedSpeedKmh(input.previous, input.current);
    if (Number.isFinite(speed) && speed > IMPOSSIBLE_SPEED_KMH) {
      flags.push("impossible_travel");
      notes.push(
        `Implied travel speed ${Math.round(speed)} km/h exceeds the ${IMPOSSIBLE_SPEED_KMH} km/h threshold.`,
      );
    }
  }

  if ((input.providerToggleCount ?? 0) > PROVIDER_TOGGLE_LIMIT) {
    flags.push("provider_toggle_churn");
    notes.push(
      `Location services toggled ${input.providerToggleCount} times during this session.`,
    );
  }

  const identical = (input.recentFixes ?? []).filter(
    (fix) =>
      fix.latitude === input.current.latitude &&
      fix.longitude === input.current.longitude,
  ).length;
  if (identical >= DUPLICATE_COORDINATE_LIMIT) {
    flags.push("duplicate_coordinates");
    notes.push(
      `Coordinates repeated exactly ${identical} times; genuine GPS always jitters.`,
    );
  }

  if (input.isKnownDevice === false) {
    flags.push("unknown_device");
    notes.push("Attendance recorded from a device not seen before.");
  }

  return { flags, notes };
}
