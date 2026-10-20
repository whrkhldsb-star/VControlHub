"use client";

/**
 * Public node detail in Komari's layout: what the node is (basic-info grid),
 * current numbers with colour-graded meters, availability, history charts
 * and the 90-day strip. Polls only `/api/status/nodes/<id>` and its `/history`.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ActionButton } from "@/components/action-button";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { SegmentedControl } from "@/components/ui-primitives";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { api, ApiError } from "@/lib/http/api-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatAge, formatDuration, formatIecBytes, formatIecRate, formatLatency, formatPercent } from "@/lib/public-status/format";
import { HISTORY_RANGES, parseHistoryRange } from "@/lib/public-status/query";
import type { PublicAvailabilityWindow, PublicHistoryRange, PublicHistoryResponse, PublicNode, PublicNodeDetailResponse, PublicUptimeDay } from "@/lib/public-status/types";
import { CountryFlag, ExpiryBadge, OsMark, PriceBadge, TagChip, UsageMeter } from "../../board-visuals";
import { nodeQuotaPercent, quotaModeLabel, systemLine } from "../../board-nodes";
import { getUptimeColorClass, MIN_SAMPLE_COVERAGE } from "../../uptime-presentation";
import { NodeFreshness, StatusPill, accentStyle } from "../../public-board-parts";
import { TimeSeriesChart, type ChartSeries } from "../../time-series-chart";
import { usePublicPolling } from "../../use-public-polling";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Locale = "zh" | "en";

class GoneError extends Error {}

async function getJson<R>(url: string, signal: AbortSignal): Promise<R> {
	try {
		return await api.get<R>(url, { signal, cache: "no-store" });
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) throw new GoneError("gone");
		throw error;
	}
}

function Tile({ label, value, detail, children }: { label: string; value?: string; detail?: string; children?: ReactNode }) {
	return (
		<div data-tile className="flex min-w-0 flex-col p-3">
			<p className="text-xs text-[var(--text-muted)]">{label}</p>
			{value !== undefined ? <p className="mt-1 truncate font-mono text-lg font-semibold tabular-nums">{value}</p> : null}
			{children}
			{detail ? <p className="mt-auto pt-0.5 text-[11px] text-[var(--text-muted)]">{detail}</p> : null}
		</div>
	);
}

function MeterTile({ label, value, detail }: { label: string; value: number | null; detail?: string }) {
	return (
		<div data-tile className="flex min-w-0 flex-col gap-2 p-3">
			<div className="flex items-baseline justify-between gap-2">
				<p className="text-xs text-[var(--text-muted)]">{label}</p>
				<p className="font-mono text-lg font-semibold tabular-nums">{formatPercent(value)}</p>
			</div>
			<UsageMeter label="" value={value} />
			{detail ? <p className="truncate font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{detail}</p> : null}
		</div>
	);
}

function AvailabilityTile({ label, window, t }: { label: string; window: PublicAvailabilityWindow; t: T }) {
	return (
		<Tile
			label={label}
			value={window.percent === null ? "—" : `${window.percent}%`}
			detail={
				window.percent === null
					? t("publicStatus.availability.noSamples")
					: `${t("publicStatus.availability.coverage", { coverage: window.coveragePercent })}${window.sufficient ? "" : ` · ${t("publicStatus.availability.insufficient")}`}`
			}
		/>
	);
}

function UptimeStrip({ days, t }: { days: PublicUptimeDay[]; t: T }) {
	return (
		<ol className="flex flex-wrap gap-1" aria-label={t("publicStatus.uptime90.label")}>
			{days.map((day) => {
				const sampled = day.checkCount > 0 && day.uptimePercent !== null;
				const coverage = Math.min(1, day.coveredMinutes / Math.max(1, day.expectedMinutes));
				const sufficient = sampled && coverage >= MIN_SAMPLE_COVERAGE;
				const label = sampled
					? t("publicStatus.uptime90.day", { date: day.date, percent: day.uptimePercent ?? 0, coverage: Math.round(coverage * 100) }) +
						(sufficient ? "" : ` · ${t("publicStatus.availability.insufficient")}`)
					: t("publicStatus.uptime90.noSample", { date: day.date });
				return (
					<li key={day.date} title={label} aria-label={label} className={`h-4 w-4 rounded ${getUptimeColorClass(day.uptimePercent ?? 0, sampled, sufficient)}`} />
				);
			})}
		</ol>
	);
}

/** What the node is, as Komari's details grid: only the facts that are known. */
function BasicInfo({ node, nowMs, locale, t }: { node: PublicNode; nowMs: number; locale: Locale; t: T }) {
	const m = node.metrics;
	const system = node.system;
	const quota = m.traffic?.quota ?? null;
	const items: Array<{ key: string; label: string; value: ReactNode; title?: string }> = [];
	if (system?.os) {
		items.push({
			key: "os",
			label: t("publicStatus.system.os"),
			value: (
				<span className="flex min-w-0 items-center gap-1.5">
					<OsMark os={system.os} size="sm" />
					<span className="truncate">{system.os}</span>
				</span>
			),
			title: system.os,
		});
	}
	if (system?.arch) items.push({ key: "arch", label: t("publicStatus.system.arch"), value: system.arch });
	if (system?.virtualization) {
		items.push({ key: "virt", label: t("publicStatus.system.virtualization"), value: system.virtualization === "none" ? t("publicStatus.system.bareMetal") : system.virtualization.toUpperCase() });
	}
	if (system?.kernel) items.push({ key: "kernel", label: t("publicStatus.system.kernel"), value: system.kernel, title: system.kernel });
	if (system?.cpuModel || m.cpu?.cores) {
		const cores = m.cpu?.cores ? t("publicStatus.metric.cores", { count: m.cpu.cores }) : null;
		const cpu = [system?.cpuModel, cores].filter(Boolean).join(" · ");
		items.push({ key: "cpu", label: t("publicStatus.system.cpu"), value: cpu, title: cpu });
	}
	if (m.memory?.totalBytes) items.push({ key: "mem", label: t("publicStatus.system.memoryTotal"), value: formatIecBytes(m.memory.totalBytes) });
	if (m.memory && m.memory.swapUsage !== null) items.push({ key: "swap", label: t("publicStatus.system.swap"), value: formatPercent(m.memory.swapUsage) });
	if (m.disk?.totalBytes) items.push({ key: "disk", label: t("publicStatus.system.diskTotal"), value: formatIecBytes(m.disk.totalBytes) });
	if (m.uptime) items.push({ key: "uptime", label: t("publicStatus.metric.uptime"), value: node.status === "offline" ? "—" : formatDuration(m.uptime.seconds, locale) });
	if (m.connections?.processes !== null && m.connections?.processes !== undefined) {
		items.push({ key: "procs", label: t("publicStatus.system.processes"), value: String(m.connections.processes) });
	}
	if (m.connections) {
		items.push({ key: "conns", label: t("publicStatus.metric.connections"), value: t("publicStatus.metric.tcpUdp", { tcp: m.connections.tcp ?? "—", udp: m.connections.udp ?? "—" }) });
	}
	if (quota) items.push({ key: "quota", label: t("publicStatus.quota.label"), value: `${formatIecBytes(quota.limitBytes)} · ${quotaModeLabel(quota.mode, t)}` });
	if (node.billing?.expiresAt) {
		items.push({
			key: "expires",
			label: t("publicStatus.billing.expires"),
			value: new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).format(Date.parse(node.billing.expiresAt)),
		});
	}
	items.push({ key: "updated", label: t("publicStatus.system.updated"), value: node.metricsAt ? formatAge(node.metricsAt, nowMs, locale) : t("publicStatus.node.neverSampled"), title: node.metricsAt ?? undefined });
	// Only the update time: nothing beyond the freshness line above.
	if (items.length <= 1) return null;
	return (
		<section data-card aria-labelledby="basic-info-title" className="flex flex-col gap-3">
			<h2 id="basic-info-title" className="ui-title-section">{t("publicStatus.system.basicInfo")}</h2>
			<dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
				{items.map((item) => (
					<div key={item.key} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] pb-2 sm:block sm:border-0 sm:pb-0">
						<dt className="shrink-0 text-xs text-[var(--text-muted)]">{item.label}</dt>
						<dd className="min-w-0 truncate text-right text-sm text-[var(--text-primary)] sm:mt-0.5 sm:text-left" title={item.title}>{item.value}</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

function ChartCard({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
	return (
		<div data-card className="p-3">
			<h3 className="ui-title-group">{title}</h3>
			{note ? <p className="text-xs text-[var(--text-muted)]">{note}</p> : null}
			<div className="mt-2">{children}</div>
		</div>
	);
}

export function PublicNodeClient({ initial, initialRange, preview, signedIn }: { initial: PublicNodeDetailResponse; initialRange: PublicHistoryRange; preview: boolean; signedIn: boolean }) {
	const { t, locale } = useI18n();
	const id = initial.node.id;
	const suffix = preview ? "preview=1" : "";
	const { state: urlState, setField } = useUrlQueryState({ range: "24h" }, { range: initialRange });
	const range = parseHistoryRange(urlState.range);
	const [nowMs, setNowMs] = useState(() => Date.parse(initial.generatedAt));
	useEffect(() => {
		const timer = setInterval(() => setNowMs(Date.now()), 5_000);
		return () => clearInterval(timer);
	}, []);

	const detailFetcher = useCallback(
		(signal: AbortSignal) => getJson<PublicNodeDetailResponse>(`/api/status/nodes/${id}${suffix ? `?${suffix}` : ""}`, signal),
		[id, suffix],
	);
	const detailPoll = usePublicPolling({ initial, key: id, intervalMs: initial.site.refreshSeconds * 1000, fetcher: detailFetcher, initialFresh: true });

	const historyFetcher = useCallback(
		(signal: AbortSignal) => getJson<PublicHistoryResponse>(`/api/status/nodes/${id}/history?range=${range}${suffix ? `&${suffix}` : ""}`, signal),
		[id, range, suffix],
	);
	const historyPoll = usePublicPolling<PublicHistoryResponse | null>({
		initial: null,
		key: `${id}:${range}`,
		intervalMs: Math.max(60, initial.site.refreshSeconds) * 1000,
		fetcher: historyFetcher,
	});

	const detail = detailPoll.data;
	const node = detail.node;
	const m = node.metrics;
	const metrics = detail.site.metrics;
	const history = historyPoll.data?.range === range ? historyPoll.data : null;
	const gone = detailPoll.error === "gone";

	const formatTime = useCallback(
		(time: number) => {
			const options: Intl.DateTimeFormatOptions = range === "30d"
				? { month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }
				: range === "7d"
					? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }
					: { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" };
			return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", options).format(time);
		},
		[locale, range],
	);

	const charts = useMemo(() => {
		if (!history) return null;
		const points = history.resources ?? [];
		const series = (key: "cpu" | "memory" | "disk" | "load" | "processes" | "tcp" | "udp") => points.map((p) => ({ t: Date.parse(p.t), v: p[key] ?? null }));
		const has = (key: "load" | "processes" | "tcp" | "udp") => points.some((p) => p[key] !== undefined && p[key] !== null);
		const resources: ChartSeries[] = [];
		if (history.resources && metrics.includes("cpu")) resources.push({ key: "cpu", label: t("publicStatus.metric.cpu"), color: "var(--board-accent)", points: series("cpu") });
		if (history.resources && metrics.includes("memory")) resources.push({ key: "memory", label: t("publicStatus.metric.memory"), color: "var(--success)", points: series("memory") });
		if (history.resources && metrics.includes("disk")) resources.push({ key: "disk", label: t("publicStatus.metric.disk"), color: "var(--purple)", points: series("disk") });
		const load: ChartSeries[] = has("load") ? [{ key: "load", label: t("publicStatus.metric.load"), color: "var(--chart-4)", points: series("load") }] : [];
		const connections: ChartSeries[] = has("tcp") || has("udp")
			? [
					{ key: "tcp", label: "TCP", color: "var(--chart-1)", points: series("tcp") },
					{ key: "udp", label: "UDP", color: "var(--chart-5)", points: series("udp") },
				]
			: [];
		const processes: ChartSeries[] = has("processes") ? [{ key: "processes", label: t("publicStatus.system.processes"), color: "var(--chart-6)", points: series("processes") }] : [];
		const network: ChartSeries[] = history.network
			? [
					{ key: "rx", label: t("publicStatus.metric.download"), color: "var(--info)", points: history.network.map((p) => ({ t: Date.parse(p.t), v: p.rx })) },
					{ key: "tx", label: t("publicStatus.metric.upload"), color: "var(--warning)", points: history.network.map((p) => ({ t: Date.parse(p.t), v: p.tx })) },
				]
			: [];
		const latencySeries: ChartSeries[] = history.latency
			? [{ key: "rtt", label: t("publicStatus.latency.avg"), color: "var(--board-accent)", points: history.latency.points.map((p) => ({ t: Date.parse(p.t), v: p.avg })) }]
			: [];
		const failures = history.latency
			? history.latency.points.filter((p) => p.failed > 0).map((p) => ({ t: Date.parse(p.t), label: t("publicStatus.latency.failedCount", { count: p.failed }) }))
			: [];
		return { resources, load, connections, processes, network, latencySeries, failures, from: Date.parse(history.from), to: Date.parse(history.to) };
	}, [history, metrics, t]);

	const backHref = preview ? "/status?preview=1" : "/status";
	const quota = m.traffic?.quota ?? null;
	const quotaPercent = nodeQuotaPercent(node);
	const system = systemLine(node, t);
	const price = node.billing?.monthlyPrice !== null && node.billing?.monthlyPrice !== undefined && node.billing.currency ? node.billing : null;
	const chartProps = { emptyLabel: t("publicStatus.history.empty"), tableLabel: t("publicStatus.history.table"), timeLabel: t("publicStatus.history.time"), formatX: formatTime };

	return (
		<div style={accentStyle(detail.site.accent)} className="flex flex-col gap-5" data-public-node-detail={node.id}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Link href={backHref} className="text-sm text-[var(--board-accent)] hover:underline">← {t("publicStatus.back")}</Link>
				<div className="flex items-center gap-2">
					<LanguageToggle compact />
					<ThemeToggle compact />
					{signedIn ? null : <Link href="/login?next=%2F" className="text-sm text-[var(--text-secondary)] hover:underline">{t("publicStatus.signIn")}</Link>}
				</div>
			</div>
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 items-start gap-3">
					{node.countryCode ? <CountryFlag code={node.countryCode} locale={locale} className="text-4xl" /> : null}
					<div className="min-w-0">
						<h1 className="ui-title-page truncate">{node.name}</h1>
						<p className="mt-1 text-sm text-[var(--text-muted)]">
							{[node.region, node.group, system].filter(Boolean).join(" · ")}
						</p>
						{price || node.billing?.expiresAt || node.tags.length ? (
							<div className="mt-2 flex flex-wrap items-center gap-1">
								{price ? <PriceBadge amount={price.monthlyPrice!} currency={price.currency!} t={t} /> : null}
								{node.billing?.expiresAt ? <ExpiryBadge expiresAt={node.billing.expiresAt} nowMs={nowMs} t={t} /> : null}
								{node.tags.length ? (
									<ul className="flex flex-wrap gap-1" aria-label={t("publicStatus.node.tags")}>
										{node.tags.map((tag) => <li key={tag} className="flex"><TagChip tag={tag} /></li>)}
									</ul>
								) : null}
							</div>
						) : null}
					</div>
				</div>
				<StatusPill status={node.status} t={t} />
			</header>
			{node.note ? <p className="whitespace-pre-line text-sm text-[var(--text-secondary)]">{node.note}</p> : null}
			{gone ? (
				<p role="alert" className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">{t("publicStatus.nodeGone")}</p>
			) : detailPoll.error ? (
				<div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">
					<span>{t("publicStatus.refreshFailed", { age: formatAge(new Date(detailPoll.refreshedAt).toISOString(), nowMs, locale) })}</span>
					<ActionButton size="xs" variant="outline" onClick={detailPoll.refresh}>{t("publicStatus.retry")}</ActionButton>
				</div>
			) : null}
			<p className="text-xs text-[var(--text-muted)]">
				<NodeFreshness node={node} nowMs={nowMs} locale={locale} t={t} />
				{node.reportIntervalSeconds ? ` · ${t("publicStatus.node.interval", { seconds: node.reportIntervalSeconds })}` : ""}
				{` · ${t("publicStatus.summary.pageRefreshed", { age: formatAge(new Date(detailPoll.refreshedAt).toISOString(), nowMs, locale) })}`}
			</p>

			<section aria-label={t("publicStatus.detail.current")} className="grid grid-cols-2 gap-2 md:grid-cols-4">
				{m.cpu ? <MeterTile label={t("publicStatus.metric.cpu")} value={m.cpu.usage} detail={m.cpu.cores ? t("publicStatus.metric.cores", { count: m.cpu.cores }) : undefined} /> : null}
				{m.memory ? (
					<MeterTile
						label={t("publicStatus.metric.memory")}
						value={m.memory.usage}
						detail={`${formatIecBytes(m.memory.usedBytes)} / ${formatIecBytes(m.memory.totalBytes)}${m.memory.swapUsage !== null ? ` · ${t("publicStatus.metric.swap", { value: formatPercent(m.memory.swapUsage) })}` : ""}`}
					/>
				) : null}
				{m.disk ? <MeterTile label={t("publicStatus.metric.disk")} value={m.disk.usage} detail={`${formatIecBytes(m.disk.usedBytes)} / ${formatIecBytes(m.disk.totalBytes)} · ${t("publicStatus.metric.approx")}`} /> : null}
				{m.traffic && quota ? (
					<MeterTile
						label={t("publicStatus.quota.label")}
						value={quotaPercent === null ? null : Math.min(100, quotaPercent)}
						detail={`↓ ${formatIecBytes(m.traffic.periodRxBytes)} ↑ ${formatIecBytes(m.traffic.periodTxBytes)} / ${formatIecBytes(quota.limitBytes)}`}
					/>
				) : null}
				{m.load ? (
					<Tile label={t("publicStatus.metric.load")} value={m.load.load1 === null ? "—" : m.load.load1.toFixed(2)} detail={`${m.load.load5?.toFixed(2) ?? "—"} · ${m.load.load15?.toFixed(2) ?? "—"}`} />
				) : null}
				{m.network ? (
					<Tile
						label={t("publicStatus.metric.rate")}
						value={`↓ ${formatIecRate(m.network.rxBytesPerSecond)}`}
						detail={`↑ ${formatIecRate(m.network.txBytesPerSecond)}${m.network.rateWindowSeconds ? ` · ${t("publicStatus.metric.rateWindow", { seconds: m.network.rateWindowSeconds })}` : ""}`}
					/>
				) : null}
				{m.traffic && !quota ? (
					<Tile
						label={t("publicStatus.metric.monthTraffic")}
						value={`↓ ${formatIecBytes(m.traffic.periodRxBytes)}`}
						detail={`↑ ${formatIecBytes(m.traffic.periodTxBytes)}${m.traffic.countedSince ? ` · ${t("publicStatus.metric.countedSince", { date: new Date(m.traffic.countedSince).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-GB", { timeZone: "Asia/Shanghai" }) })}` : ""}`}
					/>
				) : null}
				{m.uptime ? <Tile label={t("publicStatus.metric.uptime")} value={node.status === "offline" ? "—" : formatDuration(m.uptime.seconds, locale)} /> : null}
				{m.latency ? (
					<Tile
						label={t("publicStatus.metric.tcpLatency")}
						value={m.latency.ok === false ? t("publicStatus.latency.failed") : formatLatency(m.latency.ms)}
						detail={t("publicStatus.latency.hint")}
					/>
				) : null}
				{detail.availability ? (
					<>
						<AvailabilityTile label={t("publicStatus.availability.24h")} window={detail.availability.last24h} t={t} />
						<AvailabilityTile label={t("publicStatus.availability.7d")} window={detail.availability.last7d} t={t} />
					</>
				) : null}
			</section>

			<BasicInfo node={node} nowMs={nowMs} locale={locale} t={t} />

			<section aria-labelledby="history-title" className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 id="history-title" className="ui-title-section">{t("publicStatus.history.title")}</h2>
					<SegmentedControl
						ariaLabel={t("publicStatus.history.range")}
						value={range}
						onChange={(value) => setField("range", value)}
						size="sm"
						options={HISTORY_RANGES.map((value) => ({ value, label: t(`publicStatus.range.${value}`) }))}
					/>
				</div>
				{history ? (
					<>
						<p className="text-xs text-[var(--text-muted)]">
							{t("publicStatus.history.meta", {
								bucket: Math.round(history.bucketSeconds / 60),
								coverage: history.coveragePercent,
								samples: history.samples,
							})}
							{history.sampleIntervalSeconds ? ` · ${t("publicStatus.history.interval", { minutes: Math.round(history.sampleIntervalSeconds / 6) / 10 })}` : ""}
							{history.coveragePercent < MIN_SAMPLE_COVERAGE * 100 ? ` · ${t("publicStatus.availability.insufficient")}` : ""}
						</p>
						{/* A later refresh that failed: the charts below are the last
						    good ones, which must not pass for current. */}
						{historyPoll.error ? (
							<div role="alert" className="flex items-center gap-2 text-sm text-[var(--warning)]">
								{t("publicStatus.history.refreshFailed")}
								<ActionButton size="xs" variant="outline" onClick={historyPoll.refresh}>{t("publicStatus.retry")}</ActionButton>
							</div>
						) : null}
					</>
				) : historyPoll.error ? (
					<div role="alert" className="flex items-center gap-2 text-sm text-[var(--warning)]">
						{t("publicStatus.history.failed")}
						<ActionButton size="xs" variant="outline" onClick={historyPoll.refresh}>{t("publicStatus.retry")}</ActionButton>
					</div>
				) : (
					<p className="text-xs text-[var(--text-muted)]" role="status">{t("publicStatus.history.loading")}</p>
				)}
				{charts ? (
					<div className="grid gap-4 lg:grid-cols-2">
						{charts.resources.length ? (
							<ChartCard title={t("publicStatus.history.resources")}>
								<TimeSeriesChart ariaLabel={t("publicStatus.history.resources")} from={charts.from} to={charts.to} series={charts.resources} yMax={100} formatY={(v) => `${Math.round(v)}%`} {...chartProps} />
							</ChartCard>
						) : null}
						{history?.network ? (
							<ChartCard title={t("publicStatus.history.network")}>
								<TimeSeriesChart ariaLabel={t("publicStatus.history.network")} from={charts.from} to={charts.to} series={charts.network} formatY={(v) => formatIecRate(v)} {...chartProps} />
							</ChartCard>
						) : null}
						{history?.latency ? (
							<ChartCard
								title={t("publicStatus.history.latency")}
								note={history.latency.measured
									? t("publicStatus.history.latencyStats", { probes: history.latency.probes, failed: history.latency.failed })
									: t("publicStatus.history.latencyNotMeasured")}
							>
								<TimeSeriesChart
									ariaLabel={t("publicStatus.history.latency")}
									from={charts.from}
									to={charts.to}
									series={charts.latencySeries}
									markers={charts.failures}
									markerLabel={t("publicStatus.latency.failedMarker")}
									formatY={(v) => formatLatency(v)}
									{...chartProps}
									emptyLabel={history.latency.measured ? t("publicStatus.history.empty") : t("publicStatus.history.latencyNotMeasured")}
									height={150}
								/>
							</ChartCard>
						) : null}
						{charts.load.length ? (
							<ChartCard title={t("publicStatus.history.load")}>
								<TimeSeriesChart ariaLabel={t("publicStatus.history.load")} from={charts.from} to={charts.to} series={charts.load} formatY={(v) => v.toFixed(2)} height={150} {...chartProps} />
							</ChartCard>
						) : null}
						{charts.connections.length ? (
							<ChartCard title={t("publicStatus.history.connections")}>
								<TimeSeriesChart ariaLabel={t("publicStatus.history.connections")} from={charts.from} to={charts.to} series={charts.connections} formatY={(v) => String(Math.round(v))} height={150} {...chartProps} />
							</ChartCard>
						) : null}
						{charts.processes.length ? (
							<ChartCard title={t("publicStatus.history.processes")}>
								<TimeSeriesChart ariaLabel={t("publicStatus.history.processes")} from={charts.from} to={charts.to} series={charts.processes} formatY={(v) => String(Math.round(v))} height={150} {...chartProps} />
							</ChartCard>
						) : null}
					</div>
				) : null}
			</section>

			{detail.uptimeDays ? (
				<section aria-labelledby="uptime-title" className="flex flex-col gap-2">
					<h2 id="uptime-title" className="ui-title-section">{t("publicStatus.uptime90.title")}</h2>
					<p className="text-xs text-[var(--text-muted)]">{t("publicStatus.uptime90.desc")}</p>
					<UptimeStrip days={detail.uptimeDays} t={t} />
				</section>
			) : null}
		</div>
	);
}
