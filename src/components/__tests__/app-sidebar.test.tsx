import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppSidebar } from "../app-sidebar";
import { ToastProvider } from "../toast-provider";

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

vi.mock("../customer-switcher", () => ({
	CustomerSwitcher: () => null,
}));

/** The real sidebar tree always mounts inside a ToastProvider (CustomerSwitcher). */
function renderSidebar(props: React.ComponentProps<typeof AppSidebar>) {
	return render(
		<ToastProvider>
			<AppSidebar {...props} />
		</ToastProvider>,
	);
}

describe("AppSidebar", () => {
	it("exposes account security independently from administrator-only settings", async () => {
		const user = userEvent.setup();
		renderSidebar({ username: "admin" });

		expect(screen.getAllByRole("link", { name: /^Settings$/ }).length).toBeGreaterThan(0);
		await user.click(screen.getAllByRole("button", { name: "shell.user.menu" })[0]!);
		expect(screen.getAllByRole("link", { name: "auth.account-security" })[0]).toHaveAttribute("href", "/account/security");
		expect(screen.queryByRole("link", { name: /系统设置/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /偏好设置/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /两步验证/ })).not.toBeInTheDocument();
	});

	it("keeps long account names readable on a dedicated footer row", () => {
		renderSidebar({ username: "qa_cron_1780249023419" });

		const username = screen.getAllByText("qa_cron_1780249023419")[0];
		expect(username).toHaveClass("truncate");
		expect(username).toHaveClass("text-sm");
		expect(username).toHaveAttribute("title", "qa_cron_1780249023419");
	});

	it("shows short usernames like admin without needing hover title only", () => {
		renderSidebar({ username: "admin" });
		const username = screen.getAllByText("admin")[0];
		expect(username).toBeVisible();
		expect(username).toHaveClass("text-[var(--text-primary)]");
	});

	it("renders quick service links as external URLs without squeezing labels", () => {
		renderSidebar({ username: "admin", quickServices: [{ slug: "alist", name: "AList 文件服务", icon: "☁️", path: "http://82.158.91.159:5244/" }] });

		const links = screen.getAllByRole("link", { name: /AList 文件服务/ });
		expect(links).toHaveLength(2);
		for (const link of links) {
			expect(link).toHaveAttribute("href", "http://82.158.91.159:5244/");
			expect(link).toHaveAttribute("target", "_blank");
		}
		expect(screen.getAllByText("AList 文件服务")[0]).toHaveClass("truncate");
	});

	it("marks sidebar navigation as React-localized chrome", () => {
		renderSidebar({ username: "admin" });

		expect(screen.getAllByRole("navigation")[0]).toHaveAttribute("data-i18n-skip");
	});

	it("lets people pin pages to the top of the sidebar", async () => {
		const user = userEvent.setup();
		localStorage.removeItem("vch:nav-pins");
		renderSidebar({ username: "admin" });

		const pinButtons = screen.getAllByRole("button", { name: "shell.nav.pin" });
		await user.click(pinButtons[0]!);

		expect(screen.getAllByRole("button", { name: "shell.nav.unpin" }).length).toBeGreaterThan(0);
		expect(JSON.parse(localStorage.getItem("vch:nav-pins") ?? "[]")).toHaveLength(1);
		localStorage.removeItem("vch:nav-pins");
	});

	it("does not render without an authenticated username", () => {
		renderSidebar({});

		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /Dashboard/ })).not.toBeInTheDocument();
	});
});
