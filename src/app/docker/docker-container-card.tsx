"use client";

import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import {
	type Container,
	type ContainerStats,
	formatBytes,
	stateLabel,
} from "./docker-helpers";

export function DockerContainerCard({
	c,
	options,
	t,
	stats,
	actionLoading,
	handleAction,
	fetchLogs,
	requestRemoval,
}: {
	c: Container;
	options?: { showComposeLabels?: boolean };
	t: (key: string, vars?: Record<string, string | number>) => string;
	stats: Record<string, ContainerStats>;
	actionLoading: string | null;
	handleAction: (container: Container, action: "start" | "stop" | "restart" | "remove") => Promise<void>;
	fetchLogs: (id: string) => Promise<void>;
	requestRemoval: (container: Container) => void;
}) {
	const showComposeLabels = options?.showComposeLabels ?? false;
	const stat = stats[c.Id];
	return (
		<div key={c.Id} data-inset className="p-3.5">
			<div className="mb-2 flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<StatusBadge tone={c.State === "running" ? "success" : c.State === "paused" || c.State === "restarting" ? "warning" : c.State === "created" ? "accent" : c.State === "dead" || c.State === "removing" ? "danger" : "neutral"} size="sm">
						{stateLabel(t, c.State)}
					</StatusBadge>
					<span className="ui-mono truncate text-sm font-medium text-[var(--text-primary)]">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//,"")}</span>
				</div>
				<span className="ml-3 truncate text-xs text-[var(--text-muted)]">{c.Image}</span>
			</div>
			<div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
				<span>{c.Status}</span>
				{showComposeLabels && c.Labels?.["com.docker.compose.service"] ? <span>{t("dockerPage.label.service", { name: c.Labels["com.docker.compose.service"] })}</span> : null}
				{showComposeLabels && c.Labels?.["com.docker.compose.version"] ? <span>{t("dockerPage.label.version", { version: c.Labels["com.docker.compose.version"] })}</span> : null}
			</div>
			{stat && (
				<div className="mb-3 grid grid-cols-2 gap-1.5 text-xs tabular-nums text-[var(--text-secondary)] md:grid-cols-4">
					{[
						t("dockerPage.stat.cpu", { percent: stat.cpuPercent.toFixed(1) }),
						t("dockerPage.stat.memory", { used: formatBytes(stat.memoryUsageBytes), percent: stat.memoryPercent.toFixed(1) }),
						t("dockerPage.stat.netRx", { bytes: formatBytes(stat.networkRxBytes) }),
						t("dockerPage.stat.netTx", { bytes: formatBytes(stat.networkTxBytes) }),
					].map((label) => (
						<div key={label} className="truncate rounded-md bg-[var(--surface-elevated)] px-2 py-1.5">{label}</div>
					))}
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{c.State !=="running" && (
					<ActionButton size="sm" variant="success" onClick={() => handleAction(c,"start")} disabled={actionLoading === c.Id}>{t("dockerPage.action.start")}</ActionButton>
				)}
				{c.State ==="running" && (
					<>
						<ActionButton size="sm" variant="secondary" onClick={() => handleAction(c,"stop")} disabled={actionLoading === c.Id}>{t("dockerPage.action.stop")}</ActionButton>
						<ActionButton size="sm" variant="secondary" onClick={() => handleAction(c,"restart")} disabled={actionLoading === c.Id}>{t("dockerPage.action.restart")}</ActionButton>
					</>
				)}
				<ActionButton size="sm" variant="secondary" onClick={() => fetchLogs(c.Id)}>{t("dockerPage.action.logs")}</ActionButton>
				<ActionButton size="sm" variant="danger" onClick={() => requestRemoval(c)} disabled={actionLoading === c.Id}>{t("dockerPage.action.remove")}</ActionButton>
			</div>
		</div>
	);
}
