"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState, ToggleChip } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type { QaReportsListResult, QaReportSummary } from "@/lib/qa-reports/dto";

type KindFilter = "all" | "slice" | "blocker" | "qa_run";

const kindLabel: Record<Exclude<KindFilter, "all">, string> = {
	slice: "闭环 slice",
	blocker: "已解除 blocker",
	qa_run: "QA loop",
};

function formatTime(iso: string): string {
	const ts = Date.parse(iso);
	if (Number.isNaN(ts)) return iso;
	return new Date(ts).toLocaleString("zh-CN", { hour12: false });
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

export function QaReportsListClient({
	initialReports,
	initialTotals,
	initialUpdatedAt,
}: {
	initialReports: QaReportSummary[];
	initialTotals: QaReportsListResult["totals"];
	initialUpdatedAt: string | null;
}) {
	const [reports, setReports] = useState(initialReports);
	const [totals, setTotals] = useState(initialTotals);
	const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
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
