/**
 * `/qa-reports/[id]` detail page.
 *
 * TR-029: server-rendered detail view that surfaces the full evidence
 * payload for a single QA report — slice / blocker / qa-run — fetched
 * through `getQaReportDetail(id)`. Mirrors the list page's `task:read`
 * permission gate so admin/owner roles can deep-link into evidence
 * from the list view without an extra login step.
 */
import Link from "next/link";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getQaReportDetail } from "@/lib/qa-reports/service";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

function formatTime(iso: string | undefined): string {
	if (!iso) return "—";
	const ts = Date.parse(iso);
	if (Number.isNaN(ts)) return iso;
	return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

const kindLabel: Record<string, string> = {
	slice: "闭环 slice",
	blocker: "已解除 blocker",
	qa_run: "QA loop",
};

type Params = { params: Promise<{ id: string }> };

export default async function QaReportDetailPage({ params }: Params) {
	const session = await requireSession("/qa-reports");
	if (!sessionHasPermission(session, "task:read")) {
		return (
			<PageShell>
				<EmptyState text="你没有 QA 报告查看权限。" variant="boxed" />
			</PageShell>
		);
	}
	const { id } = await params;
	const detail = await getQaReportDetail(id);
	if (!detail) {
		return (
			<PageShell maxW="max-w-4xl">
				<PageHeader
					eyebrow="QA Reports"
					title="未找到报告"
					description={`未在 .hermes/ 下找到 id 为 ${id} 的报告。`}
				>
					<Link href="/qa-reports" className="text-xs text-cyan-300 hover:text-cyan-200">
						← 返回报告列表
					</Link>
				</PageHeader>
				<EmptyState text="该 id 已不存在或来源文件被清理。" variant="boxed" />
			</PageShell>
		);
	}
	return (
		<PageShell maxW="max-w-5xl">
			<PageHeader
				eyebrow={kindLabel[detail.kind] ?? detail.kind}
				title={detail.title}
				description={`来源 id：${detail.sourceId} · 状态：${detail.status}`}
			>
				<Link href="/qa-reports" className="text-xs text-cyan-300 hover:text-cyan-200">
					← 返回报告列表
				</Link>
			</PageHeader>
			<div className="space-y-5">
				<section data-card className="p-5">
					<dl className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2">
						<div>
							<dt className="font-semibold uppercase tracking-[0.2em] text-slate-500">完成时间</dt>
							<dd className="mt-1 text-sm text-white">{formatTime(detail.finishedAt)}</dd>
						</div>
						{detail.startedAt ? (
							<div>
								<dt className="font-semibold uppercase tracking-[0.2em] text-slate-500">起始时间</dt>
								<dd className="mt-1 text-sm text-white">{formatTime(detail.startedAt)}</dd>
							</div>
						) : null}
						<div>
							<dt className="font-semibold uppercase tracking-[0.2em] text-slate-500">状态</dt>
							<dd className="mt-1 text-sm text-white">{detail.status}</dd>
						</div>
						<div>
							<dt className="font-semibold uppercase tracking-[0.2em] text-slate-500">证据条数</dt>
							<dd className="mt-1 text-sm text-white">{detail.evidence.length}</dd>
						</div>
					</dl>
					<p className="mt-4 text-sm text-slate-300">{detail.summary}</p>
				</section>
				{detail.evidence.length > 0 ? (
					<section data-card>
						<div className="border-b border-white/[0.06] px-5 py-4">
							<h2 className="text-sm font-semibold text-white">证据明细</h2>
							<p className="mt-1 text-xs text-slate-500">从 .hermes/ 状态文件原样读出，未做二次加工。</p>
						</div>
						<ul className="divide-y divide-white/[0.06]">
							{detail.evidence.map((row, index) => (
								<li key={`${detail.id}-evidence-${index}`} className="px-5 py-4">
									<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
										{row.command || "(无 command)"}
									</div>
									<pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-300 font-mono">
										{row.result || "(无 result)"}
									</pre>
								</li>
							))}
						</ul>
					</section>
				) : null}
				{detail.changeContract ? (
					<section data-card>
						<div className="border-b border-white/[0.06] px-5 py-4">
							<h2 className="text-sm font-semibold text-white">Change Contract</h2>
							<p className="mt-1 text-xs text-slate-500">本次闭环影响的文件 / 提交，便于审计追溯。</p>
						</div>
						<div className="space-y-3 px-5 py-4 text-sm text-slate-300">
							{detail.changeContract.commit ? (
								<div>
									<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Commit</div>
									<div className="mt-1 font-mono text-xs text-cyan-200">{detail.changeContract.commit}</div>
								</div>
							) : null}
							{detail.changeContract.files && detail.changeContract.files.length > 0 ? (
								<div>
									<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
										Files ({detail.changeContract.files.length})
									</div>
									<ul className="mt-1 space-y-1 font-mono text-xs text-slate-300">
										{detail.changeContract.files.map((file) => (
											<li key={file}>{file}</li>
										))}
									</ul>
								</div>
							) : null}
							{detail.changeContract.notes ? (
								<div>
									<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Notes</div>
									<p className="mt-1 text-xs text-slate-300">{detail.changeContract.notes}</p>
								</div>
							) : null}
						</div>
					</section>
				) : null}
				{detail.next ? (
					<section data-card className="p-5">
						<h2 className="text-sm font-semibold text-white">Next</h2>
						<p className="mt-2 text-sm text-slate-300">{detail.next}</p>
					</section>
				) : null}
			</div>
		</PageShell>
	);
}
