import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getMobileNavTabs, MobileNav } from "../mobile-nav";

vi.mock("next/navigation", () => ({
	usePathname: () => "/settings",
}));

describe("MobileNav", () => {
	it("does not expose stale routes in mobile bottom navigation", () => {
		const hrefs = getMobileNavTabs().map((tab) => tab.href);

		expect(hrefs).not.toContain("/more");
		expect(hrefs).toContain("/settings");
	});

	it("renders a working settings entry instead of a missing more page", () => {
		render(<MobileNav />);

		const settingsLink = screen.getByRole("link", { name: /设置/ });
		expect(settingsLink).toHaveAttribute("href", "/settings");
	});

	it("keeps the mobile bar compact and safe-area aware on phones", () => {
		render(<MobileNav />);

		const nav = screen.getByRole("navigation", { name: "移动端底部导航" });
		expect(nav).toHaveClass("md:hidden");
		expect(nav).toHaveClass("overflow-x-auto");
		expect(nav).toHaveClass("pb-[env(safe-area-inset-bottom)]");
		expect(nav).toHaveClass("max-[360px]:px-1");
		expect(screen.getAllByRole("link")).toHaveLength(5);
	});
});
