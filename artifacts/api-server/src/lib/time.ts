/**
 * Timezone-aware wall-clock arithmetic for workplace working hours.
 *
 * `workplaces.work_start` / `work_end` are `time` columns — a wall-clock time
 * with no date and no zone. The zone they are written in is
 * `workplaces.timezone`. Resolving them as UTC instead is not a rounding error:
 * in Addis Ababa (UTC+3) a 09:00 start would be evaluated as 12:00 local, so
 * nobody would ever be marked late before noon. Every function here therefore
 * takes the zone explicitly.
 *
 * Implemented on `Intl` rather than a date library because Node ships full ICU
 * and the whole job is two conversions: instant to wall clock, and wall clock
 * back to instant.
 */

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Constructing an `Intl.DateTimeFormat` is expensive and the sweeper calls this
 * once per open session per tick, so formatters are cached. `null` caches a
 * zone the platform rejected, so a bad tenant configuration costs one throw
 * rather than one per call.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  if (FORMATTERS.has(timeZone)) return FORMATTERS.get(timeZone) ?? null;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    // An unknown IANA name. Callers fall back to UTC; see `timeOfDayOn`.
    formatter = null;
  }
  FORMATTERS.set(timeZone, formatter);
  return formatter;
}

/** The wall clock shown in `timeZone` at a given instant. */
function wallClockIn(timeZone: string, at: Date): Wall | null {
  const formatter = formatterFor(timeZone);
  if (!formatter || !Number.isFinite(at.getTime())) return null;

  const parts = formatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : Number.NaN;
  };

  const wall: Wall = {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };

  return Object.values(wall).every(Number.isFinite) ? wall : null;
}

/** The zone's UTC offset in milliseconds at a given instant. */
function offsetMsAt(timeZone: string, at: Date): number {
  const wall = wallClockIn(timeZone, at);
  if (!wall) return 0;
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Both sides truncated to whole seconds so the difference is a clean offset
  // and not offset-plus-milliseconds.
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which `timeZone` shows the given wall clock.
 *
 * Two passes: the offset that applies *at* an instant depends on the instant,
 * so the naive guess is corrected once using the offset in force at the guess.
 * Across a DST transition the two offsets differ and the second is the right
 * one. A wall clock that a spring-forward skips entirely does not exist; the
 * result is then a deterministic instant within an hour of the gap, which is
 * close enough for a shift boundary and never throws.
 */
export function zonedWallClockToUtc(timeZone: string, wall: Wall): number {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const guess = naive - offsetMsAt(timeZone, new Date(naive));
  return naive - offsetMsAt(timeZone, new Date(guess));
}

/** Parse a Postgres `time` value, "HH:MM[:SS]". */
function parseTimeOfDay(value: string): {
  hour: number;
  minute: number;
  second: number;
} {
  const [h = "", m = "", s = ""] = String(value).split(":");
  const hour = Number(h);
  const minute = Number(m);
  const second = Number(s);
  return {
    hour: Number.isFinite(hour) ? hour : 9,
    minute: Number.isFinite(minute) ? minute : 0,
    second: Number.isFinite(second) ? second : 0,
  };
}

export type WorkingHours = {
  timezone: string;
  workStart: string;
  workEnd: string;
};

/**
 * Resolve a wall-clock time of day against the calendar day that `at` falls on
 * in `timeZone`, optionally shifted by whole days.
 */
function timeOfDayOn(
  timeZone: string,
  at: Date,
  timeOfDay: string,
  dayOffset = 0,
): number {
  const parsed = parseTimeOfDay(timeOfDay);
  const wall = wallClockIn(timeZone, at);

  if (!wall) {
    // Unknown zone. Degrade to UTC rather than throwing: a mistyped timezone
    // should skew a lateness figure, not block a check-in.
    const fallback = new Date(at.getTime() + dayOffset * 86_400_000);
    fallback.setUTCHours(parsed.hour, parsed.minute, parsed.second, 0);
    return fallback.getTime();
  }

  // `Date.UTC` normalises an out-of-range day, so day + 1 rolls the month over.
  return zonedWallClockToUtc(timeZone, {
    year: wall.year,
    month: wall.month,
    day: wall.day + dayOffset,
    ...parsed,
  });
}

/** Start of the working day covering `at`, as a UTC epoch in milliseconds. */
export function workdayStartMs(
  workplace: Pick<WorkingHours, "timezone" | "workStart">,
  at: Date,
): number {
  return timeOfDayOn(workplace.timezone, at, workplace.workStart);
}

/**
 * End of the working day that began on `at`'s calendar day.
 *
 * A shift whose end is at or before its start is an overnight shift, so the end
 * belongs to the next calendar day — computed as a real next-day wall clock
 * rather than "+24h", which would be an hour out across a DST change.
 */
export function workdayEndMs(workplace: WorkingHours, at: Date): number {
  const start = workdayStartMs(workplace, at);
  const sameDayEnd = timeOfDayOn(workplace.timezone, at, workplace.workEnd);
  if (sameDayEnd > start) return sameDayEnd;
  return timeOfDayOn(workplace.timezone, at, workplace.workEnd, 1);
}
