import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined })) }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/requests",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u_1",
    username: "admin",
    roles: ["admin"],
    mustChangePassword: false }) }));

vi.mock("@/lib/auth/page-guard", () => ({
  requirePagePermission: vi.fn().mockResolvedValue({
    userId: "u_1",
    username: "admin",
    roles: ["admin"],
    mustChangePassword: false }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn().mockReturnValue(true) }));

vi.mock("../review-command-form", () => ({
  ReviewCommandForm: ({ commandRequestId }: { commandRequestId: string }) => (
    <div data-testid="review-command-form">审批表单：{commandRequestId}</div>
  ) }));

vi.mock("../cancel-command-button", () => ({
  CancelCommandButton: ({ commandRequestId }: { commandRequestId: string; commandTitle: string }) => (
    <div data-testid="cancel-command-button">取消按钮：{commandRequestId}</div>
  ) }));

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
          server: { id: "srv_1", name: "hk-prod-1", host: "203.0.113.10", port: 22 } },
      ],
      latestApproval: null,
      executionLogs: [
        { id: "log_2", summary: "检测到陈旧 RUNNING 命令：后台执行器 worker-old，最后心跳 2026-01-01T00:01:00.000Z；已根据目标状态自动归档为 FAILED。", createdAt: "2026-01-01T00:02:00.000Z" },
        { id: "log_1", summary: "命令审批已通过，任务正在进入执行器队列。", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      latestLog: { id: "log_2", summary: "检测到陈旧 RUNNING 命令：后台执行器 worker-old，最后心跳 2026-01-01T00:01:00.000Z；已根据目标状态自动归档为 FAILED。" } },
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
          server: { id: "srv_2", name: "sg-app-1", host: "198.51.100.20", port: 22 } },
      ],
      latestApproval: null,
      executionLogs: [],
      latestLog: null },
  ]) }));

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
      server: { id: "srv_1", name: "hk-prod-1", host: "203.0.113.10" } },
  ]) }));

import RequestsPage from "../page";
import { listCommandRequests } from "@/lib/command/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";

