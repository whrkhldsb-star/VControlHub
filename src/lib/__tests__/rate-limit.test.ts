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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(50_000);
    getLockoutMock.mockResolvedValue(null);
    setLockoutMock.mockResolvedValue(undefined);
    deleteLockoutMock.mockResolvedValue(undefined);
  });

  it("records failures via the shared store and locks after max failures", async () => {
    getLockoutMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ failCount: 1, lockedUntil: null, lastFailureAt: 50_000 })
      .mockResolvedValueOnce({ failCount: 2, lockedUntil: null, lastFailureAt: 50_000 })
      .mockResolvedValueOnce({ failCount: 3, lockedUntil: null, lastFailureAt: 50_000 })
      .mockResolvedValueOnce({ failCount: 4, lockedUntil: null, lastFailureAt: 50_000 });

    for (let i = 0; i < 4; i += 1) {
      const r = await recordLoginFailureAsync("bob");
      expect(r.locked).toBe(false);
    }
    const locked = await recordLoginFailureAsync("bob");
    expect(locked.locked).toBe(true);
    expect(setLockoutMock).toHaveBeenCalled();
    getLockoutMock.mockResolvedValueOnce({
      failCount: 5,
      lockedUntil: 50_000 + 15 * 60 * 1_000,
      lastFailureAt: 50_000,
    });
    expect(await isAccountLockedAsync("bob")).toMatchObject({ locked: true });
  });

  it("clears lockout on the shared store", async () => {
    await clearLoginFailureAsync("bob");
    expect(deleteLockoutMock).toHaveBeenCalledWith("bob");
  });
});
