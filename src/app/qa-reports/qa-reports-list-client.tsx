"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState, ToggleChip, StatCard, StatGrid, ListPanel, SurfacePanel } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type { Locale } from "@/lib/i18n/translations";
import type {
	QaReportTrendCard,
	QaReportTrendRecentRun,
	QaReportTrends,
	QaReportsListResult,
	QaReportSummary,
} from "@/lib/qa-reports/dto";

type KindFilter = "all" | "slice" | "blocker" | "qa_run";

function kindLabel(t: (key: string) => string, kind: Exclude<KindFilter, "all">): string {
	if (kind === "qa_run") return t("qaReportsPage.kind.qaRun");
	if (kind === "slice") return t("qaReportsPage.kind.slice");
	return t("qaReportsPage.kind.blocker");
}

const toneToCardClass: Record<QaReportTrendCard["tone"], string> = {
	success: "border-[var(--success-border)] text-[var(--success)]",
	warn: "border-[var(--warning-border)] text-[var(--warning)]",
	neutral: "border-[var(--border)] text-[var(--text-secondary)]",
	info: "border-[var(--color-action-border)]/30 text-[var(--text-secondary)]",
};

const toneToValueClass: Record<QaReportTrendCard["tone"], string> = {
	success: "text-[var(--success)]",
	warn: "text-[var(--warning)]",
	neutral: "text-[var(--text-secondary)]",
	info: "text-[var(--text-primary)]",
};

const MAX_DAILY_BAR_HEIGHT = 56; // px, the tallest possible bar in the mini chart
const MAX_RECENT_RUNS = 5;

function formatTime(iso: string, locale?: Locale): string {
	const ts = Date.parse(iso);
	if (Number.isNaN(ts)) return iso;
	return new Date(ts).toLocaleString(toDateLocale(locale ?? "zh"), { hour12: false });
}

function formatDayShort(day: string): string {
	// `YYYY-MM-DD` → `MM-DD` for compact display
	return day.length >= 10 ? day.slice(5) : day;
}

function statusToneClass(status: string): string {
	const lower = status.toLowerCase();
	if (lower.includes("fail") || lower.includes("error")) return "text-[var(--danger)] border-[var(--danger-border)]";
	if (lower.includes("run") || lower.includes("deploy")) return "text-[var(--color-action)] border-[var(--color-action-border)]/30";
	if (lower.includes("complete") || lower.includes("resolved")) return "text-[var(--success)] border-[var(--success-border)]";
	return "text-[var(--text-secondary)] border-[var(--border)]";
}

function kindAccent(kind: QaReportSummary["kind"]): string {
	if (kind === "slice") return "bg-[var(--color-action)]/15 text-[var(--text-secondary)] border-[var(--color-action-border)]/20";
	if (kind === "blocker") return "bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning-border)]";
	return "bg-[var(--color-action-bg)] text-[var(--color-action)] border-[var(--color-action-border)]/20";
}

function emptyTrends(): QaReportTrends {
	return {
		cards: [],
		dailyBuckets: [],
		moduleCoverage: [],
		recentRuns: [],
		lastFailure: null,
		sourceUpdatedAt: null,
	};
}

type TrendSectionProps = {
	trends: QaReportTrends;
};

