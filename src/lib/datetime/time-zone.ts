/**
 * Application-wide wall-clock timezone.
 *
 * Cron expressions are wall-clock schedules, while database timestamps are
 * absolute instants. Keep this value shared by schedule parsing, form input,
 * and date formatting so a deployment host's local timezone cannot alter a
 * saved schedule.
 */
export const APP_TIME_ZONE = "Asia/Shanghai";

const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

type WallClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const wallClockFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getWallClockFormatter(timeZone: string) {
  let formatter = wallClockFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    wallClockFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function wallClockAsUtc(date: Date, timeZone: string): number {
  const values = Object.fromEntries(
    getWallClockFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const { year, month, day, hour, minute, second } = values;
  if (
    year === undefined
    || month === undefined
    || day === undefined
    || hour === undefined
    || minute === undefined
    || second === undefined
  ) {
    throw new RangeError(`Could not extract wall-clock fields for timezone ${timeZone}`);
  }
  return Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    date.getUTCMilliseconds(),
  );
}

function parseWallClock(value: string): WallClockParts {
  const match = LOCAL_DATE_TIME_RE.exec(value.trim());
  if (!match) {
    throw new RangeError("Expected a local date and time in YYYY-MM-DDTHH:mm format");
  }
  const [, year, month, day, hour, minute, second = "0", fraction = ""] = match;
  const parsed = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    millisecond: Number((fraction + "000").slice(0, 3)),
  };
  const candidate = new Date(
    Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      parsed.hour,
      parsed.minute,
      parsed.second,
      parsed.millisecond,
    ),
  );
  if (
    candidate.getUTCFullYear() !== parsed.year ||
    candidate.getUTCMonth() !== parsed.month - 1 ||
    candidate.getUTCDate() !== parsed.day ||
    candidate.getUTCHours() !== parsed.hour ||
    candidate.getUTCMinutes() !== parsed.minute ||
    candidate.getUTCSeconds() !== parsed.second
  ) {
    throw new RangeError("Invalid calendar date or time");
  }
  return parsed;
}

/**
 * Interpret a native `<input type="datetime-local">` value in `timeZone`.
 * Native inputs have no IANA timezone support; using this conversion prevents
 * the browser's local timezone from silently changing a one-off schedule.
 */
export function zonedDateTimeToDate(value: string, timeZone = APP_TIME_ZONE): Date {
  const wallClock = parseWallClock(value);
  const desiredWallClockAsUtc = Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute,
    wallClock.second,
    wallClock.millisecond,
  );

  // Convert the desired wall-clock fields to an instant. Repeating the offset
  // calculation handles zones whose DST offset changes around the candidate.
  let instant = desiredWallClockAsUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observedWallClockAsUtc = wallClockAsUtc(new Date(instant), timeZone);
    instant = desiredWallClockAsUtc - (observedWallClockAsUtc - instant);
  }

  if (wallClockAsUtc(new Date(instant), timeZone) !== desiredWallClockAsUtc) {
    throw new RangeError("This local time does not exist in the configured timezone");
  }
  return new Date(instant);
}

export function zonedDateTimeToIso(value: string, timeZone = APP_TIME_ZONE): string {
  return zonedDateTimeToDate(value, timeZone).toISOString();
}
