"use client";

import Link from "next/link";
import type { CSSProperties } from "react";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { ProgressBar } from "@/components/ui-primitives";
import { formatAge, formatDuration, formatIecBytes, formatIecRate, formatLatency, formatPercent } from "@/lib/public-status/format";
import type { PublicBoardSummary, PublicNode, PublicNodeStatus } from "@/lib/public-status/types";

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

function usageTone(value: number | null) {
	if (value === null) return "neutral" as const;
	if (value >= 95) return "danger" as const;
	if (value >= 80) return "warning" as const;
	return "success" as const;
}

function MetricBar({ label, value, detail, t }: { label: string; value: number | null; detail?: string; t: T }) {
	return (
		<div className="min-w-0">
			<div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
				<span className="text-[var(--text-muted)]">{label}</span>
				<span className="truncate font-mono text-[var(--text-primary)]">
					{formatPercent(value)}
					{detail ? <span className="ml-1 text-[var(--text-muted)]">{detail}</span> : null}
				</span>
			</div>
			{value === null ? (
				<div className="h-1.5 rounded-full bg-[var(--surface-elevated)]" aria-label={t("publicStatus.metric.notSampled")} />
			) : (
				<ProgressBar value={value} tone={usageTone(value)} label={`${label} ${formatPercent(value)}`} />
			)}
		</div>
	);
}

