import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ list: vi.fn(), roles: ["operator"] }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "127.0.0.1:15430" }) }));
vi.mock("@/lib/auth/server-session", () => ({ getCurrentSession: async () => ({
  userId: "audit-tenant-user", username: "audit-tenant", roles: state.roles,
  permissions: ["docker:manage"], currentTeamId: "audit-team", mustChangePassword: false,
}) }));
vi.mock("@/lib/auth/declared-permissions", () => ({ loadSidebarDeclaredPermissions: () => ({}) }));
vi.mock("@/lib/quick-service/service", () => ({ listQuickServices: state.list }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));

import { SidebarLoader } from "../sidebar-loader";
import { assertHubHostDockerAccess } from "@/lib/docker/hub-host-access";

beforeEach(() => { vi.clearAllMocks(); state.roles = ["operator"]; });

it("hides hub services from a tenant operator rejected by the Docker API guard", async () => {
  const actor = { userId: "audit-tenant-user", username: "audit-tenant", roles: ["operator"],
    permissions: ["docker:manage"], currentTeamId: "audit-team", mustChangePassword: false };
  expect(assertHubHostDockerAccess(actor as never).ok).toBe(false);
  state.list.mockResolvedValue([{ slug: "audit-admin-app", name: "Private hub app", icon: "server", status: "running", port: 15490, path: "/private" }]);
  const element = await SidebarLoader();
  expect(state.list).not.toHaveBeenCalled();
  expect(element?.props.quickServices).toEqual([]);
});

it("loads hub services for a platform administrator", async () => {
  state.roles = ["admin"];
  state.list.mockResolvedValue([{ slug: "private-app", name: "Hub app", status: "running", port: 15490, path: "/private" }]);
  const element = await SidebarLoader();
  expect(state.list).toHaveBeenCalledOnce();
  expect(element?.props.quickServices).toEqual([expect.objectContaining({ name: "Hub app" })]);
});
