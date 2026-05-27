import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GlobalSearch, getSearchItems } from "../global-search";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

describe("GlobalSearch", () => {
	it("routes to existing application pages from search results", async () => {
		pushMock.mockClear();
		const user = userEvent.setup();
		render(<GlobalSearch />);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
		});
		await user.type(await screen.findByPlaceholderText("搜索页面、操作..."), "快捷服务");
		await user.click(await screen.findByRole("button", { name: /快捷服务/ }));

		expect(pushMock).toHaveBeenCalledWith("/quick-services");
	});

	it("routes health search results to the real health dashboard page", () => {
		const healthItem = getSearchItems().find((item) => item.label === "健康看板");

		expect(healthItem?.href).toBe("/health");
	});

	it("does not expose legacy or missing routes in the search catalog", () => {
		const hrefs = getSearchItems().map((item) => item.href);

		expect(hrefs).not.toContain("/system-health");
		expect(hrefs).not.toContain("/quickservice");
		expect(hrefs).not.toContain("/backup");
		expect(hrefs).not.toContain("/ssh");
	});
});
