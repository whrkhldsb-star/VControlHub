/**
 * useHealthData — encapsulates all data-fetching and state for the health
 * dashboard (overview, system-health report, per-server history, load + history
 * errors, last-refresh timestamp, refreshing flag, auto-refresh controls).
 *
 * Behaviour is 1:1 with the previous inline block in
 * `health-dashboard-client.tsx`:
 *   - Initial fetch fires once on mount (via `setTimeout(..., 0)`) — same
 *     defer-to-microtask trick the previous code used.
 *   - Auto-refresh fetches overview + system-health on a configurable
 *     interval. The interval is read from `localStorage` on mount and is
 *     kept reactive via the `storage` event.
 *   - `fetchHistory(serverId)` is called lazily when the user expands a row.
 */
"use client";

import { useCallback, useEffect, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { t } from "@/lib/i18n/translations";
import { getRefreshIntervalFromStorage } from "@/lib/preferences/refresh-interval";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";

import type {
	HealthOverview,
	MetricPoint,
	SystemHealthReport,
} from "./health-types";

function isSystemHealthReport(value: unknown): value is SystemHealthReport {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { generatedAt?: unknown; summary?: unknown; checks?: unknown };
	return typeof candidate.generatedAt === "string"
		&& typeof candidate.summary === "object"
		&& Array.isArray(candidate.checks);
}

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

export interface UseHealthDataOptions {
	/** Initial system-health report from the server, so we can render synchronously. */
	initialSystemHealth?: SystemHealthReport | null;
	/** Browser locale used for `toLocaleTimeString` in `lastRefresh`. */
	browserLocale: string;
	/** UI locale ("zh" | "en") — picks translated error messages. */
	locale: "zh" | "en";
}

export interface UseHealthDataReturn {
	overview: HealthOverview | null;
	systemHealth: SystemHealthReport | null;
	history: Record<string, MetricPoint[]>;
	historyErrors: Record<string, string>;
	loadError: string | null;
	lastRefresh: string;
	isRefreshing: boolean;
	autoRefresh: boolean;
	refreshIntervalSeconds: number;
	fetchHealth: () => Promise<void>;
	fetchSystemHealth: () => Promise<void>;
	fetchHistory: (serverId: string) => Promise<void>;
	setAutoRefresh: (value: boolean) => void;
}

export function useHealthData({
	initialSystemHealth,
	browserLocale,
	locale,
}: UseHealthDataOptions): UseHealthDataReturn {
	const [overview, setOverview] = useState<HealthOverview | null>(null);
	const [systemHealth, setSystemHealth] = useState<SystemHealthReport | null>(
		initialSystemHealth ?? null,
	);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [history, setHistory] = useState<Record<string, MetricPoint[]>>({});
	const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});
	const [lastRefresh, setLastRefresh] = useState<string>("");
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState<number>(() =>
		typeof window === "undefined" ? 30 : getRefreshIntervalFromStorage(window.localStorage, 30),
	);
	const [autoRefresh, setAutoRefresh] = useState(true);

	const fetchHealth = useCallback(async () => {
		setIsRefreshing(true);
		try {
			const data = (await csrfFetch("/api/health")) as HealthOverview;
			setOverview(data);
			setLoadError(null);
			setLastRefresh(new Date().toLocaleTimeString(browserLocale));
		} catch (error) {
			setLoadError(
				getErrorMessage(error, t("healthPage.error.loadStatus", locale)),
			);
		} finally {
			setIsRefreshing(false);
		}
	}, [browserLocale, locale]);

	const fetchSystemHealth = useCallback(async () => {
		try {
			const report = await csrfFetch("/api/system-health");
			if (isSystemHealthReport(report)) setSystemHealth(report);
		} catch {
			// The VPS health overview is the primary surface; keep it visible if
			// the system self-check endpoint fails.
		}
	}, []);

	const fetchHistory = useCallback(async (serverId: string) => {
		try {
			const data = (await csrfFetch(
				`/api/health?historyFor=${serverId}&hours=24`,
			)) as { history?: MetricPoint[] };
			setHistory((prev) => ({ ...prev, [serverId]: data.history ?? [] }));
			setHistoryErrors((prev) => {
				const next = { ...prev };
				delete next[serverId];
				return next;
			});
		} catch (error) {
			setHistoryErrors((prev) => ({
				...prev,
				[serverId]: getErrorMessage(
					error,
					t("healthPage.error.loadHistory", locale),
				),
			}));
		}
	}, [locale]);

	// Initial fetch — defer to the next macrotask so React has flushed the
	// first render before the network call resolves (matches the prior
	// setTimeout(..., 0) trick used inline in the dashboard client).
	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchHealth();
			void fetchSystemHealth();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [fetchHealth, fetchSystemHealth]);

	// Watch the localStorage key for refresh-interval changes (e.g. user
	// edits the value in another tab) and re-subscribe to the interval.
	useEffect(() => {
		const readSavedInterval = () => {
			setRefreshIntervalSeconds(getRefreshIntervalFromStorage(window.localStorage, 30));
		};
		readSavedInterval();
		window.addEventListener("storage", readSavedInterval);
		return () => window.removeEventListener("storage", readSavedInterval);
	}, []);

	// Auto-refresh on the configured interval (disabled when the user
	// toggles it off, or when the saved interval is 0).
	useVisibilityInterval(() => {
			void fetchHealth();
			void fetchSystemHealth();
	}, autoRefresh && refreshIntervalSeconds > 0 ? refreshIntervalSeconds * 1000 : null);

	return {
		overview,
		systemHealth,
		history,
		historyErrors,
		loadError,
		lastRefresh,
		isRefreshing,
		autoRefresh,
		refreshIntervalSeconds,
		fetchHealth,
		fetchSystemHealth,
		fetchHistory,
		setAutoRefresh,
	};
}
