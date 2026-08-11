import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render, renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import userEvent from "@testing-library/user-event";

import { ServerCreateForm } from "../server-create-form";
import { ServerCardActions } from "../server-card-actions";
import { ServerCardEditForm } from "../server-card-edit-form";

const { refreshMock, actionStateOverrides } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  actionStateOverrides: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: (action: unknown, initialState: unknown) => [
      actionStateOverrides.shift() ?? initialState,
      action,
      false,
    ],
  };
});

vi.mock("@/components/submit-button", () => ({
  SubmitButton: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <button type="submit" className={className}>
      {children}
    </button>
  ),
}));

vi.mock("../ssh-terminal-context", () => ({
  useSshTerminal: () => ({
    openTerminal: vi.fn(),
    isOpen: false,
  }),
}));

describe("server direct gateway controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionStateOverrides.length = 0;
  });

  it("lets users choose global target direct access while adding a server, defaulting to website relay", () => {
    render(
      <ServerCreateForm
        sshKeys={[
          {
            id: "key_1",
            name: "root key",
            fingerprint: "SHA256:abc",
            description: null,
          },
        ]}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: /启用目标直连（Agent 文件能力）/,
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAttribute("name", "enableDirectGateway");
    expect(screen.getByText(/默认由网站中转文件流量/)).toBeInTheDocument();
    expect(screen.getByLabelText("用户名")).toHaveValue("root");
  });

  it("shows a precise switch to install the direct gateway when currently using website relay", () => {
    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="prod"
        host="203.0.113.10"
        port={22}
        enabled={true}
        sessionToken="token"
        canManageServers
        directGateway={{
          enabled: false,
          statusLabel: "网站中转",
          publicUrl: null,
          port: 0,
        }}
      />,
    );

    expect(screen.getByText("直连状态：网站中转")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "启用目标直连" }),
    ).toBeInTheDocument();
    expect(
      document.querySelector('input[name="enabledDirectGateway"]'),
    ).toHaveAttribute("value", "true");
  });

  it("shows a precise switch to uninstall the direct gateway when direct access is enabled", () => {
    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="prod"
        host="203.0.113.10"
        port={22}
        enabled={true}
        sessionToken="token"
        canManageServers
        directGateway={{
          enabled: true,
          statusLabel: "目标直连",
          publicUrl: "http://203.0.113.10:31888",
          port: 31888,
        }}
      />,
    );

    expect(screen.getByText("直连状态：目标直连")).toBeInTheDocument();
    expect(screen.getByText("http://203.0.113.10:31888")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "切回网站中转" }),
    ).toBeInTheDocument();
    expect(
      document.querySelector('input[name="enabledDirectGateway"]'),
    ).toHaveAttribute("value", "false");
  });

  it("shows direct gateway eligibility and recovery guidance with accessible status", () => {
    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="prod"
        host="203.0.113.10"
        port={22}
        enabled={true}
        sessionToken="token"
        canManageServers
        directGateway={{
          enabled: false,
          statusLabel: "网站中转",
          publicUrl: null,
          port: 0,
        }}
      />,
    );

    expect(
      screen.getByRole("form", { name: "目标服务器直连网关控制" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("直连状态：网站中转");
    expect(screen.getByText(/VPS 必须绑定 SFTP 存储节点/)).toBeInTheDocument();
    expect(screen.getByText(/失败时仍保持网站中转/)).toBeInTheDocument();
  });

  it("shows direct gateway public URL as a probe link and recovery guidance when enabled", () => {
    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="prod"
        host="203.0.113.10"
        port={22}
        enabled={true}
        sessionToken="token"
        canManageServers
        directGateway={{
          enabled: true,
          statusLabel: "目标直连",
          publicUrl: "http://203.0.113.10:31888",
          port: 31888,
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("直连状态：目标直连");
    expect(
      screen.getByRole("link", { name: "http://203.0.113.10:31888" }),
    ).toHaveAttribute("href", "http://203.0.113.10:31888");
    expect(screen.getByText(/入口仍在监听 31888/)).toBeInTheDocument();
  });

  it("announces direct gateway action errors without implying success", () => {
    actionStateOverrides.push(
      { error: undefined, success: undefined, relatedStorageCount: undefined },
      { error: undefined, success: undefined, relatedStorageCount: undefined },
      { error: undefined, success: undefined, relatedStorageCount: undefined },
      {
        error: "目标服务器直连只能启用于已绑定 SFTP 存储节点的 VPS。",
        success: undefined,
        relatedStorageCount: undefined,
      },
    );

    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="prod"
        host="203.0.113.10"
        port={22}
        enabled={true}
        sessionToken="token"
        canManageServers
        directGateway={{
          enabled: false,
          statusLabel: "网站中转",
          publicUrl: null,
          port: 0,
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "目标服务器直连只能启用于已绑定 SFTP 存储节点的 VPS。",
    );
    expect(screen.queryByText(/已启用目标服务器直连/)).not.toBeInTheDocument();
  });

  it("cancels delete confirmation by refreshing current route instead of reloading the whole page", async () => {
    const user = userEvent.setup();
    actionStateOverrides.push(
      { error: undefined, success: undefined, relatedStorageCount: undefined },
      { error: undefined, success: undefined, relatedStorageCount: 2 },
      { error: undefined, success: undefined, relatedStorageCount: undefined },
    );

    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="prod"
        host="203.0.113.10"
        port={22}
        enabled={true}
        sessionToken="token"
        canManageServers
      />,
    );

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("requires typed VPS name confirmation before destructive delete", async () => {
    actionStateOverrides.push(
      { error: undefined, success: undefined, relatedStorageCount: undefined },
      { error: undefined, success: undefined, relatedStorageCount: 2 },
      { error: undefined, success: undefined, relatedStorageCount: undefined },
    );

    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="prod"
        host="203.0.113.10"
        port={22}
        enabled={true}
        sessionToken="token"
        canManageServers
      />,
    );

    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("确认删除「prod」？");
    expect(
      screen.getByLabelText("输入 VPS 名称「prod」确认删除"),
    ).toBeInTheDocument();
    expect(screen.getByText(/删除成功后节点会从 VPS 列表移除/)).toBeInTheDocument();
  });

  it("renders destructive-delete confirmation in English when locale is en", () => {
    actionStateOverrides.push(
      { error: undefined, success: undefined, relatedStorageCount: undefined },
      { error: undefined, success: undefined, relatedStorageCount: 2 },
      { error: undefined, success: undefined, relatedStorageCount: undefined },
    );

    renderWithI18n(
      <ServerCardActions
        serverId="srv_1"
        serverName="prod"
        host="203.0.113.10"
        port={22}
        enabled={true}
        sessionToken="token"
        canManageServers
      />,
      { locale: "en" },
    );

    expect(
      screen.getByRole("alertdialog"),
    ).toHaveAccessibleName('Delete "prod"?');
    expect(
      screen.getByLabelText('Type VPS name "prod" to confirm delete'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
  });

  it("offers an edit form for managed VPS nodes", async () => {
    const user = userEvent.setup();
    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="hk-node-01"
        host="45.207.216.45"
        port={22}
        enabled={true}
        sessionToken="token"
        canManageServers
        username="root"
        connectionType="PASSWORD"
        description="old desc"
        tags={["cy"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "编辑节点" }));

    expect(
      screen.getByRole("form", { name: "编辑 VPS 节点" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("节点名称")).toHaveValue("hk-node-01");
    expect(screen.getByLabelText("IP / 域名")).toHaveValue("45.207.216.45");
    expect(screen.getByLabelText("SSH 端口")).toHaveValue(22);
    expect(screen.getByLabelText("用户名")).toHaveValue("root");
    expect(screen.getByLabelText("新密码（留空保持不变）")).toHaveValue("");
    expect(screen.getByText(/修改 SSH 连接信息后，系统会显示新主机指纹/)).toBeInTheDocument();
    expect(screen.queryByText("本次连接观测到的指纹")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "保存并校验连接" }),
    ).toBeInTheDocument();
  });

  it("shows the probed SSH host fingerprint for explicit confirmation", () => {
    render(
      <ServerCardEditForm
        serverId="srv_1"
        serverName="hk-node-01"
        host="45.207.216.45"
        port={22}
        username="root"
        connectionType="PASSWORD"
        description={null}
        tags={[]}
        costAutoSync={false}
        costMonthlyAmount={null}
        costCurrency="CNY"
        costProvider={null}
        costLastSyncedAt={null}
        editAction={vi.fn()}
        editState={{
          error:
            "First connection requires confirming the SSH host fingerprint: SHA256:probed-from-server",
          hostKeySha256: "SHA256:probed-from-server",
        }}
      />,
    );

    expect(screen.getByText("SHA256:probed-from-server")).toBeInTheDocument();
    expect(screen.getByText("本次连接观测到的指纹")).toBeInTheDocument();
    const approval = document.querySelector(
      'input[name="approvedHostKeySha256"]',
    );
    expect(approval).toHaveAttribute("type", "hidden");
    expect(approval).toHaveValue("SHA256:probed-from-server");
    expect(
      screen.getByRole("checkbox", { name: /我已通过独立渠道核对/ }),
    ).toBeRequired();
    expect(
      screen.getByRole("button", { name: "确认指纹并保存" }),
    ).toBeInTheDocument();
  });

  it("requires fingerprint confirmation before enabling a disabled VPS", () => {
    actionStateOverrides.push(
      {
        error: "First connection requires confirming the SSH host fingerprint",
        hostKeySha256: "SHA256:enable-probe",
      },
      { error: undefined, success: undefined },
      { error: undefined, success: undefined },
    );

    render(
      <ServerCardActions
        serverId="srv_draft"
        serverName="pending-node"
        host="107.148.254.104"
        port={22}
        enabled={false}
        sessionToken="token"
        canManageServers
      />,
    );

    expect(screen.getByText("SHA256:enable-probe")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /我已核对并信任/ }),
    ).toBeRequired();
    expect(
      screen.getByRole("button", { name: "确认指纹并启用" }),
    ).toBeInTheDocument();
  });
});
