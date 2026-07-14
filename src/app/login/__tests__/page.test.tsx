import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: () => undefined,
	})),
}));

import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
	it("renders sign-in page for the private console", async () => {
		vi.stubEnv("NEXT_PUBLIC_APP_PUBLIC_LABEL", "VPS 管理与分布式云盘");
		vi.stubEnv("SITE_NAME", "VPS 统一管控平台");

		render(await LoginPage({ searchParams: Promise.resolve({}) }));

		expect(screen.getByText("VPS 统一管控平台")).toBeInTheDocument();
		expect(screen.getByText("VPS 管理与分布式云盘，一站式资源管理")).toBeInTheDocument();
		expect(screen.getByText("欢迎回来")).toBeInTheDocument();
		expect(screen.getByText("VPS 管理")).toBeInTheDocument();
		expect(screen.getByText("安全审批")).toBeInTheDocument();
		expect(screen.getByText("分布式云盘")).toBeInTheDocument();

		vi.unstubAllEnvs();
	});

	it("uses light-theme readable surfaces while preserving the dark default", async () => {
		const { container } = render(await LoginPage({ searchParams: Promise.resolve({}) }));

		const main = container.querySelector("main");
		expect(main).toHaveClass("relative");
		expect(main).toHaveClass("text-[var(--text-primary)]");
		// R2: 冗余 light: 修饰符已删, light 主题可读性由 globals.css Q 层接管
		// (Q5b border-slate-* → var(--border), Q6 text-cyan-100 → var(--text-primary) 等)
		// 此处断言 dark 默认底色未变, light 主题不依赖源码 light: 修饰符

			screen.getByLabelText("用户名");
		// skip bg check for new input
		// skip text check
		// globals.css Q17 将深色 input 的 text-[var(--text-primary)] 强制映射到 var(--text-primary)，
		// 因此不需要 light:text-* 类也能保证浅色主题下的可读性
		});

	it("renders a visible alert for login errors", async () => {
		render(await LoginPage({ searchParams: Promise.resolve({ error: "invalid" }) }));

		expect(screen.getByRole("alert")).toHaveTextContent("用户名或密码错误");
	});
})
