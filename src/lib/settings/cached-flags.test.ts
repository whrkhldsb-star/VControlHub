import { beforeEach, describe, expect, it, vi } from "vitest";

const { row } = vi.hoisted(() => ({ row: { value: null as string | null, fail: false } }));
vi.mock("@/lib/db", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(async () => {
        if (row.fail) throw new Error("connection refused");
        return row.value === null ? null : { value: row.value };
      }),
    },
  },
}));
vi.mock("@/lib/config/env", () => ({ config: { ssh: { enforceHostKeyPin: false } } }));

import { getSshEnforceHostKeyPin, invalidateCachedFlags, primeCachedFlags } from "./cached-flags";

describe("SSH host-key pin flag", () => {
  beforeEach(() => {
    invalidateCachedFlags();
    row.value = null;
    row.fail = false;
  });

  it("is strict until the stored policy has been read, then follows it (no row: env default)", async () => {
    // Cold: the background read has not landed yet.
    expect(getSshEnforceHostKeyPin()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSshEnforceHostKeyPin()).toBe(false);
  });

  it("stays strict while the first read keeps failing", async () => {
    row.fail = true;
    await expect(primeCachedFlags()).rejects.toThrow();
    expect(getSshEnforceHostKeyPin()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSshEnforceHostKeyPin()).toBe(true);
  });

  it("uses the stored policy from the first connection once primed", async () => {
    row.value = "true";
    await primeCachedFlags();
    expect(getSshEnforceHostKeyPin()).toBe(true);
  });

  it("an empty stored value means the environment default", async () => {
    row.value = "";
    await primeCachedFlags();
    expect(getSshEnforceHostKeyPin()).toBe(false);
  });

  it("a database error keeps the stored policy instead of reverting to the env default", async () => {
    vi.useFakeTimers();
    try {
      row.value = "true";
      await primeCachedFlags();
      row.fail = true;
      vi.advanceTimersByTime(61_000);
      expect(getSshEnforceHostKeyPin()).toBe(true);
      await vi.runAllTimersAsync();
      expect(getSshEnforceHostKeyPin()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
