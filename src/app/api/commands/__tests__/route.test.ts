import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    createCommandRequest: vi.fn(),
    listCommandRequests: vi.fn(),
    auditUserAction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.sessionHasPermission }));
vi.mock("@/lib/command/service", () => ({
  createCommandRequest: mocks.createCommandRequest,
  listCommandRequests: mocks.listCommandRequests,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../route");

describe("/api/commands audit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ userId: "u1", username: "alice", user: { id: "u1" } });
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.listCommandRequests.mockResolvedValue([]);
    mocks.createCommandRequest.mockResolvedValue({
      id: "cmd1",
      title: "Restart nginx",
      command: "systemctl restart nginx",
      reason: "routine maintenance",
      status: "PENDING_APPROVAL",
      targets: [{ id: "target1" }, { id: "target2" }],
      requiresApproval: true,
    });
  });

  it("audits command submissions without leaking raw shell text", async () => {
    const response = await route.POST(new Request("http://local/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Restart nginx",
        command: "systemctl restart nginx && cat /etc/shadow",
        reason: "routine maintenance",
        serverIds: ["srv1", "srv2"],
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.auditUserAction).toHaveBeenCalledWith("u1", "command.submit", {
      commandRequestId: "cmd1",
      title: "Restart nginx",
      status: "PENDING_APPROVAL",
      targetCount: 2,
      requiresApproval: true,
      submissionMode: "user",
    });
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("systemctl restart nginx");
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("/etc/shadow");
  });

  it("does not audit invalid command submissions", async () => {
    const response = await route.POST(new Request("http://local/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "", command: "", serverIds: [] }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.createCommandRequest).not.toHaveBeenCalled();
    expect(mocks.auditUserAction).not.toHaveBeenCalled();
  });
});
