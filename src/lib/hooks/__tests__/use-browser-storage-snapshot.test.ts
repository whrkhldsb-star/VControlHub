import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `useBrowserStorageSnapshot` and the `browser-storage` writer it pairs
 * with.
 *
 * The pair exists because the native `storage` event only fires in *other* tabs.
 * A component that writes a preference and then reads it through
 * `useSyncExternalStore` would never see its own change, so `writeLocalStorageValue`
 * dispatches a same-tab `vch:local-storage-sync` event and the hook subscribes to
 * both. Losing either half breaks a different case (own tab vs. other tab), so
 * both are covered here.
 *
 * The reader must also survive storage being unavailable — Safari private mode
 * throws on `localStorage` access — by falling back to the server snapshot rather
 * than crashing the component tree.
 */
import { LOCAL_STORAGE_SYNC_EVENT, notifyLocalStorageChange, writeLocalStorageValue } from "@/lib/browser-storage";
import { useBrowserStorageSnapshot } from "../use-browser-storage-snapshot";

const KEY = "vch:theme";
const readTheme = (storage: Storage) => storage.getItem(KEY) ?? "system";

describe("writeLocalStorageValue", () => {
	beforeEach(() => window.localStorage.clear());

	it("writes the value and reports success", () => {
		expect(writeLocalStorageValue(KEY, "dark")).toBe(true);
		expect(window.localStorage.getItem(KEY)).toBe("dark");
	});

	it("notifies same-tab listeners, which the native storage event does not", () => {
		const seen: string[] = [];
		const listener = (event: Event) => seen.push((event as CustomEvent<string>).detail);
		window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, listener);
		try {
			writeLocalStorageValue(KEY, "dark");
			expect(seen).toEqual([KEY]);
		} finally {
			window.removeEventListener(LOCAL_STORAGE_SYNC_EVENT, listener);
		}
	});

	it("returns false instead of throwing when storage is unavailable", () => {
		// Private/restricted browsing contexts throw on setItem; a preference write
		// must degrade, not take down the component.
		// jsdom's localStorage delegates to Storage.prototype, so the spy has to go
		// there rather than on the instance.
		const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("QuotaExceededError");
		});
		try {
			expect(writeLocalStorageValue(KEY, "dark")).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it("exposes a standalone notifier for callers that write by other means", () => {
		const seen: string[] = [];
		const listener = (event: Event) => seen.push((event as CustomEvent<string>).detail);
		window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, listener);
		try {
			notifyLocalStorageChange("other-key");
			expect(seen).toEqual(["other-key"]);
		} finally {
			window.removeEventListener(LOCAL_STORAGE_SYNC_EVENT, listener);
		}
	});
});

describe("useBrowserStorageSnapshot", () => {
	beforeEach(() => window.localStorage.clear());

	it("returns the current stored value", () => {
		window.localStorage.setItem(KEY, "dark");
		const { result } = renderHook(() => useBrowserStorageSnapshot(KEY, readTheme, "system"));
		expect(result.current).toBe("dark");
	});

	it("returns the reader's own fallback when the key is unset", () => {
		const { result } = renderHook(() => useBrowserStorageSnapshot(KEY, readTheme, "system"));
		expect(result.current).toBe("system");
	});

	it("re-reads after a same-tab write", () => {
		// The case the native storage event misses entirely.
		const { result } = renderHook(() => useBrowserStorageSnapshot(KEY, readTheme, "system"));
		act(() => {
			writeLocalStorageValue(KEY, "dark");
		});
		expect(result.current).toBe("dark");
	});

	it("re-reads after another tab's storage event", () => {
		const { result } = renderHook(() => useBrowserStorageSnapshot(KEY, readTheme, "system"));
		act(() => {
			window.localStorage.setItem(KEY, "light");
			window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
		});
		expect(result.current).toBe("light");
	});

	it("re-reads on a storage event with a null key (a whole-store clear)", () => {
		window.localStorage.setItem(KEY, "dark");
		const { result } = renderHook(() => useBrowserStorageSnapshot(KEY, readTheme, "system"));
		act(() => {
			window.localStorage.clear();
			window.dispatchEvent(new StorageEvent("storage", { key: null }));
		});
		expect(result.current).toBe("system");
	});

	it("ignores a same-tab notification for a different key", () => {
		const read = vi.fn(readTheme);
		const { result } = renderHook(() => useBrowserStorageSnapshot(KEY, read, "system"));
		const before = read.mock.calls.length;
		act(() => {
			notifyLocalStorageChange("vch:other");
		});
		expect(read.mock.calls.length).toBe(before);
		expect(result.current).toBe("system");
	});

	it("also subscribes to an extra event name when one is given", () => {
		const { result } = renderHook(() =>
			useBrowserStorageSnapshot(KEY, readTheme, "system", "vch:custom"),
		);
		act(() => {
			window.localStorage.setItem(KEY, "dark");
			window.dispatchEvent(new Event("vch:custom"));
		});
		expect(result.current).toBe("dark");
	});

	it("falls back to the server snapshot when reading throws", () => {
		const { result } = renderHook(() =>
			useBrowserStorageSnapshot(
				KEY,
				() => {
					throw new Error("storage blocked");
				},
				"system",
			),
		);
		expect(result.current).toBe("system");
	});

	it("removes its listeners on unmount", () => {
		const read = vi.fn(readTheme);
		const { unmount } = renderHook(() => useBrowserStorageSnapshot(KEY, read, "system"));
		unmount();
		const before = read.mock.calls.length;
		writeLocalStorageValue(KEY, "dark");
		window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
		expect(read.mock.calls.length).toBe(before);
	});
});
