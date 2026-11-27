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
import { listCostEntryPage, listRecentSnapshots, summarizeMonth, listCostBudgets } from "@/lib/cost/service";
import { listCloudBillingAccounts } from "@/lib/cost/cloud-billing/service";
import { redactCloudBillingAccountForReader } from "@/lib/cost/cloud-billing/redact";
import { COST_CURRENCY_VALUES, type CostCurrency } from "@/lib/cost/types";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PageGuide } from "@/components/page-guide";

import { CostPageClient } from "./cost-page-client";
import { costDateSchema } from "@/lib/cost/schema";
import { appTimeZoneDateKey, zonedDateTimeToDate } from "@/lib/datetime/time-zone";

export const dynamic = "force-dynamic";

/** Application time, as budgets and the monthly fee sync read it. */
function currentMonth(): string {
	return appTimeZoneDateKey().slice(0, 7);
}

export default async function CostSummaryPage({ searchParams }: { searchParams?: Promise<{ budget?: string; periodStart?: string }> }) {
	const session = await requireSession("/cost-summary");
	const canRead = sessionHasPermission(session, "cost:read");
	const canManage = sessionHasPermission(session, "cost:manage");
	const canReadServers = sessionHasPermission(session, "server:read");
	const locale = await getServerLocale();

	const params = await searchParams;
	const period = costDateSchema.safeParse(params?.periodStart);
	const linkedDate = canRead && typeof params?.budget === "string" && period.success && period.data.endsWith("-01")
		&& period.data <= appTimeZoneDateKey() ? zonedDateTimeToDate(period.data + "T12:00") : null;
	const historical = linkedDate ? await listCostBudgets(linkedDate, session) : [];
	const selected = historical.find(row => row.id === params?.budget && row.periodStart === params?.periodStart);
	const month = selected?.periodStart.slice(0, 7) ?? currentMonth();
	const defaultCurrency: CostCurrency = selected?.currency ?? "CNY";

	// Always pass session into team-scoped cost services so SSR matches API
	// teamWhere (cost:read alone must not hydrate fleet-wide entries/budgets).
	// The five reads are independent — run them concurrently so page TTFB is
	// the slowest query, not the sum of all five.
	const [summary, entries, snapshots, budgets, billingAccounts] = await Promise.all([
		canRead ? summarizeMonth(month, defaultCurrency, session) : null,
		canRead ? listCostEntryPage({ limit: 200, month, session }) : { entries: [], total: 0 },
		canRead ? listRecentSnapshots(31, session, defaultCurrency, month) : [],
		selected ? historical : canRead ? listCostBudgets(new Date(), session) : [],
		canRead ? listCloudBillingAccounts(session) : [],
	]);

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("costPage.eyebrow", locale)}
				title={t("costPage.title", locale)}
				description={t("costPage.desc", locale)}
			/>
			{canRead && (
				<PageGuide
					title={t("costPage.guide.title", locale)}
					summary={t("costPage.guide.summary", locale)}
					steps={[
						t("costPage.guide.step1", locale),
						t("costPage.guide.step2", locale),
						t("costPage.guide.step3", locale),
					]}
					links={canReadServers ? [{ label: t("costPage.guide.openServers", locale), href: "/servers" }] : undefined}
					className="mb-6"
				/>
			)}
			<CostPageClient
				key={selected ? selected.id + selected.periodStart : month}
				initialMonth={month}
				initialCurrency={defaultCurrency}
				initialSummary={summary}
				initialEntries={entries.entries}
				initialTotal={entries.total}
				selectedBudget={selected?.id}
				initialSnapshots={snapshots}
				initialBudgets={budgets}
				initialBillingAccounts={billingAccounts.map((account) => redactCloudBillingAccountForReader(account, session))}
				canRead={canRead}
				canManage={canManage}
				availableCurrencies={[...COST_CURRENCY_VALUES]}
			/>
		</PageShell>
	);
}
