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

import { CostCloudBillingPanel } from "../cost-cloud-billing-panel";

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
