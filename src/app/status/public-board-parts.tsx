"use client";

/** Pieces shared by the board, its node views and the detail page. */
import type { CSSProperties } from "react";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatAge } from "@/lib/public-status/format";
import type { PublicNode, PublicNodeStatus } from "@/lib/public-status/types";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Locale = "zh" | "en";

export const ACCENT_VARS: Record<string, string> = {
	default: "var(--accent)",
	indigo: "var(--indigo)",
	purple: "var(--purple)",
	emerald: "var(--success)",
	amber: "var(--warning)",
	rose: "var(--danger)",
};

export function accentStyle(accent: string): CSSProperties {
	return { "--board-accent": ACCENT_VARS[accent] ?? ACCENT_VARS.default } as CSSProperties;
}

export function statusTone(status: PublicNodeStatus): StatusTone {
	switch (status) {
		case "online":
			return "success";
		case "offline":
			return "danger";
		case "stale":
			return "warning";
		case "maintenance":
			return "info";
		default:
			return "neutral";
	}
}

export function StatusPill({ status, t }: { status: PublicNodeStatus; t: T }) {
	return <StatusBadge tone={statusTone(status)}>{t(`publicStatus.status.${status}`)}</StatusBadge>;
}

export function NodeFreshness({ node, nowMs, locale, t }: { node: PublicNode; nowMs: number; locale: Locale; t: T }) {
	if (!node.metricsAt && !node.checkedAt && !node.heartbeatAt) {
		return <span>{t("publicStatus.node.neverSampled")}</span>;
	}
	return (
		<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
			{node.metricsAt ? (
				<span title={node.metricsAt}>{t("publicStatus.node.sampledAgo", { age: formatAge(node.metricsAt, nowMs, locale) })}</span>
			) : (
				<span>{t("publicStatus.node.noMetricsYet")}</span>
			)}
			{node.heartbeatAt ? (
				<span title={node.heartbeatAt}>· {t("publicStatus.node.heartbeatAgo", { age: formatAge(node.heartbeatAt, nowMs, locale) })}</span>
			) : null}
			{node.metricsStale ? <span className="font-medium text-[var(--warning)]">· {t("publicStatus.node.metricsStale")}</span> : null}
		</span>
	);
}
