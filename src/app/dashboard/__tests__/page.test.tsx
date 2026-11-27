import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u_1",
    username: "admin",
    roles: ["admin"],
    mustChangePassword: false,
  }),
}));

vi.mock("@/lib/server/service", () => ({
  listServerProfiles: vi.fn().mockResolvedValue([
    {
      id: "srv_1",
      name: "hk-prod-1",
      host: "203.0.113.10",
      port: 22,
      username: "root",
      connectionSummary: "root@203.0.113.10:22，使用 SSH 密钥 prod-root-key 连接",
      tags: ["prod"],
      enabled: true,
      sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc" },
    },
  ]),
}));

vi.mock("@/lib/storage/service", () => ({
  getStorageOverview: vi.fn().mockResolvedValue({
    nodes: [
      {
        id: "node_1",
        name: "主控本机",
        driver: "LOCAL",
        isDefault: true,
        connectionSummary: "本机存储：/srv/whrkhldsb/storage",
        directAccess: { mode: "managed-download", description: "本机文件由管理端直接提供受控下载与预览。" },
        fileCount: 3,
      },
      {
        id: "node_2",
        name: "香港媒体库",
        driver: "SFTP",
        isDefault: false,
        connectionSummary: "SFTP 存储：root@203.0.113.11:22（绑定节点 hk-media-1），根目录 /data/media",
        directAccess: { mode: "managed-download", description: "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。", href: "/api/storage/sftp-download?nodeId=node_2&path=" },
        fileCount: 8,
      },
    ],
    entries: [
      {
        id: "file_1",
        name: "demo.mp4",
        mimeType: "video/mp4",
        relativePath: "videos/demo.mp4",
        sizeLabel: "1024 B",
        previewable: true,
        directAccess: { mode: "managed-download", description: "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。", href: "/api/storage/sftp-download?nodeId=node_2&path=" },
        storageNode: { name: "香港媒体库" },
      },
    ],
    stats: {
      totalNodes: 2,
      defaultNodeName: "主控本机",
      localNodeCount: 1,
      sftpNodeCount: 1,
      totalEntries: 1,
      previewableEntries: 1,
    },
  }),
}));



vi.mock("@/lib/notification/service", () => ({
  getUnreadCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/dashboard/attention-queries", () => ({
  dashboardCommands: vi.fn().mockResolvedValue({ requests: [], pendingApprovals: 0, review: { count: 0, latest: null } }),
  openIncidentSummary: vi.fn().mockResolvedValue({ count: 2, latest: { title: "CPU", serverName: "hk-prod-1", metric: "cpu_usage" } }),
  failedTaskSummary: vi.fn().mockResolvedValue({ count: 0, latest: undefined }),
}));
vi.mock("@/lib/dashboard/download-summary", () => ({
  downloadSummary: vi.fn().mockResolvedValue({ totals: { COMPLETED: 1 }, days: [] }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "audit_1",
          action: "server.updated",
          severity: "INFO",
          actorType: "USER",
          createdAt: new Date("2026-05-27T08:30:00.000Z"),
          actor: { username: "admin", displayName: "Admin" },
        },
      ]),
    },
    downloadTask: {
      groupBy: vi.fn().mockResolvedValue([{ status: "COMPLETED", _count: 1 }]),
    },
    scheduledTask: {
      count: vi.fn().mockResolvedValue(1),
    },
    alertRule: {
      count: vi.fn().mockResolvedValue(1),
    },
    backupSchedule: {
      count: vi.fn().mockResolvedValue(1),
    },
    vpsBackupSchedule: {
      count: vi.fn().mockResolvedValue(0),
    },
    server: {
      count: vi.fn().mockResolvedValue(1),
    },
    // TR-020 M02: 仪表盘拖拽重排总开关 — 默认 true (settings.service DEFAULTS)
    setting: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

import { csrfFetch } from "@/lib/auth/csrf-client";
import Dashboard from "../page";
import { requireSession } from "@/lib/auth/require-session";
import { listServerProfiles } from "@/lib/server/service";
import { getStorageOverview } from "@/lib/storage/service";
import { prisma } from "@/lib/db";
import { dashboardCommands, openIncidentSummary, failedTaskSummary } from "@/lib/dashboard/attention-queries";
import { downloadSummary } from "@/lib/dashboard/download-summary";

