import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
	it("renders sign-in page for the private console", async () => {
		vi.stubEnv("NEXT_PUBLIC_APP_PUBLIC_LABEL", "VPS 管理与分布式云盘");
		vi.stubEnv("SITE_NAME", "VPS 统一管控平台");

		render(await LoginPage({ searchParams: Promise.resolve({}) }));

		expect(screen.getByText("VPS 统一管控平台")).toBeInTheDocument();
		expect(screen.getByText("VPS 管理与分布式云盘，一站掌控。")).toBeInTheDocument();
		expect(screen.getByText("欢迎回来")).toBeInTheDocument();
		expect(screen.getByText("VPS 管理")).toBeInTheDocument();
		expect(screen.getByText("安全审批")).toBeInTheDocument();
		expect(screen.getByText("分布式云盘")).toBeInTheDocument();

		vi.unstubAllEnvs();
	});

	it("uses light-theme readable surfaces while preserving the dark default", async () => {
		const { container } = render(await LoginPage({ searchParams: Promise.resolve({}) }));

		const main = container.querySelector("main");
		expect(main).toHaveClass("bg-[#050508]");
		expect(main).toHaveClass("text-white");
		expect(main?.className).toContain("light:bg-slate-50");
		expect(main?.className).toContain("light:text-slate-950");

		const username = screen.getByLabelText("用户名");
		expect(username.className).toContain("bg-white/[0.04]");
		expect(username.className).toContain("text-white");
		expect(username.className).toContain("light:bg-white");
		expect(username.className).toContain("light:text-slate-950");
	});

	it("renders a visible alert for login errors", async () => {
		render(await LoginPage({ searchParams: Promise.resolve({ error: "invalid" }) }));

		expect(screen.getByRole("alert")).toHaveTextContent("用户名或密码错误");
	});
});
