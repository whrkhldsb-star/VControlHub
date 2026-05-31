import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RootLayout from "@/app/layout";

const cookieGetMock = vi.fn();
const headerGetMock = vi.fn();

vi.mock("next/font/google", () => ({
	Geist: () => ({ variable: "geist-sans" }),
	Geist_Mono: () => ({ variable: "geist-mono" }),
}));

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({ get: cookieGetMock })),
	headers: vi.fn(async () => ({ get: headerGetMock })),
}));

vi.mock("@/components/sidebar-loader", () => ({
	SidebarLoader: () => <aside data-testid="sidebar-loader" />,
}));

vi.mock("@/components/toast-provider", () => ({
	ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/mobile-nav", () => ({
	MobileNav: () => <nav aria-label="移动端底部导航" />,
}));

vi.mock("@/components/global-search", () => ({
	GlobalSearch: () => <div data-testid="global-search" />,
}));

vi.mock("@/lib/i18n/provider", () => ({
	I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/auth/session", () => ({
	getSessionCookieName: () => "vcontrolhub_session",
}));

describe("RootLayout", () => {
	beforeEach(() => {
		cookieGetMock.mockReset();
		headerGetMock.mockReset();
		headerGetMock.mockReturnValue(null);
	});

	it("does not render authenticated chrome before a session exists", async () => {
		cookieGetMock.mockReturnValue(undefined);

		render(await RootLayout({ children: <div>登录</div> }));

		expect(screen.queryByRole("navigation", { name: "移动端底部导航" })).not.toBeInTheDocument();
		expect(screen.queryByTestId("global-search")).not.toBeInTheDocument();
	});

	it("renders mobile navigation and global search for authenticated sessions", async () => {
		cookieGetMock.mockReturnValue({ value: "session-token" });

		render(await RootLayout({ children: <div>仪表盘</div> }));

		expect(screen.getByTestId("sidebar-loader")).toBeInTheDocument();
		expect(screen.getByRole("navigation", { name: "移动端底部导航" })).toBeInTheDocument();
		expect(screen.getByTestId("global-search")).toBeInTheDocument();
	});

	it("hides authenticated chrome on public login pages even when a session cookie still exists", async () => {
		cookieGetMock.mockReturnValue({ value: "session-token" });
		headerGetMock.mockImplementation((name: string) =>
			name === "x-vcontrolhub-public-auth-page" ? "1" : null,
		);

		render(await RootLayout({ children: <div>欢迎回来</div> }));

		expect(screen.queryByTestId("sidebar-loader")).not.toBeInTheDocument();
		expect(screen.queryByRole("navigation", { name: "移动端底部导航" })).not.toBeInTheDocument();
		expect(screen.queryByTestId("global-search")).not.toBeInTheDocument();
	});
});
