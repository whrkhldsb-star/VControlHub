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
});
