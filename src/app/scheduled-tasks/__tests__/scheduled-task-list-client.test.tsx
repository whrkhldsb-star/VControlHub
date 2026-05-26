import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduledTaskListClient } from "../scheduled-task-list-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

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
  nextRunAt: null,
  lastResult: null,
  runCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  creator: { username: "admin", displayName: null },
};

describe("ScheduledTaskListClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("creates scheduled tasks through the API instead of only closing the form", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ task: { id: "task_1" } })
      .mockResolvedValueOnce({ tasks: [] });

    render(<ScheduledTaskListClient tasks={[]} servers={servers} canCreate />);

    await actor.click(screen.getByRole("button", { name: "+ 创建定时任务" }));
    await actor.type(screen.getByPlaceholderText("例如：清理日志"), "清理日志");
    await actor.clear(screen.getByPlaceholderText("0 3 * * *"));
    await actor.type(screen.getByPlaceholderText("0 3 * * *"), "0 2 * * *");
    await actor.type(screen.getByPlaceholderText("df -h"), "journalctl --vacuum-time=7d");
    await actor.click(screen.getByRole("checkbox", { name: "主节点" }));
    await actor.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/scheduled-tasks", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "清理日志",
        cronExpression: "0 2 * * *",
        command: "journalctl --vacuum-time=7d",
        reason: "",
        serverIds: ["srv_1"],
      }),
    })));
  });

  it("shows an error and keeps the create form open when scheduled task creation fails", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Cron 表达式无效"));

    render(<ScheduledTaskListClient tasks={[]} servers={servers} canCreate />);

    await actor.click(screen.getByRole("button", { name: "+ 创建定时任务" }));
    await actor.type(screen.getByPlaceholderText("例如：清理日志"), "清理日志");
    await actor.type(screen.getByPlaceholderText("df -h"), "df -h");
    await actor.click(screen.getByRole("checkbox", { name: "主节点" }));
    await actor.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cron 表达式无效");
    expect(screen.getByRole("button", { name: "创建任务" })).toBeInTheDocument();
  });

  it("uses an in-app confirmation dialog before deleting a scheduled task", async () => {
    const actor = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    vi.mocked(csrfFetch).mockResolvedValue({ tasks: [task] });

    render(<ScheduledTaskListClient tasks={[task]} servers={servers} canCreate />);
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

    render(<ScheduledTaskListClient tasks={[task]} servers={servers} canCreate />);
    await actor.click(screen.getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "确认删除定时任务" });
    await actor.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/scheduled-tasks?id=task_1", { method: "DELETE" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("删除任务失败：权限不足");
    expect(screen.getByText("清理日志")).toBeInTheDocument();
  });
});
