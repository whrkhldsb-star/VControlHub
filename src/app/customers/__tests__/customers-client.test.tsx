import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { CustomersClient, type Customer } from "../customers-client";

const addToastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({ addToast: addToastMock }),
	ToastProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../identity-templates-section", () => ({ IdentityTemplatesSection: () => null }));
vi.mock("../customer-members-dialog", () => ({ CustomerMembersDialog: () => null }));

const acme: Customer = {
	id: "team_a", slug: "acme", name: "Acme", description: null, createdAt: "2026-10-01T00:00:00.000Z", deletedAt: null,
	_count: { members: 2, servers: 3, storageNodes: 1 },
};
const gone: Customer = { ...acme, id: "team_old", slug: "old", name: "Old Co", deletedAt: "2026-10-05T00:00:00.000Z" };

describe("CustomersClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(csrfFetch).mockImplementation(async (url) =>
			url === "/api/teams" ? { teams: [acme], deletedTeams: [gone] } : { success: true });
	});

	it("lists customers with their resource counts and the deleted ones", async () => {
		render(<CustomersClient />);
		expect(await screen.findByText("Acme")).toBeInTheDocument();
		expect(screen.getByText("3 台服务器")).toBeInTheDocument();
		expect(screen.getByText("Old Co")).toBeInTheDocument();
	});

	it("deletes a customer only after its name is typed", async () => {
		const user = userEvent.setup();
		render(<CustomersClient />);
		await user.click(await screen.findByRole("button", { name: "删除客户" }));
		const dialog = await screen.findByRole("dialog");
		const confirm = within(dialog).getByRole("button", { name: "删除客户" });
		expect(confirm).toBeDisabled();
		await user.type(within(dialog).getByLabelText("输入客户名称“Acme”以确认"), "Acme");
		await user.click(confirm);
		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/teams/team_a", { method: "DELETE" }));
	});

	it("restores a deleted customer", async () => {
		const user = userEvent.setup();
		render(<CustomersClient />);
		await user.click(await screen.findByText("已删除的客户（1）"));
		await user.click(await screen.findByRole("button", { name: "恢复" }));
		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/teams/team_old/restore", { method: "POST" }));
	});
});
