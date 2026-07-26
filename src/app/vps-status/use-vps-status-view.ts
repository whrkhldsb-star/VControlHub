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

import { tt as applyTemplate } from "@/app/health/health-dashboard-helpers";
import { useHealthData } from "@/app/health/use-health-data";

export type VpsStatusFilter = "all" | "online" | "issue";
export type VpsStatusViewMode = "cards" | "table";

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
	const [viewMode, setViewMode] = useState<VpsStatusViewMode>(() => {
		if (typeof window === "undefined") return "cards";
		try {
			const saved = window.localStorage.getItem("vch.vpsStatus.viewMode");
			if (saved === "cards" || saved === "table") return saved;
		} catch {
			/* ignore */
		}
		return "cards";
	});

	const setViewModePersist = (mode: VpsStatusViewMode) => {
		setViewMode(mode);
		try {
			window.localStorage.setItem("vch.vpsStatus.viewMode", mode);
		} catch {
			/* ignore */
		}
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
