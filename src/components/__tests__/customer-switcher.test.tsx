import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionGateProvider, type SessionGate } from "@/lib/auth/session-context";
import { csrfFetch } from "@/lib/auth/csrf-client";
import {
	isScopeSwitchReleasing,
	registerActiveWork,
	resetActiveWorkRegistryForTests,
} from "@/lib/forms/active-work-guard";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { notifyCustomersChanged } from "@/lib/team/customers-changed";
import { CustomerSwitcher } from "../customer-switcher";

const mockRefresh = vi.fn();
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("../toast-provider", () => ({
	useToast: () => ({ addToast: vi.fn() }),
	ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

function renderAs(permissions: SessionGate["permissions"], compact = false) {
	const gate: SessionGate = { roles: [], permissions, authenticated: true, currentTeamId: null };
	return render(<SessionGateProvider value={gate}><CustomerSwitcher compact={compact} /></SessionGateProvider>);
}

describe("CustomerSwitcher", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetActiveWorkRegistryForTests();
	});
	afterEach(() => {
		resetActiveWorkRegistryForTests();
	});

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

	it("keeps the last confirmed customers when a refresh fails and offers a retry", async () => {
		vi.mocked(csrfFetch).mockResolvedValueOnce({ teams: [{ id: "a", name: "Acme" }], currentTeamId: "a" });
		renderAs(["team:read", "team:manage"]);
		expect(await screen.findByRole("option", { name: "Acme" })).toBeInTheDocument();

		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Network down"));
		act(() => notifyCustomersChanged());
		expect(await screen.findByRole("alert")).toHaveTextContent("客户列表加载失败");
		expect(screen.getByRole("option", { name: "Acme" })).toBeInTheDocument();
		expect(screen.getByRole("combobox")).toHaveValue("a");

		vi.mocked(csrfFetch).mockResolvedValueOnce({ teams: [{ id: "a", name: "Acme" }, { id: "b", name: "Beta" }], currentTeamId: "a" });
		act(() => screen.getByRole("button", { name: "重试" }).click());
		expect(await screen.findByRole("option", { name: "Beta" })).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
	});

	it("says the customer list could not load instead of showing none", async () => {
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Network down"));
		renderAs(["team:read", "team:manage"]);
		expect(await screen.findByRole("alert")).toHaveTextContent("客户列表加载失败");
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
	});

	it("confirms before switching when active work exists, handles cancel and failed POST", async () => {
		vi.mocked(csrfFetch).mockResolvedValueOnce({ teams: [{ id: "a", name: "Acme" }], currentTeamId: null });
		const unregTerm = registerActiveWork("terminal", 2);
		const unregForm = registerActiveWork("dirtyForm", 1);
		renderAs(["team:read", "team:manage"]);
		expect(await screen.findByRole("option", { name: "Acme" })).toBeInTheDocument();

		fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });
		expect(await screen.findByRole("dialog")).toHaveTextContent("Acme");
		expect(screen.getByRole("dialog")).toHaveTextContent("2 个打开的终端");
		expect(screen.getByRole("dialog")).toHaveTextContent("1 个未保存的表单");
		expect(csrfFetch).toHaveBeenCalledTimes(1);

		// Cancel leaves server scope untouched
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(csrfFetch).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("combobox")).toHaveValue("");

		// Failed POST keeps dialog open and restores guards
		fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });
		expect(await screen.findByRole("dialog")).toBeInTheDocument();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Switch refused"));
		fireEvent.click(screen.getByRole("button", { name: "继续切换" }));
		expect(await screen.findByText("Switch refused")).toBeInTheDocument();
		expect(isScopeSwitchReleasing()).toBe(false);
		expect(mockRefresh).not.toHaveBeenCalled();

		// Retry succeeds
		vi.mocked(csrfFetch).mockResolvedValueOnce({ ok: true });
		fireEvent.click(screen.getByRole("button", { name: "继续切换" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(mockRefresh).toHaveBeenCalledTimes(1);

		unregTerm();
		unregForm();
	});

	it("shows a compact active-customer indicator when the sidebar is collapsed", async () => {
		vi.mocked(csrfFetch).mockResolvedValueOnce({ teams: [{ id: "a", name: "Acme" }], currentTeamId: "a" });
		renderAs(["team:read", "team:manage"], true);
		expect(await screen.findByRole("button", { name: "当前客户：Acme" })).toHaveTextContent("A");
	});
});
