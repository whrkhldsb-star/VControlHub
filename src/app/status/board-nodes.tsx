"use client";

/**
 * Status board node views in Komari's style: dense cards with flag, OS,
 * colour-graded meters, price/expiry badges, a traffic quota bar and an
 * on-demand 24-hour trend; a table with inline meters; and the summary tiles
 * (live clock, online share, countries, traffic, live throughput) with a
 * per-visitor choice of which tiles to show.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Activity, ArrowDownUp, Clock, MapPin, Settings, TrendingUp, Zap } from "@/components/icons";
import { useDismiss } from "@/components/ui/menu";
import { Dialog } from "@/components/ui/dialog";
import { CheckboxField, IconButton } from "@/components/ui-primitives";
import { api } from "@/lib/http/api-client";
import { quotaUsagePercent, type TrafficQuotaMode } from "@/lib/public-status/billing";
import { formatAge, formatDuration, formatIecBytes, formatIecRate, formatLatency, formatPercent } from "@/lib/public-status/format";
import { countryFlag, countryName } from "@/lib/public-status/region-flag";
import type { PublicBoardSummary, PublicHistoryResponse, PublicNode } from "@/lib/public-status/types";
import { cn } from "@/lib/ui/cn";
import { CountryFlag, ExpiryBadge, LiveClock, OsMark, PriceBadge, StateStrip, StatusDot, TagChip, UsageMeter } from "./board-visuals";
import { NodeFreshness, StatusPill } from "./public-board-parts";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Locale = "zh" | "en";

function usedOfTotal(used: number | null | undefined, total: number | null | undefined) {
	if (total === null || total === undefined) return undefined;
	if (used === null || used === undefined) return formatIecBytes(total);
	return `${formatIecBytes(used)} / ${formatIecBytes(total)}`;
}

function offlineText(node: PublicNode, t: T) {
	if (node.status === "offline") return t(node.offlineReason === "collect_failed" ? "publicStatus.offline.collectFailed" : "publicStatus.offline.unreachable");
	if (node.status === "stale") return t("publicStatus.node.staleHint");
	return null;
}

function virtualizationLabel(value: string | null | undefined, t: T): string | null {
	if (!value) return null;
	return value === "none" ? t("publicStatus.system.bareMetal") : value.toUpperCase();
}

/** "Ubuntu 24.04 · x86_64 · KVM"; null when nothing is known. */
export function systemLine(node: PublicNode, t: T): string | null {
	const system = node.system;
	if (!system) return null;
	const parts = [system.os, system.arch, virtualizationLabel(system.virtualization, t)].filter(Boolean);
	return parts.length ? parts.join(" · ") : null;
}

export function quotaModeLabel(mode: TrafficQuotaMode, t: T) {
	return t(`publicStatus.quota.mode.${mode}`);
}

/** Percent of the monthly allowance used, or null without a quota or counters. */
export function nodeQuotaPercent(node: PublicNode): number | null {
	const traffic = node.metrics.traffic;
	if (!traffic?.quota) return null;
	return quotaUsagePercent(traffic.quota.mode, traffic.periodRxBytes, traffic.periodTxBytes, traffic.quota.limitBytes);
}

