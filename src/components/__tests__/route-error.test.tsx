import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RouteError } from "../route-error";
import { renderWithI18n as renderI18n } from "@/lib/i18n/__tests__/test-helpers";

function makeError(message: string, digest?: string): Error & { digest?: string } {
	const err = new Error(message) as Error & { digest?: string };
	if (digest) err.digest = digest;
	return err;
}

describe("RouteError", () => {
	it("renders localized Chinese copy via t() for all hardcoded strings (zh)", () => {
		const error = makeError("", "abc123");
		renderI18n(
			<RouteError error={error} reset={vi.fn()} />,
			{ locale: "zh" },
		);

		expect(screen.getByRole("heading", { name: "页面加载出错" })).toBeInTheDocument();
		expect(
			screen.getByText("当前页面遇到了异常，已保留现场信息。你可以重试，或稍后从系统自检/日志中继续排查。"),
		).toBeInTheDocument();
		expect(screen.getByText(/错误标识:\s*abc123/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "硬刷新" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "系统自检" })).toHaveAttribute("href", "/health");
	});

	it("renders localized English copy via t() for all hardcoded strings (en)", () => {
		const error = makeError("", "abc123");
		renderI18n(
			<RouteError error={error} reset={vi.fn()} />,
			{ locale: "en" },
		);

		expect(screen.getByRole("heading", { name: "Page failed to load" })).toBeInTheDocument();
		expect(
			screen.getByText(
				"The current page hit an error and the trace has been preserved. You can retry, or check the system health and logs.",
			),
		).toBeInTheDocument();
		expect(screen.getByText(/Error ID:\s*abc123/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Hard refresh" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "System health check" })).toHaveAttribute("href", "/health");
	});

	it("falls back to error.message when provided and skips the digest row without digest", () => {
		renderI18n(
			<RouteError error={makeError("数据库连接失败")} reset={vi.fn()} />,
			{ locale: "zh" },
		);

		expect(screen.getByText("数据库连接失败")).toBeInTheDocument();
		expect(screen.queryByText(/错误标识:/)).not.toBeInTheDocument();
	});

	it("invokes reset when the retry button is clicked", () => {
		const reset = vi.fn();
		renderI18n(
			<RouteError error={makeError("boom")} reset={reset} />,
			{ locale: "zh" },
		);

		screen.getByRole("button", { name: "重试" }).click();
		expect(reset).toHaveBeenCalledTimes(1);
	});
});
