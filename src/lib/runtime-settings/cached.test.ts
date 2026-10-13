import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { settingRow } = vi.hoisted(() => ({ settingRow: { value: null as string | null } }));
vi.mock("@/lib/db", () => ({
  prisma: { setting: { findUnique: vi.fn(async () => (settingRow.value === null ? null : { value: settingRow.value })) } },
}));

import { getRuntimeSettingNumberCached, rememberRuntimeSettingNumber, resetRuntimeSettingCache } from "./cached";

describe("getRuntimeSettingNumberCached", () => {
  beforeEach(() => {
    resetRuntimeSettingCache();
    settingRow.value = null;
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
});
