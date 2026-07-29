"use client";

/**
 * Business state for the VPS fleet status page: health polling data
 * (via the shared `useHealthData` hook), filter / view-mode / expand
 * state, and derived labels. Extracted 1:1 from `vps-status-client.tsx`.
 */

import { useMemo, useState } from "react";

import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { writeLocalStorageValue } from "@/lib/browser-storage";
import { useBrowserStorageSnapshot } from "@/lib/hooks/use-browser-storage-snapshot";

import { tt as applyTemplate } from "@/app/health/health-dashboard-helpers";
import { useHealthData } from "@/app/health/use-health-data";

export type VpsStatusFilter = "all" | "online" | "issue";
export type VpsStatusViewMode = "cards" | "table";

const VPS_STATUS_VIEW_MODE_KEY = "vch.vpsStatus.viewMode";

function readViewMode(storage: Storage): VpsStatusViewMode {
	const saved = storage.getItem(VPS_STATUS_VIEW_MODE_KEY);
	return saved === "table" ? "table" : "cards";
}

export function useVpsStatusView() {
	const { locale, t } = useI18n();
	const browserLocale = toDateLocale(locale);
	const {
		overview,
		history,
		historyErrors,
		loadError,
		lastRefresh,
		isRefreshing,
		refreshIntervalSeconds,
		fetchHealth,
		fetchHistory,
	} = useHealthData({ browserLocale, locale, mode: "vps" });

	const [expandedServer, setExpandedServer] = useState<string | null>(null);
	const [filter, setFilter] = useState<VpsStatusFilter>("all");
	const viewMode = useBrowserStorageSnapshot(VPS_STATUS_VIEW_MODE_KEY, readViewMode, "cards");

	const setViewModePersist = (mode: VpsStatusViewMode) => {
		writeLocalStorageValue(VPS_STATUS_VIEW_MODE_KEY, mode);
	};

	const tt = (key: string, vars?: Record<string, string | number>) => applyTemplate(t, key, vars);

	const filteredServers = useMemo(() => {
		const list = overview?.servers ?? [];
		if (filter === "online") {
			// Reachable via SSH (includes resource-critical). Offline/disabled excluded.
			return list.filter(
				(s) => s.status === "healthy" || s.status === "warning" || s.status === "critical",
			);
		}
		if (filter === "issue") {
			return list.filter(
				(s) =>
					s.status === "warning" ||
					s.status === "critical" ||
					s.status === "offline" ||
					s.status === "unknown",
			);
		}
		return list;
	}, [overview, filter]);

	const toggleExpand = async (serverId: string) => {
		if (expandedServer === serverId) {
			setExpandedServer(null);
			return;
		}
		setExpandedServer(serverId);
		if (!history[serverId]) await fetchHistory(serverId);
	};

	const loading = overview === null && loadError === null;
	const intervalLabel =
		refreshIntervalSeconds <= 0
			? t("healthPage.ui.autoRefreshOff")
			: getRefreshIntervalLabel(refreshIntervalSeconds);

	return {
		locale,
		t,
		tt,
		browserLocale,
		overview,
		history,
		historyErrors,
		loadError,
		lastRefresh,
		isRefreshing,
		refreshIntervalSeconds,
		fetchHealth,
		expandedServer,
		setExpandedServer,
		filter,
		setFilter,
		viewMode,
		setViewModePersist,
		filteredServers,
		toggleExpand,
		loading,
		intervalLabel,
	};
}