function Row({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
	return (
		<div className="flex min-w-0 items-baseline justify-between gap-3">
			<dt className="shrink-0 text-xs text-[var(--text-muted)]">{label}</dt>
			<dd className="min-w-0 truncate text-right font-mono text-xs tabular-nums text-[var(--text-primary)]" title={title}>{children}</dd>
		</div>
	);
}

/** Down and up side by side, or one above the other where width is short. */
function Pair({ down, up, t, stacked = false }: { down: string; up: string; t: T; stacked?: boolean }) {
	if (stacked) {
		return (
			<span className="flex flex-col">
				<span title={t("publicStatus.metric.download")}>↓ {down}</span>
				<span title={t("publicStatus.metric.upload")}>↑ {up}</span>
			</span>
		);
	}
	return (
		<>
			<span title={t("publicStatus.metric.download")}>↓ {down}</span>{" "}
			<span title={t("publicStatus.metric.upload")}>↑ {up}</span>
		</>
	);
}

function Rates({ rx, tx, t, stacked }: { rx: number | null | undefined; tx: number | null | undefined; t: T; stacked?: boolean }) {
	return <Pair down={formatIecRate(rx)} up={formatIecRate(tx)} t={t} stacked={stacked} />;
}

function Volumes({ rx, tx, t, stacked }: { rx: number | null | undefined; tx: number | null | undefined; t: T; stacked?: boolean }) {
	return <Pair down={formatIecBytes(rx)} up={formatIecBytes(tx)} t={t} stacked={stacked} />;
}

/* ── Trend dialog (24 h CPU, memory and latency), loaded on demand ─────── */

function TrendDialog({ node, preview, locale, t, onClose }: { node: PublicNode; preview: boolean; locale: Locale; t: T; onClose: () => void }) {
	const [data, setData] = useState<PublicHistoryResponse | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		const controller = new AbortController();
		const params = new URLSearchParams({ range: "24h" });
		if (preview) params.set("preview", "1");
		api.get<PublicHistoryResponse>(`/api/status/nodes/${node.id}/history?${params}`, { signal: controller.signal, cache: "no-store" })
			.then(setData)
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => controller.abort();
	}, [node.id, preview]);
	const from = data ? Date.parse(data.from) : 0;
	const to = data ? Date.parse(data.to) : 0;
	const formatX = (time: number) =>
		new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(time);
	const resources = data?.resources ?? null;
	const cpuPoints = resources?.map((point) => ({ t: Date.parse(point.t), v: point.cpu ?? null })) ?? [];
	const memoryPoints = resources?.map((point) => ({ t: Date.parse(point.t), v: point.memory ?? null })) ?? [];
	const hasCpu = resources?.some((point) => point.cpu !== undefined) ?? false;
	const hasMemory = resources?.some((point) => point.memory !== undefined) ?? false;
	const latency = data?.latency ?? null;
	return (
		<Dialog
			open
			onClose={onClose}
			size="lg"
			placement="sheet"
			eyebrow={t("publicStatus.trend.subtitle")}
			title={
				<span className="flex min-w-0 items-center gap-2">
					<CountryFlag code={node.countryCode} locale={locale} />
					<span className="truncate">{node.name}</span>
				</span>
			}
			closeLabel={t("publicStatus.trend.close")}
			footer={
				<Link href={`/status/nodes/${node.id}${preview ? "?preview=1" : ""}`} className="text-sm text-[var(--board-accent,var(--accent))] hover:underline">
					{t("publicStatus.trend.details")}
				</Link>
			}
		>
			{failed ? (
				<p role="alert" className="text-sm text-[var(--warning)]">{t("publicStatus.history.failed")}</p>
			) : !data ? (
				<p className="text-sm text-[var(--text-muted)]" role="status">{t("publicStatus.history.loading")}</p>
			) : (
				<div className="grid gap-4">
					{hasCpu || hasMemory ? (
						<div>
							<p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{t("publicStatus.trend.load")}</p>
							<TimeSeriesChart
								ariaLabel={t("publicStatus.trend.cpuChart")}
								from={from}
								to={to}
								yMax={100}
								height={140}
								series={[
									...(hasCpu ? [{ key: "cpu", label: t("publicStatus.metric.cpu"), color: "var(--chart-1)", points: cpuPoints }] : []),
									...(hasMemory ? [{ key: "memory", label: t("publicStatus.metric.memory"), color: "var(--chart-2)", points: memoryPoints }] : []),
								]}
								formatY={(value) => `${Math.round(value)}%`}
								formatX={formatX}
								emptyLabel={t("publicStatus.history.empty")}
								tableLabel={t("publicStatus.history.table")}
								timeLabel={t("publicStatus.history.time")}
							/>
						</div>
					) : null}
					{latency ? (
						<div>
							<p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{t("publicStatus.history.latency")}</p>
							{latency.measured ? (
								<TimeSeriesChart
									ariaLabel={t("publicStatus.trend.latencyChart")}
									from={from}
									to={to}
									height={140}
									series={[{ key: "latency", label: t("publicStatus.latency.avg"), color: "var(--chart-3)", points: latency.points.map((point) => ({ t: Date.parse(point.t), v: point.avg })) }]}
									markers={latency.points.filter((point) => point.failed > 0).map((point) => ({ t: Date.parse(point.t), label: t("publicStatus.latency.failedCount", { count: point.failed }) }))}
									markerLabel={t("publicStatus.latency.failedMarker")}
									formatY={(value) => formatLatency(value)}
									formatX={formatX}
									emptyLabel={t("publicStatus.history.empty")}
									tableLabel={t("publicStatus.history.table")}
									timeLabel={t("publicStatus.history.time")}
								/>
							) : (
								<p className="text-xs text-[var(--text-muted)]">{t("publicStatus.history.latencyNotMeasured")}</p>
							)}
						</div>
					) : null}
					{!resources && !latency ? <p className="text-sm text-[var(--text-muted)]">{t("publicStatus.history.empty")}</p> : null}
				</div>
			)}
		</Dialog>
	);
}

