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

  it("counts every spelling of one account name (padding, case, look-alike forms) in a single bucket", async () => {
    const spellings = ["bob", " bob", "BOB ", "bob  ", "\u{FF42}ob"]; // last: full-width "b"
    let last: Awaited<ReturnType<typeof rate.recordLoginFailureAsync>> | null = null;
    for (const name of spellings) last = await rate.recordLoginFailureAsync(name, "203.0.113.5");
    expect(last).toMatchObject({ locked: true, scope: "client", failCount: 5 });
    expect(await rate.isAccountLockedAsync("bob", "203.0.113.5")).toMatchObject({ locked: true });
    expect(await rate.isAccountLockedAsync("  Bob\t", "203.0.113.5")).toMatchObject({ locked: true });
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
