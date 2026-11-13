import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildAttentionChecks } from "@/lib/dashboard/attention";
import { I18nProvider } from "@/lib/i18n/provider";

import { DashboardAttention } from "../dashboard-attention";

vi.mock("next/link", () => ({
	default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
		<a href={href} {...props}>{children}</a>
	),
}));

const now = new Date("2026-11-13T12:00:00.000Z");
const renderBlock = (checks: ReturnType<typeof buildAttentionChecks>, locale: "zh" | "en" = "zh") =>
	render(<I18nProvider initialLocale={locale}><DashboardAttention checks={checks} checkedAt="20:00" /></I18nProvider>);

/**
 * The dashboard opened with counters, most of them 0, and nothing said whether anything needed the person
 * looking at it: an alert nobody had acknowledged, a task that failed, a command waiting for approval sat on three other pages.
 */
describe("DashboardAttention", () => {
	it("says all is clear, and what was checked, when nothing is waiting", () => {
		renderBlock(buildAttentionChecks({ openIncidents: [], failedTasks: [], pendingApprovals: [], now }));
		const block = screen.getByRole("region", { name: "一切正常" });
		expect(block).toHaveAttribute("data-attention", "clear");
		expect(within(block).getByText("截至 20:00")).toBeInTheDocument();
		expect(within(block).getByText("没有等待确认的告警")).toBeInTheDocument();
		expect(within(block).getByText("24 小时内没有失败的任务")).toBeInTheDocument();
		expect(within(block).getByText("没有等待你审批的命令")).toBeInTheDocument();
		expect(within(block).queryByRole("link")).not.toBeInTheDocument();
	});

	it("counts what is waiting, names the newest of each and links to where it is dealt with", () => {
		renderBlock(buildAttentionChecks({
			openIncidents: [{ title: "web-01 CPU 使用率 ≥ 90%" }, { title: "db-02 离线" }, { title: "cache-01 内存" }],
			failedTasks: [{ title: "备份 db-02", updatedAt: new Date(now.getTime() - 60_000) }],
			pendingApprovals: [],
			now,
		}));
		const block = screen.getByRole("region", { name: "2 件事需要处理" });
		expect(block).toHaveAttribute("data-attention", "danger");

		const alerts = block.querySelector('[data-attention-check="alerts"]') as HTMLElement;
		expect(within(alerts).getByText("3 条告警等待确认")).toBeInTheDocument();
		expect(within(alerts).getByText("最近一条：web-01 CPU 使用率 ≥ 90%")).toBeInTheDocument();
		expect(within(alerts).getByRole("link", { name: "查看告警" })).toHaveAttribute("href", "/alert-rules#incidents");

		const tasks = block.querySelector('[data-attention-check="failedTasks"]') as HTMLElement;
		expect(within(tasks).getByText("24 小时内有 1 个任务失败")).toBeInTheDocument();
		expect(within(tasks).getByRole("link", { name: "查看任务" })).toHaveAttribute("href", "/operation-tasks?status=failed");

		// What was checked and found nothing stays in its place, without a link.
		const approvals = block.querySelector('[data-attention-check="approvals"]') as HTMLElement;
		expect(within(approvals).getByText("没有等待你审批的命令")).toBeInTheDocument();
		expect(within(approvals).queryByRole("link")).not.toBeInTheDocument();
	});

	it("takes the waiting tone when only a person's decision is outstanding", () => {
		renderBlock(buildAttentionChecks({ openIncidents: null, failedTasks: null, pendingApprovals: [{ title: "重启 nginx" }], now }), "en");
		const block = screen.getByRole("region", { name: "One thing needs you" });
		expect(within(block).getByText("Commands waiting for your approval: 1")).toBeInTheDocument();
		expect(block).toHaveAttribute("data-attention", "warning");
		expect(within(block).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/requests");
		// The account cannot see alerts or tasks: those rows are not claimed clear.
		expect(within(block).queryByText("No alert is waiting for acknowledgement")).not.toBeInTheDocument();
		expect(within(block).queryByText(/failed in the last 24 hours/)).not.toBeInTheDocument();
	});

	it("is not drawn for an account that can see none of the checks", () => {
		const { container } = renderBlock([]);
		expect(container).toBeEmptyDOMElement();
	});
});
