import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCreateForm } from "../server-create-form";

const { actionStateMock } = vi.hoisted(() => ({
  actionStateMock: {
    current: {} as {
      error?: string;
      success?: string;
      hostKeySha256?: string;
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [actionStateMock.current, vi.fn()],
  };
});

vi.mock("../actions", () => ({
  createServerAction: vi.fn() }));

describe("ServerCreateForm", () => {
  beforeEach(() => {
    actionStateMock.current = {};
  });

  it("keeps the VPS password field empty by default when password auth is selected", async () => {
    const user = userEvent.setup();

    render(<ServerCreateForm sshKeys={[]} />);
    expect(screen.getByRole("group", { name: "连接方式" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "密码" }));

    const passwordInput = screen.getByLabelText("密码") as HTMLInputElement;
    expect(passwordInput).toHaveValue("");
    expect(passwordInput).not.toHaveAttribute("value", expect.stringMatching(/.+/));
  });

  it("does not save an unreachable node as a draft unless the operator opts in", () => {
    render(<ServerCreateForm sshKeys={[]} />);

		expect(screen.getByRole("button", { name: "检测连接并获取指纹" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /连接失败时保存为草稿/ }),
    ).not.toBeChecked();
  });

	it("keeps optional cost and storage settings collapsed until requested", () => {
		render(<ServerCreateForm sshKeys={[]} />);

		expect(screen.getByText("成本同步（可选）").closest("details")).not.toHaveAttribute("open");
		expect(screen.getByText("云盘与高级设置（可选）").closest("details")).not.toHaveAttribute("open");
	});

  it("shows the first observed host fingerprint without a copy-paste field", () => {
    actionStateMock.current = {
      error: "First connection requires confirming the SSH host fingerprint",
      hostKeySha256: "SHA256:first-probe",
    };

    render(<ServerCreateForm sshKeys={[]} />);

    expect(screen.getByText("SHA256:first-probe")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("SHA256:...")).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /我已通过独立渠道核对/ }),
    ).toBeRequired();
    expect(
      document.querySelector('input[name="approvedHostKeySha256"]'),
    ).toHaveValue("SHA256:first-probe");
    expect(
      screen.getByRole("button", { name: "确认指纹并保存" }),
    ).toBeInTheDocument();
  });

  it("restores endpoint and SSH key fields when fingerprint approval requires a second submit", async () => {
    const user = userEvent.setup();
    const view = render(
      <ServerCreateForm
        sshKeys={[{ id: "key-1", name: "key", fingerprint: "fp", description: null }]}
      />,
    );
    const form = document.querySelector('form:has(input[name="host"])') as HTMLFormElement;

    await user.type(screen.getByLabelText("节点名称"), "production-vps");
    await user.type(screen.getByLabelText("IP / 主机名"), "107.148.254.104");
    await user.clear(screen.getByLabelText("端口"));
    await user.type(screen.getByLabelText("端口"), "48163");
    await user.selectOptions(screen.getByLabelText("SSH 密钥"), "key-1");
    fireEvent.submit(form);
    form.reset();

    actionStateMock.current = {
      error: "First connection requires confirming the SSH host fingerprint",
      hostKeySha256: "SHA256:verified",
    };
    view.rerender(
      <ServerCreateForm
        sshKeys={[{ id: "key-1", name: "key", fingerprint: "fp", description: null }]}
      />,
    );

    expect(screen.getByLabelText("节点名称")).toHaveValue("production-vps");
    expect(screen.getByLabelText("IP / 主机名")).toHaveValue("107.148.254.104");
    expect(screen.getByLabelText("端口")).toHaveValue(48163);
    expect(screen.getByLabelText("SSH 密钥")).toHaveValue("key-1");
  });

  it("keeps a password in browser memory across fingerprint confirmation", async () => {
    const user = userEvent.setup();
    const view = render(<ServerCreateForm sshKeys={[]} />);
    const form = document.querySelector('form:has(input[name="host"])') as HTMLFormElement;
    await user.click(screen.getByRole("button", { name: "密码" }));
    await user.type(screen.getByLabelText("密码"), "temporary-secret");
    fireEvent.submit(form);
    form.reset();

    actionStateMock.current = {
      error: "First connection requires confirming the SSH host fingerprint",
      hostKeySha256: "SHA256:verified",
    };
    view.rerender(<ServerCreateForm sshKeys={[]} />);

    expect(screen.getByLabelText("密码")).toHaveValue("temporary-secret");
  });
});
