import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QaReportsListClient } from "../qa-reports-list-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import type { QaReportsListResult, QaReportSummary } from "@/lib/qa-reports/dto";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const mockReports: QaReportSummary[] = [
	{
		id: "slice:media-x",
		kind: "slice",
		title: "已闭环 slice · media-x",
		finishedAt: "2026-06-07T16:22:34.000Z",
		status: "completed",
		summary: "demo slice summary",
		evidenceCount: 3,
	},
	{
		id: "blocker:quick-services-docker-canary:2026-06-03T06:35:45Z",
		kind: "blocker",
		title: "已解除 blocker · quick-services-docker-canary",
		finishedAt: "2026-06-03T06:35:45.000Z",
		status: "resolved · environment_blocker",
		summary: "Docker was missing",
		evidenceCount: 1,
	},
	{
		id: "qa_run:backups-create-form-visible-labels",
		kind: "qa_run",
		title: "QA loop · Backups create form",
		finishedAt: "2026-06-08T17:52:20.000Z",
		status: "completed_verified_deployed",
		summary: "Visible labels now present",
		evidenceCount: 5,
	},
];

const mockTotals: QaReportsListResult["totals"] = {
	total: 3,
	slices: 1,
	blockers: 1,
	qaRuns: 1,
};

const mockTrends: QaReportsListResult["trends"] = {
	cards: [
		{ id: "totalRuns", label: "总 tick 数", value: "12", raw: 12, tone: "info", caption: "成功 10 · 失败 2" },
		{ id: "successRate", label: "成功率", value: "83%", raw: 83, tone: "info", caption: "10/12 次 deploy_committed_pushed" },
		{ id: "moduleCoverage", label: "模块覆盖", value: "3/12", raw: 3, tone: "info", caption: "已巡检 3 个，剩余 9 个" },
		{ id: "lastFailure", label: "最近失败", value: "downloads", raw: 2, tone: "warn", caption: "deploy blocked by restart approval" },
	],
	dailyBuckets: [
		{ day: "2026-06-09", total: 0, success: 0, failed: 0 },
		{ day: "2026-06-10", total: 2, success: 2, failed: 0 },
		{ day: "2026-06-11", total: 1, success: 0, failed: 1 },
		{ day: "2026-06-12", total: 0, success: 0, failed: 0 },
		{ day: "2026-06-13", total: 3, success: 3, failed: 0 },
		{ day: "2026-06-14", total: 4, success: 4, failed: 0 },
		{ day: "2026-06-15", total: 2, success: 1, failed: 1 },
	],
	moduleCoverage: [
		{ module: "downloads", lastVisitedAt: "2026-06-15T02:45:00.000Z", visitCount: 4 },
		{ module: "backups-scheduled-tasks", lastVisitedAt: "2026-06-14T22:00:00.000Z", visitCount: 2 },
		{ module: "ai-providers-models", lastVisitedAt: "2026-06-12T11:30:00.000Z", visitCount: 1 },
	],
	recentRuns: [
		{
			timestamp: "2026-06-15T02:45:00.000Z",
			module: "downloads",
			result: "deployed_committed_pushed",
			isSuccess: true,
			summary: "download cap landed",
		},
		{
			timestamp: "2026-06-15T01:00:00.000Z",
			module: "downloads",
			result: "code_reverified_deploy_still_blocked_by_restart_approval",
			isSuccess: false,
			summary: "no change vs prior tick",
		},
	],
	lastFailure: {
		timestamp: "2026-06-15T01:00:00.000Z",
		module: "downloads",
		summary: "no change vs prior tick",
	},
	sourceUpdatedAt: "2026-06-15T03:00:00.000Z",
};

const emptyTrendsPayload: QaReportsListResult["trends"] = {
	cards: [],
	dailyBuckets: [],
	moduleCoverage: [],
	recentRuns: [],
	lastFailure: null,
	sourceUpdatedAt: null,
};

