import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ServerCreateForm } from "../server-create-form";
import { ServerCardActions } from "../server-card-actions";

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

  it("offers an edit form for managed VPS nodes", async () => {
    const user = userEvent.setup();
    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="慈云"
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
    expect(screen.getByLabelText("节点名称")).toHaveValue("慈云");
    expect(screen.getByLabelText("IP / 域名")).toHaveValue("45.207.216.45");
    expect(screen.getByLabelText("SSH 端口")).toHaveValue(22);
    expect(screen.getByLabelText("用户名")).toHaveValue("root");
    expect(screen.getByLabelText("新密码（留空保持不变）")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "保存并校验连接" }),
    ).toBeInTheDocument();
  });
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

vi.mock("@/components/ssh-terminal-modal", () => ({
  SshTerminalModal: () => <div data-testid="ssh-terminal-modal" />,
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
      name: /启用目标服务器直连/,
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAttribute("name", "enableDirectGateway");
    expect(screen.getByText(/默认使用网站服务器中转/)).toBeInTheDocument();
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
      screen.getByRole("button", { name: "切回网站中转并删除直连服务" }),
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
    expect(screen.getByText(/不会把直连标记成成功/)).toBeInTheDocument();
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
    expect(screen.getByText(/进程仍在监听 31888/)).toBeInTheDocument();
  });

  it("announces direct gateway action errors without implying success", () => {
    actionStateOverrides.push(
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

  it("offers an edit form for managed VPS nodes", async () => {
    const user = userEvent.setup();
    render(
      <ServerCardActions
        serverId="srv_1"
        serverName="慈云"
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
    expect(screen.getByLabelText("节点名称")).toHaveValue("慈云");
    expect(screen.getByLabelText("IP / 域名")).toHaveValue("45.207.216.45");
    expect(screen.getByLabelText("SSH 端口")).toHaveValue(22);
    expect(screen.getByLabelText("用户名")).toHaveValue("root");
    expect(screen.getByLabelText("新密码（留空保持不变）")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "保存并校验连接" }),
    ).toBeInTheDocument();
  });
});
