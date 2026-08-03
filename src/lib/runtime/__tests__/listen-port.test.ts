import { describe, expect, it } from "vitest";

import { parseTcpPort } from "@/lib/runtime/listen-port";

describe("parseTcpPort", () => {
  it("uses the fallback and accepts decimal ports", () => {
    expect(parseTcpPort(undefined, 3000, "PORT")).toBe(3000);
    expect(parseTcpPort(" 48163 ", 3000, "PORT")).toBe(48163);
  });

  it("rejects partial, non-decimal, and out-of-range values", () => {
    for (const value of ["3000abc", "0x16", "1e3", "0", "65536"]) {
      expect(() => parseTcpPort(value, 3000, "PORT")).toThrow(
        "PORT must be a valid TCP port",
      );
    }
  });
});
