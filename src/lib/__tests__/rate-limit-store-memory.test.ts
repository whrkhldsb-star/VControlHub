import { describe, expect, it } from "vitest";

import { getRateLimitStore } from "@/lib/rate-limit-store";

describe("in-memory rate-limit store bounds", () => {
  it("accepts keys of any length without keeping them verbatim", async () => {
    const store = getRateLimitStore();
    const huge = `login:${"x".repeat(1_000_000)}`;
    const first = await store.addAndGetWindow(huge, 1_000, 60_000);
    const second = await store.addAndGetWindow(huge, 2_000, 60_000);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2); // the same oversize key still maps to one bucket
  });

  it("evicts the oldest bucket instead of growing past its cap", async () => {
    const store = getRateLimitStore();
    await store.addAndGetWindow("cap:first", 1_000, 3_600_000);
    for (let i = 0; i < 50_001; i += 1) await store.addAndGetWindow(`cap:filler:${i}`, 1_000, 3_600_000);
    // "cap:first" was the oldest key: its bucket is gone, so it starts over.
    expect(await store.addAndGetWindow("cap:first", 2_000, 3_600_000)).toHaveLength(1);
  });
});
