/**
 * Working-hours timezone arithmetic.
 *
 * These assertions are all written as "this wall clock in this zone is that UTC
 * instant", which is checkable by hand and independent of how the conversion is
 * implemented. Zones were picked for their properties: Addis Ababa never
 * observes DST, New York observes it, and Kathmandu sits on a 45-minute offset
 * that catches any assumption of whole-hour zones.
 */

import { describe, expect, it } from "vitest";
import { workdayEndMs, workdayStartMs, zonedWallClockToUtc } from "./time";

const iso = (ms: number) => new Date(ms).toISOString();

describe("zonedWallClockToUtc", () => {
  it("resolves a fixed-offset zone", () => {
    // Addis Ababa is UTC+3 year-round: 09:00 local is 06:00Z.
    expect(
      iso(
        zonedWallClockToUtc("Africa/Addis_Ababa", {
          year: 2026,
          month: 9,
          day: 2,
          hour: 9,
          minute: 0,
          second: 0,
        }),
      ),
    ).toBe("2026-09-02T06:00:00.000Z");
  });

  it("resolves a 45-minute offset", () => {
    // Kathmandu is UTC+05:45.
    expect(
      iso(
        zonedWallClockToUtc("Asia/Kathmandu", {
          year: 2026,
          month: 9,
          day: 2,
          hour: 9,
          minute: 0,
          second: 0,
        }),
      ),
    ).toBe("2026-09-02T03:15:00.000Z");
  });

  it("uses the offset in force on the day, not a fixed one", () => {
    const wall = { month: 1, day: 15, hour: 9, minute: 0, second: 0 };
    // January: EST, UTC-5.
    expect(
      iso(zonedWallClockToUtc("America/New_York", { ...wall, year: 2026 })),
    ).toBe("2026-01-15T14:00:00.000Z");
    // July: EDT, UTC-4.
    expect(
      iso(
        zonedWallClockToUtc("America/New_York", {
          ...wall,
          year: 2026,
          month: 7,
        }),
      ),
    ).toBe("2026-07-15T13:00:00.000Z");
  });

  it("lands on the correct side of a spring-forward transition", () => {
    // The US moves to EDT at 02:00 local on 2026-03-08. An 09:00 start that
    // morning is already EDT, so UTC-4 — a single-pass conversion that used the
    // previous day's offset would be an hour out.
    expect(
      iso(
        zonedWallClockToUtc("America/New_York", {
          year: 2026,
          month: 3,
          day: 8,
          hour: 9,
          minute: 0,
          second: 0,
        }),
      ),
    ).toBe("2026-03-08T13:00:00.000Z");
  });
});

describe("workdayStartMs", () => {
  const addis = { timezone: "Africa/Addis_Ababa", workStart: "09:00:00" };

  it("anchors to the local calendar day of the instant", () => {
    // 08:30 local on 2 September.
    const at = new Date("2026-09-02T05:30:00.000Z");
    expect(iso(workdayStartMs(addis, at))).toBe("2026-09-02T06:00:00.000Z");
  });

  it("uses the local day, not the UTC day", () => {
    // 01:00 local on 3 September is still 2 September in UTC. The workday that
    // instant belongs to is the 3rd's, which is what an employee would say.
    const at = new Date("2026-09-02T22:00:00.000Z");
    expect(iso(workdayStartMs(addis, at))).toBe("2026-09-03T06:00:00.000Z");
  });

  it("accepts a time without seconds", () => {
    const at = new Date("2026-09-02T05:30:00.000Z");
    expect(
      iso(workdayStartMs({ ...addis, workStart: "08:30" }, at)),
    ).toBe("2026-09-02T05:30:00.000Z");
  });

  it("falls back to UTC for an unrecognised zone rather than throwing", () => {
    const at = new Date("2026-09-02T05:30:00.000Z");
    expect(() =>
      workdayStartMs({ timezone: "Mars/Olympus_Mons", workStart: "09:00:00" }, at),
    ).not.toThrow();
    expect(
      iso(
        workdayStartMs(
          { timezone: "Mars/Olympus_Mons", workStart: "09:00:00" },
          at,
        ),
      ),
    ).toBe("2026-09-02T09:00:00.000Z");
  });
});

describe("workdayEndMs", () => {
  it("resolves a same-day shift", () => {
    const workplace = {
      timezone: "Africa/Addis_Ababa",
      workStart: "09:00:00",
      workEnd: "17:00:00",
    };
    const at = new Date("2026-09-02T07:00:00.000Z");
    expect(iso(workdayEndMs(workplace, at))).toBe("2026-09-02T14:00:00.000Z");
  });

  it("rolls an overnight shift into the next day", () => {
    // 22:00 to 06:00: the end is the following morning, not eight hours before
    // the shift started.
    const workplace = {
      timezone: "Africa/Addis_Ababa",
      workStart: "22:00:00",
      workEnd: "06:00:00",
    };
    const at = new Date("2026-09-02T19:30:00.000Z"); // 22:30 local
    expect(iso(workdayEndMs(workplace, at))).toBe("2026-09-03T03:00:00.000Z");
  });

  it("rolls an overnight shift across a month boundary", () => {
    const workplace = {
      timezone: "Africa/Addis_Ababa",
      workStart: "22:00:00",
      workEnd: "06:00:00",
    };
    const at = new Date("2026-09-30T19:30:00.000Z"); // 22:30 local, 30 Sept
    expect(iso(workdayEndMs(workplace, at))).toBe("2026-10-01T03:00:00.000Z");
  });

  it("treats a shift ending exactly at its start as overnight", () => {
    const workplace = {
      timezone: "Africa/Addis_Ababa",
      workStart: "09:00:00",
      workEnd: "09:00:00",
    };
    const at = new Date("2026-09-02T07:00:00.000Z");
    expect(iso(workdayEndMs(workplace, at))).toBe("2026-09-03T06:00:00.000Z");
  });
});
