import { describe, expect, it } from "vitest";

import { APP_TIME_ZONE, appTimeZoneDateTimeLocal, zonedDateTimeToDate, zonedDateTimeToIso } from "@/lib/datetime/time-zone";

describe("application timezone conversion", () => {
  // An edited one-off task opens with its time in the field; saving it unchanged keeps the same instant.
  it("shows an instant as a datetime-local field in the application time zone, and reads it back", () => {
    expect(appTimeZoneDateTimeLocal(new Date("2026-08-20T02:00:00.000Z"))).toBe("2026-08-20T10:00");
    expect(zonedDateTimeToIso(appTimeZoneDateTimeLocal(new Date("2026-12-31T23:30:00.000Z")))).toBe("2026-12-31T23:30:00.000Z");
  });

  it("interprets datetime-local values in the application timezone, not the browser timezone", () => {
    expect(zonedDateTimeToIso("2026-08-20T10:00")).toBe("2026-08-20T02:00:00.000Z");
    expect(zonedDateTimeToDate("2026-08-20T10:00", APP_TIME_ZONE).getTime()).toBe(
      Date.parse("2026-08-20T02:00:00.000Z"),
    );
  });

  it("rejects malformed calendar values instead of letting Date normalize them", () => {
    expect(() => zonedDateTimeToIso("2026-02-30T10:00")).toThrow(RangeError);
    expect(() => zonedDateTimeToIso("not-a-date")).toThrow(RangeError);
  });
});
