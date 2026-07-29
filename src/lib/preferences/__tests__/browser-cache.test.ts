import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	mergeUserPreferencesCache,
	readUserPreferencesCache,
	USER_PREFERENCES_CHANGED_EVENT,
	USER_PREFERENCES_STORAGE_KEY,
	writeUserPreferencesCache,
} from "../browser-cache";

describe("user preference browser cache", () => {
	beforeEach(() => {
		window.localStorage.clear();
		vi.restoreAllMocks();
	});

	it("returns null for absent or malformed cache data", () => {
		expect(readUserPreferencesCache()).toBeNull();
		window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, "{");
		expect(readUserPreferencesCache()).toBeNull();
	});

	it("normalizes cache writes and can suppress same-page notifications", () => {
		const dispatchSpy = vi.spyOn(window, "dispatchEvent");
		const saved = writeUserPreferencesCache(
			{ defaultPage: "/files", autoRefreshInterval: 2 },
			{ notify: false },
		);

		expect(saved.defaultPage).toBe("/files");
		expect(saved.autoRefreshInterval).toBe(5);
		expect(readUserPreferencesCache()).toEqual(saved);
		expect(dispatchSpy).not.toHaveBeenCalled();
	});

	it("merges partial updates without dropping sibling preferences", () => {
		writeUserPreferencesCache(
			{ defaultPage: "/servers", notificationsEnabled: false },
			{ notify: false },
		);
		const dispatchSpy = vi.spyOn(window, "dispatchEvent");

		const saved = mergeUserPreferencesCache({ dashboardWidgets: ["quick-links"] });

		expect(saved.defaultPage).toBe("/servers");
		expect(saved.notificationsEnabled).toBe(false);
		expect(saved.dashboardWidgets).toEqual(["quick-links"]);
		expect(dispatchSpy).toHaveBeenCalledWith(
			expect.objectContaining({ type: USER_PREFERENCES_CHANGED_EVENT }),
		);
	});
});
