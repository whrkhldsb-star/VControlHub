"use client";

/**
 * Public node detail: current numbers, availability, history charts and the
 * 90-day strip. Polls only `/api/status/nodes/<id>` and its `/history`.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { SegmentedControl } from "@/components/ui-primitives";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { api, ApiError } from "@/lib/http/api-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatAge, formatDuration, formatIecBytes, formatIecRate, formatLatency, formatPercent } from "@/lib/public-status/format";
import { HISTORY_RANGES, parseHistoryRange } from "@/lib/public-status/query";
import type { PublicAvailabilityWindow, PublicHistoryResponse, PublicNodeDetailResponse, PublicUptimeDay } from "@/lib/public-status/types";
import { getUptimeColorClass, MIN_SAMPLE_COVERAGE } from "../../uptime-presentation";
import { NodeFreshness, StatusPill, accentStyle } from "../../public-board-parts";
import { TimeSeriesChart, type ChartSeries } from "../../time-series-chart";
import { usePublicPolling } from "../../use-public-polling";

type T = (key: string, vars?: Record<string, string | number>) => string;

class GoneError extends Error {}

async function getJson<R>(url: string, signal: AbortSignal): Promise<R> {
	try {
		return await api.get<R>(url, { signal, cache: "no-store" });
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) throw new GoneError("gone");
		throw error;
	}
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
	return (
		<div data-card className="min-w-0 p-3">
			<p className="text-xs text-[var(--text-muted)]">{label}</p>
			<p className="mt-1 truncate font-mono text-lg font-semibold">{value}</p>
			{detail ? <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{detail}</p> : null}
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

export function PublicNodeClient({ initial, preview, signedIn }: { initial: PublicNodeDetailResponse; preview: boolean; signedIn: boolean }) {
	const { t, locale } = useI18n();
	const id = initial.node.id;
	const suffix = preview ? "preview=1" : "";
	const { state: urlState, setField } = useUrlQueryState({ range: "24h" });
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
			const options: Intl.DateTimeFormatOptions = range === "7d"
				? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }
				: { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" };
			return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", options).format(time);
		},
		[locale, range],
	);

	const charts = useMemo(() => {
		if (!history) return null;
		const resources: ChartSeries[] = [];
		const toPoints = (key: "cpu" | "memory" | "disk") =>
			(history.resources ?? []).map((p) => ({ t: Date.parse(p.t), v: p[key] ?? null }));
		if (history.resources && metrics.includes("cpu")) resources.push({ key: "cpu", label: t("publicStatus.metric.cpu"), color: "var(--board-accent)", points: toPoints("cpu") });
		if (history.resources && metrics.includes("memory")) resources.push({ key: "memory", label: t("publicStatus.metric.memory"), color: "var(--success)", points: toPoints("memory") });
		if (history.resources && metrics.includes("disk")) resources.push({ key: "disk", label: t("publicStatus.metric.disk"), color: "var(--purple)", points: toPoints("disk") });
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
		return { resources, network, latencySeries, failures, from: Date.parse(history.from), to: Date.parse(history.to) };
	}, [history, metrics, t]);

	const title = node.name;
	const backHref = preview ? "/status?preview=1" : "/status";

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
				<div className="min-w-0">
					<h1 className="ui-title-page truncate">{title}</h1>
					<p className="mt-1 text-sm text-[var(--text-muted)]">{[node.region, node.group].filter(Boolean).join(" · ")}</p>
					{node.tags.length ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{node.tags.join(" · ")}</p> : null}
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
				{m.cpu ? <Tile label={t("publicStatus.metric.cpu")} value={formatPercent(m.cpu.usage)} detail={m.cpu.cores ? t("publicStatus.metric.cores", { count: m.cpu.cores }) : undefined} /> : null}
				{m.memory ? (
					<Tile
						label={t("publicStatus.metric.memory")}
						value={formatPercent(m.memory.usage)}
						detail={`${formatIecBytes(m.memory.usedBytes)} / ${formatIecBytes(m.memory.totalBytes)}${m.memory.swapUsage !== null ? ` · ${t("publicStatus.metric.swap", { value: formatPercent(m.memory.swapUsage) })}` : ""}`}
					/>
				) : null}
				{m.disk ? <Tile label={t("publicStatus.metric.disk")} value={formatPercent(m.disk.usage)} detail={`${formatIecBytes(m.disk.usedBytes)} / ${formatIecBytes(m.disk.totalBytes)} · ${t("publicStatus.metric.approx")}`} /> : null}
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
				{m.traffic ? (
					<Tile
						label={t("publicStatus.metric.monthTraffic")}
						value={`↓ ${formatIecBytes(m.traffic.periodRxBytes)}`}
						detail={`↑ ${formatIecBytes(m.traffic.periodTxBytes)}${m.traffic.countedSince ? ` · ${t("publicStatus.metric.countedSince", { date: new Date(m.traffic.countedSince).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-GB", { timeZone: "Asia/Shanghai" }) })}` : ""}`}
					/>
				) : null}
				{m.uptime ? <Tile label={t("publicStatus.metric.uptime")} value={formatDuration(m.uptime.seconds, locale)} /> : null}
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
					<p className="text-xs text-[var(--text-muted)]">
						{t("publicStatus.history.meta", {
							bucket: Math.round(history.bucketSeconds / 60),
							coverage: history.coveragePercent,
							samples: history.samples,
						})}
						{history.sampleIntervalSeconds ? ` · ${t("publicStatus.history.interval", { minutes: Math.round(history.sampleIntervalSeconds / 6) / 10 })}` : ""}
						{history.coveragePercent < MIN_SAMPLE_COVERAGE * 100 ? ` · ${t("publicStatus.availability.insufficient")}` : ""}
					</p>
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
							<div data-card className="p-3">
								<h3 className="ui-title-group mb-2">{t("publicStatus.history.resources")}</h3>
								<TimeSeriesChart
									ariaLabel={t("publicStatus.history.resources")}
									from={charts.from}
									to={charts.to}
									series={charts.resources}
									yMax={100}
									formatY={(v) => `${Math.round(v)}%`}
									formatX={formatTime}
									emptyLabel={t("publicStatus.history.empty")}
									tableLabel={t("publicStatus.history.table")}
									timeLabel={t("publicStatus.history.time")}
								/>
							</div>
						) : null}
						{history?.network ? (
							<div data-card className="p-3">
								<h3 className="ui-title-group mb-2">{t("publicStatus.history.network")}</h3>
								<TimeSeriesChart
									ariaLabel={t("publicStatus.history.network")}
									from={charts.from}
									to={charts.to}
									series={charts.network}
									formatY={(v) => formatIecRate(v)}
									formatX={formatTime}
									emptyLabel={t("publicStatus.history.empty")}
									tableLabel={t("publicStatus.history.table")}
									timeLabel={t("publicStatus.history.time")}
								/>
							</div>
						) : null}
						{history?.latency ? (
							<div data-card className="p-3">
								<h3 className="ui-title-group">{t("publicStatus.history.latency")}</h3>
								<p className="mb-2 text-xs text-[var(--text-muted)]">
									{history.latency.measured
										? t("publicStatus.history.latencyStats", { probes: history.latency.probes, failed: history.latency.failed })
										: t("publicStatus.history.latencyNotMeasured")}
								</p>
								<TimeSeriesChart
									ariaLabel={t("publicStatus.history.latency")}
									from={charts.from}
									to={charts.to}
									series={charts.latencySeries}
									markers={charts.failures}
									markerLabel={t("publicStatus.latency.failedMarker")}
									formatY={(v) => formatLatency(v)}
									formatX={formatTime}
									emptyLabel={history.latency.measured ? t("publicStatus.history.empty") : t("publicStatus.history.latencyNotMeasured")}
									tableLabel={t("publicStatus.history.table")}
									timeLabel={t("publicStatus.history.time")}
									height={150}
								/>
							</div>
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
