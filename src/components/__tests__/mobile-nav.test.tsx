import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
	SessionGateProvider,
	type SessionGate,
} from "@/lib/auth/session-context";
import type { Permission } from "@/lib/auth/rbac";
import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme/provider";
import { OPEN_MOBILE_NAV_EVENT } from "../app-sidebar";
import { getMobileNavTabs, MobileNav } from "../mobile-nav";

vi.mock("next/navigation", () => ({
	usePathname: () => "/settings",
}));

const SAMPLE_DECLARED = {
	"/dashboard": [],
	"/servers": ["server:read", "server:ssh", "server:write"],
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

		expect(hrefs).toEqual(["/dashboard", "/servers", "/operation-tasks", "/files"]);
		expect(hrefs).not.toContain("/more");
	});

	it("derives mobile tabs by stable hrefs instead of fragile main-nav indexes", () => {
		const labels = getMobileNavTabs().map((tab) => tab.fallbackLabel);

		expect(labels).toEqual(["Dashboard", "VPS Management", "Tasks", "Files"]);
	});

	it("opens the full navigation drawer from the More tab instead of a missing more page", async () => {
		const user = userEvent.setup();
		const opened = vi.fn();
		window.addEventListener(OPEN_MOBILE_NAV_EVENT, opened);
		try {
			renderWithProviders(<MobileNav />);
			await user.click(screen.getByRole("button", { name: /更多/ }));
			expect(opened).toHaveBeenCalledTimes(1);
		} finally {
			window.removeEventListener(OPEN_MOBILE_NAV_EVENT, opened);
		}
	});

	it("keeps the mobile bar compact and safe-area aware on phones", () => {
		renderWithProviders(<MobileNav />);

		const nav = screen.getByRole("navigation", { name: "移动端导航" });
		expect(nav).toHaveClass("lg:hidden");
		expect(nav).toHaveClass("pb-[calc(0.25rem+env(safe-area-inset-bottom))]");
		expect(screen.getAllByRole("link")).toHaveLength(4);
	});

	it("leaves language and theme controls to the top bar", () => {
		renderWithProviders(<MobileNav />);

		expect(screen.queryByRole("button", { name: "切换到英文" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "切换到浅色模式" })).not.toBeInTheDocument();
	});

	it("renders mobile nav labels from the active language", async () => {
		localStorage.setItem("vps-locale", "en");
		renderWithProviders(<MobileNav />);

		expect(await screen.findByRole("link", { name: /Files/ })).toHaveAttribute("href", "/files");
		localStorage.removeItem("vps-locale");
	});

	it("filters tabs by declaredPermissionsByHref like the sidebar", () => {
		renderWithProviders(
			<MobileNav declaredPermissionsByHref={SAMPLE_DECLARED} />,
			READ_ONLY_GATE,
		);

		const hrefs = screen.getAllByRole("link").map((el) => el.getAttribute("href"));
		expect(hrefs).toEqual(["/dashboard", "/servers"]);
		expect(hrefs).not.toContain("/files");
	});
});