const csrfFetchMock = vi.mocked(csrfFetch);

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    csrfFetchMock.mockReset();
    csrfFetchMock.mockImplementation(async (url) => {
      if (String(url) === "/api/preferences") {
        return {
          dashboardWidgets: ["server-status", "quick-links", "analytics", "audit-log"],
        };
      }
      return { servers: [], downloads: [], audit: [], imageBed: [] };
    });
  });


  it("does not load restricted data for an account without dashboard data permissions", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      userId: "restricted", username: "restricted", roles: [], permissions: [],
      currentTeamId: "team_1", mustChangePassword: false,
    });
    await Dashboard();
    for (const query of [listServerProfiles, getStorageOverview, dashboardCommands,
      prisma.auditLog.findMany, downloadSummary, prisma.scheduledTask.count,
      prisma.alertRule.count, prisma.backupSchedule.count, prisma.vpsBackupSchedule.count, prisma.server.count,
      openIncidentSummary, failedTaskSummary]) {
      expect(query).not.toHaveBeenCalled();
    }
  });

  it("shows only the quick links admitted by a file-only account's page permissions", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      userId: "files", username: "files", roles: [], permissions: ["storage:read"], currentTeamId: "team", mustChangePassword: false,
    });
    const { container } = render(<I18nProvider initialLocale="en">{await Dashboard()}</I18nProvider>);
    const links = container.querySelectorAll('[data-dashboard-widget="quick-links"] a');
    expect([...links].map((link) => link.getAttribute("href"))).toEqual(["/files", "/downloads", "/notifications"]);
  });

  it("uses command:read for scheduled-task statistics", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      userId: "reader", username: "reader", roles: [], permissions: ["command:read"],
      currentTeamId: "team_1", mustChangePassword: false,
    });
    await Dashboard();
    expect(prisma.scheduledTask.count).toHaveBeenCalledWith({ where: { status: "ACTIVE", teamId: "team_1", team: { deletedAt: null } } });
    expect(dashboardCommands).toHaveBeenCalled();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("scopes VPS backup schedule and priced server setup counts with serverTeamWhere", async () => {
    const { serverTeamWhere } = await import("@/lib/auth/team-scope");

    // Platform admin in all-customers mode: serverTeamWhere excludes soft-deleted teams.
    const adminSession = {
      userId: "admin_1",
      username: "admin",
      roles: ["admin" as const],
      permissions: ["backup:read" as const, "cost:read" as const],
      currentTeamId: null,
      mustChangePassword: false,
    };
    vi.mocked(requireSession).mockResolvedValueOnce(adminSession);
    await Dashboard();
    expect(prisma.vpsBackupSchedule.count).toHaveBeenCalledWith({
      where: {
        server: serverTeamWhere(adminSession),
      },
    });
    expect(prisma.server.count).toHaveBeenCalledWith({
      where: {
        ...serverTeamWhere(adminSession),
        costMonthlyAmount: { gt: 0 },
      },
    });

    // Customer member with cost:read: serverTeamWhere enforces per-server ACL.
    vi.mocked(prisma.server.count).mockClear();
    const customerSession = {
      userId: "reader",
      username: "reader",
      roles: [] as never[],
      permissions: ["cost:read" as const],
      currentTeamId: "team_1",
      mustChangePassword: false,
    };
    vi.mocked(requireSession).mockResolvedValueOnce(customerSession);
    await Dashboard();
    expect(prisma.server.count).toHaveBeenCalledWith({
      where: {
        ...serverTeamWhere(customerSession),
        costMonthlyAmount: { gt: 0 },
      },
    });
  });

  it("shows an unavailable download count when the path ACL cannot be read", async () => {
    vi.mocked(downloadSummary).mockRejectedValueOnce(new Error("ACL unavailable"));
    const { container } = render(<I18nProvider initialLocale="en">{await Dashboard()}</I18nProvider>);
    const downloadLinks = [...container.querySelectorAll('a[href="/downloads"]')];
    expect(downloadLinks.some((link) => link.textContent?.includes("—"))).toBe(true);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it.each([false, true])("serializes only authorized command bodies (can approve: %s)", async (canApprove) => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      userId: "reader", username: "reader", roles: [], currentTeamId: "team_1", mustChangePassword: false,
      permissions: canApprove ? ["command:read", "command:approve"] : ["command:read"],
    });
    vi.mocked(dashboardCommands).mockResolvedValueOnce({ pendingApprovals: 0, review: { count: 0, latest: null }, requests: ["reader", "colleague"].map((requesterId) => ({
      id: requesterId, title: `Request by ${requesterId}`, command: `command-body-${requesterId}`,
      requesterId, requester: { id: requesterId, username: requesterId, displayName: null },
      status: "COMPLETED", isAssistantInitiated: false, targets: [],
    })) } as never);

    const tree = await Dashboard();
    const props = JSON.stringify(tree);
    expect(props).toContain("command-body-reader");
    if (canApprove) {
      expect(props).toContain("command-body-colleague");
    } else {
      expect(props).not.toContain("command-body-colleague");
      render(<I18nProvider initialLocale="en">{tree}</I18nProvider>);
      expect(screen.getByText("Request by colleague")).toBeInTheDocument();
      expect(screen.getByText("Command body hidden")).toBeInTheDocument();
    }
  });

  it("opens with what needs the account, asked of the pages that deal with it", async () => {
    render(<I18nProvider initialLocale="zh">{await Dashboard()}</I18nProvider>);

    const block = screen.getByRole("region", { name: "1 件事需要处理" });
    expect(block).toHaveTextContent("2 条告警等待确认");
    expect(block).toHaveTextContent("最近一条：hk-prod-1 · CPU 使用率");
    expect(block).toHaveTextContent("24 小时内没有失败的任务");
    expect(block).toHaveTextContent("没有等待你审批的命令");
    expect(openIncidentSummary).toHaveBeenCalledWith(expect.objectContaining({ userId: "u_1" }));
    expect(failedTaskSummary).toHaveBeenCalledWith(expect.objectContaining({ userId: "u_1" }), expect.any(Date));
  });

  it("counts only what this account can act on, named as the task centre names it", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      userId: "u_2", username: "reviewer", roles: [], permissions: ["command:read", "command:approve", "task:read"],
      currentTeamId: "team_1", mustChangePassword: false,
    });
    const request = (id: string, requesterId: string, title: string) => ({
      id, title, command: "uptime", status: "PENDING_APPROVAL", isAssistantInitiated: false, targets: [],
      requesterId, requester: { id: requesterId, username: requesterId, displayName: null },
    });
    // The reviewer's own request goes to another reviewer: the server refuses their decision on it.
    vi.mocked(dashboardCommands).mockResolvedValueOnce({ pendingApprovals: 2, review: { count: 1, latest: "Rotate logs" }, requests: [request("cmd_own", "u_2", "Own restart"), request("cmd_other", "u_3", "Rotate logs")] } as never);
    vi.mocked(failedTaskSummary).mockResolvedValueOnce({
      count: 1, latest: { id: "backup-1", count: 1, source: "backup", taskType: "DATABASE", title: "DATABASE backup", updatedAt: new Date() },
    });

    render(<I18nProvider initialLocale="zh">{await Dashboard()}</I18nProvider>);

    const block = screen.getByRole("region", { name: "2 件事需要处理" });
    expect(block).toHaveTextContent("24 小时内有 1 个任务失败");
    expect(block).toHaveTextContent("最近一条：数据库备份");
    expect(block).toHaveTextContent("1 条命令等待你审批");
    expect(block).toHaveTextContent("最近一条：Rotate logs");
    expect(block).not.toHaveTextContent("Own restart");
    // No alert row: this account does not manage alerts, so it cannot know.
    expect(block).not.toHaveTextContent("告警");
    expect(openIncidentSummary).not.toHaveBeenCalled();
  });

  it("renders dashboard sections for servers and storage overview", async () => {
    render(<I18nProvider initialLocale="zh">{await Dashboard()}</I18nProvider>);

    expect(screen.getByRole("heading", { name: "仪表盘" })).toBeInTheDocument();
    expect(screen.getByText("VPS 状态总览")).toBeInTheDocument();
    expect(screen.getAllByText("启用节点").length).toBeGreaterThan(0);
    expect(screen.queryByText("在线 VPS")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /VPS 管理/ })[0]).toHaveAttribute("href", "/servers");
    expect(screen.getByText("VPS 节点")).toBeInTheDocument();
    expect(screen.getByText("核心资源")).toBeInTheDocument();
    expect(screen.getByText("运维队列")).toBeInTheDocument();
    // Unread notifications and active schedules are separate tiles, not one "a / b" cell.
    expect(screen.getByText("未读通知")).toBeInTheDocument();
    expect(screen.getByText("启用的定时任务")).toBeInTheDocument();
    // The feature map at the foot names every page too; the quick links are the cards above it.
    const quickLinks = within(document.querySelector<HTMLElement>('[data-dashboard-widget="quick-links"]')!);
    expect(quickLinks.getByText("文件管理")).toBeInTheDocument();
    expect(quickLinks.getByText("远程下载")).toBeInTheDocument();
    expect(quickLinks.getByText("审批中心")).toBeInTheDocument();
    expect(screen.getByText("最近审批活动")).toBeInTheDocument();
    await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith("/api/preferences"));
    expect(screen.getByText("最近操作日志")).toBeInTheDocument();
    expect(screen.getByText("server.updated")).toBeInTheDocument();
    expect(screen.getByText("2026/05/27 16:30:00")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /查看全部/ })).toHaveAttribute("href", "/audit");
  });

  it("maps every page the account can open, each with what it is for", async () => {
    render(<I18nProvider initialLocale="zh">{await Dashboard()}</I18nProvider>);
    const map = screen.getByRole("heading", { name: "功能地图" }).closest("details")!;
    expect(within(map).getByRole("link", { name: /站内公告.*公告和维护通知/ })).toHaveAttribute("href", "/announcements");
  });

  it("keeps a viewer without server or task access away from header buttons that would refuse them", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      userId: "u_9", username: "viewer", roles: [], permissions: [], currentTeamId: "team_1", mustChangePassword: false,
    });
    render(<I18nProvider initialLocale="zh">{await Dashboard()}</I18nProvider>);
    const header = screen.getByRole("heading", { name: "仪表盘" }).closest("header") ?? document.body;
    expect(within(header as HTMLElement).queryByRole("link", { name: /^VPS 管理$/ })).not.toBeInTheDocument();
    expect(within(header as HTMLElement).queryByRole("link", { name: /^任务中心$/ })).not.toBeInTheDocument();
  });
});
