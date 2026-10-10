import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import { AppTopbar } from "../app-topbar";

const navigation = vi.hoisted(() => ({ pathname: "/files/webdav" }));

vi.mock("next/navigation", () => ({
	usePathname: () => navigation.pathname,
}));

vi.mock("../notification-bell", () => ({
	NotificationBell: () => <button type="button" aria-label="通知" />,
}));

vi.mock("../theme-toggle", () => ({
	ThemeToggle: () => <button type="button" aria-label="切换到浅色模式" />,
}));

vi.mock("../language-toggle", () => ({
	LanguageToggle: () => <button type="button" aria-label="切换到英文" />,
}));

function renderTopbar() {
	return render(
		<I18nProvider initialLocale="zh">
			<AppTopbar appName="VControlHub" />
		</I18nProvider>,
	);
}

describe("AppTopbar", () => {
	afterEach(() => {
		navigation.pathname = "/files/webdav";
		localStorage.removeItem("vch:recent-pages");
		document.documentElement.removeAttribute("data-sidebar");
	});

	it("shows where the page sits in the navigation as a breadcrumb", () => {
		renderTopbar();

		const breadcrumb = screen.getByRole("navigation", { name: "当前位置" });
		expect(breadcrumb).toHaveTextContent("文件与传输");
		expect(screen.getByRole("link", { name: "文件管理" })).toHaveAttribute("href", "/files");
		expect(screen.getByText("WebDAV 接入")).toHaveAttribute("aria-current", "page");
	});

	it("names the browser tab after the current page", () => {
		navigation.pathname = "/alert-rules";
		renderTopbar();

		expect(document.title).toBe("告警规则 · VControlHub");
	});

	it("exposes a visible search control that opens global search without relying on hidden shortcuts", async () => {
		const user = userEvent.setup();
		const opened = vi.fn();
		window.addEventListener("vcontrolhub:open-global-search", opened);
		try {
			renderTopbar();
			const search = screen.getByRole("button", { name: "全局搜索" });
			expect(search).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
			await user.click(search);
			expect(opened).toHaveBeenCalledTimes(1);
		} finally {
			window.removeEventListener("vcontrolhub:open-global-search", opened);
		}
	});

	it("collapses the sidebar and remembers the choice", async () => {
		const user = userEvent.setup();
		renderTopbar();

		await user.click(screen.getByRole("button", { name: "收起侧边栏" }));

		expect(document.documentElement).toHaveAttribute("data-sidebar", "collapsed");
		expect(document.cookie).toContain("vch-sidebar=collapsed");
		expect(screen.getByRole("button", { name: "展开侧边栏" })).toHaveAttribute("aria-pressed", "true");
	});

	it("records visited pages for the command palette", () => {
		navigation.pathname = "/servers";
		renderTopbar();

		expect(JSON.parse(localStorage.getItem("vch:recent-pages") ?? "[]")).toContain("/servers");
	});

	it("keeps notifications and appearance controls in the bar", () => {
		renderTopbar();

		expect(screen.getByRole("button", { name: "通知" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeInTheDocument();
	});
});
