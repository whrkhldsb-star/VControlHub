import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/lib/command/service", () => ({
  listCommandRequests: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/notification/service", () => ({
  getUnreadCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/alert/incidents", () => ({
  // Worst level first, as the service orders them; the dashboard names the newest. Titles are stored in English.
  listAlertIncidents: vi.fn().mockResolvedValue([
    { title: "Alert: hk-prod-1 disk usage", serverName: "hk-prod-1", metric: "disk_usage", level: 2, createdAt: new Date("2026-05-27T07:00:00.000Z") },
    { title: "Alert: hk-prod-1 cpu usage", serverName: "hk-prod-1", metric: "cpu_usage", level: 1, createdAt: new Date("2026-05-27T08:00:00.000Z") },
  ]),
}));

vi.mock("@/lib/operation-task/service", () => ({
  listOperationTaskResult: vi.fn().mockResolvedValue({ tasks: [], sourceSummary: [], failureSummary: [] }),
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
import { listCommandRequests } from "@/lib/command/service";
import { prisma } from "@/lib/db";
import { listAlertIncidents } from "@/lib/alert/incidents";
import { listOperationTaskResult } from "@/lib/operation-task/service";

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
    for (const query of [listServerProfiles, getStorageOverview, listCommandRequests,
      prisma.auditLog.findMany, prisma.downloadTask.groupBy, prisma.scheduledTask.count,
      prisma.alertRule.count, prisma.backupSchedule.count, prisma.vpsBackupSchedule.count, prisma.server.count,
      listAlertIncidents, listOperationTaskResult]) {
      expect(query).not.toHaveBeenCalled();
    }
  });

  it("uses command:read for scheduled-task statistics", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      userId: "reader", username: "reader", roles: [], permissions: ["command:read"],
      currentTeamId: "team_1", mustChangePassword: false,
    });
    await Dashboard();
    expect(prisma.scheduledTask.count).toHaveBeenCalledWith({ where: { status: "ACTIVE", teamId: "team_1" } });
    expect(listCommandRequests).toHaveBeenCalled();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("opens with what needs the account, asked of the pages that deal with it", async () => {
    render(<I18nProvider initialLocale="zh">{await Dashboard()}</I18nProvider>);

    const block = screen.getByRole("region", { name: "1 件事需要处理" });
    expect(block).toHaveTextContent("2 条告警等待确认");
    expect(block).toHaveTextContent("最近一条：hk-prod-1 · CPU 使用率");
    expect(block).toHaveTextContent("24 小时内没有失败的任务");
    expect(block).toHaveTextContent("没有等待你审批的命令");
    expect(listAlertIncidents).toHaveBeenCalledWith(expect.objectContaining({ status: "OPEN" }));
    expect(listOperationTaskResult).toHaveBeenCalledWith({ status: "failed", limit: 50 }, expect.objectContaining({ userId: "u_1" }));
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
    vi.mocked(listCommandRequests).mockResolvedValueOnce([request("cmd_own", "u_2", "Own restart"), request("cmd_other", "u_3", "Rotate logs")] as never);
    vi.mocked(listOperationTaskResult).mockResolvedValueOnce({
      tasks: [
        { id: "t_old", source: "job", title: "Sync mirrors", status: "failed", updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
        { id: "t_backup", source: "backup", taskType: "DATABASE", title: "DATABASE backup", status: "failed", updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      ],
      sourceSummary: [],
      failureSummary: [],
    } as never);

    render(<I18nProvider initialLocale="zh">{await Dashboard()}</I18nProvider>);

    const block = screen.getByRole("region", { name: "2 件事需要处理" });
    expect(block).toHaveTextContent("24 小时内有 1 个任务失败");
    expect(block).toHaveTextContent("最近一条：数据库备份");
    expect(block).toHaveTextContent("1 条命令等待你审批");
    expect(block).toHaveTextContent("最近一条：Rotate logs");
    expect(block).not.toHaveTextContent("Own restart");
    // No alert row: this account does not manage alerts, so it cannot know.
    expect(block).not.toHaveTextContent("告警");
    expect(listAlertIncidents).not.toHaveBeenCalled();
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
    expect(screen.getByText("文件管理")).toBeInTheDocument();
    expect(screen.getByText("远程下载")).toBeInTheDocument();
    expect(screen.getByText("审批中心")).toBeInTheDocument();
    expect(screen.getByText("最近审批活动")).toBeInTheDocument();
    await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith("/api/preferences"));
    expect(screen.getByText("最近操作日志")).toBeInTheDocument();
    expect(screen.getByText("server.updated")).toBeInTheDocument();
    expect(screen.getByText("2026/05/27 16:30:00")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /查看全部/ })).toHaveAttribute("href", "/audit");
  });
});
