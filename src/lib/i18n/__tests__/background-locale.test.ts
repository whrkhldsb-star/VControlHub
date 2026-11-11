import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { setting: { findUnique: mocks.findUnique } } }));

import { apiCopy, backgroundCopyLocale, setBackgroundCopyLocale } from "../api-copy";
import { startBackgroundCopyLocaleSync, syncBackgroundCopyLocale } from "../background-locale";
import { serviceTranslations, t } from "../service-translations";

const KEY = "backend.webdav.destinationExistsAndOverwriteIsF";

describe("a process without requests speaks the platform's default language", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setBackgroundCopyLocale(undefined);
	});
	afterEach(() => {
		vi.useRealTimers();
		setBackgroundCopyLocale(undefined);
	});

	it("takes it from the platform setting", async () => {
		mocks.findUnique.mockResolvedValue({ value: "en" });

		await syncBackgroundCopyLocale();

		expect(mocks.findUnique).toHaveBeenCalledWith({ where: { key: "platform.defaultLocale" }, select: { value: true } });
		expect(backgroundCopyLocale()).toBe("en");
		expect(t(KEY)).toBe(serviceTranslations.en[KEY]);
	});

	it("is Chinese while the setting was never saved, for both kinds of copy", async () => {
		mocks.findUnique.mockResolvedValue(null);
		await syncBackgroundCopyLocale();
		expect(backgroundCopyLocale()).toBe("zh");
		expect(t(KEY)).toBe(serviceTranslations.zh[KEY]);
		expect(apiCopy("apiCopy.files.op.revoked")).toBe(serviceTranslations.zh["apiCopy.files.op.revoked"]);
	});

	it("keeps the language it has when the setting cannot be read", async () => {
		mocks.findUnique.mockResolvedValueOnce({ value: "en" }).mockRejectedValueOnce(new Error("database unavailable"));
		await syncBackgroundCopyLocale();
		await expect(syncBackgroundCopyLocale()).resolves.toBeUndefined();
		expect(backgroundCopyLocale()).toBe("en");
	});

	it("follows a change of the setting without a restart, until stopped", async () => {
		vi.useFakeTimers();
		mocks.findUnique.mockResolvedValue({ value: "zh" });
		const stop = await startBackgroundCopyLocaleSync();
		expect(backgroundCopyLocale()).toBe("zh");

		mocks.findUnique.mockResolvedValue({ value: "en" });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(backgroundCopyLocale()).toBe("en");

		stop();
		mocks.findUnique.mockResolvedValue({ value: "zh" });
		await vi.advanceTimersByTimeAsync(120_000);
		expect(backgroundCopyLocale()).toBe("en");
	});
});
