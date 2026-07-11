"use client";

import { useEffect, useRef } from "react";

/** Runs an interval only while the document is visible and avoids stale callbacks. */
export function useVisibilityInterval(callback: () => void, delayMs: number | null) {
	const callbackRef = useRef(callback);
	useEffect(() => {
		callbackRef.current = callback;
	}, [callback]);

	useEffect(() => {
		if (delayMs === null || delayMs <= 0) return;
		let timer: ReturnType<typeof setInterval> | null = null;
		const stop = () => { if (timer !== null) clearInterval(timer); timer = null; };
		const start = () => {
			if (timer !== null || document.visibilityState === "hidden") return;
			timer = setInterval(() => callbackRef.current(), delayMs);
		};
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") return stop();
			callbackRef.current();
			start();
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		start();
		return () => { document.removeEventListener("visibilitychange", onVisibilityChange); stop(); };
	}, [delayMs]);
}