describe("QaReportsListClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders all reports by default with kind + status badges", () => {
		render(
			<QaReportsListClient
				initialReports={mockReports}
				initialTotals={mockTotals}
				initialUpdatedAt="2026-06-08T17:52:20.000Z"
				initialTrends={mockTrends}
			/>,
		);
		expect(screen.getByText("已闭环 slice · media-x")).toBeInTheDocument();
		expect(screen.getByText("已解除 blocker · quick-services-docker-canary")).toBeInTheDocument();
		expect(screen.getByText("QA loop · Backups create form")).toBeInTheDocument();
		expect(screen.getByText("证据 3 条")).toBeInTheDocument();
	});

	it("filters by kind when the user clicks a chip", async () => {
		const actor = userEvent.setup();
		render(
			<QaReportsListClient
				initialReports={mockReports}
				initialTotals={mockTotals}
				initialUpdatedAt="2026-06-08T17:52:20.000Z"
				initialTrends={mockTrends}
			/>,
		);
		await actor.click(screen.getByRole("button", { name: "筛选 闭环 slice (1)" }));
		expect(screen.getByText("已闭环 slice · media-x")).toBeInTheDocument();
		expect(screen.queryByText("已解除 blocker · quick-services-docker-canary")).not.toBeInTheDocument();
	});

	it("shows an empty-state when no reports exist on disk", () => {
		render(
			<QaReportsListClient
				initialReports={[]}
				initialTotals={{ total: 0, slices: 0, blockers: 0, qaRuns: 0 }}
				initialUpdatedAt={null}
				initialTrends={emptyTrendsPayload}
			/>,
		);
		expect(screen.getByText(/当前 \.hermes\/ 下没有任何可展示的 QA 报告记录/)).toBeInTheDocument();
	});

	it("refresh button calls /api/admin/qa-reports and updates state", async () => {
		const actor = userEvent.setup();
		const refreshedTotals: QaReportsListResult["totals"] = {
			total: 1,
			slices: 1,
			blockers: 0,
			qaRuns: 0,
		};
		vi.mocked(csrfFetch).mockResolvedValueOnce({
			reports: [mockReports[0]!],
			totals: refreshedTotals,
			lastUpdatedAt: "2026-06-15T00:00:00.000Z",
			trends: mockTrends,
		} satisfies QaReportsListResult);
		render(
			<QaReportsListClient
				initialReports={mockReports}
				initialTotals={mockTotals}
				initialUpdatedAt="2026-06-08T17:52:20.000Z"
				initialTrends={mockTrends}
			/>,
		);
		await actor.click(screen.getByRole("button", { name: "重新读取 .hermes/" }));
		await vi.waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/admin/qa-reports"));
	});

	it("surfaces a refresh error in the role=alert banner", async () => {
		const actor = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("磁盘读取失败"));
		render(
			<QaReportsListClient
				initialReports={mockReports}
				initialTotals={mockTotals}
				initialUpdatedAt="2026-06-08T17:52:20.000Z"
				initialTrends={mockTrends}
			/>,
		);
		await actor.click(screen.getByRole("button", { name: "重新读取 .hermes/" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("磁盘读取失败");
	});

	it("renders the trend cards + recent runs sections when trends are populated", () => {
		render(
			<QaReportsListClient
				initialReports={mockReports}
				initialTotals={mockTotals}
				initialUpdatedAt="2026-06-08T17:52:20.000Z"
				initialTrends={mockTrends}
			/>,
		);
		// 4 trend cards labelled with their captions
		expect(screen.getByText("总 tick 数")).toBeInTheDocument();
		expect(screen.getByText("83%")).toBeInTheDocument();
		expect(screen.getByText("3/12")).toBeInTheDocument();
		expect(screen.getByText("deploy blocked by restart approval")).toBeInTheDocument();
		// Daily bucket chart
		expect(screen.getByRole("img", { name: "近 7 日 tick 柱状图" })).toBeInTheDocument();
		// Recent runs
		expect(screen.getByText("download cap landed")).toBeInTheDocument();
	});

	it("shows the empty-state hint when no trends exist on disk", () => {
		render(
			<QaReportsListClient
				initialReports={mockReports}
				initialTotals={mockTotals}
				initialUpdatedAt="2026-06-08T17:52:20.000Z"
				initialTrends={emptyTrendsPayload}
			/>,
		);
		expect(
			screen.getByText(/autonomous-maintenance-state\.json 不可用或暂无 completed_runs 历史/),
		).toBeInTheDocument();
	});
});
