import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QaReportsListClient } from "../qa-reports-list-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
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
		} satisfies QaReportsListResult);
		render(
			<QaReportsListClient
				initialReports={mockReports}
				initialTotals={mockTotals}
				initialUpdatedAt="2026-06-08T17:52:20.000Z"
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
			/>,
		);
		await actor.click(screen.getByRole("button", { name: "重新读取 .hermes/" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("磁盘读取失败");
	});
});
