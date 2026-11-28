import { screen, within } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const basePage = () => ({ pendingCount: 2, nextCursor: null as string | null, requests: [
  {
    id: "cmd_1",
    title: "Restart nginx",
    command: "systemctl restart nginx",
    reason: "Routine maintenance",
    status: "PENDING_APPROVAL",
    approvalStateLabel: "待审批",
    origin: "AI_CHAT",
    riskLevel: "high",
    riskReasons: ["high.service_mutation"],
    decisionSource: null as string | null,
    isAssistantInitiated: true,
    runInitiatorId: null,
    unattributedManualRun: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    requester: { id: "u_1", username: "admin", displayName: "管理员" },
    targetCount: 73,
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
    // A deployment is not the AI: its badge says "deployment" even though nobody typed the command by hand.
    origin: "DEPLOYMENT",
    riskLevel: null,
    riskReasons: [],
    decisionSource: null as string | null,
    isAssistantInitiated: false,
    runInitiatorId: null,
    unattributedManualRun: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    requester: { id: "u_2", username: "operator", displayName: "运维同事" },
    targetCount: 1,
    targets: [
      {
        id: "target_2",
        status: "PENDING_APPROVAL",
        server: { id: "srv_2", name: "sg-app-1", host: "198.51.100.20", port: 22 } },
    ],
    latestApproval: null,
    executionLogs: [],
    latestLog: null },
] });

vi.mock("@/lib/command/service", () => ({
  getCommandRequestForViewer: vi.fn().mockResolvedValue(null),
  listCommandRequestPage: vi.fn(),
}));

vi.mock("@/lib/ai/hosted-service", () => ({
  getPendingActionPage: vi.fn(),
}));

vi.mock("@/lib/ai/ops/service", () => ({
  countPendingAiOpsRecommendations: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/command/approval-policy-settings", () => ({
  getApprovalPolicySettings: vi.fn().mockResolvedValue({
    commandApprovalPolicy: "never",
    aiCommandApprovalPolicy: "high_risk",
    deployApprovalPolicy: "always",
    commandSelfReview: "platform_admins",
    aiMaxAutomationMode: "full_auto",
    aiFullAutoAllowCritical: false,
  }),
}));

import RequestsPage from "../page";
import { getApprovalPolicySettings } from "@/lib/command/approval-policy-settings";
import { getCommandRequestForViewer, listCommandRequestPage } from "@/lib/command/service";
import { getPendingActionPage } from "@/lib/ai/hosted-service";
import { countPendingAiOpsRecommendations } from "@/lib/ai/ops/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";

type Page = ReturnType<typeof basePage>;
const listPage = () => vi.mocked(listCommandRequestPage) as unknown as { mockResolvedValue: (page: Page) => void; mockResolvedValueOnce: (page: Page) => void };
const pendingProposal = {
  id: "ai_action_1",
  conversationId: "conv_9",
  actionName: "重启服务",
  actionType: "restart_service",
  riskLevel: "high",
  status: "PENDING_APPROVAL",
  params: { serviceName: "nginx" },
  createdAt: new Date("2026-05-27T07:00:00Z"),
  server: { id: "srv_1", name: "hk-prod-1", host: "203.0.113.10" },
};
const permitOnly = (held: string[]) =>
  vi.mocked(sessionHasPermission).mockImplementation(((_session: unknown, permission: string) => held.includes(permission)) as never);

