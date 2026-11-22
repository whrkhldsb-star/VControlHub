// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { requireSession } from "@/lib/auth/require-session";
import type { Permission } from "@/lib/auth/rbac";
import { CostPageClient } from "../cost-page-client";
import CostSummaryPage from "../page";

const { budgetRows } = vi.hoisted(() => ({ budgetRows: vi.fn((): { id: string; periodStart: string; currency: string }[] => []) }));

const account = {
	id: "billing-1",
	lastSyncError: "legacy internal supplier detail", lastSyncStatus: "error",
	config: {
		region: "us-east-1",
		sampleCsv: "date,amount\n2026-07-01,42",
		billingCsvUrl: "https://billing.example/export.csv?token=private",
	},
};

vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/cost/service", () => ({
	summarizeMonth: async () => null,
	listCostEntryPage: async () => ({ entries: [], total: 0 }),
	listRecentSnapshots: async () => [],
	listCostBudgets: budgetRows,
}));
vi.mock("@/lib/cost/cloud-billing/service", () => ({
	listCloudBillingAccounts: async () => [structuredClone(account)],
}));
vi.mock("@/lib/i18n/translations", () => ({ getServerLocale: async () => "en", t: (key: string) => key }));
vi.mock("@/components/page-shell", () => ({
	PageShell: ({ children }: { children: ReactNode }) => children,
	PageHeader: () => null,
}));
vi.mock("../cost-page-client", () => ({ CostPageClient: vi.fn(() => null) }));

async function billingAccountsFor(permissions: Permission[]) {
	vi.mocked(requireSession).mockResolvedValue({
		userId: "user-1",
		username: "cost-user",
		roles: [],
		currentTeamId: "team-1",
		mustChangePassword: false,
		permissions,
	});
	vi.mocked(CostPageClient).mockClear();
	renderToStaticMarkup(await CostSummaryPage({}));
	return vi.mocked(CostPageClient).mock.lastCall?.[0].initialBillingAccounts;
}

it("omits the sample CSV and billing feed URL from the cost reader's initial client props", async () => {
	expect(await billingAccountsFor(["cost:read"])).toStrictEqual([{ id: "billing-1", lastSyncError: "error", lastSyncStatus: "error", config: { region: "us-east-1" } }]);
});

it("passes the full billing config to a cost manager", async () => {
	expect(await billingAccountsFor(["cost:read", "cost:manage"])).toStrictEqual([account]);
});

it("opens the validated budget period and falls back for an inaccessible budget", async () => {
	await billingAccountsFor(["cost:read"]);
	const periodStart = "2024-07-01";
	budgetRows.mockReturnValueOnce([{ id: "ours", periodStart, currency: "USD" }]);
	renderToStaticMarkup(await CostSummaryPage({ searchParams: Promise.resolve({ budget: "ours", periodStart }) }));
	expect(vi.mocked(CostPageClient).mock.lastCall?.[0]).toMatchObject({ selectedBudget: "ours", initialMonth: "2024-07", initialCurrency: "USD" });
	renderToStaticMarkup(await CostSummaryPage({ searchParams: Promise.resolve({ budget: "foreign", periodStart }) }));
	expect(vi.mocked(CostPageClient).mock.lastCall?.[0].selectedBudget).toBeUndefined();
});
