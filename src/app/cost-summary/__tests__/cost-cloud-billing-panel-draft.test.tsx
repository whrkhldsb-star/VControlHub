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
