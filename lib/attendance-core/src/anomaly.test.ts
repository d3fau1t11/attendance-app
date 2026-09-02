import { describe, expect, it } from "vitest";
import { detectAnomalies } from "./anomaly";
import type { LocationFix } from "./geofence";

const BASE = { latitude: 9.0192, longitude: 38.7468 };

function fix(overrides: Partial<LocationFix> = {}): LocationFix {
  return { ...BASE, accuracyM: 10, timestamp: 1_700_000_000_000, ...overrides };
}

describe("detectAnomalies", () => {
  it("returns no flags for an ordinary fix from a known device", () => {
    const result = detectAnomalies({ current: fix(), isKnownDevice: true });
    expect(result.flags).toEqual([]);
  });

  it("flags an OS-reported mocked location", () => {
    const result = detectAnomalies({ current: fix({ isMocked: true }) });
    expect(result.flags).toContain("mock_location_detected");
  });

  it("flags travel that is physically implausible", () => {
    // ~1 degree of latitude (111km) in one minute → far beyond any vehicle.
    const previous = fix({ timestamp: 1_700_000_000_000 });
    const current = fix({
      latitude: BASE.latitude + 1,
      timestamp: 1_700_000_060_000,
    });
    const result = detectAnomalies({ current, previous });
    expect(result.flags).toContain("impossible_travel");
  });

  it("does not flag a normal commute", () => {
    // 10km in 20 minutes = 30 km/h.
    const previous = fix({ timestamp: 1_700_000_000_000 });
    const current = fix({
      latitude: BASE.latitude + 10_000 / 111_320,
      timestamp: 1_700_000_000_000 + 20 * 60_000,
    });
    const result = detectAnomalies({ current, previous });
    expect(result.flags).not.toContain("impossible_travel");
  });

  it("tolerates a fast jump caused by a long GPS gap", () => {
    // 50km apart but 3 hours later — a reacquired fix after a flight/drive,
    // not evidence of spoofing.
    const previous = fix({ timestamp: 1_700_000_000_000 });
    const current = fix({
      latitude: BASE.latitude + 50_000 / 111_320,
      timestamp: 1_700_000_000_000 + 3 * 3_600_000,
    });
    expect(detectAnomalies({ current, previous }).flags).not.toContain(
      "impossible_travel",
    );
  });

  it("flags repeated toggling of location services", () => {
    const result = detectAnomalies({ current: fix(), providerToggleCount: 9 });
    expect(result.flags).toContain("provider_toggle_churn");
  });

  it("flags byte-identical coordinates, which real GPS never produces", () => {
    const result = detectAnomalies({
      current: fix(),
      recentFixes: [fix(), fix(), fix()],
    });
    expect(result.flags).toContain("duplicate_coordinates");
  });

  it("flags an unrecognised device without blocking it", () => {
    const result = detectAnomalies({ current: fix(), isKnownDevice: false });
    expect(result.flags).toContain("unknown_device");
    // The contract is advisory: callers receive flags, never a "reject" verdict.
    expect(result.notes.length).toBe(result.flags.length);
  });

  it("accumulates multiple independent flags", () => {
    const previous = fix({ timestamp: 1_700_000_000_000 });
    const current = fix({
      latitude: BASE.latitude + 1,
      timestamp: 1_700_000_060_000,
      isMocked: true,
    });
    const result = detectAnomalies({
      current,
      previous,
      isKnownDevice: false,
      providerToggleCount: 20,
    });
    expect(result.flags).toEqual(
      expect.arrayContaining([
        "mock_location_detected",
        "impossible_travel",
        "provider_toggle_churn",
        "unknown_device",
      ]),
    );
  });
});
