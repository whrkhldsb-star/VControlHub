/**
 * `/qa-reports` admin list page.
 *
 * TR-029: a server-rendered page that surfaces the on-disk QA report
 * history (`.hermes/remediation-state.json#completed[]` +
 * `…#resolvedBlockers[]` + `.hermes/qa-loop-state.json#lastRun`)
 * without forcing ops staff to ssh into the host. The page delegates
 * to `listQaReports()` for the SSR payload and the matching client
 * component for refresh + filter.
 *
 * Permission: `task:read` (admin/owner). Mirrors the gate used by
 * `/api/admin/qa-reports` and `/api/admin/workers`.
 */
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listQaReports } from "@/lib/qa-reports/service";
import { QaReportsListClient } from "./qa-reports-list-client";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function QaReportsPage() {
	const session = await requireSession("/qa-reports");
	if (!sessionHasPermission(session, "task:read")) {
		return (
			<PageShell>
				<EmptyState text="你没有 QA 报告查看权限。" variant="boxed" />
			</PageShell>
		);
	}
	const initial = await listQaReports();
	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow="QA Reports"
				title="站内 QA 报告"
				description="汇总维护环、QA 环和已解除 blocker 的闭环记录；数据来源 .hermes/remediation-state.json + .hermes/qa-loop-state.json。"
			/>
			<QaReportsListClient initialReports={initial.reports} initialTotals={initial.totals} initialUpdatedAt={initial.lastUpdatedAt} />
		</PageShell>
	);
}
