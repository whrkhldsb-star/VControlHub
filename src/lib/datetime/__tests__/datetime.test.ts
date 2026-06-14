import { describe, expect, it } from "vitest";

import {
  APP_TIME_ZONE,
  formatZhDate,
  formatZhDateTime,
  formatZhTime,
} from "@/lib/datetime/format";

describe("datetime formatters", () => {
  it("APP_TIME_ZONE is fixed to Asia/Shanghai", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Shanghai");
  });

  describe("formatZhDateTime", () => {
    it("formats a Date as YYYY/MM/DD HH:mm:ss in Asia/Shanghai", () => {
      // 2025-01-15 03:30:45 UTC = 2025-01-15 11:30:45 Asia/Shanghai
      const out = formatZhDateTime(new Date("2025-01-15T03:30:45Z"));
      expect(out).toMatch(/^2025\/01\/15 11:30:45$/);
    });

    it("accepts ISO string input", () => {
      const out = formatZhDateTime("2025-01-15T03:30:45Z");
      expect(out).toMatch(/^2025\/01\/15 11:30:45$/);
    });

    it("accepts epoch number input", () => {
      const out = formatZhDateTime(Date.parse("2025-01-15T03:30:45Z"));
      expect(out).toMatch(/^2025\/01\/15 11:30:45$/);
    });

    it("returns the fallback for null / undefined / NaN", () => {
      expect(formatZhDateTime(null)).toBe("—");
      expect(formatZhDateTime(undefined)).toBe("—");
      expect(formatZhDateTime(Number.NaN)).toBe("—");
      expect(formatZhDateTime(null, "n/a")).toBe("n/a");
    });
  });

  describe("formatZhDate", () => {
    it("returns just the date portion", () => {
      const out = formatZhDate(new Date("2025-01-15T03:30:45Z"));
      expect(out).toMatch(/^2025\/01\/15$/);
    });
    it("honors the fallback", () => {
      expect(formatZhDate(null, "no-date")).toBe("no-date");
    });
  });

  describe("formatZhTime", () => {
    it("returns just the time portion", () => {
      const out = formatZhTime(new Date("2025-01-15T03:30:45Z"));
      expect(out).toMatch(/^11:30:45$/);
    });
    it("honors the fallback", () => {
      expect(formatZhTime(undefined, "n/a")).toBe("n/a");
    });
  });
});
