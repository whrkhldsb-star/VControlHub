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
import { t, getServerLocale, type Locale } from "@/lib/i18n/translations";
import { formatDateTime } from "@/lib/datetime/format";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

function formatTime(iso: string | undefined, locale: Locale): string {
	if (!iso) return "—";
	return formatDateTime(iso, locale);
}

function kindLabel(kind: string): string {
	switch (kind) {
		case "slice":
			return t("qaReportsPage.kind.slice");
		case "blocker":
			return t("qaReportsPage.kind.blocker");
		case "qa_run":
			return t("qaReportsPage.kind.qaRun");
		default:
			return kind;
	}
}

type Params = { params: Promise<{ id: string }> };

export default async function QaReportDetailPage({ params }: Params) {
	const session = await requireSession("/qa-reports");
	const locale = await getServerLocale();
	if (!sessionHasPermission(session, "task:read")) {
		return (
			<PageShell>
				<EmptyState text={t("qaReportsPage.noPermission")} variant="boxed" />
			</PageShell>
		);
	}
	const { id } = await params;
	const detail = await getQaReportDetail(id);
	if (!detail) {
		return (
			<PageShell maxW="max-w-4xl">
				<PageHeader
					eyebrow={t("qaReportsPage.eyebrow", locale)}
					title={t("qaReportsPage.detail.notFound")}
					description={t("qaReportsPage.detail.notFoundDesc").replace("{id}", id)}
				>
					<Link href="/qa-reports" className="text-xs text-[var(--color-action)] hover:text-[var(--text-secondary)]">
						{t("qaReportsPage.detail.backToList")}
					</Link>
				</PageHeader>
				<EmptyState text={t("qaReportsPage.detail.emptyIdMissing")} variant="boxed" />
			</PageShell>
		);
	}
	return (
		<PageShell maxW="max-w-5xl">
			<PageHeader
				eyebrow={kindLabel(detail.kind)}
				title={detail.title}
				description={t("qaReportsPage.detail.sourceIdAndStatus")
					.replace("{sourceId}", detail.sourceId)
					.replace("{status}", detail.status)}
			>
				<Link href="/qa-reports" className="text-xs text-[var(--color-action)] hover:text-[var(--text-secondary)]">
					{t("qaReportsPage.detail.backToList")}
				</Link>
			</PageHeader>
			<div className="space-y-5">
				<section data-card className="">
					<dl className="grid gap-3 text-xs text-[var(--text-muted)] sm:grid-cols-2">
						<div>
							<dt className="font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qaReportsPage.detail.finishedAt")}</dt>
							<dd className="mt-1 text-sm text-[var(--text-primary)]">{formatTime(detail.finishedAt, locale)}</dd>
						</div>
						{detail.startedAt ? (
							<div>
								<dt className="font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qaReportsPage.detail.startedAt")}</dt>
								<dd className="mt-1 text-sm text-[var(--text-primary)]">{formatTime(detail.startedAt, locale)}</dd>
							</div>
						) : null}
						<div>
							<dt className="font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qaReportsPage.detail.status")}</dt>
							<dd className="mt-1 text-sm text-[var(--text-primary)]">{detail.status}</dd>
						</div>
						<div>
							<dt className="font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qaReportsPage.detail.evidenceCount")}</dt>
							<dd className="mt-1 text-sm text-[var(--text-primary)]">{detail.evidence.length}</dd>
						</div>
					</dl>
					<p className="mt-4 text-sm text-[var(--text-secondary)]">{detail.summary}</p>
				</section>
				{detail.evidence.length > 0 ? (
					<section data-card>
						<div className="border-b border-[var(--border)] px-5 py-4">
							<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("qaReportsPage.detail.evidenceTitle")}</h2>
							<p className="mt-1 text-xs text-[var(--text-muted)]">{t("qaReportsPage.detail.evidenceDesc")}</p>
						</div>
						<ul className="divide-y divide-[var(--border)]">
							{detail.evidence.map((row, index) => (
								<li key={`${detail.id}-evidence-${index}`} className="px-5 py-4">
									<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-action)]">
										{row.command || t("qaReportsPage.detail.noCommand")}
									</div>
									<pre className="mt-2 whitespace-pre-wrap break-words text-xs text-[var(--text-secondary)] font-mono">
										{row.result || t("qaReportsPage.detail.noResult")}
									</pre>
								</li>
							))}
						</ul>
					</section>
				) : null}
				{detail.changeContract ? (
					<section data-card>
						<div className="border-b border-[var(--border)] px-5 py-4">
							<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("qaReportsPage.detail.changeContract")}</h2>
							<p className="mt-1 text-xs text-[var(--text-muted)]">{t("qaReportsPage.detail.changeContractDesc")}</p>
						</div>
						<div className="space-y-3 px-5 py-4 text-sm text-[var(--text-secondary)]">
							{detail.changeContract.commit ? (
								<div>
									<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qaReportsPage.detail.commit")}</div>
									<div className="mt-1 font-mono text-xs text-[var(--text-secondary)]">{detail.changeContract.commit}</div>
								</div>
							) : null}
							{detail.changeContract.files && detail.changeContract.files.length > 0 ? (
								<div>
									<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
										{t("qaReportsPage.detail.filesCount").replace("{n}", String(detail.changeContract.files.length))}
									</div>
									<ul className="mt-1 space-y-1 font-mono text-xs text-[var(--text-secondary)]">
										{detail.changeContract.files.map((file) => (
											<li key={file}>{file}</li>
										))}
									</ul>
								</div>
							) : null}
							{detail.changeContract.notes ? (
								<div>
									<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qaReportsPage.detail.notes")}</div>
									<p className="mt-1 text-xs text-[var(--text-secondary)]">{detail.changeContract.notes}</p>
								</div>
							) : null}
						</div>
					</section>
				) : null}
				{detail.next ? (
					<section data-card className="">
						<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("qaReportsPage.detail.next")}</h2>
						<p className="mt-2 text-sm text-[var(--text-secondary)]">{detail.next}</p>
					</section>
				) : null}
			</div>
		</PageShell>
	);
}