function TrendSection({ trends }: TrendSectionProps) {
		const { t } = useI18n();
	const dailyMax = useMemo(() => {
		let max = 0;
		for (const bucket of trends.dailyBuckets) {
			if (bucket.total > max) max = bucket.total;
		}
		return max;
	}, [trends.dailyBuckets]);

	const topModules = useMemo(() => trends.moduleCoverage.slice(0, 6), [trends.moduleCoverage]);
	const recentRuns = useMemo(() => trends.recentRuns.slice(0, MAX_RECENT_RUNS), [trends.recentRuns]);

	return (
		<section aria-label={t("qaReportsPage.maintenanceTrendAria")} data-card className="p-4">
			<div className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("qaReportsPage.maintenanceTrendTitle")}</h2>
				<p className="text-xs text-[var(--text-muted)]">{t("qaReportsPage.maintenanceTrendDesc")}</p>
			</div>
			{trends.cards.length === 0 &&
			trends.dailyBuckets.length === 0 &&
			trends.moduleCoverage.length === 0 &&
			trends.recentRuns.length === 0 ? (
				<p className="mt-4 text-xs text-[var(--text-muted)]">{t("qaReportsPage.maintenanceTrendEmpty")}</p>
			) : null}
			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{trends.cards.map((card) => (
					<div
						key={card.id}
						data-card
						className={`rounded-xl border bg-[var(--surface-elevated)] p-4 ${toneToCardClass[card.tone]}`}
					>
						<div className="text-xs text-[var(--text-muted)]">{card.label}</div>
						<div className={`mt-2 text-2xl font-semibold ${toneToValueClass[card.tone]}`}>{card.value}</div>
						{card.caption ? <p className="mt-1 text-[11px] text-[var(--text-muted)]">{card.caption}</p> : null}
					</div>
				))}
			</div>
			{trends.dailyBuckets.length > 0 ? (
				<div className="mt-5">
					<div className="mb-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
						<span>{t("qaReportsPage.dailyTickHeader")}</span>
						<span>{t("qaReportsPage.dailyTickPeak").replace("{n}", String(dailyMax))}</span>
					</div>
					<div className="flex items-end gap-2" role="img" aria-label={t("qaReportsPage.tickChartAria")}>
						{trends.dailyBuckets.map((bucket) => {
							const totalHeight =
								dailyMax === 0
									? 0
									: Math.max(4, Math.round((bucket.total / dailyMax) * MAX_DAILY_BAR_HEIGHT));
							const successHeight =
								bucket.total === 0
									? 0
									: Math.max(2, Math.round((bucket.success / bucket.total) * totalHeight));
							return (
								<div key={bucket.day} className="flex flex-1 flex-col items-center gap-1">
									<div
										className="flex w-full max-w-[40px] flex-col-reverse overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]"
										style={{ height: `${MAX_DAILY_BAR_HEIGHT}px` }}
										title={t("qaReportsPage.dailyTickTitle")
											.replace("{day}", bucket.day)
											.replace("{n}", String(bucket.total))
											.replace("{ok}", String(bucket.success))
											.replace("{fail}", String(bucket.failed))}
									>
										<div className="w-full bg-[var(--success-bg)]" style={{ height: `${successHeight}px` }} />
										<div
											className="w-full bg-[var(--warning-bg)]"
											style={{ height: `${Math.max(0, totalHeight - successHeight)}px` }}
										/>
									</div>
									<div className="text-[10px] text-[var(--text-muted)]">{formatDayShort(bucket.day)}</div>
									<div className="text-[10px] text-[var(--text-muted)]">{bucket.total}</div>
								</div>
							);
						})}
					</div>
				</div>
			) : null}
			{topModules.length > 0 ? (
				<div className="mt-5">
					<div className="mb-2 text-xs text-[var(--text-muted)]">{t("qaReportsPage.moduleCoverageHeader")}</div>
					<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{topModules.map((row) => (
							<li
								key={row.module}
								className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs"
							>
								<span className="truncate text-[var(--text-secondary)]">{row.module}</span>
								<span className="ml-2 shrink-0 text-[var(--text-muted)]">
									{t("qaReportsPage.moduleCoverageItem")
										.replace("{n}", String(row.visitCount))
										.replace(
											"{time}",
											row.lastVisitedAt ? formatTime(row.lastVisitedAt) : t("qaReportsPage.uninspected"),
										)}
								</span>
							</li>
						))}
					</ul>
				</div>
			) : null}
			{recentRuns.length > 0 ? (
				<div className="mt-5">
					<div className="mb-2 text-xs text-[var(--text-muted)]">
						{t("qaReportsPage.recentRunsHeader").replace("{n}", String(recentRuns.length))}
					</div>
					<ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
						{recentRuns.map((run, index) => (
							<RecentRunRow key={`${run.timestamp}-${index}`} run={run} />
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}

function RecentRunRow({ run }: { run: QaReportTrendRecentRun }) {
	const accent = run.isSuccess
		? "border-[var(--success-border)] text-[var(--success)]"
		: "border-[var(--warning-border)] text-[var(--warning)]";
	return (
		<li className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2 text-xs">
					<span className="text-[var(--text-secondary)]">{run.module}</span>
					<span className={`rounded-lg border px-2 py-0.5 text-[10px] ${accent}`}>{run.result}</span>
				</div>
				<p className="mt-1 text-[11px] text-[var(--text-muted)]">{run.summary}</p>
			</div>
			<div className="shrink-0 text-[11px] text-[var(--text-muted)]">{formatTime(run.timestamp)}</div>
		</li>
	);
}

export function QaReportsListClient({
	initialReports,
	initialTotals,
	initialUpdatedAt,
	initialTrends,
}: {
	initialReports: QaReportSummary[];
	initialTotals: QaReportsListResult["totals"];
	initialUpdatedAt: string | null;
	initialTrends: QaReportTrends;
}) {
		const { t } = useI18n();
	const [reports, setReports] = useState(initialReports);
	const [totals, setTotals] = useState(initialTotals);
	const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
	const [trends, setTrends] = useState<QaReportTrends>(initialTrends);
	const [kindFilter, setKindFilter] = useState<KindFilter>("all");
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const filtered = useMemo(() => {
		if (kindFilter === "all") return reports;
		return reports.filter((report) => report.kind === kindFilter);
	}, [reports, kindFilter]);

	const refresh = async () => {
		setRefreshing(true);
		setError(null);
		try {
			const data = await csrfFetch<QaReportsListResult>("/api/admin/qa-reports");
			setReports(data.reports ?? []);
			setTotals(data.totals ?? { total: 0, slices: 0, blockers: 0, qaRuns: 0 });
			setUpdatedAt(data.lastUpdatedAt ?? null);
			setTrends(data.trends ?? emptyTrends());
		} catch (err) {
			setError(err instanceof Error ? err.message : t("qaReportsPage.refreshError"));
		} finally {
			setRefreshing(false);
		}
	};

	const kindFilters: { label: string; value: KindFilter }[] = [
		{ label: t("qaReportsPage.filterAll").replace("{n}", String(totals.total)), value: "all" },
		{ label: t("qaReportsPage.filterSlice").replace("{n}", String(totals.slices)), value: "slice" },
		{ label: t("qaReportsPage.filterBlocker").replace("{n}", String(totals.blockers)), value: "blocker" },
		{ label: t("qaReportsPage.filterQaRun").replace("{n}", String(totals.qaRuns)), value: "qa_run" },
	];

	return (
		<div className="space-y-5">
			{error ? (
				<div role="alert" className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
					{error}
				</div>
			) : null}
			<section aria-label={t("qaReportsPage.summaryAria")}>
				<SurfacePanel
					title={t("qaReportsPage.summaryTitle")}
					description={t("qaReportsPage.summaryDesc")}
					actions={
						<div className="flex flex-col items-end gap-1 text-xs text-[var(--text-muted)]">
							<div>
								{updatedAt
									? t("qaReportsPage.summaryUpdatedAt").replace("{time}", formatTime(updatedAt))
									: t("qaReportsPage.summaryUpdatedAtEmpty")}
							</div>
							<button
								type="button"
								onClick={refresh}
								disabled={refreshing}
								className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
							>
								{refreshing ? t("qaReportsPage.refreshing") : t("qaReportsPage.refreshReadHermes")}
							</button>
						</div>
					}
				>
					<StatGrid cols={4} className="mb-0">
						<StatCard label={t("qaReportsPage.totalReports")} value={String(totals.total)} />
						<StatCard label={t("qaReportsPage.closedSlices")} value={String(totals.slices)} accent={totals.slices > 0} accentColor="cyan" />
						<StatCard label={t("qaReportsPage.resolvedBlockers")} value={String(totals.blockers)} accent={totals.blockers > 0} accentColor="amber" />
						<StatCard label={t("qaReportsPage.qaLoop")} value={String(totals.qaRuns)} accent={totals.qaRuns > 0} accentColor="emerald" />
					</StatGrid>
				</SurfacePanel>
			</section>
			<TrendSection trends={trends} />
			<section aria-label={t("qaReportsPage.listAria")}>
				<ListPanel
					title={t("qaReportsPage.listTitle")}
					description={t("qaReportsPage.listDesc")}
					count={filtered.length}
					actions={
						<div
							className="flex flex-wrap items-center gap-2"
							role="group"
							aria-label={t("qaReportsPage.filterAria")}
						>
							{kindFilters.map((filter) => (
								<ToggleChip
									key={filter.value}
									active={kindFilter === filter.value}
									onClick={() => setKindFilter(filter.value)}
									ariaLabel={t("qaReportsPage.filterChipAria").replace("{label}", filter.label)}
								>
									{filter.label}
								</ToggleChip>
							))}
						</div>
					}
					empty={
						filtered.length === 0 ? (
							reports.length === 0 ? (
								<EmptyState variant="boxed" icon="📋">
									<div className="space-y-2">
										<p className="text-sm text-[var(--text-primary)]">{t("qaReportsPage.emptyAll")}</p>
										<p className="text-xs text-[var(--text-muted)]">{t("qaReportsPage.emptyAllHint")}</p>
									</div>
								</EmptyState>
							) : (
								<EmptyState
									text={t("qaReportsPage.emptyFiltered").replace(
										"{kind}",
										kindFilter === "all"
											? ""
											: (kindLabel(t, kindFilter as Exclude<KindFilter, "all">) ?? kindFilter),
									)}
									variant="boxed"
								/>
							)
						) : undefined
					}
				>
					{filtered.length > 0 ? (
					<ul>
						{filtered.map((report) => (
							<li key={report.id} className="border-b border-[var(--border-subtle)] px-5 py-4 last:border-b-0">
								<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<span
												className={`rounded-lg border px-2 py-1 text-xs font-medium ${kindAccent(report.kind)}`}
											>
												{kindLabel(t, report.kind)}
											</span>
											<span
												data-tone="neutral"
												className={`rounded-lg border px-2 py-1 text-xs font-medium ${statusToneClass(report.status)}`}
											>
												{report.status}
											</span>
											{report.evidenceCount > 0 ? (
												<span className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)]">
													{t("qaReportsPage.evidenceCount").replace("{n}", String(report.evidenceCount))}
												</span>
											) : null}
										</div>
										<h3 className="mt-2 text-sm font-medium text-[var(--text-primary)]">
											<Link
												href={`/qa-reports/${encodeURIComponent(report.id)}`}
												className="hover:underline"
											>
												{report.title}
											</Link>
										</h3>
										<p className="mt-1 text-xs text-[var(--text-muted)]">{formatTime(report.finishedAt)}</p>
										<p className="mt-2 text-sm text-[var(--text-secondary)]">{report.summary}</p>
									</div>
									<div className="flex flex-col items-end gap-2">
										<Link
											href={`/qa-reports/${encodeURIComponent(report.id)}`}
											className="text-xs text-[var(--color-action)] hover:text-[var(--text-secondary)]"
										>
											{t("qaReportsPage.viewDetail")}
										</Link>
									</div>
								</div>
							</li>
						))}
					</ul>
					) : null}
				</ListPanel>
			</section>
		</div>
	);
}
