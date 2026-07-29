import { screen } from "@testing-library/react";
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
});
