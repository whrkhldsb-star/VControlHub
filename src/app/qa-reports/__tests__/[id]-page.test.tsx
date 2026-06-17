import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, sessionHasPermissionMock, getQaReportDetailMock } = vi.hoisted(() => ({
	requireSessionMock: vi.fn(),
	sessionHasPermissionMock: vi.fn(),
	getQaReportDetailMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/qa-reports/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/qa-reports/service")>();
	return {
		...actual,
		getQaReportDetail: getQaReportDetailMock,
	};
});

import QaReportDetailPage from "../[id]/page";

describe("QaReportDetailPage", () => {
	beforeEach(() => {
		// vi.resetAllMocks clears the mock implementation AND the
		// mockResolvedValueOnce queue. vi.clearAllMocks only clears
		// .mock.calls, which causes queued values to leak across tests
		// and produce "rendered as not-found" false negatives.
		vi.resetAllMocks();
		requireSessionMock.mockResolvedValue({ userId: "user_1", username: "viewer", roles: ["viewer"] });
		sessionHasPermissionMock.mockReturnValue(true);
	});

	it("shows the no-permission empty state when the user lacks task:read", async () => {
		sessionHasPermissionMock.mockReturnValueOnce(false);

		render(await QaReportDetailPage({ params: Promise.resolve({ id: "slice:missing" }) }));

		expect(screen.getByText("你没有 QA 报告查看权限。")).toBeInTheDocument();
		expect(getQaReportDetailMock).not.toHaveBeenCalled();
	});

	it("renders the not-found page when the report id has no matching record", async () => {
		getQaReportDetailMock.mockResolvedValueOnce(null);

		render(await QaReportDetailPage({ params: Promise.resolve({ id: "slice:ghost" }) }));

		expect(screen.getByRole("heading", { name: "未找到报告" })).toBeInTheDocument();
		// Use the full description string so the matcher resolves to a single
		// element (the <p> rendered by PageHeader). The function-form matcher
		// matches the <header> wrapper as well because textContent bubbles
		// up to ancestors, which produced "Found multiple elements" before.
		expect(
			screen.getByText("未在 .hermes/ 下找到 id 为 slice:ghost 的报告。"),
		).toBeInTheDocument();
		expect(screen.getByText("该 id 已不存在或来源文件被清理。")).toBeInTheDocument();
		expect(screen.getAllByRole("link", { name: "← 返回报告列表" })).toHaveLength(1);
	});

	it("renders the report detail with all t()-driven sections when a slice is found", async () => {
		getQaReportDetailMock.mockResolvedValueOnce({
			id: "slice:media-x",
			kind: "slice",
			title: "已闭环 slice · media-x",
			finishedAt: "2026-06-07T16:22:34.000Z",
			startedAt: "2026-06-07T16:20:00.000Z",
			status: "completed",
			summary: "Demo slice summary text",
			evidenceCount: 2,
			sourceId: "media-x",
			evidence: [
				{ command: "ls -la /var/log", result: "log file list" },
				{ command: "", result: "" },
			],
			changeContract: {
				commit: "abc1234",
				files: ["src/lib/media/service.ts", "src/app/media/page.tsx"],
				notes: "Drive-by fix notes",
			},
			next: "Continue with TR-054 follow-up",
		});

		render(await QaReportDetailPage({ params: Promise.resolve({ id: "slice:media-x" }) }));
		expect(getQaReportDetailMock).toHaveBeenCalledWith("slice:media-x");

		// eyebrow / header
		expect(screen.getByText("闭环 slice")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "已闭环 slice · media-x" })).toBeInTheDocument();
		// description with template replacement
		expect(screen.getByText("来源 id：media-x · 状态：completed")).toBeInTheDocument();

		// dt labels
		expect(screen.getByText("完成时间")).toBeInTheDocument();
		expect(screen.getByText("起始时间")).toBeInTheDocument();
		expect(screen.getByText("状态")).toBeInTheDocument();
		expect(screen.getByText("证据条数")).toBeInTheDocument();

		// evidence section
		expect(screen.getByRole("heading", { name: "证据明细" })).toBeInTheDocument();
		expect(
			screen.getByText("从 .hermes/ 状态文件原样读出，未做二次加工。"),
		).toBeInTheDocument();
		expect(screen.getByText("ls -la /var/log")).toBeInTheDocument();
		expect(screen.getByText("log file list")).toBeInTheDocument();
		// fallback strings
		expect(screen.getByText("（无 command）")).toBeInTheDocument();
		expect(screen.getByText("（无 result）")).toBeInTheDocument();

		// change contract
		expect(screen.getByRole("heading", { name: "Change Contract" })).toBeInTheDocument();
		expect(
			screen.getByText("本次闭环影响的文件 / 提交，便于审计追溯。"),
		).toBeInTheDocument();
		expect(screen.getByText("Commit")).toBeInTheDocument();
		expect(screen.getByText("abc1234")).toBeInTheDocument();
		// template with replacement
		expect(screen.getByText("Files (2)")).toBeInTheDocument();
		expect(screen.getByText("src/lib/media/service.ts")).toBeInTheDocument();
		expect(screen.getByText("src/app/media/page.tsx")).toBeInTheDocument();
		expect(screen.getByText("Notes")).toBeInTheDocument();
		expect(screen.getByText("Drive-by fix notes")).toBeInTheDocument();

		// next section
		expect(screen.getByRole("heading", { name: "Next" })).toBeInTheDocument();
		expect(screen.getByText("Continue with TR-054 follow-up")).toBeInTheDocument();
	});

	it("falls back to the raw kind value for unknown kinds", async () => {
		getQaReportDetailMock.mockResolvedValueOnce({
			id: "weird:custom",
			kind: "weird",
			title: "Custom kind detail",
			finishedAt: "2026-06-08T00:00:00.000Z",
			status: "unknown",
			summary: "summary",
			evidenceCount: 0,
			sourceId: "custom",
			evidence: [],
		});

		render(await QaReportDetailPage({ params: Promise.resolve({ id: "weird:custom" }) }));

		expect(screen.getByText("weird")).toBeInTheDocument();
		// no change contract / evidence / next sections rendered for empty payload
		expect(screen.queryByRole("heading", { name: "证据明细" })).not.toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "Change Contract" })).not.toBeInTheDocument();
	});
});
