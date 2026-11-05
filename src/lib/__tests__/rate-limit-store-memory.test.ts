import { describe, expect, it } from "vitest";

import { getRateLimitStore, rateLimitNamespace } from "@/lib/rate-limit-store";

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

  it("files path buckets and coded identifiers under separate namespaces", () => {
    expect(rateLimitNamespace("/api/share/x1:203.0.113.9")).toBe("path");
    expect(rateLimitNamespace("login:fast:203.0.113.9")).toBe("login");
    expect(rateLimitNamespace("share-password:tok:203.0.113.9")).toBe("share-password");
    expect(rateLimitNamespace("noprefix")).toBe("other");
  });

  it("does not let a flood of made-up paths evict a live login counter", async () => {
    const store = getRateLimitStore();
    const now = 10_000_000;
    const window = 15 * 60_000;
    for (let i = 0; i < 3; i += 1) await store.addAndGetWindow("login:slow:203.0.113.9", now + i, window);
    for (let i = 0; i < 50_001; i += 1) await store.addAndGetWindow(`/api/share/x${i}:203.0.113.9`, now + 10, 60_000);
    expect(await store.addAndGetWindow("login:slow:203.0.113.9", now + 20, window)).toHaveLength(4);
  });

  it("drops expired buckets before evicting a live one when a namespace is full", async () => {
    const store = getRateLimitStore();
    const start = 50_000_000;
    await store.addAndGetWindow("sweep:live", start, 3_600_000);
    for (let i = 0; i < 49_999; i += 1) await store.addAndGetWindow(`sweep:stale:${i}`, start, 1_000);
    // Full now; the stale buckets expired a minute later, so the next key reclaims their room instead of "sweep:live".
    await store.addAndGetWindow("sweep:incoming", start + 60_000, 1_000);
    expect(await store.addAndGetWindow("sweep:live", start + 60_001, 3_600_000)).toHaveLength(2);
  });
});