/** "x / y" with IEC units, or just the total when usage is unknown. */
function usedOfTotal(used: number | null | undefined, total: number | null | undefined) {
	if (total === null || total === undefined) return undefined;
	if (used === null || used === undefined) return formatIecBytes(total);
	return `${formatIecBytes(used)} / ${formatIecBytes(total)}`;
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

function offlineText(node: PublicNode, t: T) {
	if (node.status === "offline") return t(node.offlineReason === "collect_failed" ? "publicStatus.offline.collectFailed" : "publicStatus.offline.unreachable");
	if (node.status === "stale") return t("publicStatus.node.staleHint");
	return null;
}

export function NodeCard({ node, nowMs, locale, t, linkSuffix = "" }: { node: PublicNode; nowMs: number; locale: Locale; t: T; linkSuffix?: string }) {
	const m = node.metrics;
	const hasNumbers = Boolean(m.cpu || m.memory || m.disk);
	const notice = offlineText(node, t);
	return (
		<article
			data-card
			data-public-node={node.id}
			data-status={node.status}
			className={`flex min-w-0 flex-col gap-3 p-4 ${node.status === "offline" || node.status === "stale" ? "opacity-90" : ""}`}
		>
			<header className="flex min-w-0 items-start justify-between gap-2">
				<div className="min-w-0">
					<h3 className="ui-title-group truncate">
						<Link href={`/status/nodes/${node.id}${linkSuffix}`} className="hover:underline focus-visible:underline">
							{node.name}
						</Link>
					</h3>
					<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
						{[node.region, node.group].filter(Boolean).join(" · ") || " "}
					</p>
				</div>
				<span className="shrink-0 whitespace-nowrap">
					<StatusPill status={node.status} t={t} />
				</span>
			</header>
			{node.tags.length > 0 ? (
				<ul className="flex flex-wrap gap-1" aria-label={t("publicStatus.node.tags")}>
					{node.tags.map((tag) => (
						<li key={tag} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">{tag}</li>
					))}
				</ul>
			) : null}
			{notice ? <p className="text-xs text-[var(--text-secondary)]">{notice}</p> : null}
			{hasNumbers ? (
				<div className={`grid gap-2.5 ${node.metricsStale ? "opacity-70" : ""}`}>
					{m.cpu ? <MetricBar label={t("publicStatus.metric.cpu")} value={m.cpu.usage} detail={m.cpu.cores ? t("publicStatus.metric.cores", { count: m.cpu.cores }) : undefined} t={t} /> : null}
					{m.memory ? <MetricBar label={t("publicStatus.metric.memory")} value={m.memory.usage} detail={usedOfTotal(m.memory.usedBytes, m.memory.totalBytes)} t={t} /> : null}
					{m.disk ? <MetricBar label={t("publicStatus.metric.disk")} value={m.disk.usage} detail={usedOfTotal(m.disk.usedBytes, m.disk.totalBytes)} t={t} /> : null}
				</div>
			) : null}
			<dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
				{m.network ? (
					<>
						<dt className="text-[var(--text-muted)]">{t("publicStatus.metric.rate")}</dt>
						<dd className="text-right font-mono">
							<span title={t("publicStatus.metric.download")}>↓ {formatIecRate(m.network.rxBytesPerSecond)}</span>{" "}
							<span title={t("publicStatus.metric.upload")}>↑ {formatIecRate(m.network.txBytesPerSecond)}</span>
						</dd>
					</>
				) : null}
				{m.traffic ? (
					<>
						<dt className="text-[var(--text-muted)]">{t("publicStatus.metric.monthTraffic")}</dt>
						<dd className="text-right font-mono">
							↓ {formatIecBytes(m.traffic.periodRxBytes)} ↑ {formatIecBytes(m.traffic.periodTxBytes)}
						</dd>
					</>
				) : null}
				{m.uptime ? (
					<>
						<dt className="text-[var(--text-muted)]">{t("publicStatus.metric.uptime")}</dt>
						<dd className="text-right font-mono">{formatDuration(m.uptime.seconds, locale)}</dd>
					</>
				) : null}
				{m.load ? (
					<>
						<dt className="text-[var(--text-muted)]">{t("publicStatus.metric.load")}</dt>
						<dd className="text-right font-mono">{m.load.load1 === null ? "—" : m.load.load1.toFixed(2)}</dd>
					</>
				) : null}
				{m.latency ? (
					<>
						<dt className="text-[var(--text-muted)]">{t("publicStatus.metric.tcpLatency")}</dt>
						<dd className="text-right font-mono">{m.latency.ok === false ? t("publicStatus.latency.failed") : formatLatency(m.latency.ms)}</dd>
					</>
				) : null}
			</dl>
			{node.note ? <p className="whitespace-pre-line text-xs text-[var(--text-secondary)]">{node.note}</p> : null}
			<footer className="mt-auto text-[11px] text-[var(--text-muted)]">
				<NodeFreshness node={node} nowMs={nowMs} locale={locale} t={t} />
			</footer>
		</article>
	);
}

export function NodeTable({ nodes, nowMs, locale, t, metrics, linkSuffix = "" }: { nodes: PublicNode[]; nowMs: number; locale: Locale; t: T; metrics: string[]; linkSuffix?: string }) {
	const show = (key: string) => metrics.includes(key);
	return (
		<div data-card className="relative overflow-x-auto p-0">
			<table className="w-full min-w-[640px] text-left text-sm">
				<caption className="sr-only">{t("publicStatus.table.caption")}</caption>
				<thead className="text-xs text-[var(--text-muted)]">
					<tr>
						<th scope="col" className="px-3 py-2 font-medium">{t("publicStatus.table.node")}</th>
						<th scope="col" className="px-3 py-2 font-medium">{t("publicStatus.table.status")}</th>
						{show("cpu") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.cpu")}</th> : null}
						{show("memory") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.memory")}</th> : null}
						{show("disk") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.disk")}</th> : null}
						{show("network") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.rate")}</th> : null}
						{show("traffic") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.monthTraffic")}</th> : null}
						{show("latency") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.tcpLatency")}</th> : null}
						<th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.table.sampled")}</th>
					</tr>
				</thead>
				<tbody>
					{nodes.map((node) => {
						const m = node.metrics;
						return (
							<tr key={node.id} data-public-node={node.id} data-status={node.status} className="border-t border-[var(--border-subtle)]">
								<th scope="row" className="max-w-[16rem] px-3 py-2 font-medium">
									<Link href={`/status/nodes/${node.id}${linkSuffix}`} className="block truncate hover:underline">{node.name}</Link>
									<span className="block truncate text-xs font-normal text-[var(--text-muted)]">{[node.region, node.group].filter(Boolean).join(" · ")}</span>
								</th>
								<td className="px-3 py-2"><StatusPill status={node.status} t={t} /></td>
								{show("cpu") ? <td className="px-3 py-2 text-right font-mono">{formatPercent(m.cpu?.usage)}</td> : null}
								{show("memory") ? <td className="px-3 py-2 text-right font-mono">{formatPercent(m.memory?.usage)}</td> : null}
								{show("disk") ? <td className="px-3 py-2 text-right font-mono">{formatPercent(m.disk?.usage)}</td> : null}
								{show("network") ? (
									<td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">↓ {formatIecRate(m.network?.rxBytesPerSecond)} ↑ {formatIecRate(m.network?.txBytesPerSecond)}</td>
								) : null}
								{show("traffic") ? (
									<td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">↓ {formatIecBytes(m.traffic?.periodRxBytes)} ↑ {formatIecBytes(m.traffic?.periodTxBytes)}</td>
								) : null}
								{show("latency") ? (
									<td className="px-3 py-2 text-right font-mono">{m.latency?.ok === false ? t("publicStatus.latency.failed") : formatLatency(m.latency?.ms)}</td>
								) : null}
								<td className={`whitespace-nowrap px-3 py-2 text-right text-xs ${node.metricsStale ? "text-[var(--warning)]" : "text-[var(--text-muted)]"}`}>
									{node.metricsAt ? formatAge(node.metricsAt, nowMs, locale) : t("publicStatus.node.neverSampled")}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: string }) {
	return (
		<div data-card className="min-w-0 p-3">
			<p className="text-xs text-[var(--text-muted)]">{label}</p>
			<p className="mt-1 truncate font-mono text-base font-semibold sm:text-lg" style={tone ? { color: tone } : undefined} title={value}>{value}</p>
			{detail ? <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{detail}</p> : null}
		</div>
	);
}

export function SummaryStrip({ summary, metrics, nowMs, refreshedAt, locale, t }: {
	summary: PublicBoardSummary;
	metrics: string[];
	nowMs: number;
	refreshedAt: number;
	locale: Locale;
	t: T;
}) {
	const others = [
		summary.offline ? t("publicStatus.summary.offlineCount", { count: summary.offline }) : null,
		summary.stale ? t("publicStatus.summary.staleCount", { count: summary.stale }) : null,
		summary.unknown ? t("publicStatus.summary.unknownCount", { count: summary.unknown }) : null,
		summary.maintenance ? t("publicStatus.summary.maintenanceCount", { count: summary.maintenance }) : null,
	].filter(Boolean).join(" · ");
	return (
		<section aria-label={t("publicStatus.summary.label")} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
			<Stat label={t("publicStatus.summary.online")} value={`${summary.online} / ${summary.total}`} detail={others || t("publicStatus.summary.allOnline")} tone={summary.total > 0 && summary.online === summary.total ? "var(--success)" : undefined} />
			<Stat
				label={t("publicStatus.summary.regions")}
				value={String(summary.regions.length)}
				detail={summary.groups.length ? t("publicStatus.summary.groups", { count: summary.groups.length }) : undefined}
			/>
			{metrics.includes("network") ? (
				<Stat
					label={t("publicStatus.summary.throughput")}
					value={`↓ ${formatIecRate(summary.rxBytesPerSecond)}`}
					detail={`↑ ${formatIecRate(summary.txBytesPerSecond)} · ${t("publicStatus.summary.rateNodes", { count: summary.rateNodes })}`}
				/>
			) : null}
			{metrics.includes("traffic") ? (
				<Stat label={t("publicStatus.summary.monthTraffic")} value={`↓ ${formatIecBytes(summary.periodRxBytes)}`} detail={`↑ ${formatIecBytes(summary.periodTxBytes)}`} />
			) : null}
			<Stat
				label={t("publicStatus.summary.lastSample")}
				value={summary.lastSampleAt ? formatAge(summary.lastSampleAt, nowMs, locale) : "—"}
				detail={t("publicStatus.summary.pageRefreshed", { age: formatAge(new Date(refreshedAt).toISOString(), nowMs, locale) })}
			/>
		</section>
	);
}
