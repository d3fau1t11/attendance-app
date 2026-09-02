/**
 * Geofence evaluation. Pure functions, no I/O — the identical logic runs on the
 * server (authoritative decisions) and on the device (deciding whether an
 * observation is even worth reporting).
 */

/** Tunables come from the `workplaces` row; see the schema for rationale. */
export type GeofenceConfig = {
  latitude: number;
  longitude: number;
  radiusM: number;
  /** Hysteresis band added to the radius before an exit is believed. */
  exitBufferM: number;
  /** Fixes less accurate than this are unusable in either direction. */
  maxAccuracyM: number;
};

export type LocationFix = {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy in metres (radius of 68% confidence). */
  accuracyM: number;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Android mock-location indicator, when the OS provides it. */
  isMocked?: boolean;
};

/**
 * The three-valued result is the heart of avoiding false check-outs. A binary
 * inside/outside answer forces a decision on evidence that does not support
 * one; `inconclusive` lets the state machine correctly do nothing.
 */
export type GeofenceVerdict = "inside" | "outside" | "inconclusive";

export type GeofenceEvaluation = {
  verdict: GeofenceVerdict;
  /** Distance from the fix to the geofence centre, in metres. */
  distanceM: number;
  /** Why this verdict was reached — surfaced in the UI and audit trail. */
  reason:
    | "within_radius"
    | "confidently_outside"
    | "accuracy_too_poor"
    | "within_hysteresis_band";
};

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean Earth radius

/**
 * Great-circle distance between two coordinates, in metres.
 *
 * Haversine is accurate to ~0.5% which is far below GPS noise at the scale of a
 * workplace geofence, and it avoids the convergence issues of Vincenty.
 */
export function haversineDistanceM(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = Math.PI / 180;
  const φ1 = aLat * toRad;
  const φ2 = bLat * toRad;
  const Δφ = (bLat - aLat) * toRad;
  const Δλ = (bLon - aLon) * toRad;

  const h =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Classify a single fix against a geofence.
 *
 * The asymmetry between entering and leaving is deliberate:
 *
 *   inside   ⟸ distance ≤ radius                     (plain radius)
 *   outside  ⟸ distance − accuracy > radius + buffer (must clear the band)
 *
 * Anything between the two is `inconclusive`. Concretely: with a 150m radius,
 * a 50m buffer and a fix 200m away accurate to ±80m, the device could genuinely
 * be standing at the door — so we refuse to call it an exit. This is what stops
 * GPS drift from checking people out while they sit at their desk.
 */
export function evaluateGeofence(
  fix: LocationFix,
  config: GeofenceConfig,
): GeofenceEvaluation {
  const distanceM = haversineDistanceM(
    fix.latitude,
    fix.longitude,
    config.latitude,
    config.longitude,
  );

  // Garbage in, no decision out. A ±500m fix proves nothing either way.
  if (fix.accuracyM > config.maxAccuracyM) {
    return { verdict: "inconclusive", distanceM, reason: "accuracy_too_poor" };
  }

  if (distanceM <= config.radiusM) {
    return { verdict: "inside", distanceM, reason: "within_radius" };
  }

  const exitThreshold = config.radiusM + config.exitBufferM;
  if (distanceM - fix.accuracyM > exitThreshold) {
    return { verdict: "outside", distanceM, reason: "confidently_outside" };
  }

  return {
    verdict: "inconclusive",
    distanceM,
    reason: "within_hysteresis_band",
  };
}

/** Speed in km/h implied by moving between two fixes. */
export function impliedSpeedKmh(from: LocationFix, to: LocationFix): number {
  const seconds = Math.abs(to.timestamp - from.timestamp) / 1000;
  if (seconds <= 0) return Number.POSITIVE_INFINITY;
  const metres = haversineDistanceM(
    from.latitude,
    from.longitude,
    to.latitude,
    to.longitude,
  );
  return (metres / seconds) * 3.6;
}
