import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { settingRow } = vi.hoisted(() => ({ settingRow: { value: null as string | null, fail: false } }));
vi.mock("@/lib/db", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(async () => {
        if (settingRow.fail) throw new Error("connection refused");
        return settingRow.value === null ? null : { value: settingRow.value };
      }),
    },
  },
}));

import { getRuntimeSettingNumberCached, primeRuntimeSettingCache, rememberRuntimeSettingNumber, resetRuntimeSettingCache } from "./cached";

describe("getRuntimeSettingNumberCached", () => {
  beforeEach(() => {
    resetRuntimeSettingCache();
    settingRow.value = null;
    settingRow.fail = false;
    delete process.env.JOB_DEFAULT_MAX_ATTEMPTS;
  });
  afterEach(() => {
    delete process.env.JOB_DEFAULT_MAX_ATTEMPTS;
  });

  it("answers from env/default until the persisted value lands, then from the database", async () => {
    settingRow.value = "7";
    process.env.JOB_DEFAULT_MAX_ATTEMPTS = "4";
    expect(getRuntimeSettingNumberCached("jobs.defaultMaxAttempts")).toBe(4);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getRuntimeSettingNumberCached("jobs.defaultMaxAttempts")).toBe(7);
  });

  it("keeps following env when no row exists", async () => {
    process.env.JOB_DEFAULT_MAX_ATTEMPTS = "4";
    getRuntimeSettingNumberCached("jobs.defaultMaxAttempts");
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.env.JOB_DEFAULT_MAX_ATTEMPTS = "5";
    expect(getRuntimeSettingNumberCached("jobs.defaultMaxAttempts")).toBe(5);
  });

  it("takes a value remembered after a save immediately", () => {
    rememberRuntimeSettingNumber("jobs.defaultMaxAttempts", 9);
    expect(getRuntimeSettingNumberCached("jobs.defaultMaxAttempts")).toBe(9);
  });

  it("answers from the database from the first call once primed at process start", async () => {
    settingRow.value = "7";
    process.env.JOB_DEFAULT_MAX_ATTEMPTS = "4";
    await primeRuntimeSettingCache();
    expect(getRuntimeSettingNumberCached("jobs.defaultMaxAttempts")).toBe(7);
  });

  it("keeps the last known database value when a refresh fails", async () => {
    vi.useFakeTimers();
    try {
      settingRow.value = "7";
      process.env.JOB_DEFAULT_MAX_ATTEMPTS = "4";
      await primeRuntimeSettingCache();
      settingRow.fail = true;
      vi.advanceTimersByTime(61_000);
      expect(getRuntimeSettingNumberCached("jobs.defaultMaxAttempts")).toBe(7);
      await vi.runAllTimersAsync();
      expect(getRuntimeSettingNumberCached("jobs.defaultMaxAttempts")).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });
});
