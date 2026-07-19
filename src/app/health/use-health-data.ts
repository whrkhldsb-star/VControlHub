/**
 * useHealthData — encapsulates data-fetching for the split health surfaces:
 *   - mode "system": platform self-check only (`/api/system-health`)
 *   - mode "vps": fleet overview + per-server history (`/api/health`)
 *   - mode "all": legacy combined (kept for tests)
 *
 * Auto-refresh interval always comes from the shared Settings preference
 * (`vps-preferences.autoRefreshInterval`) via localStorage +
 * `vps-preferences-updated` / `storage` events — same as monitoring/docker.
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

export type HealthDataMode = "all" | "system" | "vps";

function isSystemHealthReport(value: unknown): value is SystemHealthReport {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { generatedAt?: unknown; summary?: unknown; checks?: unknown };
	return (
		typeof candidate.generatedAt === "string" &&
		typeof candidate.summary === "object" &&
		Array.isArray(candidate.checks)
	);
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
	/** Which data surfaces to load. Default "all" for backward compatibility. */
	mode?: HealthDataMode;
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
	mode = "all",
}: UseHealthDataOptions): UseHealthDataReturn {
	const wantVps = mode === "all" || mode === "vps";
	const wantSystem = mode === "all" || mode === "system";

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
		if (!wantVps) return;
		setIsRefreshing(true);
		try {
			const data = (await csrfFetch("/api/health")) as HealthOverview;
			setOverview(data);
			setLoadError(null);
			setLastRefresh(new Date().toLocaleTimeString(browserLocale));
		} catch (error) {
			setLoadError(getErrorMessage(error, t("healthPage.error.loadStatus", locale)));
		} finally {
			setIsRefreshing(false);
		}
	}, [browserLocale, locale, wantVps]);

	const fetchSystemHealth = useCallback(async () => {
		if (!wantSystem) return;
		setIsRefreshing(true);
		try {
			const report = await csrfFetch("/api/system-health");
			if (isSystemHealthReport(report)) {
				setSystemHealth(report);
				setLoadError(null);
				setLastRefresh(new Date().toLocaleTimeString(browserLocale));
			}
		} catch (error) {
			// On system-only page, surface the error; on combined/vps keep quiet.
			if (!wantVps) {
				setLoadError(getErrorMessage(error, t("healthPage.error.loadStatus", locale)));
			}
		} finally {
			setIsRefreshing(false);
		}
	}, [browserLocale, locale, wantSystem, wantVps]);

	const fetchHistory = useCallback(
		async (serverId: string) => {
			if (!wantVps) return;
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
					[serverId]: getErrorMessage(error, t("healthPage.error.loadHistory", locale)),
				}));
			}
		},
		[locale, wantVps],
	);

	// Initial fetch
	useEffect(() => {
		const timer = window.setTimeout(() => {
			if (wantVps) void fetchHealth();
			if (wantSystem) void fetchSystemHealth();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [fetchHealth, fetchSystemHealth, wantSystem, wantVps]);

	// Keep refresh interval in sync with Settings (storage + in-page event).
	useEffect(() => {
		const readSavedInterval = () => {
			setRefreshIntervalSeconds(getRefreshIntervalFromStorage(window.localStorage, 30));
		};
		readSavedInterval();
		window.addEventListener("storage", readSavedInterval);
		window.addEventListener("vps-preferences-updated", readSavedInterval);
		return () => {
			window.removeEventListener("storage", readSavedInterval);
			window.removeEventListener("vps-preferences-updated", readSavedInterval);
		};
	}, []);

	useVisibilityInterval(() => {
		if (wantVps) void fetchHealth();
		if (wantSystem) void fetchSystemHealth();
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
