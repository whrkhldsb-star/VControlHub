import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  listServerProfilesMock: vi.fn(),
}));

const defaultServer = {
  id: "srv_1",
  name: "hk-prod-1",
  host: "203.0.113.10",
  port: 22,
  username: "root",
  description: "primary node",
  tags: ["prod"],
  enabled: true,
  connectionSummary: "root@203.0.113.10:22，使用 SSH 密钥 prod-root-key 连接",
  sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc" },
  storageNode: {
    id: "node_1",
    name: "香港媒体库",
    driver: "SFTP",
    isDefault: false,
    basePath: "/data/media",
  },
  targetCount: 2,
  pendingCommandCount: 1,
  latestCommands: [
    {
      id: "cmd_1",
      title: "Restart nginx",
      initiatedByType: "ASSISTANT",
      requestStatus: "PENDING_APPROVAL",
      targetStatus: "PENDING_APPROVAL",
      createdAt: new Date(),
    },
  ],
  connectionTypeLabel: "SSH 密钥",
  statusLabel: "已启用",
};

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: "test-session-token" }),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

vi.mock("../actions", () => ({
  getServerFormOptions: vi.fn().mockResolvedValue({
    sshKeys: [
      {
        id: "key_1",
        name: "prod-root-key",
        fingerprint: "SHA256:abc",
        description: null,
      },
    ],
  }),
  createSshKeyAction: vi.fn(),
  toggleServerAction: vi.fn(),
  toggleDirectGatewayAction: vi.fn(),
  updateServerAction: vi.fn(),
  batchToggleServerAction: vi.fn(),
  deleteServerAction: vi.fn(),
}));

vi.mock("../server-create-form", () => ({
  ServerCreateForm: ({
    sshKeys,
  }: {
    sshKeys: Array<{ id: string; name: string }>;
  }) => (
    <div data-testid="server-create-form">表单密钥数：{sshKeys.length}</div>
  ),
}));

vi.mock("@/lib/server/service", () => ({
  listServerProfiles: serviceMocks.listServerProfilesMock,
}));

import ServersPage from "../page";

describe("ServersPage", () => {
  it("renders managed server cards and management form", async () => {
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([defaultServer]);

    render(await ServersPage());

    expect(
      screen.getByRole("heading", { name: "VPS 管理" }),
    ).toBeInTheDocument();
    expect(screen.getByText("VPS 状态优先")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "命令下发" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "命令下发" })).toHaveAttribute(
      "href",
      "/requests",
    );
    expect(screen.getAllByText("hk-prod-1").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("region", { name: "VPS 状态总览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("root@203.0.113.10:22")).toBeInTheDocument();
    expect(screen.getByText("SSH 密钥")).toBeInTheDocument();
    expect(screen.getByText("prod-root-key")).toBeInTheDocument();
    expect(screen.getByText("待审批")).toBeInTheDocument();
    expect(screen.getByText("1 条")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /查看详情/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看详情/ })).toHaveAttribute(
      "aria-controls",
      "server-details-srv_1",
    );
    expect(screen.getByRole("status", { name: "节点实时状态：启用 · 待探测" })).toHaveTextContent("启用 · 待探测");
    expect(screen.getByText(/列表状态未代表 SSH\/SFTP\/直连实时在线/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "hk-prod-1 VPS 详情" })).not.toBeInTheDocument();
    expect(screen.queryByText("连接与状态")).not.toBeInTheDocument();
    expect(screen.queryByText("最近命令投递")).not.toBeInTheDocument();
    expect(screen.queryByText("操作与资源")).not.toBeInTheDocument();
    expect(screen.queryByText("节点操作")).not.toBeInTheDocument();
    expect(screen.queryByText("关联资源")).not.toBeInTheDocument();
    expect(screen.queryByTestId("server-create-form")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "添加 VPS" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "添加密钥" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "批量操作" }),
    ).toBeInTheDocument();
  });

  it("expands a VPS details region with service-health guidance and readable status context", async () => {
    const user = userEvent.setup();
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([defaultServer]);

    render(await ServersPage());
    await user.click(screen.getByRole("button", { name: /查看详情/ }));

    expect(
      screen.getByRole("region", { name: "hk-prod-1 VPS 详情" }),
    ).toBeInTheDocument();
    expect(screen.getByText("连接与状态")).toBeInTheDocument();
    expect(screen.getByText(/状态徽章表示 VControlHub 是否允许该 VPS 接收操作/)).toBeInTheDocument();
    expect(screen.getByText(/直连访问异常/)).toBeInTheDocument();
    expect(screen.getByText("诊断下一步")).toBeInTheDocument();
    expect(screen.getByText(/节点“启用”只表示允许接收操作/)).toBeInTheDocument();
    expect(screen.getByText("SSH 交互连接")).toBeInTheDocument();
    expect(screen.getByText("SFTP / 文件管理")).toBeInTheDocument();
    expect(screen.getByText("Direct Gateway")).toBeInTheDocument();
    expect(screen.getByText("命令审批队列")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看实时监控 JSON" })).toHaveAttribute(
      "href",
      "/api/servers/monitor?serverId=srv_1",
    );
    expect(screen.getAllByRole("link", { name: "打开相关入口" })[0]).toHaveAttribute(
      "href",
      "/files?nodeId=node_1",
    );
    expect(screen.getByText("1 条待处理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行实时探测" })).toBeInTheDocument();
    expect(screen.getAllByText("prod-root-key").length).toBeGreaterThan(1);
  });

  it("runs realtime diagnostics from the server card and renders monitor results", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cpu: { usagePercent: 12.5 },
        memory: { usagePercent: 48.2 },
        disk: [{ mount: "/", usagePercent: 71 }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([defaultServer]);

    render(await ServersPage());
    await user.click(screen.getByRole("button", { name: /查看详情/ }));
    await user.click(screen.getByRole("button", { name: "运行实时探测" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/servers/monitor?serverId=srv_1",
      { cache: "no-store" },
    );
    expect(await screen.findByText(/探测成功：CPU 12.5% · 内存 48.2%，磁盘 \/ 71%/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows realtime diagnostic failures without hiding the guidance", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "连接失败: timeout" }),
    }));
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([defaultServer]);

    render(await ServersPage());
    await user.click(screen.getByRole("button", { name: /查看详情/ }));
    await user.click(screen.getByRole("button", { name: "运行实时探测" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("探测失败：连接失败: timeout");
    expect(screen.getByText("诊断下一步")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("renders password-connected server without ssh key metadata", async () => {
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([
      {
        ...defaultServer,
        id: "srv_2",
        name: "local-node",
        host: "127.0.0.1",
        description: null,
        tags: [],
        connectionSummary: "root@127.0.0.1:22，使用密码连接",
        sshKey: null,
        storageNode: null,
        targetCount: 0,
        pendingCommandCount: 0,
        latestCommands: [],
        connectionTypeLabel: "密码",
      },
    ]);

    render(await ServersPage());

    expect(screen.getAllByText("local-node").length).toBeGreaterThan(0);
    expect(screen.queryByText("未绑定")).not.toBeInTheDocument();
    expect(screen.getAllByText("未配置").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /查看详情/ }),
    ).toBeInTheDocument();
  });
});
