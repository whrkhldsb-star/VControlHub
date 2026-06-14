import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OperationTaskListClient } from "../operation-task-list-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type { OperationTask } from "@/lib/operation-task/dto";

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
    logPreview: ["systemctl restart app", "service restarted"],
  },
];
const initialSourceSummary = [{ source: "command" as const, total: 1, attention: 1, failed: 0, running: 0, pending: 1 }];
const initialFailureSummary = [{ reason: "执行超时", total: 1, sources: ["command" as const], latestTaskId: "command:cmd_1", latestTitle: "重启服务", latestAt: "2026-01-01T00:00:00.000Z" }];

describe("OperationTaskListClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders initial source aggregation counts", () => {
    render(<OperationTaskListClient initialTasks={initialTasks} initialSourceSummary={initialSourceSummary} initialFailureSummary={initialFailureSummary} />);

    const summary = screen.getByLabelText("来源聚合");
    expect(summary).toHaveTextContent("命令");
    expect(summary).toHaveTextContent("总计 1");
    expect(summary).toHaveTextContent("待处理 1");
    const failure = screen.getByLabelText("失败原因聚合");
    expect(failure).toHaveTextContent("执行超时");
    expect(failure).toHaveTextContent("最新：重启服务");
    expect(screen.getByLabelText("排序偏好")).toHaveValue("recent");
    expect(screen.getByLabelText("最近日志：重启服务")).toHaveTextContent("systemctl restart app");
    expect(screen.getByLabelText("最近日志：重启服务")).toHaveTextContent("service restarted");
  });

  it("surfaces refresh failures and keeps the existing task list visible", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("任务中心刷新失败"));

    render(<OperationTaskListClient initialTasks={initialTasks} initialSourceSummary={initialSourceSummary} initialFailureSummary={initialFailureSummary} />);

    expect(screen.getByText("重启服务")).toBeInTheDocument();
    expect(screen.getByText("worker worker-1")).toBeInTheDocument();
    expect(screen.getByText(/后台执行器 worker-1/)).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("任务中心刷新失败");
    expect(screen.getByText("重启服务")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "应用筛选" })).toBeEnabled());
  });

  it("refreshes with status and task type filters", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValue({
      tasks: [{
        ...initialTasks[0],
        id: "job:alert_failed",
        source: "job",
        sourceId: "alert_failed",
        title: "告警规则评估失败",
        status: "failed",
        taskType: "alert.evaluate",
      }],
      sourceSummary: [{ source: "job", total: 1, attention: 1, failed: 1, running: 0, pending: 0 }],
      failureSummary: [{ reason: "通知发送失败", total: 1, sources: ["job"], latestTaskId: "job:alert_failed", latestTitle: "告警规则评估失败", latestAt: "2026-01-01T00:00:00.000Z" }],
    });

    render(<OperationTaskListClient initialTasks={[{
      ...initialTasks[0],
      id: "job:alert_seed",
      source: "job",
      sourceId: "alert_seed",
      title: "告警规则评估",
      status: "completed",
      taskType: "alert.evaluate",
    }]} initialSourceSummary={[{ source: "job", total: 1, attention: 0, failed: 0, running: 0, pending: 0 }]} initialFailureSummary={[]} />);

    await actor.selectOptions(screen.getByLabelText("状态筛选"), "failed");
    await actor.selectOptions(screen.getByLabelText("任务类型"), "alert.evaluate");
    await actor.selectOptions(screen.getByLabelText("排序偏好"), "attention");
    await actor.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(csrfFetch).toHaveBeenCalledWith("/api/operation-tasks?status=failed&taskType=alert.evaluate&sort=attention");
    expect(await screen.findByText("告警规则评估失败")).toBeInTheDocument();
    expect(screen.getByLabelText("来源聚合")).toHaveTextContent("后台");
    expect(screen.getByLabelText("来源聚合")).toHaveTextContent("失败 1");
    expect(screen.getByLabelText("失败原因聚合")).toHaveTextContent("通知发送失败");
    expect(screen.getByLabelText("失败原因聚合")).toHaveTextContent("最新：告警规则评估失败");
  });

  it("links CSV export to the current task filters", async () => {
    const actor = userEvent.setup();

    render(<OperationTaskListClient initialTasks={[{
      ...initialTasks[0],
      id: "job:alert_seed",
      source: "job",
      sourceId: "alert_seed",
      title: "告警规则评估",
      status: "completed",
      taskType: "alert.evaluate",
    }]} initialSourceSummary={[]} initialFailureSummary={[]} />);

    expect(screen.getByRole("link", { name: "导出当前结果 CSV" })).toHaveAttribute("href", "/api/operation-tasks?format=csv");
    await actor.selectOptions(screen.getByLabelText("状态筛选"), "failed");
    await actor.selectOptions(screen.getByLabelText("任务类型"), "alert.evaluate");
    await actor.selectOptions(screen.getByLabelText("排序偏好"), "attention");

    expect(screen.getByRole("link", { name: "导出当前结果 CSV" })).toHaveAttribute("href", "/api/operation-tasks?status=failed&taskType=alert.evaluate&sort=attention&format=csv");
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
    expect(screen.getAllByText("alert.evaluate").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("已折叠 18 次周期完成记录")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看来源 →" })).toHaveAttribute("href", "/tasks");
  });
});
