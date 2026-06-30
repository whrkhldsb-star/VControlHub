"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ResourcePollingState<T> = {
	/** Latest successfully-fetched data, or null before the first success. */
	data: T | null;
	/** True only during the very first load (no data yet). */
	loading: boolean;
	/** True while a refresh is in flight after data already exists. */
	refreshing: boolean;
	/** Error message from the most recent failed fetch, or null. */
	error: string | null;
	/** Imperatively trigger a fetch now (e.g. a manual "refresh" button). */
	refresh: () => Promise<void>;
	/** Replace the data locally without a fetch (optimistic updates). */
	setData: (next: T | null) => void;
};

export type UseResourcePollingOptions<T> = {
	/** Async function that fetches and returns the resource. Throw to signal an error. */
	fetcher: () => Promise<T>;
	/**
	 * Polling interval in seconds. 0 (or negative) disables the interval —
	 * the resource is fetched once and only refreshed manually.
	 */
	intervalSeconds: number;
	/** When false, polling is paused (the initial fetch still runs). Defaults to true. */
	enabled?: boolean;
	/**
	 * When true (default), polling pauses while the tab is hidden
	 * (`document.visibilityState === "hidden"`) and fires an immediate
	 * catch-up fetch when the tab becomes visible again. Saves request
	 * volume for background tabs.
	 */
	pauseWhenHidden?: boolean;
	/** Map a thrown value to a user-facing message. Defaults to Error.message / String(). */
	getErrorMessage?: (error: unknown) => string;
};

function defaultErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return "请求失败";
}

/**
 * Unifies the loading / error / data + visibility-aware polling boilerplate
 * that was hand-written across docker / traffic / monitoring / downloads /
 * users / audit / quick-services / preferences.
 *
 * Behavior:
 *   - Runs the fetcher once on mount (and whenever `fetcher` identity changes).
 *   - While `enabled` and `intervalSeconds > 0`, polls on that interval.
 *   - When `pauseWhenHidden`, stops the interval for hidden tabs and does an
 *     immediate catch-up fetch on re-show.
 *   - De-dupes overlapping fetches: a new tick is skipped if one is in flight.
 *   - Distinguishes first-load `loading` from subsequent `refreshing`.
 *   - Ignores in-flight responses after unmount (no setState-after-unmount).
 *
 * Keep the `fetcher` stable with `useCallback` — its identity drives the
 * effect that (re)starts polling.
 */
export function useResourcePolling<T>(options: UseResourcePollingOptions<T>): ResourcePollingState<T> {
	const {
		fetcher,
		intervalSeconds,
		enabled = true,
		pauseWhenHidden = true,
		getErrorMessage = defaultErrorMessage,
	} = options;

	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const mountedRef = useRef(true);
	const inFlightRef = useRef(false);
	const hasDataRef = useRef(false);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const refresh = useCallback(async () => {
		if (inFlightRef.current) return; // de-dupe overlapping fetches
		inFlightRef.current = true;
		if (hasDataRef.current) setRefreshing(true);
		try {
			const next = await fetcher();
			if (!mountedRef.current) return;
			setData(next);
			hasDataRef.current = true;
			setError(null);
		} catch (err) {
			if (!mountedRef.current) return;
			setError(getErrorMessage(err));
		} finally {
			if (mountedRef.current) {
				setLoading(false);
				setRefreshing(false);
			}
			inFlightRef.current = false;
		}
	}, [fetcher, getErrorMessage]);

	// Initial fetch + re-fetch when the fetcher identity changes.
	// refresh() sets state asynchronously (after the await), so the
	// set-state-in-effect rule is a false positive here.
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void refresh();
	}, [refresh]);

	// Polling interval with optional visibility pause.
	useEffect(() => {
		if (!enabled || intervalSeconds <= 0) return;

		let timer: ReturnType<typeof setInterval> | null = null;

		const start = () => {
			if (timer !== null) return;
			timer = setInterval(() => {
				void refresh();
			}, intervalSeconds * 1000);
		};
		const stop = () => {
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
		};

		if (pauseWhenHidden && typeof document !== "undefined") {
			const onVisibility = () => {
				if (document.visibilityState === "hidden") {
					stop();
				} else {
					void refresh(); // catch-up on re-show
					start();
				}
			};
			document.addEventListener("visibilitychange", onVisibility);
			if (document.visibilityState !== "hidden") start();
			return () => {
				document.removeEventListener("visibilitychange", onVisibility);
				stop();
			};
		}

		start();
		return stop;
	}, [enabled, intervalSeconds, pauseWhenHidden, refresh]);

	const setDataPublic = useCallback((next: T | null) => {
		setData(next);
		hasDataRef.current = next !== null;
	}, []);

	return { data, loading, refreshing, error, refresh, setData: setDataPublic };
}
