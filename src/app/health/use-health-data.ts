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

import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { browserT as t } from "@/lib/i18n/browser-translations";
import { getRefreshIntervalFromStorage } from "@/lib/preferences/refresh-interval";
import { REFRESH_PREFERENCES_STORAGE_KEY } from "@/lib/preferences/refresh-interval";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import { useBrowserStorageSnapshot } from "@/lib/hooks/use-browser-storage-snapshot";
import { getErrorMessage } from "@/lib/http/error-message";

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

function readRefreshInterval(storage: Storage): number {
	return getRefreshIntervalFromStorage(storage, 30);
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
	const refreshIntervalSeconds = useBrowserStorageSnapshot(
		REFRESH_PREFERENCES_STORAGE_KEY,
		readRefreshInterval,
		30,
		"vps-preferences-updated",
	);
	const [autoRefresh, setAutoRefresh] = useState(true);
	// Separate in-flight counters so fleet + system fetches do not clobber each other.
	const vpsInFlightRef = useRef(0);
	const systemInFlightRef = useRef(0);
	const healthGenRef = useRef(0);
	const systemGenRef = useRef(0);
	const historyGenByServerRef = useRef<Record<string, number>>({});

	const syncRefreshing = useCallback(() => {
		setIsRefreshing(vpsInFlightRef.current + systemInFlightRef.current > 0);
	}, []);

	const fetchHealth = useCallback(async () => {
		if (!wantVps) return;
		const gen = ++healthGenRef.current;
		vpsInFlightRef.current += 1;
		syncRefreshing();
		try {
			const data = (await csrfFetch("/api/health")) as HealthOverview;
			if (gen !== healthGenRef.current) return;
			setOverview(data);
			setLoadError(null);
			setLastRefresh(new Date().toLocaleTimeString(browserLocale));
		} catch (error) {
			if (gen !== healthGenRef.current) return;
			setLoadError(getErrorMessage(error, t("healthPage.error.loadStatus", locale)));
		} finally {
			vpsInFlightRef.current = Math.max(0, vpsInFlightRef.current - 1);
			syncRefreshing();
		}
	}, [browserLocale, locale, wantVps, syncRefreshing]);

	const fetchSystemHealth = useCallback(async () => {
		if (!wantSystem) return;
		const gen = ++systemGenRef.current;
		systemInFlightRef.current += 1;
		syncRefreshing();
		try {
			const report = await csrfFetch("/api/system-health");
			if (gen !== systemGenRef.current) return;
			if (isSystemHealthReport(report)) {
				setSystemHealth(report);
				setLoadError(null);
				setLastRefresh(new Date().toLocaleTimeString(browserLocale));
			} else if (!wantVps) {
				// Invalid / unexpected payload must not leave the system page looking healthy with stale null.
				setLoadError(t("healthPage.error.loadStatus", locale));
			}
		} catch (error) {
			if (gen !== systemGenRef.current) return;
			// On system-only page, surface the error; on combined/vps keep quiet.
			if (!wantVps) {
				setLoadError(getErrorMessage(error, t("healthPage.error.loadStatus", locale)));
			}
		} finally {
			systemInFlightRef.current = Math.max(0, systemInFlightRef.current - 1);
			syncRefreshing();
		}
	}, [browserLocale, locale, wantSystem, wantVps, syncRefreshing]);

	const fetchHistory = useCallback(
		async (serverId: string) => {
			if (!wantVps) return;
			const gen = (historyGenByServerRef.current[serverId] ?? 0) + 1;
			historyGenByServerRef.current[serverId] = gen;
			try {
				const data = (await csrfFetch(
					`/api/health?historyFor=${serverId}&hours=24`,
				)) as { history?: MetricPoint[] };
				if (historyGenByServerRef.current[serverId] !== gen) return;
				setHistory((prev) => ({ ...prev, [serverId]: data.history ?? [] }));
				setHistoryErrors((prev) => {
					const next = { ...prev };
					delete next[serverId];
					return next;
				});
			} catch (error) {
				if (historyGenByServerRef.current[serverId] !== gen) return;
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
		return () => {
			window.clearTimeout(timer);
			// Invalidate in-flight overview/system fetches on unmount/remount.
			healthGenRef.current += 1;
			systemGenRef.current += 1;
		};
	}, [fetchHealth, fetchSystemHealth, wantSystem, wantVps]);

	// System self-check is a one-shot snapshot (+ error retry). Fleet auto-refresh
	// belongs on /vps-status only (mode "vps" | "all").
	useVisibilityInterval(() => {
		if (wantVps) void fetchHealth();
		if (wantSystem && wantVps) void fetchSystemHealth();
	}, wantVps && autoRefresh && refreshIntervalSeconds > 0 ? refreshIntervalSeconds * 1000 : null);

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
