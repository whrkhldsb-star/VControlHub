import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserManagementClient } from "../users-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

// The query the page was opened with (`?create=1&teamId=…` opens the create form); the form's
// unsaved-changes guard navigates with the router.
const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/users",
  useSearchParams: () => new URLSearchParams(navigation.search),
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

/** The directory with two customers, for the create form. */
function directory(users: unknown[] = [user]) {
  vi.mocked(csrfFetch).mockImplementation(((url: string) => {
    if (url.startsWith("/api/teams")) return Promise.resolve({ teams: [{ id: "team_a", name: "Acme" }, { id: "team_b", name: "Beta" }] });
    if (url.startsWith("/api/identity-templates")) return Promise.resolve({ templates: [{ id: "identity:viewer", name: "客户只读", isBuiltin: true }] });
    return Promise.resolve({ users, total: users.length });
  }) as never);
}

const listReads = () => vi.mocked(csrfFetch).mock.calls
  .filter(([url, init]) => String(url).startsWith("/api/users") && !(init as { method?: string } | undefined)?.method)
  .map(([url]) => String(url));

describe("UserManagementClient", () => {
  afterEach(() => {
    navigation.search = "";
    window.history.replaceState(null, "", "/");
  });

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

    // The list says so in a notice with a retry (it was an empty state that said the load failed).
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((node) => node.textContent?.includes("用户列表加载失败"))).toBe(true);
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("还没有用户")).not.toBeInTheDocument();
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
    // Asked first: one press used to sign the account out everywhere, on a button next to "reset password".
    const dialog = await screen.findByRole("dialog", { name: "禁用账号" });
    expect(dialog).toHaveTextContent("alice");
    expect(vi.mocked(csrfFetch).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);

    await actor.click(within(dialog).getByRole("button", { name: "禁用" }));
    // The refusal is shown in the dialog that asked, which stays open.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("禁用失败");
    expect(screen.getByText("Alice")).toBeInTheDocument();

    await actor.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "禁用账号" })).not.toBeInTheDocument());
    expect(vi.mocked(csrfFetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  });

  it("shows a refused password in the dialog it was typed in", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teams") return { teams: [{ id: "team_a", name: "Acme" }] };
      if (url === "/api/identity-templates") return { templates: [] };
      if (url.startsWith("/api/users") && init?.method === "PATCH") throw new Error("密码至少需要 12 个字符");
      return { users: [user] };
    });
    render(<UserManagementClient canManage />);
    await actor.click(await screen.findByRole("button", { name: "重置密码" }));
    const dialog = await screen.findByRole("dialog");
    await actor.type(within(dialog).getByLabelText("新密码"), "short");
    await actor.click(within(dialog).getByRole("button", { name: "确认重置" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("密码至少需要 12 个字符");
    expect(screen.getAllByText("密码至少需要 12 个字符")).toHaveLength(1);
    // Typed again: the last refusal goes.
    await actor.type(within(dialog).getByLabelText("新密码"), "-and-longer");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says why an account cannot be created when the customers could not be read", async () => {
    // The request failed in silence: an empty list of customers and a button that stayed disabled.
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/teams") throw new Error("缺少权限: team:read");
      if (url === "/api/identity-templates") return { templates: [] };
      return { users: [user] };
    });
    render(<UserManagementClient canManage />);
    await actor.click(await screen.findByRole("button", { name: "创建用户" }));
    expect(await screen.findByText("缺少权限: team:read")).toBeInTheDocument();
  });

  it("says a customer is needed first, and links to customers, when there are none", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/teams") return { teams: [] };
      if (url === "/api/identity-templates") return { templates: [] };
      return { users: [user] };
    });
    render(<UserManagementClient canManage />);
    await actor.click(await screen.findByRole("button", { name: "创建用户" }));
    expect(await screen.findByText("需要先有客户")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去新建客户" })).toHaveAttribute("href", "/customers");
    // A platform administrator needs no customer.
    await actor.click(screen.getByRole("button", { name: "平台管理员" }));
    expect(screen.queryByText("需要先有客户")).not.toBeInTheDocument();
  });

  it("offers to read the list again after it could not be loaded", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("用户列表加载失败")).mockResolvedValue({ users: [user], total: 1 });
    render(<UserManagementClient />);
    await actor.click(await screen.findByRole("button", { name: "重试" }));
    expect(await screen.findByText("Alice")).toBeInTheDocument();
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

  it("offers the account type as one choice of two, and shows the customer fields for a customer account only", async () => {
    // The two types were filter chips inside a "radiogroup": announced as radio buttons, which they were not.
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(((url: string) => {
      if (url.startsWith("/api/teams")) return Promise.resolve({ teams: [{ id: "team_a", name: "Acme" }] });
      if (url.startsWith("/api/identity-templates")) return Promise.resolve({ templates: [{ id: "identity:viewer", name: "客户只读", isBuiltin: true }] });
      return Promise.resolve({ users: [] });
    }) as never);
    render(<UserManagementClient canManage />);
    await actor.click(await screen.findByRole("button", { name: "创建用户" }));

    const types = screen.getByRole("group", { name: "账号类型" });
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(within(types).getByRole("button", { name: "客户账号" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("所属客户")).toBeInTheDocument();
    await actor.click(within(types).getByRole("button", { name: "平台管理员" }));
    expect(within(types).getByRole("button", { name: "平台管理员" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("所属客户")).not.toBeInTheDocument();
  });

  it("says what is empty when the directory has no accounts", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ users: [], total: 0 });
    render(<UserManagementClient />);
    expect(await screen.findByText("还没有用户")).toBeInTheDocument();
    // Nothing to search yet.
    expect(screen.queryByRole("searchbox", { name: "搜索用户" })).not.toBeInTheDocument();
  });

  it("opens the create form from a link, with the customer the link names", async () => {
    // The next step after creating a customer links here with that customer.
    navigation.search = "create=1&teamId=team_b";
    window.history.replaceState(null, "", "/users?create=1&teamId=team_b");
    directory();
    render(<UserManagementClient canManage />);

    const customer = await screen.findByLabelText("所属客户");
    await waitFor(() => expect(customer).toHaveValue("team_b"));
    expect(within(screen.getByRole("group", { name: "账号类型" })).getByRole("button", { name: "客户账号" })).toHaveAttribute("aria-pressed", "true");
    // The link's parameters leave the address: a reload or Back does not open the form again.
    expect(window.location.search).toBe("");
    // The header's command waits while the form is open.
    expect(screen.queryByRole("button", { name: "创建用户" })).not.toBeInTheDocument();
  });

  it("chooses only a customer the account may choose from a link", async () => {
    navigation.search = "create=1&teamId=team_elsewhere";
    directory();
    render(<UserManagementClient canManage />);
    const customer = await screen.findByLabelText("所属客户");
    await waitFor(() => expect(customer).toHaveValue("team_a"));
  });

  it("leaves the form closed for an account that may not create users", async () => {
    navigation.search = "create=1&teamId=team_b";
    window.history.replaceState(null, "", "/users?create=1&teamId=team_b");
    vi.mocked(csrfFetch).mockResolvedValue({ users: [user] });
    render(<UserManagementClient canManage={false} />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认创建" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("closes the form from its own Cancel, asking first only when something was typed", async () => {
    // The header's create button turned into a Cancel that threw the typed account away without a word.
    const actor = userEvent.setup();
    navigation.search = "create=1&teamId=team_b";
    directory();
    render(<UserManagementClient canManage />);
    await waitFor(() => expect(screen.getByLabelText("所属客户")).toHaveValue("team_b"));

    // What the link and the page filled in is not input of the person's: nothing to ask about.
    await actor.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认创建" })).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "创建用户" }));
    await actor.type(screen.getByLabelText("用户名 *"), "carol");
    await actor.click(screen.getByRole("button", { name: "取消" }));
    const dialog = await screen.findByRole("dialog", { name: "放弃未保存的更改？" });
    await actor.click(within(dialog).getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("用户名 *")).toHaveValue("carol");

    await actor.click(screen.getByRole("button", { name: "取消" }));
    await actor.click(within(await screen.findByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "放弃并离开" }));
    await waitFor(() => expect(screen.queryByLabelText("用户名 *")).not.toBeInTheDocument());
    await actor.click(screen.getByRole("button", { name: "创建用户" }));
    expect(screen.getByLabelText("用户名 *")).toHaveValue("");
  });

  it("searches the directory on the server, at once on Enter but not on an input method's Enter", async () => {
    const actor = userEvent.setup();
    directory();
    render(<UserManagementClient />);
    const box = await screen.findByRole("searchbox", { name: "搜索用户" });

    await actor.type(box, "ali");
    // The Enter that picks an input method's candidate is part of the typing.
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(listReads()).not.toContain("/api/users?page=1&pageSize=50&q=ali");
    await actor.keyboard("{Enter}");
    await waitFor(() => expect(listReads()).toContain("/api/users?page=1&pageSize=50&q=ali"));
  });

  it("says when a search matched no account, and clears it", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(((url: string) =>
      Promise.resolve(url.includes("q=") ? { users: [], total: 0 } : { users: [user], total: 1 })) as never);
    render(<UserManagementClient />);
    const box = await screen.findByRole("searchbox", { name: "搜索用户" });
    await actor.type(box, "zzz{Enter}");
    expect(await screen.findByText("没有匹配的结果")).toBeInTheDocument();
    expect(screen.getByText("没有用户名或显示名称包含“zzz”的用户。")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    // The same box, kept while the list read again.
    expect(screen.getByRole("searchbox", { name: "搜索用户" })).toBe(box);
    expect(box).toHaveValue("");
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