describe("RequestsPage", () => {
  beforeEach(() => {
    vi.mocked(sessionHasPermission).mockReturnValue(true);
    listPage().mockResolvedValue(basePage());
    vi.mocked(getPendingActionPage).mockResolvedValue({ total: 1, nextCursor: null, actions: [pendingProposal] } as never);
    vi.mocked(countPendingAiOpsRecommendations).mockResolvedValue(0);
    vi.mocked(getCommandRequestForViewer).mockResolvedValue(null);
    vi.mocked(getApprovalPolicySettings).mockResolvedValue({
      commandApprovalPolicy: "never",
      aiCommandApprovalPolicy: "high_risk",
      deployApprovalPolicy: "always",
      commandSelfReview: "platform_admins",
      aiMaxAutomationMode: "full_auto",
      aiFullAutoAllowCritical: false,
    });
  });

  it("renders the command approval queue with truthful origin, risk and reasons", async () => {
    render(await RequestsPage({}));

    expect(screen.getByText("审批来自人工、AI 助手、部署和自动化的命令申请。")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "命令申请" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Restart nginx")).toBeInTheDocument();
    expect(screen.getByText("Deploy app")).toBeInTheDocument();
    expect(screen.getByText(/运维同事/)).toBeInTheDocument();
    const aiCard = document.querySelector("#command-cmd_1")!;
    const deployCard = document.querySelector("#command-cmd_2")!;
    expect(aiCard.querySelector("[data-origin-badge]")).toHaveTextContent("AI 助手");
    expect(deployCard.querySelector("[data-origin-badge]")).toHaveTextContent("部署");
    expect(deployCard).not.toHaveTextContent("AI 助手");
    expect(within(aiCard as HTMLElement).getByText("高风险")).toBeInTheDocument();
    expect(within(aiCard as HTMLElement).getByText("更改系统服务。")).toBeInTheDocument();
    expect(screen.getByText("目标 73 台")).toBeInTheDocument();
    expect(screen.getByText("hk-prod-1")).toBeInTheDocument();
    expect(screen.getAllByText("执行记录")).toHaveLength(2);
    expect(screen.getByText("命令审批已通过，任务正在进入执行器队列。")).toBeInTheDocument();
    expect(screen.getByText(/后台执行器 worker-old/)).toBeInTheDocument();
    expect(screen.getAllByTestId("review-command-form")).toHaveLength(2);
    expect(screen.getAllByTestId("cancel-command-button")).toHaveLength(2);
  });

  it("points to the AI assistant for unconfirmed AI proposals instead of a second set of approval cards", async () => {
    render(await RequestsPage({}));
    const banner = document.querySelector("[data-ai-proposals-banner]")!;
    expect(banner).toHaveTextContent("你有 1 条 AI 提议在 AI 助手中等待确认。");
    expect(within(banner as HTMLElement).getByRole("link", { name: "打开 AI 助手" })).toHaveAttribute("href", "/ai?c=conv_9&action=ai_action_1");
    // The proposal itself is confirmed in its conversation: no card for it here.
    expect(screen.queryByText("重启服务")).not.toBeInTheDocument();
    expect(screen.queryByText("restart_service")).not.toBeInTheDocument();
    expect(getPendingActionPage).toHaveBeenCalledTimes(1);
  });

  it("shows no AI banner when nothing waits, and does not ask without the chat permission", async () => {
    vi.mocked(getPendingActionPage).mockResolvedValueOnce({ total: 0, nextCursor: null, actions: [] } as never);
    const empty = render(await RequestsPage({}));
    expect(document.querySelector("[data-ai-proposals-banner]")).toBeNull();
    empty.unmount();

    permitOnly(["command:read", "command:approve"]);
    vi.mocked(getPendingActionPage).mockClear();
    render(await RequestsPage({}));
    expect(getPendingActionPage).not.toHaveBeenCalled();
    expect(document.querySelector("[data-ai-proposals-banner]")).toBeNull();
  });

  it("opens approvers on “Waiting on me” and everyone else on “My submissions”", async () => {
    const approver = render(await RequestsPage({}));
    expect(listCommandRequestPage).toHaveBeenLastCalledWith(expect.anything(), undefined, 20, { filter: "waiting_on_me" });
    const tabs = screen.getByRole("navigation", { name: "申请视图" });
    expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual(["待我审批", "我的提交", "全部进行中", "历史记录"]);
    expect(within(tabs).getByRole("link", { name: "待我审批" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "历史记录" })).toHaveAttribute("href", "/requests?tab=history");
    approver.unmount();

    permitOnly(["command:read", "command:create", "command:execute"]);
    render(await RequestsPage({}));
    expect(listCommandRequestPage).toHaveBeenLastCalledWith(expect.anything(), undefined, 20, { filter: "my_submissions" });
    const memberTabs = screen.getByRole("navigation", { name: "申请视图" });
    // "Waiting on me" would always be empty for someone who cannot approve.
    expect(within(memberTabs).getAllByRole("link").map((link) => link.textContent)).toEqual(["我的提交", "全部进行中", "历史记录"]);
    expect(within(memberTabs).getByRole("link", { name: "我的提交" })).toHaveAttribute("aria-current", "page");
  });

  it("filters on the server by tab and origin, and keeps both (and a deep link) in every link", async () => {
    vi.mocked(getCommandRequestForViewer).mockResolvedValueOnce(basePage().requests[0] as never);
    render(await RequestsPage({ searchParams: Promise.resolve({ tab: "all_open", origin: "DEPLOYMENT", requestId: "cmd_1" }) }));
    // The API's `all_open` alias lands on the "All open" tab.
    expect(listCommandRequestPage).toHaveBeenLastCalledWith(expect.anything(), undefined, 20, { filter: "open", origin: "DEPLOYMENT" });
    const tabs = screen.getByRole("navigation", { name: "申请视图" });
    expect(within(tabs).getByRole("link", { name: "全部进行中" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "历史记录" })).toHaveAttribute("href", "/requests?tab=history&origin=DEPLOYMENT&requestId=cmd_1");
    const origins = screen.getByRole("navigation", { name: "按来源筛选" });
    expect(within(origins).getAllByRole("link").map((link) => link.textContent)).toEqual(["全部来源", "手动", "AI", "AI 自动化", "部署", "回滚", "定时任务", "运维剧本", "API"]);
    expect(within(origins).getByRole("link", { name: "部署" })).toHaveAttribute("aria-current", "true");
    expect(within(origins).getByRole("link", { name: "AI" })).toHaveAttribute("href", "/requests?tab=open&origin=AI_CHAT&requestId=cmd_1");
    expect(within(origins).getByRole("link", { name: "全部来源" })).toHaveAttribute("href", "/requests?tab=open&requestId=cmd_1");
    // The deep-linked request stays expanded on top whatever the filter.
    expect(document.querySelectorAll("#command-cmd_1")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "查看全部申请" })).toHaveAttribute("href", "/requests?tab=open&origin=DEPLOYMENT");
  });

  it("ignores an unknown tab or origin, and a tab the account may not open", async () => {
    permitOnly(["command:read", "command:create"]);
    render(await RequestsPage({ searchParams: Promise.resolve({ tab: "waiting_on_me", origin: "MARTIAN" }) }));
    expect(listCommandRequestPage).toHaveBeenLastCalledWith(expect.anything(), undefined, 20, { filter: "my_submissions" });
    expect(within(screen.getByRole("navigation", { name: "按来源筛选" })).getByRole("link", { name: "全部来源" })).toHaveAttribute("aria-current", "true");
  });

  it("pages through a tab with the cursor the server returned", async () => {
    listPage().mockResolvedValueOnce({ ...basePage(), nextCursor: "1700000000000.cmd_0" });
    render(await RequestsPage({ searchParams: Promise.resolve({ tab: "history", after: "1800000000000.cmd_9" }) }));
    expect(listCommandRequestPage).toHaveBeenLastCalledWith(expect.anything(), "1800000000000.cmd_9", 20, { filter: "history" });
    expect(screen.getByRole("link", { name: "下一页" })).toHaveAttribute("href", "/requests?tab=history&after=1700000000000.cmd_0");
    expect(screen.getByRole("link", { name: "第一页" })).toHaveAttribute("href", "/requests?tab=history");
  });

  it("shows the decision a command went through", async () => {
    const page = basePage();
    listPage().mockResolvedValueOnce({ ...page, requests: [{ ...page.requests[0]!, id: "cmd_auto", status: "COMPLETED", decisionSource: "AI_MODE_AUTO" }] });
    render(await RequestsPage({ searchParams: Promise.resolve({ tab: "history" }) }));
    expect(document.querySelector("#command-cmd_auto [data-decision-source]")).toHaveTextContent("放行方式：自动模式执行");
  });

  it("links platform admins to pending AI ops recommendations", async () => {
    vi.mocked(countPendingAiOpsRecommendations).mockResolvedValueOnce(3);
    const admin = render(await RequestsPage({}));
    const link = screen.getByRole("link", { name: /3 条智能运维建议待处理/ });
    expect(link).toHaveAttribute("href", "/ai-ops");
    admin.unmount();

    // Without platform scope (team:manage) the AI ops records are not this account's to read.
    permitOnly(["command:read", "command:approve", "ai:ops:read", "ai:chat"]);
    vi.mocked(countPendingAiOpsRecommendations).mockClear();
    render(await RequestsPage({}));
    expect(countPendingAiOpsRecommendations).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /智能运维建议/ })).not.toBeInTheDocument();
  });

  it("hides the AI ops link when nothing is pending", async () => {
    render(await RequestsPage({}));
    expect(screen.queryByRole("link", { name: /智能运维建议/ })).not.toBeInTheDocument();
  });

  it("offers the cancel button to whoever the server accepts a cancel request from", async () => {
    // cmd_1 was filed by u_1, cmd_2 by u_2. The button followed "may approve" alone.
    const as = (userId: string, held: string[]) => {
      vi.mocked(requirePagePermission).mockResolvedValueOnce({ userId, username: userId, roles: ["operator"], mustChangePassword: false } as never);
      permitOnly(held);
    };
    const cancelButtons = () => screen.queryAllByTestId("cancel-command-button").map((node) => node.textContent);

    // An operator (may execute, may not approve) can stop their own command, and only theirs.
    as("u_2", ["command:read", "command:create", "command:execute"]);
    const operator = render(await RequestsPage({}));
    expect(cancelButtons()).toEqual(["取消按钮：cmd_2"]);
    expect(screen.queryAllByTestId("review-command-form")).toHaveLength(0);
    operator.unmount();

    // A reviewer without the execute permission: the server refuses their cancel request, so no button.
    as("u_9", ["command:read", "command:approve"]);
    const reviewer = render(await RequestsPage({}));
    expect(cancelButtons()).toEqual([]);
    expect(screen.getAllByTestId("review-command-form")).toHaveLength(2);
    reviewer.unmount();

    // Execute and approve: anyone's request.
    as("u_9", ["command:read", "command:approve", "command:execute"]);
    const manager = render(await RequestsPage({}));
    expect(cancelButtons()).toHaveLength(2);
    manager.unmount();

    // May only submit: withdraws their own request while it waits (both are pending here), nobody else's.
    as("u_2", ["command:read", "command:create"]);
    render(await RequestsPage({}));
    expect(cancelButtons()).toEqual(["取消按钮：cmd_2"]);
  });

  it("shows a submitter the text of their own command, and only reviewers anyone else's", async () => {
    // The text was for reviewers only, the submitter's own included.
    vi.mocked(requirePagePermission).mockResolvedValueOnce({ userId: "u_2", username: "u_2", roles: ["operator"], mustChangePassword: false } as never);
    permitOnly(["command:read", "command:create"]);
    const { container } = render(await RequestsPage({}));
    expect(container.querySelector("#command-cmd_2")).toHaveTextContent("deploy --prod");
    expect(container.querySelector("#command-cmd_1")).not.toHaveTextContent("systemctl restart nginx");
  });

  it("offers a review only where the server accepts the reviewer's decision", async () => {
    const page = basePage();
    const other = page.requests[1]!;
    listPage().mockResolvedValueOnce({ ...page, requests: [...page.requests,
      { ...other, id: "manual", runInitiatorId: "u_1" } as never, { ...other, id: "legacy", unattributedManualRun: true },
    ] });
    // cmd_1 was filed by u_1. A reviewer does not decide on their own request unless they manage the team.
    vi.mocked(requirePagePermission).mockResolvedValueOnce({ userId: "u_1", username: "u_1", roles: ["operator"], mustChangePassword: false } as never);
    permitOnly(["command:read", "command:approve"]);
    const { container } = render(await RequestsPage({}));
    expect(screen.getAllByTestId("review-command-form").map((node) => node.textContent)).toEqual(["审批表单：cmd_2"]);
    expect(container.querySelector("#command-cmd_1")).toHaveTextContent("这是你提交的命令，由另一位审批人处理。");
    expect(container.querySelector("#command-cmd_2")).not.toHaveTextContent("另一位审批人");
    // The batch tools take only what this reviewer may decide on.
    expect(container.querySelector('#command-cmd_1 input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('#command-cmd_2 input[type="checkbox"]')).not.toBeNull();
    expect(container.querySelector('#command-manual input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('#command-legacy input[type="checkbox"]')).toBeNull();
  });

  it("keeps finished requests out of the queue, in a folded history, on a tab that mixes both", async () => {
    const { requests: [pending] } = basePage();
    listPage().mockResolvedValueOnce({ pendingCount: 1, nextCursor: null, requests: [
      pending!, { ...pending!, id: "cmd_done", title: "Rotate logs", status: "COMPLETED" },
    ] });

    const { container } = render(await RequestsPage({ searchParams: Promise.resolve({ tab: "my_submissions" }) }));

    const history = Array.from(container.querySelectorAll("details")).find((el) =>
      el.querySelector("summary")?.textContent?.includes("已处理记录"),
    );
    expect(history).not.toBeUndefined();
    expect(history).not.toHaveAttribute("open");
    expect(history?.querySelector("summary")).toHaveTextContent("已处理记录 1");
    expect(history).toHaveTextContent("Rotate logs");
    expect(history).not.toHaveTextContent("Restart nginx");
    expect(screen.getAllByTestId("review-command-form")).toHaveLength(1);
  });

  it("lists the History tab's requests directly, not folded", async () => {
    const { requests: [pending] } = basePage();
    listPage().mockResolvedValueOnce({ pendingCount: 0, nextCursor: null, requests: [{ ...pending!, id: "cmd_done", title: "Rotate logs", status: "COMPLETED" }] });
    const { container } = render(await RequestsPage({ searchParams: Promise.resolve({ tab: "history" }) }));
    expect(screen.getByText("Rotate logs")).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll("summary")).some((summary) => summary.textContent?.includes("已处理记录"))).toBe(false);
  });

  it("says why a tab is empty, and that the origin filter is the reason when one is set", async () => {
    listPage().mockResolvedValueOnce({ pendingCount: 0, nextCursor: null, requests: [] });
    const plain = render(await RequestsPage({}));
    expect(screen.getByText("目前没有等待你审批的命令。")).toBeInTheDocument();
    plain.unmount();

    listPage().mockResolvedValueOnce({ pendingCount: 0, nextCursor: null, requests: [] });
    render(await RequestsPage({ searchParams: Promise.resolve({ origin: "PLAYBOOK" }) }));
    expect(screen.getByText("当前来源下没有命令申请。")).toBeInTheDocument();
  });

  it("focuses a deep-linked request once and shows a neutral notice when missing or out of scope", async () => {
    vi.mocked(getCommandRequestForViewer).mockResolvedValueOnce(basePage().requests[0] as never);

    const focused = render(await RequestsPage({ searchParams: Promise.resolve({ requestId: "cmd_1" }) }));
    expect(focused.container.querySelectorAll("#command-cmd_1")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "查看全部申请" })).toHaveAttribute("href", "/requests");
    focused.unmount();

    vi.mocked(getCommandRequestForViewer).mockResolvedValueOnce(null);
    render(await RequestsPage({ searchParams: Promise.resolve({ requestId: "missing_or_other_team" }) }));
    expect(screen.getByText("未找到这条命令申请，或当前客户范围内无权查看。")).toBeInTheDocument();
  });

  it("offers self-review to non-admin approvers when command.selfReview is approvers (Astra P2-4)", async () => {
    vi.mocked(requirePagePermission).mockResolvedValueOnce({
      userId: "u_1",
      username: "reviewer",
      roles: ["operator"],
      mustChangePassword: false,
    } as never);
    permitOnly(["command:read", "command:approve"]);
    vi.mocked(getApprovalPolicySettings).mockResolvedValueOnce({
      commandApprovalPolicy: "never",
      aiCommandApprovalPolicy: "high_risk",
      deployApprovalPolicy: "always",
      commandSelfReview: "approvers",
      aiMaxAutomationMode: "full_auto",
      aiFullAutoAllowCritical: false,
    });
    const ownRequest = basePage().requests[0]!; // requester.id === "u_1"
    listPage().mockResolvedValueOnce({ pendingCount: 1, nextCursor: null, requests: [ownRequest] });

    render(await RequestsPage({}));
    expect(screen.getByTestId("review-command-form")).toHaveTextContent("cmd_1");
  });
});
