import { render, screen } from "@testing-library/react";
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
			initialBudgets={[{ id: "budget-1", category: "vps", name: "Production VPS", limitAmount: "100.00", currency: "CNY", period: "monthly", alertThresholdPercent: 80, enabled: true, usageAmount: "85.00", usagePercent: 85, periodStart: "2026-06-01", periodEnd: "2026-06-30", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]}
			canRead canManage availableCurrencies={["CNY"]} />);
		expect(screen.getByText("Production VPS")).toBeInTheDocument();
		expect(screen.getByText("85.0%")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "costPage.budget.check" }));
		expect(csrfFetchMock).toHaveBeenCalledWith("/api/cost/budgets/check", expect.objectContaining({ method: "POST" }));
	});
});
