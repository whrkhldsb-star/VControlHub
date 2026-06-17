import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ServerCreateForm } from "../server-create-form";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [
      { error: undefined, success: undefined, relatedStorageCount: undefined },
      vi.fn(),
    ] };
});

vi.mock("../actions", () => ({
  createServerAction: vi.fn() }));

describe("ServerCreateForm", () => {
  it("keeps the VPS password field empty by default when password auth is selected", async () => {
    const user = userEvent.setup();

    render(<ServerCreateForm sshKeys={[]} />);
    expect(screen.getByRole("group", { name: "连接方式" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "密码" }));

    const passwordInput = screen.getByLabelText("密码") as HTMLInputElement;
    expect(passwordInput).toHaveValue("");
    expect(passwordInput).not.toHaveAttribute("value", expect.stringMatching(/.+/));
  });
});
