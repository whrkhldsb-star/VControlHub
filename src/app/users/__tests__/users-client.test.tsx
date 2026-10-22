import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserManagementClient } from "../users-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

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
  accountType: "customer",
  customer: { id: "team_a", name: "Acme", deleted: false },
  identityTemplate: { id: "identity:viewer", name: "客户只读", isBuiltin: true },
};

describe("UserManagementClient", () => {
  it("shows each account's customer and identity template", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ users: [user] });

    render(<UserManagementClient />);

    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("客户只读")).toBeInTheDocument();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces user list load errors instead of showing an empty list", async () => {
    vi.mocked(csrfFetch).mockRejectedValue(new Error("用户列表加载失败"));

    render(<UserManagementClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent("用户列表加载失败");
    expect(screen.queryByText("暂无用户。")).not.toBeInTheDocument();
  });

  it("accepts the public API array response shape without crashing", async () => {
    vi.mocked(csrfFetch).mockResolvedValue([user]);

    render(<UserManagementClient />);

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.queryByText("用户列表加载失败，请稍后重试。")).not.toBeInTheDocument();
  });

  it("shows an error when disabling a user fails and keeps the user visible", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teams") return { teams: [{ id: "team_a", name: "Acme" }] };
      if (url === "/api/identity-templates") return { templates: [] };
      if (url.startsWith("/api/users") && init?.method === "PATCH") throw new Error("禁用失败");
      return { users: [user] };
    });

    render(<UserManagementClient canManage />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "禁用" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("禁用失败");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "禁用" })).toBeInTheDocument();
  });

  it("hides write actions for read-only users (user:read without user:manage)", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ users: [user] });

    render(<UserManagementClient canManage={false} />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "创建用户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "禁用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "权限配置" })).not.toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
  });

  it("keeps a next user typed while the previous one was being created", async () => {
    // The first create's success reset the form and closed it, losing B.
    const actor = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(csrfFetch).mockImplementation(((url: string, init?: { method?: string }) => {
      if (init?.method === "POST") return new Promise((resolve) => { finish = resolve; });
      if (url.startsWith("/api/teams")) return Promise.resolve({ teams: [{ id: "team_a", name: "Acme" }] });
      if (url.startsWith("/api/identity-templates")) return Promise.resolve({ templates: [{ id: "identity:viewer", name: "客户只读", isBuiltin: true }] });
      return Promise.resolve({ users: [] });
    }) as never);
    render(<UserManagementClient canManage />);

    await actor.click(await screen.findByRole("button", { name: "创建用户" }));
    const username = screen.getByLabelText("用户名 *");
    await actor.type(username, "alice");
    await actor.type(screen.getByLabelText(/密码/), "Correct-Horse-1");
    await actor.click(screen.getByRole("button", { name: "确认创建" }));
    await actor.clear(username);
    await actor.type(username, "bob");

    // The list reloads once the create has succeeded.
    const listReads = () => vi.mocked(csrfFetch).mock.calls.filter(([url, init]) => String(url).startsWith("/api/users") && !(init as { method?: string } | undefined)?.method).length;
    const before = listReads();
    finish({ id: "u_alice" });
    await vi.waitFor(() => expect(listReads()).toBeGreaterThan(before));
    expect(screen.getByLabelText("用户名 *")).toHaveValue("bob");
  });
});
