import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GlobalSearch } from "../global-search";

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
});
