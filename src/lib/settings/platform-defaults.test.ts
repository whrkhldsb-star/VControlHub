import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, findMany } = vi.hoisted(() => {
  const rows: Array<{ key: string; value: string }> = [];
  return { rows, findMany: vi.fn(async () => rows) };
});
vi.mock("@/lib/db", () => ({ prisma: { setting: { findMany } } }));

import { getPlatformDefaults, invalidatePlatformDefaults } from "./platform-defaults";

describe("getPlatformDefaults", () => {
  beforeEach(() => {
    rows.length = 0;
    findMany.mockClear();
    invalidatePlatformDefaults();
  });

  it("falls back to zh/dark and ignores unknown values", async () => {
    rows.push({ key: "platform.defaultLocale", value: "fr" }, { key: "platform.defaultTheme", value: "" });
    expect(await getPlatformDefaults()).toEqual({ locale: "zh", theme: "dark" });
  });

  it("returns the persisted defaults and caches them until invalidated", async () => {
    rows.push({ key: "platform.defaultLocale", value: "en" }, { key: "platform.defaultTheme", value: "light" });
    expect(await getPlatformDefaults()).toEqual({ locale: "en", theme: "light" });
    await getPlatformDefaults();
    expect(findMany).toHaveBeenCalledTimes(1);
    invalidatePlatformDefaults();
    await getPlatformDefaults();
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("does not cache what a read started before a save found", async () => {
    // Saved en/light while a read still held zh/dark: it cached zh/dark for
    // another 15 s after the save had cleared the cache.
    let finish!: () => void;
    findMany.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve([{ key: "platform.defaultLocale", value: "zh" }, { key: "platform.defaultTheme", value: "dark" }]); }) as never);
    const late = getPlatformDefaults();
    rows.push({ key: "platform.defaultLocale", value: "en" }, { key: "platform.defaultTheme", value: "light" });
    invalidatePlatformDefaults();
    finish();
    await late;
    expect(await getPlatformDefaults()).toEqual({ locale: "en", theme: "light" });
  });

  it("survives a database failure", async () => {
    findMany.mockRejectedValueOnce(new Error("down"));
    expect(await getPlatformDefaults()).toEqual({ locale: "zh", theme: "dark" });
  });
});
