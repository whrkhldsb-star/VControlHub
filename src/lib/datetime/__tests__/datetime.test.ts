import { describe, expect, it } from "vitest";

import {
  APP_TIME_ZONE,
  formatDateTime,
} from "@/lib/datetime/format";

describe("datetime formatters", () => {
  it("APP_TIME_ZONE is fixed to Asia/Shanghai", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Shanghai");
  });

  describe("formatDateTime", () => {
    it("formats a Date as YYYY/MM/DD HH:mm:ss in Asia/Shanghai for the zh locale", () => {
      // 2025-01-15 03:30:45 UTC = 2025-01-15 11:30:45 Asia/Shanghai
      const out = formatDateTime(new Date("2025-01-15T03:30:45Z"), "zh");
      expect(out).toMatch(/^2025\/01\/15 11:30:45$/);
    });

    it("accepts ISO string input", () => {
      const out = formatDateTime("2025-01-15T03:30:45Z", "zh");
      expect(out).toMatch(/^2025\/01\/15 11:30:45$/);
    });

    it("accepts epoch number input", () => {
      const out = formatDateTime(Date.parse("2025-01-15T03:30:45Z"), "zh");
      expect(out).toMatch(/^2025\/01\/15 11:30:45$/);
    });

    it("accepts epoch zero instead of treating it as an empty value", () => {
      expect(formatDateTime(0, "zh")).toMatch(/^1970\/01\/01 08:00:00$/);
    });

    it("formats the en locale with en-US shaping", () => {
      const out = formatDateTime(new Date("2025-01-15T03:30:45Z"), "en");
      expect(out).toMatch(/^01\/15\/2025/);
    });

    it("returns the fallback for null / undefined / NaN", () => {
      expect(formatDateTime(null, "zh")).toBe("—");
      expect(formatDateTime(undefined, "zh")).toBe("—");
      expect(formatDateTime(Number.NaN, "zh")).toBe("—");
      expect(formatDateTime(null, "zh", "n/a")).toBe("n/a");
    });
  });
});
