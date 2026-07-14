/**
 * TR-031 E01: /cost-summary — 成本追踪 UI 页面。
 *
 * RSC reads initial data (summary for current month + recent entries +
 * recent snapshots) and hands them to a client component for the
 * create / edit / delete flows. Currency is selected by the client
 * and triggers a fresh /api/cost/summary?currency=... fetch.
 */
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listCostEntries, listRecentSnapshots, summarizeMonth, listCostBudgets } from "@/lib/cost/service";
import { COST_CURRENCY_VALUES, type CostCurrency } from "@/lib/cost/types";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageHeader, PageShell } from "@/components/page-shell";

import { CostPageClient } from "./cost-page-client";

export const dynamic = "force-dynamic";

function currentMonth(): string {
	const now = new Date();
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function CostSummaryPage() {
	const session = await requireSession("/cost-summary");
	const canRead = sessionHasPermission(session, "cost:read");
	const canManage = sessionHasPermission(session, "cost:manage");
	const locale = await getServerLocale();

	const month = currentMonth();
	const defaultCurrency: CostCurrency = "CNY";

	const summary = canRead
		? await summarizeMonth(month, defaultCurrency)
		: null;
	const entries = canRead ? await listCostEntries({ limit: 200 }) : [];
	const snapshots = canRead ? await listRecentSnapshots(30) : [];
	const budgets = canRead ? await listCostBudgets() : [];

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("costPage.eyebrow", locale)}
				title={t("costPage.title", locale)}
				description={t("costPage.desc", locale)}
			/>
			<CostPageClient
				initialMonth={month}
				initialCurrency={defaultCurrency}
				initialSummary={summary}
				initialEntries={entries}
				initialSnapshots={snapshots}
				initialBudgets={budgets}
				canRead={canRead}
				canManage={canManage}
				availableCurrencies={[...COST_CURRENCY_VALUES]}
			/>
		</PageShell>
	);
}
