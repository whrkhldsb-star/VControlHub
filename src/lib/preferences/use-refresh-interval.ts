"use client";

import { useCallback } from "react";

import {
	DEFAULT_REFRESH_INTERVAL_SECONDS,
	getRefreshIntervalFromStorage,
	REFRESH_PREFERENCES_STORAGE_KEY,
} from "@/lib/preferences/refresh-interval";
import { useBrowserStorageSnapshot } from "@/lib/hooks/use-browser-storage-snapshot";

/**
 * Reads the user's auto-refresh interval (seconds) from the shared
 * `vps-preferences` localStorage entry and keeps it in sync.
 *
 * This consolidates an init + dual-listener `useEffect` block that was
 * duplicated byte-for-byte across docker / monitoring / traffic /
 * monitoring surfaces. The hook:
 *   - SSR-safe initial read (returns `fallback` when `window` is undefined)
 *   - listens for cross-tab `storage` events
 *   - listens for the in-page `vps-preferences-updated` custom event
 *     (dispatched by the preferences page when the user changes the
 *     interval without a full reload)
 *   - cleans up both listeners on unmount
 *
 * @param fallback default interval in seconds (defaults to 30)
 * @returns the current refresh interval in seconds; 0 means "manual only"
 */
export function useRefreshInterval(fallback: number = DEFAULT_REFRESH_INTERVAL_SECONDS): number {
	const read = useCallback(
		(storage: Storage) => getRefreshIntervalFromStorage(storage, fallback),
		[fallback],
	);
	return useBrowserStorageSnapshot(
		REFRESH_PREFERENCES_STORAGE_KEY,
		read,
		fallback,
		"vps-preferences-updated",
	);
}
