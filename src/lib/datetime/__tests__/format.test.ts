import { describe, expect, it } from "vitest";

import {
  formatCompactDateTime,
  formatDateTime,
  formatShortDate,
  formatShortTime,
} from "@/lib/datetime/format";

const SAMPLE = "2026-07-27T06:30:45.000Z"; // 14:30:45 Asia/Shanghai

describe("shared datetime formatting", () => {
  it("uses the application timezone and locale-aware fixed formats", () => {
    expect(formatDateTime(SAMPLE, "zh")).toContain("14:30:45");
    expect(formatShortDate(SAMPLE, "zh")).toMatch(/07[\/-]27/);
    expect(formatShortTime(SAMPLE, "zh")).toContain("14:30");
    expect(formatCompactDateTime(SAMPLE, "en")).toMatch(/07\/27.*14:30/);
  });

  it("uses fallback for empty and invalid values", () => {
    expect(formatDateTime(null, "zh")).toBe("—");
    expect(formatShortTime("not-a-date", "en", "invalid")).toBe("invalid");
  });
});
