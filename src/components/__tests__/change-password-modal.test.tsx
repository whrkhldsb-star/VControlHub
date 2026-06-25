import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChangePasswordModal } from "../change-password-modal";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [{}, vi.fn()],
  };
});

vi.mock("@/app/account/password/actions", () => ({
  changePasswordAction: vi.fn(),
}));

describe("ChangePasswordModal", () => {
  it("exposes a named dialog with described password fields and visibility toggles", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <I18nProvider initialLocale="zh">
        <ChangePasswordModal open={true} onClose={onClose} />
      </I18nProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "修改登录密码" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("输入当前密码后设置新密码。修改后不会强制退出，下次登录需使用新密码。");

    for (const [label, description] of [
      ["当前密码", "请输入当前正在使用的登录密码。"],
      ["新密码", "至少 8 位，建议混合大小写、数字和符号。"],
      ["确认新密码", "再次输入新密码，避免输错。"],
    ] as const) {
      const input = within(dialog).getByLabelText(label);
      expect(input).toHaveAttribute("type", "password");
      expect(input).toHaveAccessibleDescription(description);

      const field = input.closest("div.grid");
      expect(field).not.toBeNull();
      const showButton = within(field as HTMLElement).getByRole("button", { name: `显示${label}` });
      expect(showButton).toHaveAttribute("aria-pressed", "false");
      await user.click(showButton);
      expect(input).toHaveAttribute("type", "text");
      expect(within(field as HTMLElement).getByRole("button", { name: `隐藏${label}` })).toHaveAttribute("aria-pressed", "true");
    }

    await user.click(screen.getByRole("button", { name: "关闭修改密码弹窗" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders English copy under the en locale (TR-054 i18n closeout)", () => {
    render(
      <I18nProvider initialLocale="en">
        <ChangePasswordModal open={true} onClose={vi.fn()} />
      </I18nProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Change login password" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(
      "Enter your current password to set a new one. The change won't force a logout; the new password is required for the next login.",
    );
    expect(
      screen.getByRole("button", { name: "Close change password modal" }),
    ).toBeInTheDocument();
  });

  it("renders password fields with English labels under en locale", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <ChangePasswordModal open={true} onClose={vi.fn()} />
      </I18nProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Change login password" });

    for (const [label, description] of [
      ["Current password", "Enter your current login password."],
      ["New password", "At least 8 characters. Use a mix of upper/lower case, digits and symbols."],
      ["Confirm new password", "Re-enter the new password to avoid typos."],
    ] as const) {
      const input = within(dialog).getByLabelText(label);
      expect(input).toHaveAttribute("type", "password");
      expect(input).toHaveAccessibleDescription(description);

      const field = input.closest("div.grid");
      expect(field).not.toBeNull();
      const showButton = within(field as HTMLElement).getByRole("button", { name: `Show${label}` });
      expect(showButton).toHaveAttribute("aria-pressed", "false");
      await user.click(showButton);
      expect(input).toHaveAttribute("type", "text");
      expect(within(field as HTMLElement).getByRole("button", { name: `Hide${label}` })).toHaveAttribute("aria-pressed", "true");
    }

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save new password" })).toBeInTheDocument();
  });
});