/* ── Card ───────────────────────────────────────────────────────────────── */

export function NodeCard({ node, nowMs, locale, t, linkSuffix = "", preview = false }: { node: PublicNode; nowMs: number; locale: Locale; t: T; linkSuffix?: string; preview?: boolean }) {
	const m = node.metrics;
	const [trendOpen, setTrendOpen] = useState(false);
	const closeTrend = useCallback(() => setTrendOpen(false), []);
	const notice = offlineText(node, t);
	const down = node.status === "offline";
	const system = systemLine(node, t);
	const quota = m.traffic?.quota ?? null;
	const quotaPercent = nodeQuotaPercent(node);
	const hasMeters = Boolean(m.cpu || m.memory || m.disk);
	const price = node.billing?.monthlyPrice !== null && node.billing?.monthlyPrice !== undefined && node.billing.currency ? node.billing : null;
	const badges = Boolean(price || node.billing?.expiresAt || node.tags.length);
	const canTrend = Boolean(m.cpu || m.memory || m.latency);
	return (
		<article
			data-card
			data-public-node={node.id}
			data-status={node.status}
			className={cn(
				"relative flex min-w-0 flex-col gap-3 transition-[box-shadow,border-color] duration-200 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)] motion-reduce:transition-none",
				down && "opacity-75",
			)}
		>
			<header className="flex min-w-0 items-start gap-2.5">
				{node.countryCode ? <CountryFlag code={node.countryCode} locale={locale} className="mt-0.5 text-2xl" /> : null}
				<div className="min-w-0 flex-1">
					<h3 className="ui-title-group flex min-w-0 items-center gap-1.5">
						<StatusDot status={node.status} label={t(`publicStatus.status.${node.status}`)} decorative />
						{/* The name's link covers the card, so the whole card opens the details. */}
						<Link href={`/status/nodes/${node.id}${linkSuffix}`} className="truncate after:absolute after:inset-0 after:rounded-[inherit] hover:underline focus-visible:underline">
							{node.name}
						</Link>
					</h3>
					<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
						{[node.region, node.group].filter(Boolean).join(" · ") || " "}
					</p>
				</div>
				<div className="relative z-[1] flex shrink-0 items-center gap-1">
					{canTrend ? (
						<IconButton label={t("publicStatus.trend.open", { name: node.name })} className="h-8 w-8" onClick={() => setTrendOpen(true)}>
							<TrendingUp size={16} />
						</IconButton>
					) : null}
					<StatusPill status={node.status} t={t} />
				</div>
			</header>

			{badges ? (
				<div className="-mt-1 flex flex-wrap items-center gap-1">
					{price ? <PriceBadge amount={price.monthlyPrice!} currency={price.currency!} t={t} /> : null}
					{node.billing?.expiresAt ? <ExpiryBadge expiresAt={node.billing.expiresAt} nowMs={nowMs} t={t} /> : null}
					{node.tags.length ? (
						<ul className="flex flex-wrap gap-1" aria-label={t("publicStatus.node.tags")}>
							{node.tags.map((tag) => <li key={tag} className="flex"><TagChip tag={tag} /></li>)}
						</ul>
					) : null}
				</div>
			) : null}

			<div className="border-t border-[var(--border-subtle)]" aria-hidden />

			{notice ? <p className="text-xs text-[var(--text-secondary)]">{notice}</p> : null}

			{system ? (
				<p className="flex min-w-0 items-center justify-between gap-3 text-xs">
					<span className="shrink-0 text-[var(--text-muted)]">{t("publicStatus.system.title")}</span>
					<span className="flex min-w-0 items-center gap-1.5 text-[var(--text-primary)]" title={node.system?.cpuModel ?? undefined}>
						{node.system?.os ? <OsMark os={node.system.os} size="sm" /> : null}
						<span className="truncate">{system}</span>
					</span>
				</p>
			) : null}

			{hasMeters ? (
				<div className={cn("grid grid-cols-3 gap-3 sm:grid-cols-1 sm:gap-2.5", node.metricsStale && "opacity-70")}>
					{m.cpu ? (
						<UsageMeter
							label={t("publicStatus.metric.cpu")}
							value={m.cpu.usage}
							detail={m.cpu.cores ? <span className="max-sm:hidden">{t("publicStatus.metric.cores", { count: m.cpu.cores })}</span> : undefined}
						/>
					) : null}
					{m.memory ? (
						<UsageMeter label={t("publicStatus.metric.memory")} value={m.memory.usage} detail={<span className="max-sm:hidden">{usedOfTotal(m.memory.usedBytes, m.memory.totalBytes)}</span>} />
					) : null}
					{m.disk ? (
						<UsageMeter label={t("publicStatus.metric.disk")} value={m.disk.usage} detail={<span className="max-sm:hidden">{usedOfTotal(m.disk.usedBytes, m.disk.totalBytes)}</span>} />
					) : null}
				</div>
			) : null}

			{m.traffic && quota ? (
				<div>
					<UsageMeter
						overflow
						label={t("publicStatus.quota.label")}
						value={quotaPercent}
						detail={`${formatIecBytes(quota.limitBytes)} · ${quotaModeLabel(quota.mode, t)}`}
					/>
					<p className="mt-0.5 text-right font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
						<Volumes rx={m.traffic.periodRxBytes} tx={m.traffic.periodTxBytes} t={t} />
					</p>
				</div>
			) : null}

			<dl className="flex flex-col gap-1.5">
				{m.network ? (
					<Row label={t("publicStatus.metric.rate")}>
						<Rates rx={m.network.rxBytesPerSecond} tx={m.network.txBytesPerSecond} t={t} />
					</Row>
				) : null}
				{m.traffic && !quota ? (
					<Row label={t("publicStatus.metric.monthTraffic")}>
						<Volumes rx={m.traffic.periodRxBytes} tx={m.traffic.periodTxBytes} t={t} />
					</Row>
				) : null}
				{m.uptime ? <Row label={t("publicStatus.metric.uptime")}>{down ? "—" : formatDuration(m.uptime.seconds, locale)}</Row> : null}
				{m.load ? (
					<Row label={t("publicStatus.metric.load")} title={[m.load.load1, m.load.load5, m.load.load15].map((value) => (value === null ? "—" : value.toFixed(2))).join(" / ")}>
						{m.load.load1 === null ? "—" : m.load.load1.toFixed(2)}
					</Row>
				) : null}
				{m.latency ? (
					<Row label={t("publicStatus.metric.tcpLatency")}>
						{m.latency.ok === false ? <span className="text-[var(--danger)]">{t("publicStatus.latency.failed")}</span> : formatLatency(m.latency.ms)}
					</Row>
				) : null}
				{m.connections ? (
					<Row label={t("publicStatus.metric.connections")} title={t("publicStatus.metric.processesTitle", { count: m.connections.processes ?? "—" })}>
						{t("publicStatus.metric.tcpUdp", { tcp: m.connections.tcp ?? "—", udp: m.connections.udp ?? "—" })}
					</Row>
				) : null}
			</dl>

			{node.note ? <p className="whitespace-pre-line text-xs text-[var(--text-secondary)]">{node.note}</p> : null}
			<footer className="mt-auto border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--text-muted)]">
				<NodeFreshness node={node} nowMs={nowMs} locale={locale} t={t} />
			</footer>
			{trendOpen ? <TrendDialog node={node} preview={preview} locale={locale} t={t} onClose={closeTrend} /> : null}
		</article>
	);
}

