import { beforeEach, describe, expect, it, vi } from "vitest";

const { addAndGetWindowMock } = vi.hoisted(() => ({
  addAndGetWindowMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit-store", () => ({
  getRateLimitStore: () => ({
    addAndGetWindow: addAndGetWindowMock,
  }),
}));

const { checkRateLimitAsync, clearLoginFailure, isAccountLocked, recordLoginFailure } = await import("@/lib/rate-limit");

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

    expect(result).toEqual({ allowed: false, retryAfterMs: 500, remaining: 0 });
  });
});

describe("account login failure retention", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearLoginFailure("alice");
  });

  it("resets stale failures after the lockout retention window", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    expect(recordLoginFailure("Alice").failCount).toBe(1);
    expect(recordLoginFailure("alice").failCount).toBe(2);

    vi.spyOn(Date, "now").mockReturnValue(10_000 + 15 * 60 * 1_000);
    expect(recordLoginFailure("ALICE")).toMatchObject({ failCount: 1, locked: false });
  });

  it("clears failures immediately after a successful login", () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000);
    for (let i = 0; i < 5; i += 1) recordLoginFailure("alice");
    expect(isAccountLocked("alice").locked).toBe(true);

    clearLoginFailure("alice");
    expect(isAccountLocked("alice")).toEqual({ locked: false, lockedUntil: null });
  });
});
