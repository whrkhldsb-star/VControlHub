"use client";

import { useEffect } from "react";

import { api } from "@/lib/http/api-client";

type MetricRating = "good" | "needs-improvement" | "poor";

type VitalPayload = {
	name: "CLS" | "LCP" | "INP" | "FCP" | "TTFB";
	value: number;
	rating?: MetricRating;
	path?: string;
	navigationType?: string;
};

function rateMetric(name: VitalPayload["name"], value: number): MetricRating | undefined {
	// Thresholds aligned with web.dev Core Web Vitals guidance.
	switch (name) {
		case "CLS":
			if (value <= 0.1) return "good";
			if (value <= 0.25) return "needs-improvement";
			return "poor";
		case "LCP":
			if (value <= 2500) return "good";
			if (value <= 4000) return "needs-improvement";
			return "poor";
		case "INP":
			if (value <= 200) return "good";
			if (value <= 500) return "needs-improvement";
			return "poor";
		case "FCP":
			if (value <= 1800) return "good";
			if (value <= 3000) return "needs-improvement";
			return "poor";
		case "TTFB":
			if (value <= 800) return "good";
			if (value <= 1800) return "needs-improvement";
			return "poor";
		default:
			return undefined;
	}
}

async function postVital(payload: VitalPayload) {
	try {
		await api.post("/api/monitoring/web-vitals", {
			...payload,
			rating: payload.rating ?? rateMetric(payload.name, payload.value),
			path: typeof window !== "undefined" ? window.location.pathname : undefined,
		});
	} catch {
		// Best-effort telemetry — never block the UI on reporting failures.
	}
}

/**
 * Collects Core Web Vitals via the web-vitals library when available,
 * with a PerformanceObserver fallback for LCP/CLS/INP if the package is absent.
 */
export function WebVitalsReporter() {
	useEffect(() => {
		let cancelled = false;
		const cleanups: Array<() => void> = [];

		async function start() {
			try {
				const webVitals = await import("web-vitals");
				if (cancelled) return;
				const report = (metric: { name: string; value: number; rating?: MetricRating; navigationType?: string }) => {
					if (!["CLS", "LCP", "INP", "FCP", "TTFB"].includes(metric.name)) return;
					void postVital({
						name: metric.name as VitalPayload["name"],
						value: metric.value,
						rating: metric.rating,
						navigationType: metric.navigationType,
					});
				};
				webVitals.onCLS(report);
				webVitals.onINP(report);
				webVitals.onLCP(report);
				webVitals.onFCP?.(report);
				webVitals.onTTFB?.(report);
				return;
			} catch {
				// Fall through to PerformanceObserver fallback.
			}

			if (typeof PerformanceObserver === "undefined") return;

			try {
				const lcpObserver = new PerformanceObserver((list) => {
					const entries = list.getEntries();
					const last = entries[entries.length - 1] as PerformanceEntry | undefined;
					if (last) void postVital({ name: "LCP", value: last.startTime });
				});
				lcpObserver.observe({ type: "largest-contentful-paint", buffered: true } as PerformanceObserverInit);
				cleanups.push(() => lcpObserver.disconnect());
			} catch {
				// Unsupported browser.
			}

			try {
				let cls = 0;
				const clsObserver = new PerformanceObserver((list) => {
					for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
						if (!entry.hadRecentInput && typeof entry.value === "number") cls += entry.value;
					}
					void postVital({ name: "CLS", value: cls });
				});
				clsObserver.observe({ type: "layout-shift", buffered: true } as PerformanceObserverInit);
				cleanups.push(() => clsObserver.disconnect());
			} catch {
				// Unsupported browser.
			}

			try {
				const inpObserver = new PerformanceObserver((list) => {
					for (const entry of list.getEntries() as Array<PerformanceEntry & { duration?: number; interactionId?: number }>) {
						if (entry.interactionId && typeof entry.duration === "number") {
							void postVital({ name: "INP", value: entry.duration });
						}
					}
				});
				inpObserver.observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
				cleanups.push(() => inpObserver.disconnect());
			} catch {
				// Unsupported browser.
			}
		}

		void start();
		return () => {
			cancelled = true;
			for (const cleanup of cleanups) cleanup();
		};
	}, []);

	return null;
}
