import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    listTemplates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    auditUserAction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/command-template/service", () => ({
  listTemplates: mocks.listTemplates,
  createTemplate: mocks.createTemplate,
  updateTemplate: mocks.updateTemplate,
  deleteTemplate: mocks.deleteTemplate,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../route");

describe("/api/command-templates audit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", username: "alice", user: { id: "u1" }, currentTeamId: null } });
    mocks.listTemplates.mockResolvedValue([]);
    mocks.createTemplate.mockResolvedValue({
      id: "tmpl1",
      name: "Restart app",
      description: "restart service",
      command: "systemctl restart app",
      tags: ["systemd"],
      variables: [],
      isBuiltin: false,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      creator: { username: "alice", displayName: "Alice" },
    });
    mocks.updateTemplate.mockResolvedValue({
      id: "tmpl1",
      name: "Restart web",
      description: "restart service",
      command: "systemctl restart web",
      tags: ["systemd"],
      variables: [],
      isBuiltin: false,
    });
    mocks.deleteTemplate.mockResolvedValue({ id: "tmpl1", name: "Restart web", isBuiltin: false });
  });

  it("audits command template create/update/delete without leaking command text", async () => {
    await route.POST(new Request("http://local/api/command-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Restart app", description: "restart service", command: "systemctl restart app", tags: ["systemd"] }),
    }));

    await route.PATCH(new Request("http://local/api/command-templates", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "tmpl1", name: "Restart web", command: "systemctl restart web" }),
    }));

    await route.DELETE(new Request("http://local/api/command-templates?id=tmpl1", { method: "DELETE" }));

    expect(mocks.auditUserAction).toHaveBeenCalledWith("u1", "command_template.create", expect.objectContaining({ templateId: "tmpl1", name: "Restart app" }), undefined, null);
    expect(mocks.auditUserAction).toHaveBeenCalledWith("u1", "command_template.update", expect.objectContaining({ templateId: "tmpl1", name: "Restart web" }), undefined, null);
    expect(mocks.auditUserAction).toHaveBeenCalledWith("u1", "command_template.delete", expect.objectContaining({ templateId: "tmpl1" }), undefined, null);
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("systemctl restart");
  });
});
