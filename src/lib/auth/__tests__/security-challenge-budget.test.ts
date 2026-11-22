import { expect, it, vi } from "vitest";
import { getRateLimitStore } from "@/lib/rate-limit-store";
import { checkSecurityChallenge } from "../security-challenge-budget";

it("charges only failed proofs to one account across prompts and client addresses", async () => {
  const verify = vi.fn(async () => true);
  for (let i = 0; i < 6; i++) await checkSecurityChallenge("same-account", verify, Boolean);
  verify.mockResolvedValue(false);
  for (let i = 0; i < 4; i++) await checkSecurityChallenge("same-account", verify, Boolean);
  await expect(checkSecurityChallenge("same-account", verify, Boolean)).rejects.toMatchObject({ status: 429 });
  verify.mockClear().mockResolvedValue(true);
  await expect(checkSecurityChallenge("same-account", verify, Boolean)).rejects.toMatchObject({ status: 429 });
  expect(verify).not.toHaveBeenCalled();
  await expect(checkSecurityChallenge("another-account", verify, Boolean)).resolves.toBe(true);
});

it("accumulates overlapping failures, expires the block, and leaves infrastructure errors out of the budget", async () => {
  vi.useFakeTimers();
  try {
    const key = "concurrent-settings";
    const verify = vi.fn(async () => false);
    const fault = new Error("verification unavailable");
    for (let i = 0; i < 6; i++) {
      await expect(checkSecurityChallenge(key, async () => { throw fault; }, Boolean)).rejects.toBe(fault);
    }
    await Promise.allSettled(Array.from({ length: 5 }, () => checkSecurityChallenge(key, verify, Boolean)));
    verify.mockClear().mockResolvedValue(true);
    await expect(checkSecurityChallenge(key, verify, Boolean)).rejects.toMatchObject({ status: 429 });
    expect(verify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15 * 60_000);
    await expect(checkSecurityChallenge(key, verify, Boolean)).resolves.toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("returns a committed change if releasing its expiring reservation fails", async () => {
  const release = vi.spyOn(getRateLimitStore(), "settleChallenge").mockRejectedValueOnce(new Error("store unavailable"));
  try {
    await expect(checkSecurityChallenge("committed-change", async () => "saved", Boolean)).resolves.toBe("saved");
  } finally {
    release.mockRestore();
  }
});
