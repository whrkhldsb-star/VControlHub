import { screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast-provider";

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

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

vi.mock("@/lib/server/service", () => ({
  listServerProfiles: serviceMocks.listServerProfilesMock,
}));

import { csrfFetch } from "@/lib/auth/csrf-client";

// 自动探测默认开启，进入 /servers 后会立即调用 /api/servers/monitor。
// 这里默认 mock /api/preferences 返回 autoProbeEnabled=false，让既有测试
// 聚焦在「手动探测 + 状态徽章」语义；单独的自动探测测试会显式打开。
beforeEach(() => {
  vi.mocked(csrfFetch).mockReset();
  vi.mocked(csrfFetch).mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/api/preferences")) {
      return {
        autoProbeEnabled: false,
        autoProbeIntervalSec: 60,
      };
    }
    return undefined;
  });
});

async function waitForAutoProbePreferences() {
  await waitFor(() => {
    expect(vi.mocked(csrfFetch)).toHaveBeenCalledWith("/api/preferences");
  });
}

afterEach(() => {
  vi.mocked(csrfFetch).mockReset();
});

import ServersPage from "../page";

function renderPage(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("ServersPage", () => {
  it("renders managed server cards and management form", async () => {
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([defaultServer]);

    renderPage(await ServersPage());
    await waitForAutoProbePreferences();

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

    renderPage(await ServersPage());
    await waitForAutoProbePreferences();
    await user.click(screen.getByRole("button", { name: /查看详情/ }));

    expect(
      await screen.findByRole("region", { name: "hk-prod-1 VPS 详情" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("连接状态")).toBeInTheDocument();
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
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/vps-backup/schedules")) {
        return { ok: true, json: async () => ({ schedules: [] }) };
      }
      if (url.includes("/vps-backup/records")) {
        return { ok: true, json: async () => ({ records: [] }) };
      }
      return {
        ok: true,
        json: async () => ({
          cpu: { usagePercent: 12.5 },
          memory: { usagePercent: 48.2 },
          disk: [{ mount: "/", usagePercent: 71 }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([defaultServer]);

    renderPage(await ServersPage());
    await waitForAutoProbePreferences();
    await user.click(screen.getByRole("button", { name: /查看详情/ }));
    await user.click(screen.getByRole("button", { name: "运行实时探测" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/servers/monitor?serverId=srv_1",
      { cache: "no-store" },
    );
    expect((await screen.findAllByText(/探测成功：CPU 12.5% · 内存 48.2%，磁盘 \/ 71%/)).length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("shows realtime diagnostic failures without hiding the guidance", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/vps-backup/schedules")) {
        return { ok: true, json: async () => ({ schedules: [] }) };
      }
      if (url.includes("/vps-backup/records")) {
        return { ok: true, json: async () => ({ records: [] }) };
      }
      return {
        ok: true,
        json: async () => ({ error: "连接失败: timeout" }),
      };
    }));
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([defaultServer]);

    renderPage(await ServersPage());
    await waitForAutoProbePreferences();
    await user.click(screen.getByRole("button", { name: /查看详情/ }));
    await user.click(screen.getByRole("button", { name: "运行实时探测" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("失败: 连接失败: timeout");
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

    renderPage(await ServersPage());
    await waitForAutoProbePreferences();

    expect(screen.getAllByText("local-node").length).toBeGreaterThan(0);
    expect(screen.queryByText("未绑定")).not.toBeInTheDocument();
    expect(screen.getAllByText("未配置").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /查看详情/ }),
    ).toBeInTheDocument();
  });

  it("auto-probes enabled servers on mount when 自动探测 is on", async () => {
    // 强制开启自动探测: mock /api/preferences 返回 enabled=true
    vi.mocked(csrfFetch).mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/preferences")) {
        return {
          autoProbeEnabled: true,
          autoProbeIntervalSec: 60,
        };
      }
      return undefined;
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cpu: { usagePercent: 7.7 },
        memory: { usagePercent: 33.3 },
        disk: [{ mount: "/", usagePercent: 42 }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([defaultServer]);

    renderPage(await ServersPage());
    await waitForAutoProbePreferences();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/servers/monitor?serverId=srv_1",
        { cache: "no-store" },
      );
    });

    // 状态徽章应当从「启用 · 待探测」过渡到「在线 · …」（成功路径）
    await waitFor(() => {
      expect(
        screen.getByRole("status", { name: /节点实时状态：在线/ }),
      ).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("does not surface the page-level auto-probe controls (they moved to /preferences)", async () => {
    serviceMocks.listServerProfilesMock.mockResolvedValueOnce([]);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderPage(await ServersPage());
    await waitForAutoProbePreferences();

    // 等 hydrate 完
    await waitFor(() => {
      // /servers 页面已经不再渲染 auto-probe checkbox / combobox
      expect(
        screen.queryByRole("checkbox", { name: "启用 VPS 自动探测" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("combobox", { name: "自动探测间隔" }),
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
