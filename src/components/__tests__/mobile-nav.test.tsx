import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
	SessionGateProvider,
	type SessionGate,
} from "@/lib/auth/session-context";
import type { Permission } from "@/lib/auth/rbac";
import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme/provider";
import { getMobileNavTabs, MobileNav } from "../mobile-nav";

vi.mock("next/navigation", () => ({
	usePathname: () => "/settings",
}));

const SAMPLE_DECLARED = {
	"/dashboard": [],
	"/servers": ["server:ssh", "server:write"],
	"/operation-tasks": ["task:read"],
	"/files": ["storage:write", "storage:read"],
	"/settings": [],
} as const satisfies Record<string, readonly Permission[]>;

const READ_ONLY_GATE: SessionGate = {
	roles: [],
	permissions: ["server:read"],
	authenticated: true,
};

function renderWithProviders(
	ui: React.ReactNode,
	gate: SessionGate = {
		roles: [],
		permissions: [],
		authenticated: true,
	},
) {
	function Wrapper({ children }: { children: ReactNode }) {
		return (
			<ThemeProvider>
				<I18nProvider>
					<SessionGateProvider value={gate}>{children}</SessionGateProvider>
				</I18nProvider>
			</ThemeProvider>
		);
	}
	return render(ui, { wrapper: Wrapper });
}

describe("MobileNav", () => {
	it("does not expose stale routes in mobile bottom navigation", () => {
		const hrefs = getMobileNavTabs().map((tab) => tab.href);

		expect(hrefs).toEqual(["/dashboard", "/servers", "/operation-tasks", "/files", "/settings"]);
		expect(hrefs).not.toContain("/more");
		expect(hrefs).toContain("/settings");
	});

	it("derives mobile tabs by stable hrefs instead of fragile main-nav indexes", () => {
		const labels = getMobileNavTabs().map((tab) => tab.fallbackLabel);

		expect(labels).toEqual(["Dashboard", "VPS Management", "Tasks", "Files", "Settings"]);
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
		expect(nav).toHaveClass("pb-[calc(0.4rem+env(safe-area-inset-bottom))]");
		expect(nav).toHaveClass("px-1.5");
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

	it("filters tabs by declaredPermissionsByHref like the sidebar", () => {
		renderWithProviders(
			<MobileNav declaredPermissionsByHref={SAMPLE_DECLARED} />,
			READ_ONLY_GATE,
		);

		const hrefs = screen.getAllByRole("link").map((el) => el.getAttribute("href"));
			expect(hrefs).toEqual(["/dashboard", "/settings"]);
		expect(hrefs).not.toContain("/servers");
		expect(hrefs).not.toContain("/files");
	});
});
