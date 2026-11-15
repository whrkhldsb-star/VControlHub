import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.fetch }));
vi.mock("@/components/toast-provider", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/toast-provider")>()),
	useToast: () => ({ addToast: mocks.toast }),
}));
// The edit form's unsaved-changes guard intercepts navigation through the router.
vi.mock("next/navigation", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/navigation")>()),
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { CostCloudBillingPanel, changedBillingFields } from "../cost-cloud-billing-panel";

/** A success for account A must not wipe account B, typed while A was saving. */
describe("CostCloudBillingPanel drafts", () => {
	it("keeps a next account typed while the previous one was saving", async () => {
		const user = userEvent.setup();
		let finish: (value: unknown) => void = () => undefined;
		mocks.fetch.mockImplementation((_url: string, init?: { method?: string }) =>
			init?.method === "POST" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ accounts: [] }));
		render(<CostCloudBillingPanel initialAccounts={[]} canManage currencies={["USD"]} month="2026-10" />);

		const name = screen.getByLabelText("账户名称");
		await user.type(name, "A");
		// A generic CSV account reads its bill from a CSV address or pasted CSV.
		await user.type(screen.getByLabelText("账单 CSV 地址（可选）"), "https://bills.example.com/a.csv");
		await user.click(screen.getByRole("button", { name: "添加账单账户" }));
		await user.clear(name);
		await user.type(name, "B");
		finish({ id: "a" });

		await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", expect.any(String)));
		expect(name).toHaveValue("B");
	});
});

/** The line read "最近同步：partial · 2026-11-10 16:30:00": the stored word, and the UTC clock passed off as local. */
describe("CostCloudBillingPanel last sync", () => {
	const account = {
		id: "acc-1", name: "生产账单", provider: "aws" as const, currency: "USD" as const, enabled: true, config: {}, hasCredentials: false,
		teamId: null, lastSyncAt: "2026-11-10T16:30:00.000Z", lastSyncStatus: "partial" as const, lastSyncError: null,
		lastSyncImported: 3, lastSyncSkipped: 1, createdById: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-10T16:30:00.000Z",
	};

	it("shows when and how the last sync ended in the application's time zone and the reader's language", () => {
		const zh = render(<CostCloudBillingPanel initialAccounts={[account]} canManage={false} currencies={["USD"]} month="2026-11" />);
		expect(screen.getByText("最近同步：部分成功 · 2026/11/11 00:30:00 · 导入 3 条")).toBeInTheDocument();
		zh.unmount();

		render(<CostCloudBillingPanel initialAccounts={[{ ...account, lastSyncStatus: "error" }]} canManage={false} currencies={["USD"]} month="2026-11" />, { locale: "en" });
		expect(screen.getByText("Last sync: Failed · 11/11/2026, 00:30:00 · imported 3")).toBeInTheDocument();
	});
});

/** The sentence was filled in with String.replace, which reads "$&" and "$'" in the inserted name as instructions. */
describe("CostCloudBillingPanel delete confirmation", () => {
	it("names the account as it is written", async () => {
		const user = userEvent.setup();
		const account = {
			id: "acc-1", name: "AWS $& 主账户 $'", provider: "aws" as const, currency: "USD" as const, enabled: true, config: {}, hasCredentials: false,
			teamId: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null,
			lastSyncImported: 0, lastSyncSkipped: 0, createdById: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-10T16:30:00.000Z",
		};
		render(<CostCloudBillingPanel initialAccounts={[account as never]} canManage currencies={["USD"]} month="2026-11" />);
		await user.click(screen.getByRole("button", { name: "删除" }));
		expect(screen.getByText("确认删除账单账户“AWS $& 主账户 $'”？凭证与导入配置将一并移除。")).toBeInTheDocument();
	});
});

