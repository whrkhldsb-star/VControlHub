import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitStore } from "../rate-limit-store";

vi.mock("@/lib/runtime-settings/service", () => ({
  getRuntimeSettingNumbers: () => { throw new Error("Settings unavailable"); },
}));

let store: RateLimitStore;
let rate: typeof import("../rate-limit");

beforeEach(async () => {
  vi.stubEnv("REDIS_URL", "");
  vi.resetModules();
  store = (await import("../rate-limit-store")).getRateLimitStore();
  rate = await import("../rate-limit");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("checkRateLimitAsync", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
  });

  it("uses the configured rate-limit store instead of the legacy local Map", async () => {
    const add = vi.spyOn(store, "addAndGetWindow").mockResolvedValueOnce([9_500, 10_000]);

    const result = await rate.checkRateLimitAsync("198.51.100.10", { maxRequests: 3, windowMs: 1_000 });

    // maxRequests + 1 timestamps are all a verdict needs; the store keeps no more than that.
    expect(add).toHaveBeenCalledWith("198.51.100.10", 10_000, 1_000, 4);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0, remaining: 1 });
  });

  it("rejects when the shared store window exceeds the configured limit", async () => {
    vi.spyOn(store, "addAndGetWindow").mockResolvedValueOnce([9_500, 9_750, 10_000]);

    const result = await rate.checkRateLimitAsync("198.51.100.10", { maxRequests: 2, windowMs: 1_000 });

    expect(result).toEqual({ allowed: false, retryAfterMs: 750, remaining: 0 });
  });
});

