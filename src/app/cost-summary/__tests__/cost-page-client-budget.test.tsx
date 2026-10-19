import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { csrfFetchMock, addToastMock } = vi.hoisted(() => ({ csrfFetchMock: vi.fn(), addToastMock: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: csrfFetchMock }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/components/toast-provider", () => ({ useToast: () => ({ addToast: addToastMock }) }));

import { CostPageClient } from "../cost-page-client";

describe("CostPageClient budgets", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		csrfFetchMock.mockResolvedValue(new Response(JSON.stringify({ checked: 1, triggered: 0 }), { status: 200 }));
	});

	it("renders budget progress and supports manual alert check", async () => {
		const user = userEvent.setup();
		render(<CostPageClient initialMonth="2026-06" initialCurrency="CNY" initialSummary={null} initialEntries={[]} initialSnapshots={[]}
			initialBudgets={[{ id: "budget-1", category: "vps", name: "Production VPS", limitAmount: "100.00", currency: "CNY", period: "monthly", alertThresholdPercent: 80, enabled: true, usageAmount: "85.00", usagePercent: 85, periodStart: "2026-06-01", periodEnd: "2026-06-30", otherCurrencyUsage: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]}
			initialBillingAccounts={[]}
			canRead canManage availableCurrencies={["CNY"]} />);
		expect(screen.getByText("Production VPS")).toBeInTheDocument();
		expect(screen.getByText("85.0%")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "costPage.budget.check" }));
		expect(csrfFetchMock).toHaveBeenCalledWith("/api/cost/budgets/check", expect.objectContaining({ method: "POST" }));
	});

	it("keeps a next budget typed while the previous one was saving", async () => {
		// The fields stay editable while saving; clearing them on success threw
		// away a draft that had not been submitted.
		const user = userEvent.setup();
		let finish!: () => void;
		csrfFetchMock.mockImplementation((url: string, init?: RequestInit) => {
			if (url === "/api/cost/budgets" && init?.method === "POST") return new Promise((resolve) => { finish = () => resolve({}); });
			return Promise.resolve({ budgets: [] });
		});
		render(<CostPageClient initialMonth="2026-06" initialCurrency="CNY" initialSummary={null} initialEntries={[]} initialSnapshots={[]}
			initialBudgets={[]} initialBillingAccounts={[]} canRead canManage availableCurrencies={["CNY"]} />);
		const name = screen.getByRole("textbox", { name: "costPage.budget.name" });
		const limit = screen.getByRole("textbox", { name: "costPage.budget.limit" });
		await user.type(name, "First budget");
		await user.type(limit, "100");
		await user.click(within(name.parentElement!).getByRole("button", { name: "costPage.budget.create" }));
		await user.clear(name);
		await user.type(name, "Next draft");
		await user.clear(limit);
		await user.type(limit, "200");
		await act(async () => finish());
		await waitFor(() => expect(addToastMock).toHaveBeenCalledWith("success", "costPage.budget.created"));
		expect(name).toHaveValue("Next draft");
		expect(limit).toHaveValue("200");
	});
});

