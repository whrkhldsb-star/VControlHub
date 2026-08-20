import { describe, expect, it } from "vitest";

import { APP_TIME_ZONE, zonedDateTimeToDate, zonedDateTimeToIso } from "@/lib/datetime/time-zone";

describe("application timezone conversion", () => {
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