describe("account lockout shared store", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(50_000);
  });

  it("locks the guessing client after five misses but leaves the owner's other addresses alone", async () => {
    for (let i = 0; i < 4; i += 1) {
      expect((await rate.recordLoginFailureAsync("bob", "203.0.113.5")).locked).toBe(false);
    }
    const locked = await rate.recordLoginFailureAsync("bob", "203.0.113.5");
    expect(locked).toMatchObject({ locked: true, scope: "client", failCount: 5, accountFailCount: 5 });
    expect(await rate.isAccountLockedAsync("bob", "203.0.113.5")).toMatchObject({ locked: true, scope: "client" });
    // The account owner on another address is not locked out by a stranger.
    expect(await rate.isAccountLockedAsync("bob", "198.51.100.7")).toMatchObject({ locked: false, scope: null });
    expect(await rate.isAccountLockedAsync("BOB", "198.51.100.7")).toMatchObject({ locked: false });
  });

  it("matches login's trimmed, case-sensitive account identity", async () => {
    for (const name of ["bob", " bob", "bob ", "  bob  ", "bob\t"]) await rate.recordLoginFailureAsync(name, "203.0.113.5");
    expect(await rate.isAccountLockedAsync(" bob ", "203.0.113.5")).toMatchObject({ locked: true });
    for (const distinct of ["BOB", "ｂob"]) {
      expect(await rate.isAccountLockedAsync(distinct, "203.0.113.5")).toMatchObject({ locked: false });
    }
  });

  it("never keys a counter on attacker-sized text", async () => {
    const record = vi.spyOn(store, "recordFailures");
    await rate.recordLoginFailureAsync("x".repeat(2_000_000), "203.0.113.5");
    expect(record).toHaveBeenCalledOnce();
    for (const { key } of record.mock.calls[0]![0]) expect(key.length).toBeLessThan(100);
  });

  it("locks the whole account once misses from many addresses reach the account-wide ceiling", async () => {
    let last: Awaited<ReturnType<typeof rate.recordLoginFailureAsync>> | null = null;
    for (let i = 0; i < 25; i += 1) {
      last = await rate.recordLoginFailureAsync("bob", `10.0.${Math.floor(i / 4)}.${i % 4}`);
    }
    expect(last).toMatchObject({ locked: true, scope: "account", accountFailCount: 25 });
    expect(await rate.isAccountLockedAsync("bob", "198.51.100.7")).toMatchObject({ locked: true, scope: "account" });
  });

  it("keeps the legacy shared bucket when no client address is known", async () => {
    for (let i = 0; i < 5; i += 1) await rate.recordLoginFailureAsync("bob");
    expect(await rate.isAccountLockedAsync("bob")).toMatchObject({ locked: true, scope: "client" });
    expect(await store.getLockout("bob@unknown")).toMatchObject({ failCount: 5 });
  });

  it("expires a lock after its window", async () => {
    for (let i = 0; i < 5; i += 1) await rate.recordLoginFailureAsync("bob", "203.0.113.5");
    vi.spyOn(Date, "now").mockReturnValue(50_000 + 15 * 60 * 1_000 + 1);
    expect(await rate.isAccountLockedAsync("bob", "203.0.113.5")).toMatchObject({ locked: false });
    expect(await store.getLockout("bob@203.0.113.5")).toBeNull();
  });

  it("collapses routed IPv6 addresses to /64 prefixes so one host cannot rotate buckets", async () => {
    expect(rate.rateLimitIpKey("2001:db8:abcd:1234::1")).toBe("2001:db8:abcd:1234::/64");
    expect(rate.rateLimitIpKey("2001:db8:abcd:1234:feed:beef:1:2")).toBe("2001:db8:abcd:1234::/64");
    expect(rate.rateLimitIpKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(rate.rateLimitIpKey("::1")).toBe("::1");
    for (let i = 1; i <= 5; i += 1) {
      await rate.recordLoginFailureAsync("bob", `2001:db8:abcd:1234::${i}`);
    }
    expect(await rate.isAccountLockedAsync("bob", "2001:db8:abcd:1234::9999")).toMatchObject({ locked: true, scope: "client" });
  });

  it("bounds concurrent login attempts atomically against the account-wide cap", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 40 }, (_, i) => rate.reserveLoginAttemptAsync("alice", `198.51.100.${i + 1}`)),
    );
    const reserved = attempts.filter((entry) => entry.reserved);
    const rejected = attempts.filter((entry) => !entry.reserved);
    expect(reserved).toHaveLength(25);
    expect(rejected).toHaveLength(15);
    for (const entry of reserved) {
      if (entry.reserved) await rate.settleLoginAttemptAsync(entry.reservation, false);
    }
    // Releasing on success frees the budget again.
    const next = await rate.reserveLoginAttemptAsync("alice", "198.51.100.200");
    expect(next.reserved).toBe(true);
    if (next.reserved) await rate.settleLoginAttemptAsync(next.reservation, false);
  });

  it("does not double-increment failCount when settling failed reservations alongside recordLoginFailureAsync", async () => {
    for (let i = 1; i <= 5; i += 1) {
      const attempt = await rate.reserveLoginAttemptAsync("carol", "203.0.113.42");
      expect(attempt.reserved).toBe(true);
      if (attempt.reserved) await rate.settleLoginAttemptAsync(attempt.reservation, true);
      const recorded = await rate.recordLoginFailureAsync("carol", "203.0.113.42");
      expect(recorded.failCount).toBe(i);
      expect(recorded.locked).toBe(i === 5);
    }
    await rate.clearLoginFailureAsync("carol", "203.0.113.42");
    const fresh = await rate.reserveLoginAttemptAsync("carol", "203.0.113.42");
    expect(fresh.reserved).toBe(true);
    if (fresh.reserved) await rate.settleLoginAttemptAsync(fresh.reservation, false);
  });

  it("keeps concurrent counts in memory and starts fresh after the failure retention period", async () => {
    const attempts = await Promise.all(Array.from({ length: 4 }, () => rate.recordLoginFailureAsync("bob")));
    expect(attempts.map(result => result.failCount).sort()).toEqual([1, 2, 3, 4]);
    vi.spyOn(Date, "now").mockReturnValue(50_000 + 15 * 60_000);
    expect(await rate.recordLoginFailureAsync("bob")).toMatchObject({ locked: false, failCount: 1, accountFailCount: 1 });
  });

  it("clears both the client and the account-wide counters on the shared store", async () => {
    await rate.recordLoginFailureAsync("bob", "203.0.113.5");
    await rate.clearLoginFailureAsync("bob", "203.0.113.5");
    expect(await store.getLockout("bob")).toBeNull();
    expect(await store.getLockout("bob@203.0.113.5")).toBeNull();
  });
});
