import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KnownErrorNotice } from "@/components/known-error-notice";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

describe("KnownErrorNotice", () => {
	it("gives a raw system error a headline in the page's language and keeps the message under it", () => {
		const { container } = renderWithI18n(<KnownErrorNotice tone="danger" raw="ENOENT: no such file or directory, scandir '/srv/storage/teams/abc'" />);
		expect(screen.getByText("存储路径暂时无法读取：目录不存在或尚未同步。")).toBeInTheDocument();
		expect(container.querySelector("code")).toHaveTextContent("ENOENT: no such file or directory, scandir '…/abc'");
	});

	it("shows a sentence as the notice itself", () => {
		// "操作未能完成：发生意外错误。" stood above every reason without a rule, and the reason was set as code.
		const { container } = renderWithI18n(<KnownErrorNotice tone="danger" raw="未登录或会话已过期" />);
		expect(screen.getByText("未登录或会话已过期")).toBeInTheDocument();
		expect(screen.queryByText(/发生意外错误/)).not.toBeInTheDocument();
		expect(container.querySelector("code")).toBeNull();
	});
});
