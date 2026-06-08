import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppSidebar } from "../app-sidebar";

vi.mock("next/navigation", () => ({
	usePathname: () => "/settings",
}));

vi.mock("../sign-out-button", () => ({
	SignOutButton: () => <button type="button">退出登录</button>,
}));

vi.mock("../change-password-modal", () => ({
	ChangePasswordModal: () => null,
}));

vi.mock("../notification-bell", () => ({
	NotificationBell: () => <button type="button" aria-label="通知" />,
}));

vi.mock("../theme-toggle", () => ({
	ThemeToggle: () => <button type="button" aria-label="Switch to light mode" />,
}));

vi.mock("../language-toggle", () => ({
	LanguageToggle: () => <button type="button" aria-label="语言" />,
}));

describe("AppSidebar", () => {
	it("keeps two-factor controls centralized under system settings instead of a separate menu item", () => {
		render(<AppSidebar username="admin" />);

		expect(screen.getAllByRole("link", { name: /系统设置/ }).length).toBeGreaterThan(0);
		expect(screen.queryByRole("link", { name: /两步验证/ })).not.toBeInTheDocument();
	});

	it("keeps long account names and controls inside the sidebar footer", () => {
		render(<AppSidebar username="qa_cron_1780249023419" />);

		const username = screen.getAllByText("qa_cron_1780249023419")[0];
		expect(username).toHaveClass("flex-1");
		expect(username).toHaveClass("truncate");
		expect(username).toHaveAttribute("title", "qa_cron_1780249023419");
	});

	it("renders quick service links as external URLs without squeezing labels", () => {
		render(<AppSidebar username="admin" quickServices={[{ slug: "alist", name: "AList 文件服务", icon: "☁️", path: "http://82.158.91.159:5244/" }]} />);

		const links = screen.getAllByRole("link", { name: /AList 文件服务/ });
		expect(links).toHaveLength(2);
		for (const link of links) {
			expect(link).toHaveAttribute("href", "http://82.158.91.159:5244/");
			expect(link).toHaveAttribute("target", "_blank");
		}
		expect(screen.getAllByText("AList 文件服务")[0]).toHaveClass("truncate");
	});

	it("marks sidebar navigation as React-localized chrome", () => {
		render(<AppSidebar username="admin" />);

		expect(screen.getAllByRole("navigation")[0]).toHaveAttribute("data-i18n-skip");
		expect(screen.getAllByRole("button", { name: "Switch to light mode" }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("button", { name: "通知" }).length).toBeGreaterThan(0);
	});

	it("exposes a visible search control that opens global search without relying on hidden shortcuts", async () => {
		const dispatchSpy = vi.spyOn(window, "dispatchEvent");
		const user = userEvent.setup();
		render(<AppSidebar username="admin" />);

		const searchButtons = screen.getAllByRole("button", { name: "全局搜索" });
		expect(searchButtons[0]).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
		await user.click(searchButtons[0]);

		expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "vcontrolhub:open-global-search" }));
		dispatchSpy.mockRestore();
	});

	it("does not render without an authenticated username", () => {
		render(<AppSidebar />);

		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /仪表盘/ })).not.toBeInTheDocument();
	});
});
