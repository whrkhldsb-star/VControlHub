import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { csrfFetchMock, addToastMock } = vi.hoisted(() => ({ csrfFetchMock: vi.fn(), addToastMock: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: csrfFetchMock }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/components/toast-provider", () => ({ useToast: () => ({ addToast: addToastMock }) }));
// The edit form's unsaved-changes guard intercepts navigation through the router.
vi.mock("next/navigation", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/navigation")>()),
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { CostPageClient } from "../cost-page-client";
import { changedBudgetFields } from "../cost-budget-panel";

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

describe("CostPageClient budget changes", () => {
	const budget = { id: "budget-1", category: "vps" as const, name: "Production VPS", limitAmount: "100.00", currency: "CNY" as const, period: "monthly" as const, alertThresholdPercent: 80, enabled: true, usageAmount: "85.00", usagePercent: 85, periodStart: "2026-06-01", periodEnd: "2026-06-30", otherCurrencyUsage: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
	const renderPage = (budgets = [budget]) => render(<CostPageClient initialMonth="2026-06" initialCurrency="CNY" initialSummary={null} initialEntries={[]} initialSnapshots={[]}
		initialBudgets={budgets} initialBillingAccounts={[]} canRead canManage availableCurrencies={["CNY", "USD"]} />);

	beforeEach(() => {
		vi.clearAllMocks();
		csrfFetchMock.mockResolvedValue({ budgets: [budget] });
	});

	it("sends only what changed", () => {
		const form = { name: "Production VPS", category: "vps" as const, limitAmount: "100", currency: "CNY" as const, period: "monthly", alertThresholdPercent: 80 };
		// "100" and "100.00" are the same limit.
		expect(changedBudgetFields(budget, form)).toEqual({});
		expect(changedBudgetFields(budget, { ...form, limitAmount: " 150 ", alertThresholdPercent: 90 })).toEqual({ limitAmount: "150", alertThresholdPercent: 90 });
		expect(changedBudgetFields(budget, { ...form, name: "Prod", period: "yearly" })).toEqual({ name: "Prod", period: "yearly" });
	});

	// A budget could not be changed once created: a new limit meant deleting it and making it again.
	it("opens a budget in the form with its values and saves the change", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("button", { name: "costPage.edit" }));
		expect(screen.getByRole("heading", { name: "costPage.budget.editTitle" })).toBeInTheDocument();
		const limit = screen.getByRole("textbox", { name: "costPage.budget.limit" });
		expect(screen.getByRole("textbox", { name: "costPage.budget.name" })).toHaveValue("Production VPS");
		expect(limit).toHaveValue("100.00");
		// One edit at a time.
		expect(screen.getByRole("button", { name: "costPage.edit" })).toBeDisabled();

		await user.clear(limit);
		await user.type(limit, "150");
		await user.click(screen.getByRole("button", { name: "costPage.saveChanges" }));

		await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith("/api/cost/budgets/budget-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ limitAmount: "150" }) })));
		expect(addToastMock).toHaveBeenCalledWith("success", "costPage.budget.updated");
		// Back to adding a budget, with empty fields.
		expect(screen.getByRole("button", { name: "costPage.budget.create" })).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "costPage.budget.name" })).toHaveValue("");
	});

	it("closes an edit that changed nothing without sending it", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("button", { name: "costPage.edit" }));
		await user.click(screen.getByRole("button", { name: "costPage.saveChanges" }));
		expect(addToastMock).toHaveBeenCalledWith("info", "costPage.unchanged");
		expect(csrfFetchMock).not.toHaveBeenCalledWith("/api/cost/budgets/budget-1", expect.anything());
		expect(screen.queryByRole("heading", { name: "costPage.budget.editTitle" })).not.toBeInTheDocument();
	});

	// A budget's switch decides whether it alerts; nothing on the page set it.
	it("switches a budget's alerts off and says so on its card", async () => {
		const user = userEvent.setup();
		csrfFetchMock.mockImplementation((_url: string, init?: RequestInit) =>
			Promise.resolve(init?.method === "PATCH" ? {} : { budgets: [{ ...budget, enabled: false }] }));
		renderPage();
		await user.click(screen.getByRole("button", { name: "costPage.budget.turnAlertsOff" }));
		await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith("/api/cost/budgets/budget-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) })));
		expect(addToastMock).toHaveBeenCalledWith("success", "costPage.budget.alertsOff");
		expect(await screen.findByText("costPage.budget.alertsOffBadge")).toBeInTheDocument();
	});

	it("marks a budget whose alerts are off", () => {
		renderPage([{ ...budget, enabled: false }]);
		expect(screen.getByText("costPage.budget.alertsOffBadge")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "costPage.budget.turnAlertsOn" })).toBeInTheDocument();
	});
});
