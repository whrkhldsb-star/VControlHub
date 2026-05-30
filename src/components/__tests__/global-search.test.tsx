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

	it("exposes the search overlay as a labelled dialog and combobox listbox", async () => {
		const user = userEvent.setup();
		render(<GlobalSearch />);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
		});

		expect(await screen.findByRole("dialog", { name: "全局搜索" })).toHaveAttribute("aria-modal", "true");
		const input = screen.getByRole("combobox", { name: "搜索页面和操作" });
		expect(input).toHaveAttribute("aria-controls", "global-search-results");
		expect(screen.getByRole("listbox")).toHaveAttribute("id", "global-search-results");

		await user.type(input, "健康");
		expect(screen.getByRole("option", { name: /健康看板/ })).toHaveAttribute("aria-selected", "true");
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
		expect(hrefs).not.toContain("#password");
		expect(hrefs).not.toContain("#2fa");
	});

	it("covers every sidebar navigation item in the global search catalog", () => {
		const hrefs = new Set(getSearchItems().map((item) => item.href));
		const expectedMainAndSystemHrefs = [
			"/",
			"/servers",
			"/health",
			"/traffic",
			"/files",
			"/downloads",
			"/operation-tasks",
			"/shares",
			"/backups",
			"/templates",
			"/deployments",
			"/quick-services",
			"/snippets",
			"/media",
			"/image-bed",
			"/ai",
			"/announcements",
			"/tickets",
			"/requests",
			"/scheduled-tasks",
			"/alert-rules",
			"/notifications",
			"/settings",
			"/users",
			"/api-tokens",
			"/status",
			"/audit",
		];

		for (const href of expectedMainAndSystemHrefs) {
			expect(hrefs).toContain(href);
		}
	});

	it("routes 2FA and password actions to concrete settings anchors instead of dead modal events", async () => {
		pushMock.mockClear();
		const dispatchSpy = vi.spyOn(window, "dispatchEvent");
		const user = userEvent.setup();
		render(<GlobalSearch />);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
		});
		await user.type(await screen.findByPlaceholderText("搜索页面、操作..."), "两步验证");
		await user.click(await screen.findByRole("button", { name: /两步验证/ }));

		expect(pushMock).toHaveBeenCalledWith("/settings#2fa");
		expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: "open-2fa-modal" }));
		expect(getSearchItems().find((item) => item.label === "修改密码")?.href).toBe("/settings#password");
		dispatchSpy.mockRestore();
	});
});
