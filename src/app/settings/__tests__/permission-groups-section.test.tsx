import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { PermissionGroupsSection } from "../permission-groups-section";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const group = {
  id: "policy-1",
  name: "只读观察员",
  description: "Viewer",
  kind: "POLICY_GROUP" as const,
  roleKeys: ["viewer"],
  permissions: [],
  storageAccess: [],
  serverAccess: [],
  isBuiltin: false,
};

const members = [
  { role: "owner", accessRole: "inherit", user: { id: "owner", username: "owner", displayName: null } },
  { role: "admin", accessRole: "inherit", user: { id: "admin", username: "manager", displayName: null } },
  { role: "member", accessRole: "viewer", permissionTemplateId: null, user: { id: "member", username: "alice", displayName: null } },
];

describe("PermissionGroupsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/role-templates?kind=POLICY_GROUP") return { templates: [group] };
      if (url === "/api/role-templates/policy-1" && init?.method === "PATCH") {
        return { template: { ...group, ...JSON.parse(String(init.body)) } };
      }
      throw new Error(`unexpected request: ${url}`);
    });
  });

  it("updates a common group and turns role presets into exact checkbox permissions", async () => {
    const actor = userEvent.setup();
    render(<PermissionGroupsSection teamId="team-1" members={members} canManage onMemberChanged={vi.fn()} />);

    await actor.selectOptions(await screen.findByLabelText("选择权限组"), "policy-1");
    const serverRead = screen.getByText("server:read").closest("label")?.querySelector("input");
    expect(serverRead).toBeChecked();
    await actor.click(serverRead!);
    await actor.clear(screen.getByLabelText("权限组名称"));
    await actor.type(screen.getByLabelText("权限组名称"), "夜班只读");
    await actor.click(screen.getByRole("button", { name: "保存修改" }));

    const patchCall = vi.mocked(csrfFetch).mock.calls.find(([url, init]) =>
      url === "/api/role-templates/policy-1" && init?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(String(patchCall![1]?.body));
    expect(body).toMatchObject({ kind: "POLICY_GROUP", name: "夜班只读", roleKeys: [] });
    expect(body.permissions).not.toContain("server:read");
    expect(body.permissions).toContain("storage:read");
  });

  it("offers policy-group assignment only for ordinary members", async () => {
    render(<PermissionGroupsSection teamId="team-1" members={members} canManage onMemberChanged={vi.fn()} />);
    expect(await screen.findByLabelText("alice 选择权限组")).toBeInTheDocument();
    expect(screen.queryByLabelText("manager 选择权限组")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("owner 选择权限组")).not.toBeInTheDocument();
  });
});
