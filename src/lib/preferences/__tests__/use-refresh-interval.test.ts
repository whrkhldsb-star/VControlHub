/**
 * useRefreshInterval — reads the shared `vps-preferences` auto-refresh
 * interval and re-reads it on `storage` / `vps-preferences-updated` events.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRefreshInterval } from "../use-refresh-interval";

const STORAGE_KEY = "vps-preferences";

function setPref(intervalSeconds: number) {
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoRefreshInterval: intervalSeconds }));
}

afterEach(() => {
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("useRefreshInterval", () => {
	it("returns the fallback when no preference is stored", () => {
		const { result } = renderHook(() => useRefreshInterval(30));
		expect(result.current).toBe(30);
	});

	it("reads the stored interval on mount", () => {
		setPref(15);
		const { result } = renderHook(() => useRefreshInterval(30));
		expect(result.current).toBe(15);
	});

	it("re-reads on a storage event", () => {
		const { result } = renderHook(() => useRefreshInterval(30));
		expect(result.current).toBe(30);

		setPref(60);
		act(() => {
			window.dispatchEvent(new Event("storage"));
		});
		expect(result.current).toBe(60);
	});

	it("re-reads on the in-page vps-preferences-updated event", () => {
		const { result } = renderHook(() => useRefreshInterval(30));
		setPref(5);
		act(() => {
			window.dispatchEvent(new Event("vps-preferences-updated"));
		});
		expect(result.current).toBe(5);
	});

	it("removes its listeners on unmount", () => {
		const removeSpy = vi.spyOn(window, "removeEventListener");
		const { unmount } = renderHook(() => useRefreshInterval(30));
		unmount();
		expect(removeSpy).toHaveBeenCalledWith("storage", expect.any(Function));
		expect(removeSpy).toHaveBeenCalledWith("vps-preferences-updated", expect.any(Function));
	});
});
