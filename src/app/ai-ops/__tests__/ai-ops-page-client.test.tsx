/**
 * TR-030 / 56 multi-tenant (Tick 3): conditional render audit.
 *
 * Asserts that the management surfaces in `AiOpsPageClient` (trigger
 * scan button, mode/provider selects in settings, per-action
 * execute buttons) are fully removed when `canManage` is false, instead
 * of being rendered with `disabled={!canManage || ...}`.
 *
 * This is the "no disabled placeholder" rule from the user decision
 * 2026-06-16: hide UI entirely when the user lacks permission so there
 * is no half-render, no placeholder, and no leaky click target.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiOpsLogRecord, AiOpsMode, AiOpsStatus } from "@/lib/ai/ops/types";
import type { AiOpsSummary } from "@/lib/ai/ops/service";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

import { AiOpsPageClient } from "../ai-ops-page-client";

const initialSummary: AiOpsSummary = {
	total: 0,
	byStatus: {
		ok: 0,
		error: 0,
		warning: 0,
		skipped: 0,
		running: 0,
	} satisfies Record<AiOpsStatus, number>,
	byMode: {
		recommendation: 0,
		autonomous: 0,
	} satisfies Record<AiOpsMode, number>,
	lastScanAt: null,
	lastErrorAt: null,
};

const initialSettings = {
	mode: "recommendation" as const,
	providerId: null,
	scanScheduleHour: 2,
};

const initialLogs: AiOpsLogRecord[] = [];

function makeLogWithAction(id = "log-1"): AiOpsLogRecord {
	return {
		id,
		createdAt: "2026-06-18T00:00:00.000Z",
		updatedAt: "2026-06-18T00:00:00.000Z",
		mode: "recommendation",
		triggerType: "manual",
		status: "ok",
		findings: [],
		actions: [
			{
				id: `action-${id}`,
				action: "noop",
				risk: "low",
				requiresApproval: false,
				reason: "smoke",
			},
		],
		notes: null,
		errorMessage: null,
		providerId: null,
		startedAt: null,
		completedAt: null,
		durationMs: 10,
		triggeredById: null,
	};
}

const csrfFetch = vi.fn();
const addToast = vi.fn();

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: (...args: unknown[]) => csrfFetch(...args),
}));

// P-NEW-CA: ai-ops-page-client uses useToast() for scan/action feedback.
// We don't exercise the toast UI in this audit — just suppress the
// "useToast must be used within <ToastProvider>" runtime error by providing
// a no-op provider that yields the same shape.
vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({
		toasts: [],
		addToast,
		removeToast: vi.fn(),
	}),
	ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));


const header = { title: "AI 运维" };

describe("AiOpsPageClient conditional render audit", () => {
	beforeEach(() => {
		csrfFetch.mockReset();
	});
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("hides the trigger scan button when canManage is false", async () => {
		render(
			<AiOpsPageClient
				header={header}
				initialSummary={initialSummary}
				initialLogs={initialLogs}
				initialHasMore={false}
				initialTotal={0}
				initialSettings={initialSettings}
				canManage={false}
				canAutonomous={false}
			/>,
		);

		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: /立即扫描|触发扫描/i }),
			).toBeNull();
		});
	});

	it("keeps reading the list after a scan was queued, until that scan's log has finished", async () => {
		// The worker runs a queued scan some seconds later and a provider's analysis can take a minute or two.
		// The page read the list once more after 15 seconds, usually before the log existed.
		vi.useFakeTimers();
		try {
			const finished = makeLogWithAction("log-new");
			const running: AiOpsLogRecord = { ...finished, status: "running" };
			let listReads = 0;
			csrfFetch.mockImplementation(async (url: string) => {
				if (url === "/api/ai/ops/scan") return { triggered: true, queued: true, latestLog: null };
				if (url.startsWith("/api/ai/ops/logs")) {
					listReads += 1;
					const logs = listReads === 1 ? [] : listReads === 2 ? [running] : [finished];
					return { logs, total: logs.length, hasMore: false };
				}
				return { summary: initialSummary };
			});
			render(
				<AiOpsPageClient
					header={header}
					initialSummary={initialSummary}
					initialLogs={initialLogs}
					initialHasMore={false}
					initialTotal={0}
					initialSettings={initialSettings}
					canManage={true}
					canAutonomous={false}
				/>,
			);

			// The header's command (the empty history offers the same one).
			fireEvent.click(screen.getAllByRole("button", { name: /立即扫描|触发扫描/i })[0]!);
			await vi.advanceTimersByTimeAsync(0);
			expect(listReads).toBe(1); // right after the request: nothing yet
			await vi.advanceTimersByTimeAsync(5_000);
			expect(listReads).toBe(2); // the scan's log, still running
			await vi.advanceTimersByTimeAsync(5_000);
			expect(listReads).toBe(3); // finished
			await vi.advanceTimersByTimeAsync(60_000);
			expect(listReads).toBe(3); // and the page stops asking
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders the trigger scan button when canManage is true", async () => {
		render(
			<AiOpsPageClient
				header={header}
				initialSummary={initialSummary}
				initialLogs={initialLogs}
				initialHasMore={false}
				initialTotal={0}
				initialSettings={initialSettings}
				canManage={true}
				canAutonomous={false}
			/>,
		);

		// In the page header, and offered again by the empty history.
		const scans = await screen.findAllByRole("button", { name: /立即扫描|触发扫描/i });
		expect(scans).toHaveLength(2);
		expect(scans[0]!.closest("[data-page-header]")).not.toBeNull();
	});

	it("shows the settings mode select only when canManage is true", async () => {
		// The settings card is wrapped in `{canManage && (...)}`, so when
		// canManage is false the entire <select> is absent from the DOM.
		// We probe for the <select> element directly rather than the option
		// text (which is localized) so the assertion stays locale-agnostic.
		const { rerender } = render(
			<AiOpsPageClient
				header={header}
				initialSummary={initialSummary}
				initialLogs={initialLogs}
				initialHasMore={false}
				initialTotal={0}
				initialSettings={initialSettings}
				canManage={false}
				canAutonomous={false}
			/>,
		);

		// Three <select> elements are part of the filter toolbar (mode / status
		// / triggerType). The settings card's mode <select> is only present
		// when canManage is true.
		expect(document.querySelectorAll("select").length).toBe(3);

		rerender(
			<AiOpsPageClient
				header={header}
				initialSummary={initialSummary}
				initialLogs={initialLogs}
				initialHasMore={false}
				initialTotal={0}
				initialSettings={initialSettings}
				canManage={true}
				canAutonomous={false}
			/>,
		);

		// After enabling canManage, the settings card adds mode + provider selects.
		await waitFor(() => {
			expect(document.querySelectorAll("select").length).toBe(5);
		});
	});

	it("hides the per-action execute buttons when canManage is false", async () => {
		const logsWithAction = [makeLogWithAction()];

		render(
			<AiOpsPageClient
				header={header}
				initialSummary={initialSummary}
				initialLogs={logsWithAction}
				initialHasMore={false}
				initialTotal={1}
				initialSettings={initialSettings}
				canManage={false}
				canAutonomous={false}
			/>,
		);

		// No execute / approve buttons rendered for the read-only viewer.
		// The detail panel is identified via `aria-label="ai-ops-detail"`.
		const detail = await screen.findByLabelText("ai-ops-detail");
		await waitFor(() => {
			expect(within(detail).queryByRole("button", { name: /^执行$/i })).toBeNull();
			expect(within(detail).queryByRole("button", { name: /^批准$/i })).toBeNull();
			expect(
				within(detail).queryByRole("button", { name: /强制自主/i }),
			).toBeNull();
		});
	});

	it("renders the per-action execute button when canManage is true", async () => {
		const logsWithAction = [makeLogWithAction()];

		render(
			<AiOpsPageClient
				header={header}
				initialSummary={initialSummary}
				initialLogs={logsWithAction}
				initialHasMore={false}
				initialTotal={1}
				initialSettings={initialSettings}
				canManage={true}
				canAutonomous={false}
			/>,
		);

		// Scope the lookup to the per-action panel — the save settings button
		// also renders with text "执行" so a document-wide findByRole would
		// match multiple elements.
		const detail = await screen.findByLabelText("ai-ops-detail");
		expect(
			await within(detail).findByRole("button", { name: /^执行$/i }),
		).toBeInTheDocument();
	});

	it("loads the next history page from the API", async () => {
		const user = userEvent.setup();
		csrfFetch.mockImplementation(async (input: string) => {
			if (input.startsWith("/api/ai/ops/logs?")) {
				return { logs: [makeLogWithAction("log-21")], total: 21, hasMore: false };
			}
			return { summary: initialSummary };
		});

		render(
			<AiOpsPageClient
				header={header}
				initialSummary={{ ...initialSummary, total: 21 }}
				initialLogs={[makeLogWithAction()]}
				initialHasMore
				initialTotal={21}
				initialSettings={initialSettings}
				canManage={false}
				canAutonomous={false}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "下一页" }));
		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith(expect.stringContaining("offset=20"));
			expect(screen.getByText("显示 21–21，共 21 条")).toBeInTheDocument();
		});
	});

	// Every failure read "…: Error: status=403": the answer was taken raw and its message thrown away.
	it("says why a request failed in the server's words", async () => {
		const user = userEvent.setup();
		const refuse = (message: string) => Promise.reject(Object.assign(new Error(message), { name: "ApiError", status: 403 }));
		csrfFetch.mockImplementation((url: string, init?: { method?: string }) => {
			if (url === "/api/ai/ops/scan") return refuse("AI 运维尚未配置模型提供方");
			if (url === "/api/ai/ops/settings") return refuse("自主模式需要管理员权限");
			if (url.endsWith("/execute")) return refuse("该推荐项已执行过");
			if (url.startsWith("/api/ai/ops/logs?")) return refuse("缺少权限：ai:use");
			return init?.method ? refuse("unexpected") : Promise.resolve({ summary: initialSummary });
		});
		render(
			<AiOpsPageClient
				header={header}
				initialSummary={{ ...initialSummary, total: 21 }}
				initialLogs={[makeLogWithAction()]}
				initialHasMore
				initialTotal={21}
				initialSettings={initialSettings}
				canManage
				canAutonomous={false}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /立即扫描|触发扫描/i }));
		await waitFor(() => expect(addToast).toHaveBeenLastCalledWith("error", "扫描触发失败：AI 运维尚未配置模型提供方"));

		await user.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(addToast).toHaveBeenLastCalledWith("error", "保存设置失败：自主模式需要管理员权限"));

		const detail = await screen.findByLabelText("ai-ops-detail");
		await user.click(await within(detail).findByRole("button", { name: /^执行$/i }));
		await waitFor(() => expect(addToast).toHaveBeenLastCalledWith("error", "执行推荐项失败：该推荐项已执行过"));

		await user.click(screen.getByRole("button", { name: "下一页" }));
		await waitFor(() => expect(addToast).toHaveBeenLastCalledWith("error", "加载 AI 运维记录失败：缺少权限：ai:use"));
	});

	it("names a provider chosen by another administrator and sends it only when it is changed", async () => {
		// It was listed by its id, and sent back with every save, which the server refused as "not yours".
		const user = userEvent.setup();
		csrfFetch.mockImplementation(async (_url: string, init?: { body?: string }) => ({ mode: "autonomous", providerId: "prov-other", scanScheduleHour: 3, ...(init?.body ? JSON.parse(init.body) : {}) }));
		render(
			<AiOpsPageClient
				header={header}
				initialSummary={initialSummary}
				initialLogs={initialLogs}
				initialHasMore={false}
				initialTotal={0}
				initialSettings={{ ...initialSettings, providerId: "prov-other" }}
				providerOptions={[{ id: "prov-mine", name: "My OpenAI", defaultModel: "gpt-x" }]}
				storedProvider={{ id: "prov-other", name: "Team Claude", defaultModel: "claude-y", available: true }}
				canManage
				canAutonomous={false}
			/>,
		);
		const provider = screen.getByRole("combobox", { name: "AI 提供商" });
		expect(within(provider).getByRole("option", { name: "Team Claude · claude-y（由其他管理员配置）" })).toBeDisabled();
		expect(provider).toHaveValue("prov-other");

		await user.selectOptions(screen.getByRole("combobox", { name: "运行模式" }), "autonomous");
		await user.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/ai/ops/settings", expect.objectContaining({ body: JSON.stringify({ mode: "autonomous" }) })));

		await user.selectOptions(provider, "prov-mine");
		await user.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(csrfFetch).toHaveBeenLastCalledWith("/api/ai/ops/settings", expect.objectContaining({ body: JSON.stringify({ mode: "autonomous", providerId: "prov-mine" }) })));
	});

	it("tells a reader which provider is configured by its name, and when it is gone", () => {
		const view = render(
			<AiOpsPageClient initialSummary={initialSummary} initialLogs={initialLogs} initialHasMore={false} initialTotal={0}
				initialSettings={{ ...initialSettings, providerId: "prov-other" }}
				storedProvider={{ id: "prov-other", name: "Team Claude", defaultModel: "claude-y", available: true }}
				canManage={false} canAutonomous={false} />,
		);
		expect(within(screen.getByLabelText("ai-ops-settings")).getByText("Team Claude · claude-y")).toBeInTheDocument();
		view.unmount();

		render(
			<AiOpsPageClient initialSummary={initialSummary} initialLogs={initialLogs} initialHasMore={false} initialTotal={0}
				initialSettings={{ ...initialSettings, providerId: "prov-gone" }}
				storedProvider={{ id: "prov-gone", name: null, defaultModel: null, available: false }}
				canManage={false} canAutonomous={false} />,
		);
		expect(within(screen.getByLabelText("ai-ops-settings")).getByText("prov-gone（已停用或已删除，扫描只用内置检查）")).toBeInTheDocument();
	});

	it("shows the logs of the latest filter even if an earlier filter's answer arrives later", async () => {
		// The "ok" query answered after the "error" one and replaced the
		// list, while the filter still read "error".
		const okLog = { ...makeLogWithAction("log-ok"), status: "ok" as const };
		const errorLog = { ...makeLogWithAction("log-error"), status: "error" as const };
		let releaseOk: () => void = () => undefined;
		const json = (body: unknown) => body;
		csrfFetch.mockImplementation((url: string) => {
			if (url.startsWith("/api/ai/ops/summary")) return Promise.resolve(json({ summary: initialSummary }));
			if (url.includes("status=ok")) return new Promise((resolve) => { releaseOk = () => resolve(json({ logs: [okLog], total: 1, hasMore: false })); });
			return Promise.resolve(json({ logs: [errorLog], total: 1, hasMore: false }));
		});
		const user = userEvent.setup();
		render(
			<AiOpsPageClient initialSummary={initialSummary} initialLogs={[]} initialHasMore={false} initialTotal={0} initialSettings={initialSettings} canManage={false} canAutonomous={false} />,
		);
		const status = screen.getByRole("combobox", { name: "按状态筛选" });
		await user.selectOptions(status, "ok");
		await user.selectOptions(status, "error");
		const rowStatuses = () => screen.queryAllByRole("row").slice(1).map((row) => row.querySelectorAll("td")[3]?.textContent);
		await waitFor(() => expect(rowStatuses()).toEqual(["失败"]));
		releaseOk();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(rowStatuses()).toEqual(["失败"]);
	});
});
