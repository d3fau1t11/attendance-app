import { describe, expect, it } from "vitest";
import {
  evaluateGeofence,
  haversineDistanceM,
  impliedSpeedKmh,
  type GeofenceConfig,
  type LocationFix,
} from "./geofence";

const HQ = { latitude: 9.0192, longitude: 38.7468 };

const config: GeofenceConfig = {
  ...HQ,
  radiusM: 150,
  exitBufferM: 50,
  maxAccuracyM: 100,
};

/** Offset a coordinate by a north-south distance; 1° latitude ≈ 111.32 km. */
function north(metres: number): { latitude: number; longitude: number } {
  return { latitude: HQ.latitude + metres / 111_320, longitude: HQ.longitude };
}

function fix(distanceM: number, accuracyM: number): LocationFix {
  return { ...north(distanceM), accuracyM, timestamp: 1_700_000_000_000 };
}

describe("haversineDistanceM", () => {
  it("returns zero for identical points", () => {
    expect(haversineDistanceM(9.0192, 38.7468, 9.0192, 38.7468)).toBe(0);
  });

  it("measures a known north-south offset within 1%", () => {
    const d = haversineDistanceM(
      HQ.latitude,
      HQ.longitude,
      north(500).latitude,
      north(500).longitude,
    );
    expect(d).toBeGreaterThan(495);
    expect(d).toBeLessThan(505);
  });
});

describe("evaluateGeofence", () => {
  it("treats a fix well within the radius as inside", () => {
    const result = evaluateGeofence(fix(50, 10), config);
    expect(result.verdict).toBe("inside");
    expect(result.reason).toBe("within_radius");
  });

  it("treats a fix exactly on the radius as inside", () => {
    // Boundary is inclusive: standing at the property line counts as present.
    const result = evaluateGeofence(fix(150, 5), config);
    expect(result.verdict).toBe("inside");
  });

  it("calls a distant, precise fix confidently outside", () => {
    // 400m away, ±10m → 390m > 200m threshold.
    const result = evaluateGeofence(fix(400, 10), config);
    expect(result.verdict).toBe("outside");
    expect(result.reason).toBe("confidently_outside");
  });

  it("refuses to decide when accuracy is worse than the configured limit", () => {
    // This is the anti-false-checkout guarantee: a ±250m fix proves nothing,
    // even though it reads as 800m from the centre.
    const result = evaluateGeofence(fix(800, 250), config);
    expect(result.verdict).toBe("inconclusive");
    expect(result.reason).toBe("accuracy_too_poor");
  });

  it("refuses to decide inside the hysteresis band", () => {
    // 220m away with ±80m accuracy → could genuinely be at the door (140m).
    // Calling this an exit is precisely how phantom check-outs happen.
    const result = evaluateGeofence(fix(220, 80), config);
    expect(result.verdict).toBe("inconclusive");
    expect(result.reason).toBe("within_hysteresis_band");
  });

  it("does not report an exit for a fix just past the radius", () => {
    // 160m: outside the radius but nowhere near clearing radius+buffer.
    expect(evaluateGeofence(fix(160, 10), config).verdict).toBe("inconclusive");
  });

  it("is sticky: re-entry uses the plain radius, exit needs the full band", () => {
    // A device oscillating between 140m and 180m never flips state, because
    // 180m is inconclusive rather than an exit.
    expect(evaluateGeofence(fix(140, 10), config).verdict).toBe("inside");
    expect(evaluateGeofence(fix(180, 10), config).verdict).toBe("inconclusive");
  });
});

describe("impliedSpeedKmh", () => {
  it("computes a plausible walking speed", () => {
    const a: LocationFix = { ...north(0), accuracyM: 5, timestamp: 0 };
    const b: LocationFix = { ...north(100), accuracyM: 5, timestamp: 60_000 };
    // 100m in 60s = 6 km/h.
    expect(impliedSpeedKmh(a, b)).toBeCloseTo(6, 0);
  });

  it("returns Infinity for a zero time delta rather than dividing by zero", () => {
    const a: LocationFix = { ...north(0), accuracyM: 5, timestamp: 1000 };
    const b: LocationFix = { ...north(100), accuracyM: 5, timestamp: 1000 };
    expect(impliedSpeedKmh(a, b)).toBe(Number.POSITIVE_INFINITY);
  });
});
