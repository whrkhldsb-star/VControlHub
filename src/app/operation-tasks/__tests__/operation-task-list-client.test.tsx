import { screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
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
    window.history.replaceState({}, "", "/operation-tasks");
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
    expect(screen.getByLabelText("重启服务 的最近日志")).toHaveTextContent("systemctl restart app");
    expect(screen.getByLabelText("重启服务 的最近日志")).toHaveTextContent("service restarted");
  });

  it("does not repeat the progress as a log, and writes the meta line once", () => {
    // A finished job's log preview is its progress: the row read "… · 100%" and then "最近日志 100%".
    const job: OperationTask = {
      id: "job:j1",
      source: "job",
      sourceId: "j1",
      title: "ITSM ticket.created",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      actor: "system",
      progress: "100%",
      logPreview: ["100%"],
      taskType: "itsm.outbound",
    };
    const failed: OperationTask = { ...job, id: "job:j2", sourceId: "j2", title: "同步镜像", status: "failed", progress: "2/3", logPreview: ["2/3", "rsync exited with 23"] };
    render(<OperationTaskListClient initialTasks={[job, failed]} initialSourceSummary={[]} initialFailureSummary={[]} />);

    expect(screen.queryByLabelText("ITSM ticket.created 的最近日志")).not.toBeInTheDocument();
    const log = screen.getByLabelText("同步镜像 的最近日志");
    expect(log).toHaveTextContent("rsync exited with 23");
    expect(log).not.toHaveTextContent("2/3");
    expect(screen.getAllByText(/ · system · 100%$/)).toHaveLength(1);
  });

  it("surfaces refresh failures and keeps the existing task list visible", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("任务中心刷新失败"));

    render(<OperationTaskListClient initialTasks={initialTasks} initialSourceSummary={initialSourceSummary} initialFailureSummary={initialFailureSummary} />);

    expect(screen.getByText("重启服务")).toBeInTheDocument();
    expect(screen.getByText("执行器 worker-1")).toBeInTheDocument();
    expect(screen.getByText(/后台执行器 worker-1/)).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "刷新" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("任务中心刷新失败");
    expect(screen.getByText("重启服务")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
  });

  it("refreshes with status and task type filters", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValue({
      tasks: [{
        ...initialTasks[0]!,
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
      ...initialTasks[0]!,
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
    await actor.click(screen.getByRole("button", { name: "刷新" }));

    expect(csrfFetch).toHaveBeenCalledWith(
      "/api/operation-tasks?status=failed&taskType=alert.evaluate&sort=attention",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(await screen.findByText("告警规则评估失败")).toBeInTheDocument();
    expect(screen.getByLabelText("来源聚合")).toHaveTextContent("后台");
    expect(screen.getByLabelText("来源聚合")).toHaveTextContent("失败 1");
    expect(screen.getByLabelText("失败原因聚合")).toHaveTextContent("通知发送失败");
    expect(screen.getByLabelText("失败原因聚合")).toHaveTextContent("最新：告警规则评估失败");
  });

  it("keeps the other task types on offer after the list is narrowed to one", async () => {
    // The options were the types in the result on screen: after choosing one type, the list held only that
    // type and the select offered nothing else but "all".
    const actor = userEvent.setup();
    const job = (id: string, taskType: string): OperationTask => ({ ...initialTasks[0]!, id: `job:${id}`, source: "job", sourceId: id, title: id, status: "completed", taskType });
    vi.mocked(csrfFetch).mockResolvedValue({ tasks: [job("backup_1", "backup.create")], sourceSummary: [], failureSummary: [] });

    render(<OperationTaskListClient initialTasks={[job("backup_1", "backup.create"), job("alert_1", "alert.evaluate")]} initialSourceSummary={[]} initialFailureSummary={[]} />);
    const types = () => Array.from((screen.getByLabelText("任务类型") as HTMLSelectElement).options).map((option) => option.value);
    expect(types()).toEqual(["all", "alert.evaluate", "backup.create"]);

    await actor.selectOptions(screen.getByLabelText("任务类型"), "backup.create");
    await waitFor(() => expect(screen.queryByText("alert_1")).not.toBeInTheDocument());
    expect(types()).toEqual(["all", "alert.evaluate", "backup.create"]);
  });

  it("drops a stale refresh when a newer filter request wins", async () => {
    const actor = userEvent.setup();
    let resolveStale: ((value: unknown) => void) | undefined;
    const staleResponse = new Promise((resolve) => {
      resolveStale = resolve;
    });
    vi.mocked(csrfFetch)
      .mockImplementationOnce(() => staleResponse as Promise<never>)
      .mockResolvedValueOnce({
        tasks: [{
          ...initialTasks[0]!,
          id: "job:alert_failed",
          source: "job",
          sourceId: "alert_failed",
          title: "告警规则评估失败",
          status: "failed",
          taskType: "alert.evaluate",
        }],
        sourceSummary: [{ source: "job", total: 1, attention: 1, failed: 1, running: 0, pending: 0 }],
        failureSummary: [],
      });

    render(<OperationTaskListClient initialTasks={initialTasks} initialSourceSummary={initialSourceSummary} initialFailureSummary={[]} />);

    await actor.selectOptions(screen.getByLabelText("状态筛选"), "pending");
    await actor.selectOptions(screen.getByLabelText("状态筛选"), "failed");

    expect(await screen.findByText("告警规则评估失败")).toBeInTheDocument();
    resolveStale?.({
      tasks: [{ ...initialTasks[0]!, title: "陈旧刷新结果" }],
      sourceSummary: initialSourceSummary,
      failureSummary: [],
    });
    await waitFor(() => {
      expect(screen.queryByText("陈旧刷新结果")).not.toBeInTheDocument();
    });
    expect(screen.getByText("告警规则评估失败")).toBeInTheDocument();
  });

  it("links CSV export to the current task filters", async () => {
    const actor = userEvent.setup();

    render(<OperationTaskListClient initialTasks={[{
      ...initialTasks[0]!,
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

  it("renders folded periodic job metadata without linking to a missing source page", async () => {
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
    }]} />);

    expect(screen.getByText("后台")).toBeInTheDocument();
    // The job type is said in the page's language, not as its code.
    expect(screen.getAllByText("告警评估").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("alert.evaluate")).not.toBeInTheDocument();
    expect(screen.getByText("已折叠 18 次周期完成记录")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看来源" })).not.toBeInTheDocument();
  });

  it("renders long task histories in bounded pages instead of mounting every row", async () => {
    const actor = userEvent.setup();
    const tasks = Array.from({ length: 25 }, (_, index): OperationTask => ({
      ...initialTasks[0]!,
      id: `command:cmd_${index + 1}`,
      sourceId: `cmd_${index + 1}`,
      title: `任务 ${index + 1}`,
    }));

    render(<OperationTaskListClient initialTasks={tasks} />);

    expect(screen.getByText("任务 1")).toBeInTheDocument();
    expect(screen.queryByText("任务 21")).not.toBeInTheDocument();
    expect(screen.getByText("显示 1–20，共 25 条")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "下一页" }));

    expect(screen.queryByText("任务 1")).not.toBeInTheDocument();
    expect(screen.getByText("任务 21")).toBeInTheDocument();
    expect(screen.getByText("显示 21–25，共 25 条")).toBeInTheDocument();
  });
});