/** An account could not be changed once added: a new CSV address meant deleting it, with its settings, and adding it again. */
describe("CostCloudBillingPanel changes", () => {
	const account = {
		id: "acc-1", name: "CSV bills", provider: "generic_csv" as const, currency: "USD" as const, enabled: true,
		config: { accountId: "1234", billingCsvUrl: "https://bills.example.com/a.csv", categoryMap: { compute: "vps" as const } }, hasCredentials: false,
		teamId: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null,
		lastSyncImported: 0, lastSyncSkipped: 0, createdById: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
	};

	it("sends what changed, the settings whole with what the form does not show", () => {
		const form = { name: "CSV bills", provider: "generic_csv" as const, currency: "USD" as const, region: "", sampleCsv: "", billingCsvUrl: "https://bills.example.com/a.csv" };
		expect(changedBillingFields(account, form)).toEqual({});
		expect(changedBillingFields(account, { ...form, name: " Bills ", currency: "CNY" as const })).toEqual({ name: "Bills", currency: "CNY" });
		expect(changedBillingFields(account, { ...form, billingCsvUrl: "https://bills.example.com/b.csv" })).toEqual({
			config: { accountId: "1234", categoryMap: { compute: "vps" }, billingCsvUrl: "https://bills.example.com/b.csv" },
		});
	});

	it("opens an account in the form, keeps its provider and saves the change", async () => {
		const user = userEvent.setup();
		mocks.fetch.mockReset();
		mocks.toast.mockReset();
		mocks.fetch.mockResolvedValue({ accounts: [account] });
		render(<CostCloudBillingPanel initialAccounts={[account]} canManage currencies={["USD", "CNY"]} month="2026-11" />);

		await user.click(screen.getByRole("button", { name: "编辑" }));
		expect(screen.getByRole("heading", { name: "编辑账单账户：CSV bills" })).toBeInTheDocument();
		expect(screen.getByLabelText("账户名称")).toHaveValue("CSV bills");
		expect(screen.getByLabelText("云厂商")).toBeDisabled();
		expect(screen.getByText("添加后不能更改云厂商。")).toBeInTheDocument();
		const url = screen.getByLabelText("账单 CSV 地址（可选）");
		expect(url).toHaveValue("https://bills.example.com/a.csv");

		await user.clear(url);
		await user.type(url, "https://bills.example.com/b.csv");
		await user.click(screen.getByRole("button", { name: "保存修改" }));

		await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/api/cost/billing-accounts/acc-1", expect.objectContaining({ method: "PATCH" })));
		const [, init] = mocks.fetch.mock.calls.find(([url]) => url === "/api/cost/billing-accounts/acc-1")!;
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({
			config: { accountId: "1234", categoryMap: { compute: "vps" }, billingCsvUrl: "https://bills.example.com/b.csv" },
		});
		expect(mocks.toast).toHaveBeenCalledWith("success", "已保存对“CSV bills”的修改");
	});

	it("will not save a generic CSV account with neither a CSV address nor CSV content", async () => {
		const user = userEvent.setup();
		mocks.fetch.mockReset();
		render(<CostCloudBillingPanel initialAccounts={[account]} canManage currencies={["USD"]} month="2026-11" />);
		await user.click(screen.getByRole("button", { name: "编辑" }));
		await user.clear(screen.getByLabelText("账单 CSV 地址（可选）"));
		await user.click(screen.getByRole("button", { name: "保存修改" }));
		expect(screen.getByRole("alert")).toHaveTextContent("通用 CSV 账户需要填写账单 CSV 地址或粘贴 CSV 内容");
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	// The card said "已停用" and greyed out its sync, but nothing on the page switched an account on or off.
	it("switches an account off and on", async () => {
		const user = userEvent.setup();
		mocks.fetch.mockReset();
		mocks.toast.mockReset();
		mocks.fetch.mockImplementation((_url: string, init?: { method?: string }) =>
			Promise.resolve(init?.method === "PATCH" ? {} : { accounts: [{ ...account, enabled: false }] }));
		render(<CostCloudBillingPanel initialAccounts={[account]} canManage currencies={["USD"]} month="2026-11" />);

		await user.click(screen.getByRole("button", { name: "停用" }));
		await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/api/cost/billing-accounts/acc-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) })));
		expect(mocks.toast).toHaveBeenCalledWith("success", "已停用“CSV bills”");
		expect(await screen.findByRole("button", { name: "启用" })).toBeInTheDocument();
		expect(screen.getByText("已停用")).toBeInTheDocument();
	});
});
