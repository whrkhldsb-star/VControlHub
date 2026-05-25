import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserManagementClient } from "../users-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

vi.mock("../user-permission-panel", () => ({
  UserPermissionPanel: () => <div>权限配置面板</div>,
}));

const user = {
  id: "user_1",
  username: "alice",
  displayName: "Alice",
  status: "ACTIVE",
  mustChangePassword: false,
  createdAt: "2026-05-25T00:00:00.000Z",
  roles: [{ key: "viewer", name: "观察者" }],
};

describe("UserManagementClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces user list load errors instead of showing an empty list", async () => {
    vi.mocked(csrfFetch).mockRejectedValue(new Error("用户列表加载失败"));

    render(<UserManagementClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent("用户列表加载失败");
    expect(screen.queryByText("暂无用户。")).not.toBeInTheDocument();
  });

  it("shows an error when disabling a user fails and keeps the user visible", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ users: [user] })
      .mockRejectedValueOnce(new Error("禁用失败"));

    render(<UserManagementClient />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "禁用" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("禁用失败");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "禁用" })).toBeInTheDocument();
  });
});