describe("RequestsPage", () => {
  it("renders separate assistant authorization and user command approval flows", async () => {
    render(await RequestsPage());

    expect(screen.getByText("AI 助手授权与用户命令审批")).toBeInTheDocument();
    // Page hero + section title both expose this label; assert at least one heading.
    expect(screen.getAllByRole("heading", { name: "AI 助手授权" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("重启服务")).toBeInTheDocument();
    expect(screen.getByText("需要你确认 AI 是否可以执行该高风险操作；只处理当前账号的 AI 托管请求。")).toBeInTheDocument();
    expect(screen.getByText("restart_service")).toBeInTheDocument();

    expect(screen.getAllByRole("heading", { name: "用户命令审批" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Restart nginx")).toBeInTheDocument();
    expect(screen.getByText("Deploy app")).toBeInTheDocument();
    expect(screen.getByText(/运维同事/)).toBeInTheDocument();
    expect(screen.getByText("助手授权")).toBeInTheDocument();
    expect(screen.getByText("用户审批")).toBeInTheDocument();
    expect(screen.getByText("hk-prod-1")).toBeInTheDocument();
    expect(screen.getAllByText("执行记录")).toHaveLength(2);
    expect(screen.getByText("命令审批已通过，任务正在进入执行器队列。")).toBeInTheDocument();
    expect(screen.getByText(/后台执行器 worker-old/)).toBeInTheDocument();
    expect(screen.getAllByTestId("review-command-form")).toHaveLength(2);
    expect(screen.getAllByTestId("cancel-command-button")).toHaveLength(2);
  });

  it("offers the cancel button to whoever the server accepts a cancel request from", async () => {
    // cmd_1 was filed by u_1, cmd_2 by u_2. The button followed "may approve" alone.
    const as = (userId: string, held: string[]) => {
      vi.mocked(requirePagePermission).mockResolvedValueOnce({ userId, username: userId, roles: ["operator"], mustChangePassword: false } as never);
      vi.mocked(sessionHasPermission).mockImplementation(((_session: unknown, permission: string) => held.includes(permission)) as never);
    };
    const cancelButtons = () => screen.queryAllByTestId("cancel-command-button").map((node) => node.textContent);

    // An operator (may execute, may not approve) can stop their own command, and only theirs.
    as("u_2", ["command:read", "command:create", "command:execute"]);
    const operator = render(await RequestsPage());
    expect(cancelButtons()).toEqual(["取消按钮：cmd_2"]);
    expect(screen.queryAllByTestId("review-command-form")).toHaveLength(0);
    operator.unmount();

    // A reviewer without the execute permission: the server refuses their cancel request, so no button.
    as("u_9", ["command:read", "command:approve"]);
    const reviewer = render(await RequestsPage());
    expect(cancelButtons()).toEqual([]);
    expect(screen.getAllByTestId("review-command-form")).toHaveLength(2);
    reviewer.unmount();

    // Execute and approve: anyone's request.
    as("u_9", ["command:read", "command:approve", "command:execute"]);
    const manager = render(await RequestsPage());
    expect(cancelButtons()).toHaveLength(2);
    manager.unmount();

    // May only submit: withdraws their own request while it waits (both are pending here), nobody else's.
    as("u_2", ["command:read", "command:create"]);
    render(await RequestsPage());
    expect(cancelButtons()).toEqual(["取消按钮：cmd_2"]);
    vi.mocked(sessionHasPermission).mockReturnValue(true);
  });

  it("shows a submitter the text of their own command, and only reviewers anyone else's", async () => {
    // The text was for reviewers only, the submitter's own included.
    vi.mocked(requirePagePermission).mockResolvedValueOnce({ userId: "u_2", username: "u_2", roles: ["operator"], mustChangePassword: false } as never);
    vi.mocked(sessionHasPermission).mockImplementation(((_session: unknown, permission: string) => ["command:read", "command:create"].includes(permission)) as never);
    const { container } = render(await RequestsPage());
    expect(container.querySelector("#command-cmd_2")).toHaveTextContent("deploy --prod");
    expect(container.querySelector("#command-cmd_1")).not.toHaveTextContent("systemctl restart nginx");
    vi.mocked(sessionHasPermission).mockReturnValue(true);
  });

  it("offers a review only where the server accepts the reviewer's decision", async () => {
    // cmd_1 was filed by u_1. A reviewer does not decide on their own request unless they manage the team.
    vi.mocked(requirePagePermission).mockResolvedValueOnce({ userId: "u_1", username: "u_1", roles: ["operator"], mustChangePassword: false } as never);
    vi.mocked(sessionHasPermission).mockImplementation(((_session: unknown, permission: string) => ["command:read", "command:approve"].includes(permission)) as never);
    const { container } = render(await RequestsPage());
    expect(screen.getAllByTestId("review-command-form").map((node) => node.textContent)).toEqual(["审批表单：cmd_2"]);
    expect(container.querySelector("#command-cmd_1")).toHaveTextContent("这是你提交的命令，由另一位审批人处理。");
    expect(container.querySelector("#command-cmd_2")).not.toHaveTextContent("另一位审批人");
    // The batch tools take only what this reviewer may decide on.
    expect(container.querySelector('#command-cmd_1 input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('#command-cmd_2 input[type="checkbox"]')).not.toBeNull();
    vi.mocked(sessionHasPermission).mockReturnValue(true);
  });

  it("keeps finished requests out of the queue, in a folded history", async () => {
    const [pending] = await (listCommandRequests as unknown as () => Promise<Array<Record<string, unknown>>>)();
    vi.mocked(listCommandRequests).mockResolvedValueOnce([
      pending,
      { ...pending, id: "cmd_done", title: "Rotate logs", status: "COMPLETED" },
    ] as never);

    const { container } = render(await RequestsPage());

    const history = container.querySelector("details");
    expect(history).not.toBeNull();
    expect(history).not.toHaveAttribute("open");
    expect(history?.querySelector("summary")).toHaveTextContent("已处理记录 1");
    expect(history).toHaveTextContent("Rotate logs");
    expect(history).not.toHaveTextContent("Restart nginx");
    expect(screen.getAllByTestId("review-command-form")).toHaveLength(1);
  });
});
