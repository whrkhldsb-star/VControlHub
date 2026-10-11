import { act, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionGateProvider, type SessionGate } from "@/lib/auth/session-context";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { notifyCustomersChanged } from "@/lib/team/customers-changed";
import { CustomerSwitcher } from "../customer-switcher";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../toast-provider", () => ({
	useToast: () => ({ addToast: vi.fn() }),
	ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

function renderAs(permissions: SessionGate["permissions"]) {
	const gate: SessionGate = { roles: [], permissions, authenticated: true, currentTeamId: null };
	return render(<SessionGateProvider value={gate}><CustomerSwitcher /></SessionGateProvider>);
}

describe("CustomerSwitcher", () => {
	beforeEach(() => vi.clearAllMocks());

	it("lets administrators pick all customers or one, and reloads when customers change", async () => {
		vi.mocked(csrfFetch).mockResolvedValueOnce({ teams: [{ id: "a", name: "Acme" }], currentTeamId: null });
		renderAs(["team:read", "team:manage"]);
		expect(await screen.findByRole("option", { name: "Acme" })).toBeInTheDocument();
		expect(screen.getByRole("combobox")).toHaveValue("");

		vi.mocked(csrfFetch).mockResolvedValueOnce({ teams: [{ id: "a", name: "Acme" }, { id: "b", name: "Beta" }], currentTeamId: null });
		act(() => notifyCustomersChanged());
		expect(await screen.findByRole("option", { name: "Beta" })).toBeInTheDocument();
		await waitFor(() => expect(csrfFetch).toHaveBeenCalledTimes(2));
	});

	it("shows a customer account its own customer without a selector", async () => {
		vi.mocked(csrfFetch).mockResolvedValueOnce({ teams: [{ id: "a", name: "Acme" }], currentTeamId: "a" });
		renderAs(["team:read"]);
		expect(await screen.findByText("Acme")).toBeInTheDocument();
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
	});
});
