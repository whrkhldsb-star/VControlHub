"use client";

import { ActionButton } from "@/components/action-button";
import {
	type Container,
	type ContainerStats,
	formatBytes,
	stateColors,
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
		<div key={c.Id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
			<div className="mb-2 flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${stateColors[c.State] ||"bg-[var(--surface-hover)]/50 text-[var(--text-muted)]"}`}>
						{stateLabel(t, c.State)}
					</span>
					<span className="truncate text-sm font-medium text-[var(--text-primary)]">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//,"")}</span>
				</div>
				<span className="ml-3 truncate text-[10px] text-[var(--text-muted)]">{c.Image}</span>
			</div>
			<div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
				<span>{c.Status}</span>
				{showComposeLabels && c.Labels?.["com.docker.compose.service"] ? <span>{t("dockerPage.label.service", { name: c.Labels["com.docker.compose.service"] })}</span> : null}
				{showComposeLabels && c.Labels?.["com.docker.compose.version"] ? <span>{t("dockerPage.label.version", { version: c.Labels["com.docker.compose.version"] })}</span> : null}
			</div>
			{stat && (
				<div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
					<div className="rounded-lg bg-[var(--accent-bg)] px-2 py-1.5 text-[var(--accent)]">{t("dockerPage.stat.cpu", { percent: stat.cpuPercent.toFixed(1) })}</div>
					<div className="rounded-lg bg-[var(--accent-bg)] px-2 py-1.5 text-[var(--accent)]">{t("dockerPage.stat.memory", { used: formatBytes(stat.memoryUsageBytes), percent: stat.memoryPercent.toFixed(1) })}</div>
					<div className="rounded-lg bg-[var(--success-bg)] px-2 py-1.5 text-[var(--success)]">{t("dockerPage.stat.netRx", { bytes: formatBytes(stat.networkRxBytes) })}</div>
					<div className="rounded-lg bg-[var(--warning-bg)] px-2 py-1.5 text-[var(--warning)]">{t("dockerPage.stat.netTx", { bytes: formatBytes(stat.networkTxBytes) })}</div>
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{c.State !=="running" && (
					<ActionButton type="button" variant="success" onClick={() => handleAction(c,"start")} disabled={actionLoading === c.Id} className="!min-h-11 !px-2.5 !py-1 !text-[10px] disabled:opacity-50">{t("dockerPage.action.start")}</ActionButton>
				)}
				{c.State ==="running" && (
					<>
						<ActionButton type="button" variant="outline" onClick={() => handleAction(c,"stop")} disabled={actionLoading === c.Id} className="!min-h-11 !px-2.5 !py-1 !text-[10px] disabled:opacity-50">{t("dockerPage.action.stop")}</ActionButton>
						<ActionButton type="button" variant="outline" onClick={() => handleAction(c,"restart")} disabled={actionLoading === c.Id} className="!min-h-11 !px-2.5 !py-1 !text-[10px] disabled:opacity-50">{t("dockerPage.action.restart")}</ActionButton>
					</>
				)}
				<ActionButton type="button" variant="secondary" onClick={() => fetchLogs(c.Id)} className="!min-h-11 !px-2.5 !py-1 !text-[10px]">{t("dockerPage.action.logs")}</ActionButton>
				<ActionButton type="button" variant="danger" onClick={() => requestRemoval(c)} disabled={actionLoading === c.Id} className="!min-h-11 !px-2.5 !py-1 !text-[10px] disabled:opacity-50">{t("dockerPage.action.remove")}</ActionButton>
			</div>
		</div>
	);
}
