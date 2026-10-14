"use client";

/**
 * Polling for the public status board.
 *
 * - One request at a time: a tick while a request is in flight is skipped.
 * - Each request is aborted after `timeoutMs`.
 * - Failures back off exponentially (interval × 2^n, capped at
 *   MAX_BACKOFF_MS) and the last good data stays on screen.
 * - Paused while the page is hidden; on becoming visible again it fetches at
 *   once if the data is older than one interval. Unmount aborts.
 * - `refresh()` fetches now and resets the backoff (the "retry" button);
 *   a new `key` (e.g. another query) also fetches now.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_BACKOFF_MS = 5 * 60_000;
export const DEFAULT_TIMEOUT_MS = 10_000;

export type PollingSnapshot<T> = {
	data: T;
	/** Error of the latest attempt, cleared by the next success. */
	error: string | null;
	/** Consecutive failures. */
	failures: number;
	loading: boolean;
	/** Time of the latest successful response (page refresh time). */
	refreshedAt: number;
	/** When the next automatic attempt is due (null while paused or loading). */
	nextAttemptAt: number | null;
};

export type PollingState<T> = PollingSnapshot<T> & { refresh: () => void };

export function backoffDelay(intervalMs: number, failures: number): number {
	if (failures <= 0) return intervalMs;
	return Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** Math.min(failures, 10));
}

type Engine = {
	run: () => void;
	schedule: () => void;
	stop: () => void;
	/** Forget failures and abandon the in-flight request. */
	reset: () => void;
	lastSuccess: number;
};

export function usePublicPolling<T>(options: {
	initial: T;
	key: string;
	intervalMs: number;
	fetcher: (signal: AbortSignal) => Promise<T>;
	timeoutMs?: number;
	/** The first key's data is already server-rendered: wait one interval. */
	initialFresh?: boolean;
}): PollingState<T> {
	const { initial, key, intervalMs, fetcher, timeoutMs = DEFAULT_TIMEOUT_MS, initialFresh = false } = options;
	const [snapshot, setSnapshot] = useState<PollingSnapshot<T>>(() => ({
		data: initial,
		error: null,
		failures: 0,
		loading: false,
		refreshedAt: Date.now(),
		nextAttemptAt: null,
	}));
	const fetcherRef = useRef(fetcher);
	const engineRef = useRef<Engine | null>(null);
	const firstKey = useRef<string | null>(initialFresh ? key : null);

	useEffect(() => {
		fetcherRef.current = fetcher;
	}, [fetcher]);

	// One engine per interval/timeout; it owns the timer and the in-flight request.
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let inflight: AbortController | null = null;
		let failures = 0;
		let alive = true;
		const engine: Engine = {
			lastSuccess: engineRef.current?.lastSuccess ?? Date.now(),
			stop() {
				if (timer) clearTimeout(timer);
				timer = null;
			},
			reset() {
				failures = 0;
				if (inflight) {
					inflight.abort();
					inflight = null;
				}
			},
			schedule() {
				engine.stop();
				if (!alive) return;
				if (document.visibilityState === "hidden") {
					setSnapshot((prev) => (prev.nextAttemptAt === null ? prev : { ...prev, nextAttemptAt: null }));
					return;
				}
				const delay = backoffDelay(intervalMs, failures);
				const due = Date.now() + delay;
				setSnapshot((prev) => ({ ...prev, nextAttemptAt: due }));
				timer = setTimeout(() => engine.run(), delay);
			},
			run() {
				if (!alive || inflight) return;
				engine.stop();
				const controller = new AbortController();
				inflight = controller;
				const timeout = setTimeout(() => controller.abort(), timeoutMs);
				setSnapshot((prev) => ({ ...prev, loading: true, nextAttemptAt: null }));
				fetcherRef.current(controller.signal)
					.then((data) => {
						if (!alive || inflight !== controller) return;
						failures = 0;
						engine.lastSuccess = Date.now();
						setSnapshot((prev) => ({ ...prev, data, error: null, failures: 0, refreshedAt: engine.lastSuccess }));
					})
					.catch((err: unknown) => {
						if (!alive || inflight !== controller) return;
						failures += 1;
						const message = controller.signal.aborted ? "timeout" : err instanceof Error ? err.message : String(err);
						setSnapshot((prev) => ({ ...prev, error: message, failures }));
					})
					.finally(() => {
						clearTimeout(timeout);
						if (inflight !== controller) return;
						inflight = null;
						if (!alive) return;
						setSnapshot((prev) => ({ ...prev, loading: false }));
						engine.schedule();
					});
			},
		};
		engineRef.current = engine;
		const onVisibility = () => {
			if (document.visibilityState === "hidden") {
				engine.stop();
				setSnapshot((prev) => ({ ...prev, nextAttemptAt: null }));
				return;
			}
			if (Date.now() - engine.lastSuccess >= intervalMs) engine.run();
			else engine.schedule();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			alive = false;
			document.removeEventListener("visibilitychange", onVisibility);
			engine.stop();
			inflight?.abort();
			inflight = null;
			if (engineRef.current === engine) engineRef.current = null;
		};
	}, [intervalMs, timeoutMs]);

	// Fetch now for a new key; the server-rendered first key just waits one interval.
	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		if (firstKey.current === key) {
			firstKey.current = null;
			engine.schedule();
			return;
		}
		firstKey.current = null;
		engine.reset();
		engine.run();
	}, [key, intervalMs, timeoutMs]);

	const refresh = useCallback(() => {
		const engine = engineRef.current;
		if (!engine) return;
		engine.reset();
		engine.run();
	}, []);

	return { ...snapshot, refresh };
}