/* ── Table ──────────────────────────────────────────────────────────────── */

function CellMeter({ value }: { value: number | null | undefined }) {
	return (
		<div className="ml-auto flex w-24 items-center gap-1.5">
			<div className="min-w-0 flex-1"><UsageMeter label="" value={value ?? null} compact /></div>
			<span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums">{formatPercent(value)}</span>
		</div>
	);
}

export function NodeTable({ nodes, nowMs, locale, t, metrics, linkSuffix = "" }: { nodes: PublicNode[]; nowMs: number; locale: Locale; t: T; metrics: string[]; linkSuffix?: string }) {
	const show = (key: string) => metrics.includes(key);
	const showBilling = show("billing") && nodes.some((node) => node.billing?.expiresAt);
	return (
		<div data-card className="relative overflow-x-auto p-0">
			<table className="w-full min-w-[760px] text-left text-sm">
				<caption className="sr-only">{t("publicStatus.table.caption")}</caption>
				<thead className="bg-[var(--surface-subtle)] text-xs text-[var(--text-muted)]">
					<tr>
						<th scope="col" className="px-3 py-2 font-medium">{t("publicStatus.table.node")}</th>
						<th scope="col" className="px-3 py-2 font-medium">{t("publicStatus.table.status")}</th>
						{show("cpu") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.cpu")}</th> : null}
						{show("memory") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.memory")}</th> : null}
						{show("disk") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.disk")}</th> : null}
						{show("network") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.rate")}</th> : null}
						{show("traffic") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.monthTraffic")}</th> : null}
						{show("uptime") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.uptime")}</th> : null}
						{show("latency") ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.metric.tcpLatency")}</th> : null}
						{showBilling ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.billing.expires")}</th> : null}
						<th scope="col" className="px-3 py-2 text-right font-medium">{t("publicStatus.table.sampled")}</th>
					</tr>
				</thead>
				<tbody>
					{nodes.map((node) => {
						const m = node.metrics;
						const quotaPercent = nodeQuotaPercent(node);
						return (
							<tr key={node.id} data-public-node={node.id} data-status={node.status} className="border-t border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-hover)]">
								<th scope="row" className="max-w-[18rem] px-3 py-2 font-medium">
									<span className="flex min-w-0 items-center gap-2">
										{node.countryCode ? <CountryFlag code={node.countryCode} locale={locale} className="text-base" /> : null}
										<Link href={`/status/nodes/${node.id}${linkSuffix}`} className="truncate hover:underline">{node.name}</Link>
									</span>
									<span className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-[var(--text-muted)]">
										{node.system?.os ? <OsMark os={node.system.os} size="sm" /> : null}
										<span className="truncate">{[node.region, node.group, node.system?.arch].filter(Boolean).join(" · ")}</span>
									</span>
								</th>
								<td className="whitespace-nowrap px-3 py-2"><StatusPill status={node.status} t={t} /></td>
								{show("cpu") ? <td className="px-3 py-2"><CellMeter value={m.cpu?.usage} /></td> : null}
								{show("memory") ? <td className="px-3 py-2"><CellMeter value={m.memory?.usage} /></td> : null}
								{show("disk") ? <td className="px-3 py-2"><CellMeter value={m.disk?.usage} /></td> : null}
								{show("network") ? (
									<td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs"><Rates rx={m.network?.rxBytesPerSecond} tx={m.network?.txBytesPerSecond} t={t} stacked /></td>
								) : null}
								{show("traffic") ? (
									<td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
										<Volumes rx={m.traffic?.periodRxBytes} tx={m.traffic?.periodTxBytes} t={t} stacked />
										{quotaPercent !== null ? <span className="block text-[11px] text-[var(--text-muted)]">{t("publicStatus.quota.used", { percent: formatPercent(quotaPercent) })}</span> : null}
									</td>
								) : null}
								{show("uptime") ? (
									<td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">{node.status === "offline" ? "—" : formatDuration(m.uptime?.seconds ?? null, locale)}</td>
								) : null}
								{show("latency") ? (
									<td className="px-3 py-2 text-right font-mono text-xs">{m.latency?.ok === false ? t("publicStatus.latency.failed") : formatLatency(m.latency?.ms)}</td>
								) : null}
								{showBilling ? (
									<td className="whitespace-nowrap px-3 py-2 text-right">{node.billing?.expiresAt ? <ExpiryBadge expiresAt={node.billing.expiresAt} nowMs={nowMs} t={t} /> : "—"}</td>
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

/* ── Summary tiles ──────────────────────────────────────────────────────── */

export const SUMMARY_TILES = ["clock", "online", "regions", "traffic", "throughput"] as const;
export type SummaryTile = (typeof SUMMARY_TILES)[number];

function Tile({ label, icon, children, detail }: { label: string; icon: ReactNode; children: ReactNode; detail?: ReactNode }) {
	return (
		<div data-tile data-summary-tile className="flex min-w-0 flex-1 flex-col p-3">
			<p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
				<span aria-hidden className="text-[var(--board-accent,var(--accent))]">{icon}</span>
				{label}
			</p>
			<div className="mt-1.5 min-w-0 truncate text-base font-semibold text-[var(--text-primary)] sm:text-lg">{children}</div>
			{detail ? <div className="mt-auto truncate pt-0.5 text-[11px] text-[var(--text-muted)]">{detail}</div> : null}
		</div>
	);
}

function TileSettings({ available, hidden, onChange, t }: { available: SummaryTile[]; hidden: ReadonlySet<SummaryTile>; onChange: (next: SummaryTile[]) => void; t: T }) {
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	useDismiss({
		open,
		onDismiss: (reason) => {
			setOpen(false);
			if (reason === "escape") buttonRef.current?.focus();
		},
		refs: [buttonRef, panelRef],
	});
	return (
		<div className="relative">
			<IconButton
				ref={buttonRef}
				label={t("publicStatus.summary.customize")}
				aria-expanded={open}
				aria-haspopup="true"
				className="h-8 w-8"
				onClick={() => setOpen((value) => !value)}
			>
				<Settings size={15} />
			</IconButton>
			{open ? (
				<div ref={panelRef} data-popover className="absolute right-0 top-full z-20 mt-1 w-56 p-3" role="group" aria-label={t("publicStatus.summary.customize")}>
					<p className="mb-2 text-xs text-[var(--text-muted)]">{t("publicStatus.summary.customizeHint")}</p>
					<div className="flex flex-col gap-1.5">
						{available.map((tile) => (
							<CheckboxField
								key={tile}
								label={t(`publicStatus.summary.tile.${tile}`)}
								checked={!hidden.has(tile)}
								onChange={(event) => {
									const next = new Set(hidden);
									if (event.target.checked) next.delete(tile);
									else next.add(tile);
									onChange([...next]);
								}}
							/>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

export function BoardSummary({ summary, metrics, nowMs, refreshedAt, generatedAtMs, locale, t, hidden, onHiddenChange }: {
	summary: PublicBoardSummary;
	metrics: string[];
	nowMs: number;
	refreshedAt: number;
	generatedAtMs: number;
	locale: Locale;
	t: T;
	hidden: ReadonlySet<SummaryTile>;
	onHiddenChange: (next: SummaryTile[]) => void;
}) {
	const others = [
		summary.offline ? t("publicStatus.summary.offlineCount", { count: summary.offline }) : null,
		summary.stale ? t("publicStatus.summary.staleCount", { count: summary.stale }) : null,
		summary.unknown ? t("publicStatus.summary.unknownCount", { count: summary.unknown }) : null,
		summary.maintenance ? t("publicStatus.summary.maintenanceCount", { count: summary.maintenance }) : null,
	].filter(Boolean).join(" · ");
	const countries = summary.countries ?? [];
	const flags = countries.map((country) => countryFlag(country.name)).filter(Boolean);
	const placeCount = countries.length || summary.regions.length;
	const allOnline = summary.total > 0 && summary.online === summary.total;
	const tiles: Array<{ key: SummaryTile; node: ReactNode }> = [
		{
			key: "clock",
			node: (
				<Tile label={t("publicStatus.summary.clock")} icon={<Clock size={13} />}>
					<LiveClock locale={locale} initialMs={generatedAtMs} />
				</Tile>
			),
		},
		{
			key: "online",
			node: (
				<Tile label={t("publicStatus.summary.online")} icon={<Activity size={13} />} detail={others || t("publicStatus.summary.allOnline")}>
					<span className="font-mono tabular-nums" style={allOnline ? { color: "var(--success)" } : undefined}>
						{summary.online} / {summary.total}
					</span>
					<StateStrip
						label={t("publicStatus.summary.stateStrip", { online: summary.online, total: summary.total })}
						parts={[
							{ name: t("publicStatus.status.online"), value: summary.online, color: "var(--success)" },
							{ name: t("publicStatus.status.maintenance"), value: summary.maintenance, color: "var(--info)" },
							{ name: t("publicStatus.status.stale"), value: summary.stale, color: "var(--warning)" },
							{ name: t("publicStatus.status.unknown"), value: summary.unknown, color: "var(--text-muted)" },
							{ name: t("publicStatus.status.offline"), value: summary.offline, color: "var(--danger)" },
						]}
					/>
				</Tile>
			),
		},
		{
			key: "regions",
			node: (
				<Tile
					label={t("publicStatus.summary.regions")}
					icon={<MapPin size={13} />}
					detail={summary.groups.length ? t("publicStatus.summary.groups", { count: summary.groups.length }) : undefined}
				>
					<span className="font-mono tabular-nums">{placeCount}</span>
					{flags.length ? (
						<span
							className="ml-2 text-base font-normal tracking-wider"
							title={countries.map((country) => `${countryName(country.name, locale)} ${country.online}/${country.total}`).join("\n")}
						>
							{flags.slice(0, 8).join("")}
							{flags.length > 8 ? <span className="ml-1 text-xs text-[var(--text-muted)]">+{flags.length - 8}</span> : null}
						</span>
					) : null}
				</Tile>
			),
		},
		...(metrics.includes("traffic")
			? [{
					key: "traffic" as const,
					node: (
						<Tile label={t("publicStatus.summary.monthTraffic")} icon={<ArrowDownUp size={13} />}>
							<span className="font-mono text-sm tabular-nums sm:text-base">
								<Volumes rx={summary.periodRxBytes} tx={summary.periodTxBytes} t={t} stacked />
							</span>
						</Tile>
					),
				}]
			: []),
		...(metrics.includes("network")
			? [{
					key: "throughput" as const,
					node: (
						<Tile label={t("publicStatus.summary.throughput")} icon={<Zap size={13} />} detail={t("publicStatus.summary.rateNodes", { count: summary.rateNodes })}>
							<span className="font-mono text-sm tabular-nums sm:text-base">
								<Rates rx={summary.rxBytesPerSecond} tx={summary.txBytesPerSecond} t={t} stacked />
							</span>
						</Tile>
					),
				}]
			: []),
	];
	const visible = tiles.filter((tile) => !hidden.has(tile.key));
	return (
		<section aria-label={t("publicStatus.summary.label")} className="flex flex-col gap-2">
			{visible.length ? (
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
					{visible.map((tile) => (
						<div key={tile.key} className={cn("flex min-w-0", tile.key === "clock" && visible.length % 2 === 1 && "col-span-2 sm:col-span-1")}>
							{tile.node}
						</div>
					))}
				</div>
			) : null}
			<div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[var(--text-muted)]">
				<p className="flex flex-wrap gap-x-3 gap-y-0.5">
					<span>{t("publicStatus.summary.lastSample")}: {summary.lastSampleAt ? formatAge(summary.lastSampleAt, nowMs, locale) : "—"}</span>
					<span>{t("publicStatus.summary.pageRefreshed", { age: formatAge(new Date(refreshedAt).toISOString(), nowMs, locale) })}</span>
				</p>
				<TileSettings available={tiles.map((tile) => tile.key)} hidden={hidden} onChange={onHiddenChange} t={t} />
			</div>
		</section>
	);
}
