import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";

import { RouteError } from "../route-error";
import { renderWithI18n as renderI18n } from "@/lib/i18n/__tests__/test-helpers";

function makeError(message: string, digest?: string): Error & { digest?: string } {
	const err = new Error(message) as Error & { digest?: string };
	if (digest) err.digest = digest;
	return err;
}

describe("RouteError", () => {
	it("tells a tab from before a deploy to reload instead of showing a fault", () => {
		const error = new UnrecognizedActionError("Server Action \"abc\" was not found on the server.");
		renderI18n(<RouteError error={error} reset={vi.fn()} />, { locale: "zh" });
		expect(screen.getByRole("heading", { name: "系统刚刚更新" })).toBeInTheDocument();
		expect(screen.getByText(/这个页面还是更新前的版本/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "刷新页面" })).toBeInTheDocument();
		expect(screen.queryByText(/was not found on the server/)).not.toBeInTheDocument();
	});

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
		expect(screen.getByText(/错误标识：\s*abc123/)).toBeInTheDocument();
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
		expect(screen.queryByText(/错误标识：/)).not.toBeInTheDocument();
	});

	it("shows the permission-denied surface for a redacted production error that kept the FORBIDDEN digest", () => {
		// What a production build hands the boundary for a ForbiddenError thrown
		// during a server render: generic name and message, digest preserved.
		const redacted = makeError("An error occurred in the Server Components render.", "FORBIDDEN");
		renderI18n(<RouteError error={redacted} reset={vi.fn()} />, { locale: "zh" });

		expect(screen.queryByRole("heading", { name: "页面加载出错" })).not.toBeInTheDocument();
		expect(screen.queryByText(/错误标识：/)).not.toBeInTheDocument();
		expect(screen.getByText(/权限/)).toBeInTheDocument();
	});

	// A production build forwards a server render failure with a generic English sentence in place of its message
	// (Next: file-conventions/error, "error.message") and the digest that finds it in the server log. The message
	// was shown whenever there was one, so the localized description below was never reached.
	it("describes a server render failure in the page language, not with the sentence a production build substitutes", () => {
		const substituted = makeError(
			"An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.",
			"3912441712",
		);
		renderI18n(<RouteError error={substituted} reset={vi.fn()} />, { locale: "zh" });

		expect(
			screen.getByText("当前页面遇到了异常，已保留现场信息。你可以重试，或稍后从系统自检/日志中继续排查。"),
		).toBeInTheDocument();
		expect(screen.queryByText(/Server Components render/)).not.toBeInTheDocument();
		expect(screen.getByText(/错误标识：\s*3912441712/)).toBeInTheDocument();
	});

	it("keeps the message of a failure in the browser, which is the real one", () => {
		renderI18n(<RouteError error={makeError("Cannot read properties of undefined (reading 'rows')")} reset={vi.fn()} />, { locale: "zh" });

		expect(screen.getByText("Cannot read properties of undefined (reading 'rows')")).toBeInTheDocument();
	});

	// A client component may throw anything; the boundary receives it as it is.
	it.each([["a string", "boom"], ["null", null], ["undefined", undefined]])("renders for a thrown value that is not an Error (%s)", (_label, thrown) => {
		renderI18n(<RouteError error={thrown as never} reset={vi.fn()} />, { locale: "zh" });

		expect(screen.getByRole("heading", { name: "页面加载出错" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
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
	it("asks the server again when the person retries, instead of rendering the failed answer once more", () => {
		// The framework hands an error screen two functions: `reset` only clears the boundary and renders what it
		// already has — for a failure on the server that is the same failed answer, so "重试" brought the error
		// screen straight back — and `retry` fetches the page again first.
		const reset = vi.fn();
		const retry = vi.fn();
		renderI18n(<RouteError error={makeError("", "2574922165")} reset={reset} retry={retry} />, { locale: "zh" });
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		expect(retry).toHaveBeenCalledOnce();
		expect(reset).not.toHaveBeenCalled();
	});

	it("still clears the boundary where no retry is handed over", () => {
		const reset = vi.fn();
		renderI18n(<RouteError error={makeError("渲染失败")} reset={reset} />, { locale: "zh" });
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		expect(reset).toHaveBeenCalledOnce();
	});

	it("is what every route's error file exports, so the framework's retry reaches it", () => {
		// A wrapper that names its props passes on only what it names: the two that existed dropped `retry`.
		const root = "src/app";
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const file = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(file);
				else if (entry.name === "error.tsx") files.push(file);
			}
		};
		walk(root);
		expect(files.length).toBeGreaterThan(40);
		const wrappers = files.filter((file) => !readFileSync(file, "utf8").includes('export { RouteError as default } from "@/components/route-error";'));
		expect(wrappers).toEqual([]);
	});
});
