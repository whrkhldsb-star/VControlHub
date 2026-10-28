import { describe, expect, it } from "vitest";
import { PreAuthLimiter, upgradeClientAddress } from "../pre-auth-limiter";

describe("PreAuthLimiter", () => {
  it("holds a total and a per-address cap, and frees a place once", () => {
    const limiter = new PreAuthLimiter(3, 2);
    const first = limiter.acquire("203.0.113.1");
    const second = limiter.acquire("203.0.113.1");
    // The address has used its two places; another address may still come in.
    expect(limiter.acquire("203.0.113.1")).toBeNull();
    const third = limiter.acquire("203.0.113.2");
    expect(third).not.toBeNull();
    // The total is full for everyone.
    expect(limiter.acquire("203.0.113.3")).toBeNull();
    expect(limiter.size).toBe(3);

    first!();
    first!(); // releasing twice frees only one place
    expect(limiter.size).toBe(2);
    expect(limiter.acquire("203.0.113.1")).not.toBeNull();
    second!();
    third!();
  });

  it("applies only the total when the address is unknown (no trusted forwarding header)", () => {
    const limiter = new PreAuthLimiter(10, 1);
    const places = Array.from({ length: 10 }, () => limiter.acquire("unknown"));
    expect(places.every(Boolean)).toBe(true);
    expect(limiter.acquire("unknown")).toBeNull();
  });
});

describe("upgradeClientAddress", () => {
  it("reads the address the way HTTP rate limits do: the entry the nearest trusted proxy added", () => {
    // With the default of one trusted hop, the rightmost entry is the one the proxy appended; what the client
    // sent in front of it is not believed.
    expect(upgradeClientAddress({ headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.7" } })).toBe("203.0.113.7");
    expect(upgradeClientAddress({ headers: {} })).toBe("unknown");
  });
});
