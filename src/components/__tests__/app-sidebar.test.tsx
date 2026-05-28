import { render, screen } from "@testing-library/react";
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
	ThemeToggle: () => <button type="button" aria-label="主题" />,
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

	it("does not render without an authenticated username", () => {
		render(<AppSidebar />);

		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /仪表盘/ })).not.toBeInTheDocument();
	});
});
