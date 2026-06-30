"use client";

import { useEffect, useState } from "react";

import {
	DEFAULT_REFRESH_INTERVAL_SECONDS,
	getRefreshIntervalFromStorage,
} from "@/lib/preferences/refresh-interval";

/**
 * Reads the user's auto-refresh interval (seconds) from the shared
 * `vps-preferences` localStorage entry and keeps it in sync.
 *
 * This consolidates an init + dual-listener `useEffect` block that was
 * duplicated byte-for-byte across docker / monitoring / traffic /
 * server-monitor-card. The hook:
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
	const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(() =>
		typeof window === "undefined" ? fallback : getRefreshIntervalFromStorage(window.localStorage, fallback),
	);

	useEffect(() => {
		const onStorage = () =>
			setRefreshIntervalSeconds(getRefreshIntervalFromStorage(globalThis.localStorage, fallback));
		window.addEventListener("storage", onStorage);
		window.addEventListener("vps-preferences-updated", onStorage);
		return () => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener("vps-preferences-updated", onStorage);
		};
	}, [fallback]);

	return refreshIntervalSeconds;
}
