import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u_1",
    username: "admin",
    roles: ["admin"],
    mustChangePassword: false,
  }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn().mockReturnValue(true),
}));

vi.mock("../review-command-form", () => ({
  ReviewCommandForm: ({ commandRequestId }: { commandRequestId: string }) => (
    <div data-testid="review-command-form">审批表单：{commandRequestId}</div>
  ),
}));

vi.mock("../cancel-command-button", () => ({
  CancelCommandButton: ({ commandRequestId }: { commandRequestId: string; commandTitle: string }) => (
    <div data-testid="cancel-command-button">取消按钮：{commandRequestId}</div>
  ),
}));

vi.mock("@/lib/command/service", () => ({
  listCommandRequests: vi.fn().mockResolvedValue([
    {
      id: "cmd_1",
      title: "Restart nginx",
      command: "systemctl restart nginx",
      reason: "Routine maintenance",
      status: "PENDING_APPROVAL",
      approvalStateLabel: "待审批",
      isAssistantInitiated: true,
      requester: { id: "u_1", username: "admin", displayName: "管理员" },
      targets: [
        {
          id: "target_1",
          status: "PENDING_APPROVAL",
          server: { id: "srv_1", name: "hk-prod-1", host: "203.0.113.10", port: 22 },
        },
      ],
      latestApproval: null,
      executionLogs: [
        { id: "log_2", summary: "检测到陈旧 RUNNING 命令：后台执行器 worker-old，最后心跳 2026-01-01T00:01:00.000Z；已根据目标状态自动归档为 FAILED。", createdAt: "2026-01-01T00:02:00.000Z" },
        { id: "log_1", summary: "命令审批已通过，任务正在进入执行器队列。", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      latestLog: { id: "log_2", summary: "检测到陈旧 RUNNING 命令：后台执行器 worker-old，最后心跳 2026-01-01T00:01:00.000Z；已根据目标状态自动归档为 FAILED。" },
    },
    {
      id: "cmd_2",
      title: "Deploy app",
      command: "deploy --prod",
      reason: "Operator triggered release",
      status: "PENDING_APPROVAL",
      approvalStateLabel: "待审批",
      isAssistantInitiated: false,
      requester: { id: "u_2", username: "operator", displayName: "运维同事" },
      targets: [
        {
          id: "target_2",
          status: "PENDING_APPROVAL",
          server: { id: "srv_2", name: "sg-app-1", host: "198.51.100.20", port: 22 },
        },
      ],
      latestApproval: null,
      executionLogs: [],
      latestLog: null,
    },
  ]),
}));

vi.mock("@/lib/ai/hosted-service", () => ({
  getPendingActions: vi.fn().mockResolvedValue([
    {
      id: "ai_action_1",
      actionName: "重启服务",
      actionType: "restart_service",
      riskLevel: "high",
      status: "PENDING_APPROVAL",
      params: { serviceName: "nginx" },
      createdAt: new Date("2026-05-27T07:00:00Z"),
      server: { id: "srv_1", name: "hk-prod-1", host: "203.0.113.10" },
    },
  ]),
}));

import RequestsPage from "../page";

describe("RequestsPage", () => {
  it("renders separate assistant authorization and user command approval flows", async () => {
    render(await RequestsPage());

    expect(screen.getByText("AI 助手授权与用户命令审批")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI 助手授权" })).toBeInTheDocument();
    expect(screen.getByText("重启服务")).toBeInTheDocument();
    expect(screen.getByText("需要你确认 AI 是否可以执行该高风险操作；只处理当前账号的 AI 托管请求。")).toBeInTheDocument();
    expect(screen.getByText("restart_service")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "用户命令审批" })).toBeInTheDocument();
    expect(screen.getByText("Restart nginx")).toBeInTheDocument();
    expect(screen.getByText("Deploy app")).toBeInTheDocument();
    expect(screen.getByText(/运维同事/)).toBeInTheDocument();
    expect(screen.getByText("助手授权")).toBeInTheDocument();
    expect(screen.getByText("用户审批")).toBeInTheDocument();
    expect(screen.getByText("hk-prod-1")).toBeInTheDocument();
    expect(screen.getAllByText("执行 / worker 记录")).toHaveLength(2);
    expect(screen.getByText("命令审批已通过，任务正在进入执行器队列。")).toBeInTheDocument();
    expect(screen.getByText(/后台执行器 worker-old/)).toBeInTheDocument();
    expect(screen.getAllByTestId("review-command-form")).toHaveLength(2);
    expect(screen.getAllByTestId("cancel-command-button")).toHaveLength(2);
  });
});
