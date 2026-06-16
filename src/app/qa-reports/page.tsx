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
import { t } from "@/lib/i18n/translations";
import { listQaReports } from "@/lib/qa-reports/service";
import { QaReportsListClient } from "./qa-reports-list-client";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function QaReportsPage() {
	const session = await requireSession("/qa-reports");
	if (!sessionHasPermission(session, "task:read")) {
		return (
			<PageShell>
				<EmptyState text={t("qaReportsPage.noPermission")} variant="boxed" />
			</PageShell>
		);
	}
	const initial = await listQaReports();
	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow="QA Reports"
				title={t("qaReportsPage.title")}
				description={t("qaReportsPage.desc")}
			/>
			<QaReportsListClient
				initialReports={initial.reports}
				initialTotals={initial.totals}
				initialUpdatedAt={initial.lastUpdatedAt}
				initialTrends={initial.trends}
			/>
		</PageShell>
	);
}
