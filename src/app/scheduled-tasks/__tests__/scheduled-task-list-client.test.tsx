import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduledTaskListClient } from "../scheduled-task-list-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const servers = [{ id: "srv_1", name: "主节点", enabled: true }];

describe("ScheduledTaskListClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
