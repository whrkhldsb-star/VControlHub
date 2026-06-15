"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState, ToggleChip } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type {
	QaReportTrendCard,
	QaReportTrendRecentRun,
	QaReportTrends,
	QaReportsListResult,
	QaReportSummary,
} from "@/lib/qa-reports/dto";

type KindFilter = "all" | "slice" | "blocker" | "qa_run";

const kindLabel: Record<Exclude<KindFilter, "all">, string> = {
	slice: "闭环 slice",
	blocker: "已解除 blocker",
	qa_run: "QA loop",
};

const toneToCardClass: Record<QaReportTrendCard["tone"], string> = {
	success: "border-emerald-400/30 text-emerald-200",
	warn: "border-amber-400/30 text-amber-200",
	neutral: "border-white/[0.08] text-slate-300",
	info: "border-cyan-400/30 text-cyan-200",
};

const toneToValueClass: Record<QaReportTrendCard["tone"], string> = {
	success: "text-emerald-100",
	warn: "text-amber-100",
	neutral: "text-slate-200",
	info: "text-white",
};

const MAX_DAILY_BAR_HEIGHT = 56; // px, the tallest possible bar in the mini chart
const MAX_RECENT_RUNS = 5;

function formatTime(iso: string): string {
	const ts = Date.parse(iso);
	if (Number.isNaN(ts)) return iso;
	return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function formatDayShort(day: string): string {
	// `YYYY-MM-DD` → `MM-DD` for compact display
	return day.length >= 10 ? day.slice(5) : day;
}

function statusToneClass(status: string): string {
	const lower = status.toLowerCase();
	if (lower.includes("fail") || lower.includes("error")) return "text-rose-300 border-rose-400/30";
	if (lower.includes("run") || lower.includes("deploy")) return "text-cyan-300 border-cyan-400/30";
	if (lower.includes("complete") || lower.includes("resolved")) return "text-emerald-300 border-emerald-400/30";
	return "text-slate-300 border-white/[0.08]";
}

function kindAccent(kind: QaReportSummary["kind"]): string {
	if (kind === "slice") return "bg-cyan-500/15 text-cyan-200 border-cyan-400/20";
	if (kind === "blocker") return "bg-amber-500/15 text-amber-200 border-amber-400/20";
	return "bg-indigo-500/15 text-indigo-200 border-indigo-400/20";
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
		<section aria-label="维护环趋势" data-card className="p-4">
			<div className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold text-white">维护环趋势</h2>
				<p className="text-xs text-slate-500">
					数据来源 .hermes/autonomous-maintenance-state.json#completed_runs[]。总 tick、成功率、模块覆盖、最近失败摘要。
				</p>
			</div>
			{trends.cards.length === 0 &&
			trends.dailyBuckets.length === 0 &&
			trends.moduleCoverage.length === 0 &&
			trends.recentRuns.length === 0 ? (
				<p className="mt-4 text-xs text-slate-500">
					当前 .hermes/autonomous-maintenance-state.json 不可用或暂无 completed_runs 历史。
				</p>
			) : null}
			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{trends.cards.map((card) => (
					<div
						key={card.id}
						data-card
						className={`rounded-xl border bg-white/[0.02] p-4 ${toneToCardClass[card.tone]}`}
					>
						<div className="text-xs text-slate-500">{card.label}</div>
						<div className={`mt-2 text-2xl font-semibold ${toneToValueClass[card.tone]}`}>{card.value}</div>
						{card.caption ? <p className="mt-1 text-[11px] text-slate-500">{card.caption}</p> : null}
					</div>
				))}
			</div>
			{trends.dailyBuckets.length > 0 ? (
				<div className="mt-5">
					<div className="mb-2 flex items-center justify-between text-xs text-slate-500">
						<span>近 7 日 tick 数（绿=成功 / 琥珀=失败）</span>
						<span>峰值 {dailyMax}</span>
					</div>
					<div className="flex items-end gap-2" role="img" aria-label="近 7 日 tick 柱状图">
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
										className="flex w-full max-w-[40px] flex-col-reverse overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.03]"
										style={{ height: `${MAX_DAILY_BAR_HEIGHT}px` }}
										title={`${bucket.day} · ${bucket.total} 次 (成功 ${bucket.success} / 失败 ${bucket.failed})`}
									>
										<div className="w-full bg-emerald-400/70" style={{ height: `${successHeight}px` }} />
										<div
											className="w-full bg-amber-400/70"
											style={{ height: `${Math.max(0, totalHeight - successHeight)}px` }}
										/>
									</div>
									<div className="text-[10px] text-slate-500">{formatDayShort(bucket.day)}</div>
									<div className="text-[10px] text-slate-400">{bucket.total}</div>
								</div>
							);
						})}
					</div>
				</div>
			) : null}
			{topModules.length > 0 ? (
				<div className="mt-5">
					<div className="mb-2 text-xs text-slate-500">模块覆盖（按访问次数排序，截前 6）</div>
					<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{topModules.map((row) => (
							<li
								key={row.module}
								className="flex items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs"
							>
								<span className="truncate text-slate-200">{row.module}</span>
								<span className="ml-2 shrink-0 text-slate-500">
									{row.visitCount} 次 · {row.lastVisitedAt ? formatTime(row.lastVisitedAt) : "未巡检"}
								</span>
							</li>
						))}
					</ul>
				</div>
			) : null}
			{recentRuns.length > 0 ? (
				<div className="mt-5">
					<div className="mb-2 text-xs text-slate-500">最近 {recentRuns.length} 次 tick</div>
					<ul className="divide-y divide-white/[0.06] rounded-md border border-white/[0.06]">
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
		? "border-emerald-400/30 text-emerald-200"
		: "border-amber-400/30 text-amber-200";
	return (
		<li className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2 text-xs">
					<span className="text-slate-200">{run.module}</span>
					<span className={`rounded-md border px-2 py-0.5 text-[10px] ${accent}`}>{run.result}</span>
				</div>
				<p className="mt-1 text-[11px] text-slate-400">{run.summary}</p>
			</div>
			<div className="shrink-0 text-[11px] text-slate-500">{formatTime(run.timestamp)}</div>
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
			setError(err instanceof Error ? err.message : "刷新 QA 报告失败");
		} finally {
			setRefreshing(false);
		}
	};

	const kindFilters: { label: string; value: KindFilter }[] = [
		{ label: `全部 (${totals.total})`, value: "all" },
		{ label: `闭环 slice (${totals.slices})`, value: "slice" },
		{ label: `已解除 blocker (${totals.blockers})`, value: "blocker" },
		{ label: `QA loop (${totals.qaRuns})`, value: "qa_run" },
	];

	return (
		<div className="space-y-5">
			{error ? (
				<div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-100">
					{error}
				</div>
			) : null}
			<section aria-label="QA 报告聚合" data-card className="p-4">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<h2 className="text-sm font-semibold text-white">来源概览</h2>
						<p className="mt-1 text-xs text-slate-500">
							数据来自应用根目录 .hermes/remediation-state.json 与 .hermes/qa-loop-state.json；只读，不写回磁盘。
						</p>
					</div>
					<div className="flex flex-col items-end gap-1 text-xs text-slate-500">
						<div>最近更新：{updatedAt ? formatTime(updatedAt) : "—"}</div>
						<button
							type="button"
							onClick={refresh}
							disabled={refreshing}
							className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.05] disabled:opacity-50"
						>
							{refreshing ? "刷新中…" : "重新读取 .hermes/"}
						</button>
					</div>
				</div>
				<div className="mt-4 grid gap-3 sm:grid-cols-4">
					{[
						["总报告数", totals.total],
						["闭环 slice", totals.slices],
						["已解除 blocker", totals.blockers],
						["QA loop", totals.qaRuns],
					].map(([label, value]) => (
						<div key={String(label)} data-card className="p-4">
							<div className="text-xs text-slate-500">{String(label)}</div>
							<div className="mt-2 text-2xl font-semibold text-white">{String(value)}</div>
						</div>
					))}
				</div>
			</section>
			<TrendSection trends={trends} />
			<section aria-label="QA 报告列表" data-card>
				<div className="flex flex-col gap-3 border-b border-white/[0.06] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
					<div>
						<h2 className="text-sm font-semibold text-white">报告列表</h2>
						<p className="mt-1 text-xs text-slate-500">点击行查看证据/change-contract 详情。</p>
					</div>
					<div className="flex flex-wrap items-center gap-2" role="group" aria-label="报告类型筛选">
						{kindFilters.map((filter) => (
							<ToggleChip
								key={filter.value}
								active={kindFilter === filter.value}
								onClick={() => setKindFilter(filter.value)}
								ariaLabel={`筛选 ${filter.label}`}
							>
								{filter.label}
							</ToggleChip>
						))}
					</div>
				</div>
				{filtered.length === 0 ? (
					<div className="px-5 py-8">
						<EmptyState
							text={
								reports.length === 0
									? "当前 .hermes/ 下没有任何可展示的 QA 报告记录。"
									: `当前筛选「${kindLabel[kindFilter as Exclude<KindFilter, "all">] ?? kindFilter}」下没有报告。`
							}
							variant="boxed"
						/>
					</div>
				) : (
					<ul className="divide-y divide-white/[0.06]">
						{filtered.map((report) => (
							<li key={report.id} className="px-5 py-4">
								<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className={`rounded-md border px-2 py-1 text-xs font-medium ${kindAccent(report.kind)}`}>
												{kindLabel[report.kind]}
											</span>
											<span
												data-tone="neutral"
												className={`rounded-md border px-2 py-1 text-xs font-medium ${statusToneClass(report.status)}`}
											>
												{report.status}
											</span>
											{report.evidenceCount > 0 ? (
												<span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400">
													证据 {report.evidenceCount} 条
												</span>
											) : null}
										</div>
										<h3 className="mt-2 text-sm font-medium text-white">
											<Link
												href={`/qa-reports/${encodeURIComponent(report.id)}`}
												className="hover:underline"
											>
												{report.title}
											</Link>
										</h3>
										<p className="mt-1 text-xs text-slate-500">{formatTime(report.finishedAt)}</p>
										<p className="mt-2 text-sm text-slate-300">{report.summary}</p>
									</div>
									<div className="flex flex-col items-end gap-2">
										<Link
											href={`/qa-reports/${encodeURIComponent(report.id)}`}
											className="text-xs text-cyan-300 hover:text-cyan-200"
										>
											查看详情 →
										</Link>
									</div>
								</div>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
