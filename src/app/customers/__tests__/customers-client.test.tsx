import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { gateFromRoles, SessionGateProvider } from "@/lib/auth/session-context";
import { isScopeSwitchReleasing, registerActiveWork, resetActiveWorkRegistryForTests } from "@/lib/forms/active-work-guard";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { CustomersClient, type Customer } from "../customers-client";

/** A platform administrator working in Acme: may manage customers and users. */
const adminGate = gateFromRoles(["admin"], undefined, "team_a");
const render = (gate = adminGate) => renderWithI18n(<SessionGateProvider value={gate}><CustomersClient /></SessionGateProvider>);

const addToastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/customers" }));
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
	afterEach(() => resetActiveWorkRegistryForTests());

	it("lists customers with their resource counts and the deleted ones", async () => {
		render();
		expect(await screen.findByText("Acme")).toBeInTheDocument();
		expect(screen.getByText("3 台服务器")).toBeInTheDocument();
		expect(screen.getByText("Old Co")).toBeInTheDocument();
	});

	it("deletes a customer only after its name is typed", async () => {
		const user = userEvent.setup();
		render();
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
		render();
		await user.click(await screen.findByText("已删除的客户"));
		await user.click(await screen.findByRole("button", { name: "恢复" }));
		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/teams/team_old/restore", { method: "POST" }));
	});

	it("points a new customer to its next step, the account form with that customer chosen", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockImplementation(async (url, init) =>
			url === "/api/teams" && init?.method === "POST" ? { success: true, team: { id: "team_new", name: "Beta" } } : { teams: [acme], deletedTeams: [gone] });
		render();
		await screen.findByText("Acme");
		await user.click(screen.getByRole("button", { name: "新建客户" }));
		await user.type(screen.getByLabelText("客户名称"), "Beta");
		const createButtons = screen.getAllByRole("button", { name: "新建客户" });
		await user.click(createButtons[createButtons.length - 1]!);
		expect(await screen.findByRole("link", { name: "下一步：为“Beta”创建账号" })).toHaveAttribute("href", "/users?create=1&teamId=team_new");
	});

	it("leaves out the next step for someone who may not create accounts", async () => {
		const user = userEvent.setup();
		render(gateFromRoles([], ["team:read", "team:manage"], null));
		await screen.findByText("Acme");
		await user.click(screen.getByRole("button", { name: "新建客户" }));
		await user.type(screen.getByLabelText("客户名称"), "Beta");
		await user.keyboard("{Enter}");
		expect(await screen.findByText("客户“Beta”已创建，现在还没有可以登录的账号。")).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "下一步：为“Beta”创建账号" })).not.toBeInTheDocument();
	});

	it("says a refused customer in its form, which keeps what was typed", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockImplementation(async (_url, init) => {
			if (init?.method === "POST") throw new Error("标识已被使用");
			return { teams: [acme], deletedTeams: [] };
		});
		render();
		await screen.findByText("Acme");
		await user.click(screen.getByRole("button", { name: "新建客户" }));
		await user.type(screen.getByLabelText("客户名称"), "Beta");
		await user.keyboard("{Enter}");
		expect(await screen.findByRole("alert")).toHaveTextContent("标识已被使用");
		expect(screen.getByLabelText("客户名称")).toHaveValue("Beta");
	});

	it("closes the form from its own Cancel, asking first when something was typed", async () => {
		const user = userEvent.setup();
		render();
		await screen.findByText("Acme");
		await user.click(screen.getByRole("button", { name: "新建客户" }));
		// One Cancel, in the form: the header's command waits while the form is open.
		await user.click(screen.getByRole("button", { name: "取消" }));
		expect(screen.queryByLabelText("客户名称")).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "新建客户" }));
		await user.type(screen.getByLabelText("客户名称"), "Beta");
		await user.click(screen.getByRole("button", { name: "取消" }));
		const dialog = await screen.findByRole("dialog", { name: "放弃未保存的更改？" });
		await user.click(within(dialog).getByRole("button", { name: "放弃并离开" }));
		await waitFor(() => expect(screen.queryByLabelText("客户名称")).not.toBeInTheDocument());
	});

	it("edits a customer in the form it was made with, sending only what changed", async () => {
		const user = userEvent.setup();
		render();
		await user.click(await screen.findByRole("button", { name: "编辑" }));

		expect(screen.getByRole("heading", { name: "编辑客户：Acme" })).toBeInTheDocument();
		expect(screen.getByLabelText("客户名称")).toHaveValue("Acme");
		// The slug cannot change: disabled, with the reason beside it.
		expect(screen.getByLabelText("标识")).toBeDisabled();
		expect(screen.getByText("标识在客户创建后不能修改。")).toBeInTheDocument();
		// While the form is open, the list's edit waits for it.
		expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();

		// Saved without a change: closes without asking the server.
		await user.click(screen.getByRole("button", { name: "保存修改" }));
		expect(screen.queryByLabelText("客户名称")).not.toBeInTheDocument();
		expect(vi.mocked(csrfFetch).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);

		await user.click(screen.getByRole("button", { name: "编辑" }));
		await user.type(screen.getByLabelText("客户名称"), " Corp");
		await user.click(screen.getByRole("button", { name: "保存修改" }));
		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/teams/team_a", expect.objectContaining({
			method: "PATCH",
			body: JSON.stringify({ name: "Acme Corp" }),
		})));
		await waitFor(() => expect(screen.queryByLabelText("客户名称")).not.toBeInTheDocument());
	});

	it("says a refused delete in the dialog, which stays open", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockImplementation(async (_url, init) => {
			if (init?.method === "DELETE") throw new Error("客户仍有运行中的任务");
			return { teams: [acme], deletedTeams: [] };
		});
		render();
		await user.click(await screen.findByRole("button", { name: "删除客户" }));
		const dialog = await screen.findByRole("dialog");
		// Enter in the name field confirms, as the button does.
		await user.type(within(dialog).getByLabelText("输入客户名称“Acme”以确认"), "Acme{Enter}");
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("客户仍有运行中的任务");
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});

	it("warns what deleting the customer being worked in ends, and lets the reload through", async () => {
		const user = userEvent.setup();
		const upload = registerActiveWork("upload", 2);
		let releasingDuringDelete = false;
		vi.mocked(csrfFetch).mockImplementation(async (url, init) => {
			if (init?.method === "DELETE") releasingDuringDelete = isScopeSwitchReleasing();
			return url === "/api/teams" ? { teams: [acme], deletedTeams: [] } : { success: true };
		});
		render();
		await user.click(await screen.findByRole("button", { name: "删除客户" }));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("这是你当前所在的客户")).toBeInTheDocument();
		expect(within(dialog).getByText(/2 个进行中的上传/)).toBeInTheDocument();

		await user.type(within(dialog).getByLabelText("输入客户名称“Acme”以确认"), "Acme");
		await user.click(within(dialog).getByRole("button", { name: "删除客户" }));
		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/teams/team_a", { method: "DELETE" }));
		expect(releasingDuringDelete).toBe(true);
		upload();
	});

	it("does not warn about active work when another customer is deleted", async () => {
		const user = userEvent.setup();
		const upload = registerActiveWork("upload", 1);
		render(gateFromRoles(["admin"], undefined, "team_other"));
		await user.click(await screen.findByRole("button", { name: "删除客户" }));
		expect(within(await screen.findByRole("dialog")).queryByText("这是你当前所在的客户")).not.toBeInTheDocument();
		upload();
	});

	it("offers a retry instead of an empty list when customers cannot load", async () => {
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Database offline"));
		render();
		expect(await screen.findByRole("button", { name: "重试" })).toBeInTheDocument();
		expect(screen.queryByText("还没有客户")).not.toBeInTheDocument();
	});
});
