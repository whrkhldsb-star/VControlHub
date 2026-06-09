import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OperationTaskListClient } from "../operation-task-list-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type { OperationTask } from "@/lib/operation-task/service";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const initialTasks: OperationTask[] = [
  {
    id: "command:cmd_1",
    source: "command",
    sourceId: "cmd_1",
    title: "重启服务",
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    actor: "alice",
    href: "/requests",
    workerId: "worker-1",
    workerHeartbeatAt: "2026-01-01T00:01:00.000Z",
    progress: "后台执行器 worker-1 · 心跳 2026/1/1 08:01:00",
  },
];

describe("OperationTaskListClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces refresh failures and keeps the existing task list visible", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("任务中心刷新失败"));

    render(<OperationTaskListClient initialTasks={initialTasks} />);

    expect(screen.getByText("重启服务")).toBeInTheDocument();
    expect(screen.getByText("worker worker-1")).toBeInTheDocument();
    expect(screen.getByText(/后台执行器 worker-1/)).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "刷新" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("任务中心刷新失败");
    expect(screen.getByText("重启服务")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
  });

  it("renders folded periodic job metadata without losing source navigation", async () => {
    render(<OperationTaskListClient initialTasks={[{
      id: "job:alert_new",
      source: "job",
      sourceId: "alert_new",
      title: "告警规则评估",
      status: "completed",
      createdAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
      taskType: "alert.evaluate",
      foldedCount: 18,
      href: "/tasks",
    }]} />);

    expect(screen.getByText("后台")).toBeInTheDocument();
    expect(screen.getByText("alert.evaluate")).toBeInTheDocument();
    expect(screen.getByText("已折叠 18 次周期完成记录")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看来源 →" })).toHaveAttribute("href", "/tasks");
  });
});
