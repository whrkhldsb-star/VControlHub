import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChangePasswordForm } from "../change-password-form";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [{}, vi.fn()],
  };
});

vi.mock("../actions", () => ({
  changePasswordAction: vi.fn(),
}));

describe("ChangePasswordForm", () => {
  it("lets operators show and hide each password field while editing", async () => {
    const user = userEvent.setup();

    render(<ChangePasswordForm />);

    for (const label of ["当前密码", "新密码", "确认新密码"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("type", "password");

      const field = input.closest("div.grid");
      expect(field).not.toBeNull();
      const toggle = within(field as HTMLElement).getByRole("button", { name: `显示${label}` });
      expect(toggle).toHaveAttribute("aria-pressed", "false");

      await user.click(toggle);
      expect(input).toHaveAttribute("type", "text");
      expect(within(field as HTMLElement).getByRole("button", { name: `隐藏${label}` })).toHaveAttribute("aria-pressed", "true");

      await user.click(within(field as HTMLElement).getByRole("button", { name: `隐藏${label}` }));
      expect(input).toHaveAttribute("type", "password");
    }
  });
});
