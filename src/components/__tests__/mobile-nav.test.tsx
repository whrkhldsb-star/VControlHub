import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme/provider";
import { getMobileNavTabs, MobileNav } from "../mobile-nav";

vi.mock("next/navigation", () => ({
	usePathname: () => "/settings",
}));

function renderWithProviders(ui: React.ReactNode) {
	return render(
		<ThemeProvider>
			<I18nProvider>{ui}</I18nProvider>
		</ThemeProvider>,
	);
}

describe("MobileNav", () => {
	it("does not expose stale routes in mobile bottom navigation", () => {
		const hrefs = getMobileNavTabs().map((tab) => tab.href);

		expect(hrefs).toEqual(["/dashboard", "/servers", "/traffic", "/files", "/settings"]);
		expect(hrefs).not.toContain("/more");
		expect(hrefs).toContain("/settings");
	});

	it("derives mobile tabs by stable hrefs instead of fragile main-nav indexes", () => {
		const labels = getMobileNavTabs().map((tab) => tab.fallbackLabel);

		expect(labels).toEqual(["仪表盘", "VPS 管理", "流量中心", "文件管理", "设置"]);
	});

	it("renders a working settings entry instead of a missing more page", () => {
		renderWithProviders(<MobileNav />);

		const settingsLink = screen.getByRole("link", { name: /设置/ });
		expect(settingsLink).toHaveAttribute("href", "/settings");
	});

	it("keeps the mobile bar compact and safe-area aware on phones", () => {
		renderWithProviders(<MobileNav />);

		const nav = screen.getByRole("navigation", { name: "移动端导航" });
		expect(nav).toHaveClass("md:hidden");
		expect(nav).toHaveClass("overflow-hidden");
		expect(nav).toHaveClass("pb-[calc(0.35rem+env(safe-area-inset-bottom))]");
		expect(nav).toHaveClass("px-1");
		expect(screen.getAllByRole("link")).toHaveLength(5);
	});

	it("exposes language and theme controls directly on the mobile bar", () => {
		renderWithProviders(<MobileNav />);

		expect(screen.getByRole("button", { name: "切换到英文" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeInTheDocument();
	});

	it("renders mobile nav labels from the active language", async () => {
		localStorage.setItem("vps-locale", "en");
		renderWithProviders(<MobileNav />);

		expect(await screen.findByRole("link", { name: /Settings/ })).toHaveAttribute("href", "/settings");
	});
});
