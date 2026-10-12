import { beforeEach, describe, expect, it, vi } from "vitest";

const { addAndGetWindowMock, getLockoutMock, setLockoutMock, deleteLockoutMock } = vi.hoisted(() => ({
  addAndGetWindowMock: vi.fn(),
  getLockoutMock: vi.fn(),
  setLockoutMock: vi.fn(),
  deleteLockoutMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit-store", () => ({
  getRateLimitStore: () => ({
    addAndGetWindow: addAndGetWindowMock,
    getLockout: getLockoutMock,
    setLockout: setLockoutMock,
    deleteLockout: deleteLockoutMock,
  }),
}));

const {
  checkRateLimitAsync,
  clearLoginFailureAsync,
  isAccountLockedAsync,
  recordLoginFailureAsync,
} = await import("@/lib/rate-limit");

describe("checkRateLimitAsync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(10_000);
  });

  it("uses the configured rate-limit store instead of the legacy local Map", async () => {
    addAndGetWindowMock.mockResolvedValueOnce([9_500, 10_000]);

    const result = await checkRateLimitAsync("198.51.100.10", { maxRequests: 3, windowMs: 1_000 });

    expect(addAndGetWindowMock).toHaveBeenCalledWith("198.51.100.10", 10_000, 1_000);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0, remaining: 1 });
  });

  it("rejects when the shared store window exceeds the configured limit", async () => {
    addAndGetWindowMock.mockResolvedValueOnce([9_500, 9_750, 10_000]);

    const result = await checkRateLimitAsync("198.51.100.10", { maxRequests: 2, windowMs: 1_000 });

    expect(result).toEqual({ allowed: false, retryAfterMs: 750, remaining: 0 });
  });
});

describe("account lockout shared store", () => {
  const store = new Map<string, { failCount: number; lockedUntil: number | null; lastFailureAt: number }>();
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    vi.spyOn(Date, "now").mockReturnValue(50_000);
    getLockoutMock.mockImplementation(async (key: string) => store.get(key) ?? null);
    setLockoutMock.mockImplementation(async (key: string, entry: { failCount: number; lockedUntil: number | null; lastFailureAt: number }) => { store.set(key, entry); });
    deleteLockoutMock.mockImplementation(async (key: string) => { store.delete(key); });
  });

  it("locks the guessing client after five misses but leaves the owner's other addresses alone", async () => {
    for (let i = 0; i < 4; i += 1) {
      expect((await recordLoginFailureAsync("bob", "203.0.113.5")).locked).toBe(false);
    }
    const locked = await recordLoginFailureAsync("bob", "203.0.113.5");
    expect(locked).toMatchObject({ locked: true, scope: "client", failCount: 5, accountFailCount: 5 });
    expect(await isAccountLockedAsync("bob", "203.0.113.5")).toMatchObject({ locked: true, scope: "client" });
    // The account owner on another address is not locked out by a stranger.
    expect(await isAccountLockedAsync("bob", "198.51.100.7")).toMatchObject({ locked: false, scope: null });
    expect(await isAccountLockedAsync("BOB", "198.51.100.7")).toMatchObject({ locked: false });
  });

  it("locks the whole account once misses from many addresses reach the account-wide ceiling", async () => {
    let last: Awaited<ReturnType<typeof recordLoginFailureAsync>> | null = null;
    for (let i = 0; i < 25; i += 1) {
      last = await recordLoginFailureAsync("bob", `10.0.${Math.floor(i / 4)}.${i % 4}`);
    }
    expect(last).toMatchObject({ locked: true, scope: "account", accountFailCount: 25 });
    expect(await isAccountLockedAsync("bob", "198.51.100.7")).toMatchObject({ locked: true, scope: "account" });
  });

  it("keeps the legacy shared bucket when no client address is known", async () => {
    for (let i = 0; i < 5; i += 1) await recordLoginFailureAsync("bob");
    expect(await isAccountLockedAsync("bob")).toMatchObject({ locked: true, scope: "client" });
    expect(store.has("bob@unknown")).toBe(true);
  });

  it("expires a lock after its window", async () => {
    for (let i = 0; i < 5; i += 1) await recordLoginFailureAsync("bob", "203.0.113.5");
    vi.spyOn(Date, "now").mockReturnValue(50_000 + 15 * 60 * 1_000 + 1);
    expect(await isAccountLockedAsync("bob", "203.0.113.5")).toMatchObject({ locked: false });
    expect(store.has("bob@203.0.113.5")).toBe(false);
  });

  it("clears both the client and the account-wide counters on the shared store", async () => {
    await recordLoginFailureAsync("bob", "203.0.113.5");
    await clearLoginFailureAsync("bob", "203.0.113.5");
    expect(deleteLockoutMock).toHaveBeenCalledWith("bob");
    expect(deleteLockoutMock).toHaveBeenCalledWith("bob@203.0.113.5");
    expect(store.size).toBe(0);
  });
});
