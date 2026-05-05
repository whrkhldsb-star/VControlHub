import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
	it("renders sign-in page for the private console", async () => {
		render(await LoginPage({ searchParams: Promise.resolve({}) }));

		expect(screen.getByText(/统一管控/)).toBeInTheDocument();
		expect(screen.getByText(/VPS 节点管理、命令审批执行与分布式云盘/)).toBeInTheDocument();
		expect(screen.getByText("欢迎回来")).toBeInTheDocument();
		expect(screen.getByText("VPS 管理")).toBeInTheDocument();
		expect(screen.getByText("安全审批")).toBeInTheDocument();
		expect(screen.getByText("分布式云盘")).toBeInTheDocument();
	});
});
