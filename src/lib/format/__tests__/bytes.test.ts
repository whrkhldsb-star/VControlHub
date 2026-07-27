import { describe, expect, it } from "vitest";

import { formatBytes, formatBytesPerSecond } from "@/lib/format/bytes";

describe("shared byte formatting", () => {
  it("formats numbers, strings and bigint with one unit policy", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes("1536")).toBe("1.5 KB");
    expect(formatBytes(BigInt(5 * 1024 * 1024))).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.00 GB");
  });

  it("supports caller-specific fallback and zero labels", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(null, { fallback: "unknown" })).toBe("unknown");
    expect(formatBytes(0, { zero: "0 B" })).toBe("0 B");
    expect(formatBytesPerSecond(0, { zero: "0 B" })).toBe("0 B/s");
  });
});
