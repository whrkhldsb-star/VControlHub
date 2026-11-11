import { screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectTouchTarget } from "@/test/ui-assertions";

import { ScheduledTaskListClient } from "../scheduled-task-list-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { isTouchTarget } from "@/test/ui-assertions";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const servers = [{ id: "srv_1", name: "主节点", enabled: true }];
const task = {
  id: "task_1",
  name: "清理日志",
  cronExpression: "0 2 * * *",
  cronDescription: "每天 2:00",
  command: "journalctl --vacuum-time=7d",
  reason: "释放磁盘",
  status: "ACTIVE",
  serverIds: ["srv_1"],
  lastRunAt: null,
  nextRunAt: "2026-01-02T02:00:00Z",
  lastResult: "执行失败：disk full",
  runCount: 1,
  createdAt: "2026-01-01T00:00:00Z",
  creator: { username: "admin", displayName: null },
};

describe("ScheduledTaskListClient", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/scheduled-tasks");
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("creates scheduled tasks through the API instead of only closing the form", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ task: { id: "task_1" } })
      .mockResolvedValueOnce({ tasks: [] });

    render(<ScheduledTaskListClient tasks={[]} servers={servers} canCreate canManage />);

    await actor.click(screen.getByRole("button", { name: "创建定时任务" }));
    await actor.type(screen.getByRole("textbox", { name: "任务名称" }), "清理日志");
    await actor.clear(screen.getByRole("textbox", { name: "Cron 表达式" }));
    await actor.type(screen.getByRole("textbox", { name: "Cron 表达式" }), "0 2 * * *");
    expect(screen.getByText("预览：每天 2:00 执行")).toBeInTheDocument();
    await actor.type(screen.getByRole("textbox", { name: "命令内容" }), "journalctl --vacuum-time=7d");
    await actor.click(screen.getByRole("checkbox", { name: "主节点" }));
    expect(screen.getByRole("group", { name: "目标节点" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/scheduled-tasks", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "清理日志",
    scheduleType: "CRON",
        cronExpression: "0 2 * * *",
        command: "journalctl --vacuum-time=7d",
        reason: "",
    approvalRequired: true,
        serverIds: ["srv_1"],
      }),
    })));
  });

  it("explains why creation is unavailable when no VPS is enabled", async () => {
    const actor = userEvent.setup();

    render(<ScheduledTaskListClient tasks={[]} servers={[]} canCreate canManage />);

    await actor.click(screen.getByRole("button", { name: "创建定时任务" }));

    expect(screen.getByText(/当前没有已启用的 VPS/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled();
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("filters scheduled tasks by visible execution log text", async () => {
    const actor = userEvent.setup();

    render(<ScheduledTaskListClient tasks={[task]} servers={servers} canCreate canManage />);

    expect(screen.getByText("最近执行日志")).toBeInTheDocument();
    expect(screen.getByText("执行失败：disk full")).toBeInTheDocument();
    await actor.type(screen.getByRole("searchbox", { name: "搜索定时任务 / 执行日志" }), "disk full");
    expect(screen.getByText("清理日志")).toBeInTheDocument();
    await actor.clear(screen.getByRole("searchbox", { name: "搜索定时任务 / 执行日志" }));
    await actor.type(screen.getByRole("searchbox", { name: "搜索定时任务 / 执行日志" }), "no match");
    expect(screen.getByText("没有匹配“no match”的定时任务或执行日志")).toBeInTheDocument();
  });

  it("retries a scheduled task through the API and refreshes the list", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ task: { id: "task_1" } })
      .mockResolvedValueOnce({ tasks: [task] });

    render(<ScheduledTaskListClient tasks={[task]} servers={servers} canCreate canManage />);
    await actor.click(screen.getByRole("button", { name: "立即运行" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/scheduled-tasks", expect.objectContaining({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retryId: "task_1" }),
    })));
    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/scheduled-tasks"));
    // The request only starts a run: the list looked the same afterwards, and nothing said it had been taken.
    const said = await screen.findByRole("status");
    expect(said).toHaveTextContent("已提交运行申请，审批通过后执行");
    expect(within(said).getByRole("link", { name: "审批中心" })).toHaveAttribute("href", "/requests");
  });

  it("says a run without approval has started", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ task: { id: "task_1" } }).mockResolvedValueOnce({ tasks: [] });
    render(<ScheduledTaskListClient tasks={[{ ...task, approvalRequired: false }]} servers={servers} canCreate canManage />);
    await actor.click(screen.getByRole("button", { name: "立即运行" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已开始运行，结果稍后显示在最近日志中");
  });

  it("reports a row action that failed where it is seen, not at the top of the list", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("重试无需逐次审批的任务需要命令执行权限"));
    const { container } = render(<ScheduledTaskListClient tasks={[task]} servers={servers} canCreate canManage />);
    await actor.click(screen.getByRole("button", { name: "立即运行" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("重试无需逐次审批的任务需要命令执行权限");
    // A toast, which stays in view; the notice above the toolbar was off screen from the tenth task down.
    expect(container.firstElementChild?.contains(alert)).toBe(false);

    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error(""));
    await actor.click(screen.getByRole("button", { name: "暂停" }));
    expect(await screen.findByText("切换定时任务状态失败")).toBeInTheDocument();
  });

  it("asks for a target when none is ticked, instead of saying that no server is enabled", async () => {
    const actor = userEvent.setup();
    render(<ScheduledTaskListClient tasks={[]} servers={servers} canCreate canManage />);
    await actor.click(screen.getByRole("button", { name: "创建定时任务" }));
    await actor.type(screen.getByRole("textbox", { name: "任务名称" }), "清理日志");
    await actor.type(screen.getByRole("textbox", { name: "命令内容" }), "df -h");
    await actor.click(screen.getByRole("button", { name: "创建任务" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请至少选择一台目标服务器");
    expect(screen.queryByText(/当前没有已启用的 VPS/)).not.toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("shows an error and keeps the create form open when scheduled task creation fails", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Cron 表达式无效"));

    render(<ScheduledTaskListClient tasks={[]} servers={servers} canCreate canManage />);

    await actor.click(screen.getByRole("button", { name: "创建定时任务" }));
    await actor.type(screen.getByRole("textbox", { name: "任务名称" }), "清理日志");
    await actor.type(screen.getByRole("textbox", { name: "命令内容" }), "df -h");
    await actor.click(screen.getByRole("checkbox", { name: "主节点" }));
    await actor.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cron 表达式无效");
    expect(screen.getByRole("button", { name: "创建任务" })).toBeInTheDocument();
  });

  it("uses an in-app confirmation dialog before deleting a scheduled task", async () => {
    const actor = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    vi.mocked(csrfFetch).mockResolvedValue({ tasks: [task] });

    render(<ScheduledTaskListClient tasks={[task]} servers={servers} canCreate canManage />);
    await actor.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog", { name: "确认删除定时任务" });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(within(dialog).getByText("清理日志")).toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalled();

    await actor.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "确认删除定时任务" })).not.toBeInTheDocument();
    expect(screen.getByText("清理日志")).toBeInTheDocument();
  });

  it("keeps a scheduled task visible and shows an error when deletion fails", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("删除任务失败：权限不足"));

    render(<ScheduledTaskListClient tasks={[task]} servers={servers} canCreate canManage />);
    await actor.click(screen.getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "确认删除定时任务" });
    await actor.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/scheduled-tasks?id=task_1", { method: "DELETE" }));
    // In the dialog, which stays open to be tried again: it used to close first and leave the reason above the list.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("删除任务失败：权限不足");
    expect(screen.getByRole("dialog", { name: "确认删除定时任务" })).toBeInTheDocument();
    expect(screen.getAllByText("清理日志").length).toBeGreaterThan(0);

    // Asked again, the dialog starts without the last refusal.
    await actor.click(within(dialog).getByRole("button", { name: "取消" }));
    await actor.click(screen.getByRole("button", { name: "删除" }));
    expect(within(await screen.findByRole("dialog", { name: "确认删除定时任务" })).queryByRole("alert")).not.toBeInTheDocument();
  });

  describe("touch targets (TR-022 R17 mobile)", () => {
    function mockHeightsBySelector(measurements: Record<string, number>) {
      // jsdom reports getBoundingClientRect as 0x0. Control heights come from
      // design tokens (--control-height is 44px on touch screens), so report the
      // requested height for elements that are touch targets by construction.
      const height = Math.max(...Object.values(measurements));
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        if (isTouchTarget(this)) {
          return { x: 0, y: 0, top: 0, left: 0, right: height, bottom: height, width: height, height, toJSON: () => ({}) } as DOMRect;
        }
        return original.call(this);
      };
      return () => {
        Element.prototype.getBoundingClientRect = original;
      };
    }

    it("renders list row action buttons with at least 44px height", () => {
      const restore = mockHeightsBySelector({ "min-h-11": 44 });
      try {
        render(<ScheduledTaskListClient tasks={[task]} servers={servers} canCreate canManage />);
        const actionButtons = ["立即运行", "暂停", "删除"];
        for (const label of actionButtons) {
          const btn = screen.getByRole("button", { name: label });
          expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        }
      } finally {
        restore();
      }
    });

    it("renders the new-task trigger with at least 44px height", () => {
      const restore = mockHeightsBySelector({ "min-h-11": 44 });
      try {
        render(<ScheduledTaskListClient tasks={[]} servers={servers} canCreate canManage />);
        const btn = screen.getByRole("button", { name: /^创建定时任务$/ });
        expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      } finally {
        restore();
      }
    });

    it("renders the create-task form with at least 44px height for primary action + cron presets", async () => {
      const restore = mockHeightsBySelector({ "min-h-11": 44 });
      try {
        const actor = userEvent.setup();
        render(<ScheduledTaskListClient tasks={[]} servers={servers} canCreate canManage />);
        await actor.click(screen.getByRole("button", { name: /^创建定时任务$/ }));

        expect(screen.getByRole("button", { name: "创建任务" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(screen.getByRole("button", { name: "取消" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

        // Cron presets are shared chips, sized from --control-height-sm (44px on touch).
        for (const label of ["每小时", "每天 3:00", "每5分钟"]) {
          expectTouchTarget(screen.getByRole("button", { name: label }));
        }
      } finally {
        restore();
      }
    });

    it("renders the delete-confirm dialog buttons with at least 44px height", async () => {
      const restore = mockHeightsBySelector({ "min-h-11": 44 });
      try {
        const actor = userEvent.setup();
        render(<ScheduledTaskListClient tasks={[task]} servers={servers} canCreate canManage />);
        await actor.click(screen.getByRole("button", { name: "删除" }));
        const dialog = await screen.findByRole("dialog", { name: "确认删除定时任务" });
        expect(within(dialog).getByRole("button", { name: "确认删除" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(within(dialog).getByRole("button", { name: "取消" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      } finally {
        restore();
      }
    });
  });
});
