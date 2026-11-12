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
		await user.click(within(name.closest("form")!).getByRole("button", { name: "costPage.budget.create" }));
		await user.clear(name);
		await user.type(name, "Next draft");
		await user.clear(limit);
		await user.type(limit, "200");
		await act(async () => finish());
		await waitFor(() => expect(addToastMock).toHaveBeenCalledWith("success", "costPage.budget.created"));
		expect(name).toHaveValue("Next draft");
		expect(limit).toHaveValue("200");
	});

	it("labels every budget field, and says in the form what is missing or refused", async () => {
		// The fields had placeholders for labels (the threshold showed a bare "80"), an empty name or limit made
		// the button do nothing, and a refusal went to a toast.
		const user = userEvent.setup();
		csrfFetchMock.mockImplementation((url: string, init?: RequestInit) =>
			url === "/api/cost/budgets" && init?.method === "POST" ? Promise.reject(new Error("Budget limit must be greater than zero")) : Promise.resolve({ budgets: [] }));
		render(<CostPageClient initialMonth="2026-06" initialCurrency="CNY" initialSummary={null} initialEntries={[]} initialSnapshots={[]}
			initialBudgets={[]} initialBillingAccounts={[]} canRead canManage availableCurrencies={["CNY"]} />);
		for (const field of ["name", "category", "limit", "currency", "period", "alertThreshold"]) {
			expect(screen.getByText(`costPage.budget.${field}`, { selector: "label" })).toBeInTheDocument();
		}
		const name = screen.getByLabelText("costPage.budget.name");
		const form = name.closest("form")!;
		// The currency reads as on the rest of the page, not as a bare code.
		expect(within(form).getByRole("option", { name: "costPage.currency.CNY" })).toBeInTheDocument();

		await user.click(within(form).getByRole("button", { name: "costPage.budget.create" }));
		expect(within(form).getByRole("alert")).toHaveTextContent("costPage.budget.error.nameRequired");
		expect(csrfFetchMock).not.toHaveBeenCalledWith("/api/cost/budgets", expect.objectContaining({ method: "POST" }));

		await user.type(name, "Production");
		expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
		await user.type(screen.getByLabelText("costPage.budget.limit"), "0");
		await user.click(within(form).getByRole("button", { name: "costPage.budget.create" }));
		expect(await within(form).findByRole("alert")).toHaveTextContent("Budget limit must be greater than zero");
		expect(addToastMock).not.toHaveBeenCalledWith("error", expect.anything());
		expect(name).toHaveValue("Production");
	});

	it("shows a refused budget deletion in the dialog that asked", async () => {
		const user = userEvent.setup();
		csrfFetchMock.mockImplementation((_url: string, init?: RequestInit) =>
			init?.method === "DELETE" ? Promise.reject(new Error("Budget is locked")) : Promise.resolve({ budgets: [] }));
		render(<CostPageClient initialMonth="2026-06" initialCurrency="CNY" initialSummary={null} initialEntries={[]} initialSnapshots={[]}
			initialBudgets={[{ id: "budget-1", category: "vps", name: "Production VPS", limitAmount: "100.00", currency: "CNY", period: "monthly", alertThresholdPercent: 80, enabled: true, usageAmount: "0.00", usagePercent: 0, otherCurrencyUsage: [] } as never]}
			initialBillingAccounts={[]} canRead canManage availableCurrencies={["CNY"]} />);
		await user.click(screen.getByRole("button", { name: "costPage.budget.delete" }));
		const dialog = screen.getByRole("dialog");
		await user.click(within(dialog).getByRole("button", { name: "costPage.budget.deleteConfirmBtn" }));
		expect(await within(dialog).findByText("Budget is locked")).toBeInTheDocument();
		expect(addToastMock).not.toHaveBeenCalledWith("error", expect.anything());
	});

	it("reloads the budgets when the page refreshes its costs", async () => {
		// A new cost changed what the budget used, but the card kept the
		// page-load figure; even the page's Refresh did not touch it.
		const user = userEvent.setup();
		const budget = { id: "budget-1", category: "vps", name: "Production VPS", limitAmount: "100.00", currency: "CNY", period: "monthly", alertThresholdPercent: 80, enabled: true, usageAmount: "0.00", usagePercent: 0, periodStart: "2026-06-01", periodEnd: "2026-06-30", otherCurrencyUsage: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
		csrfFetchMock.mockImplementation((url: string) => {
			if (url === "/api/cost/budgets") return Promise.resolve({ budgets: [{ ...budget, usageAmount: "90.00", usagePercent: 90 }] });
			return Promise.resolve({ summary: null, entries: [], snapshots: [] });
		});
		render(<CostPageClient initialMonth="2026-06" initialCurrency="CNY" initialSummary={null} initialEntries={[]} initialSnapshots={[]}
			initialBudgets={[budget as never]} initialBillingAccounts={[]} canRead canManage availableCurrencies={["CNY"]} />);
		expect(screen.getByText("0.0%")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "costPage.actions.refresh" }));
		expect(await screen.findByText("90.0%")).toBeInTheDocument();
	});
});
