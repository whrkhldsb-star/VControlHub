import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: () => ({ value: "stub-pending-2fa-payload" }),
	})),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
	redirect: vi.fn(),
}));

import Verify2faPage from "@/app/login/verify-2fa/page";

describe("Verify2faPage i18n", () => {
	it("renders the 2FA title and description via t() in default-zh locale", async () => {
		render(
			<I18nProvider initialLocale="zh">
				{await Verify2faPage({ searchParams: Promise.resolve({}) })}
			</I18nProvider>,
		);

		// auth.two-factor — already in dict, now rendered via t()
		expect(screen.getByText("两步验证")).toBeInTheDocument();
		// login.verify2faDescription — new key, zh
		expect(
			screen.getByText("请输入身份验证器应用生成的 6 位动态验证码，或使用已保存的恢复码"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "使用恢复码" })).toBeInTheDocument();
		// login.verify2faBackToLogin — new key, zh
		expect(screen.getByText("返回登录")).toBeInTheDocument();
	});

	it("keeps the back-to-login link target as /login", async () => {
		render(
			<I18nProvider initialLocale="zh">
				{await Verify2faPage({ searchParams: Promise.resolve({}) })}
			</I18nProvider>,
		);

		const backLink = screen.getByRole("link", { name: "返回登录" });
		expect(backLink).toHaveAttribute("href", "/login");
	});

	it("keeps where the person was going on the way back to sign in, and says who resets a lost device", async () => {
		render(
			<I18nProvider initialLocale="zh">
				{await Verify2faPage({ searchParams: Promise.resolve({ next: "/servers/abc" }) })}
			</I18nProvider>,
		);

		expect(screen.getByRole("link", { name: "返回登录" })).toHaveAttribute("href", "/login?next=%2Fservers%2Fabc");
		expect(screen.getByText(/请联系平台管理员为你重置两步验证/)).toBeInTheDocument();
	});
});
