import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    getAllSettingsMasked: vi.fn(),
    setManySettings: vi.fn(),
    isValidSettingKey: vi.fn(),
    auditUserAction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/settings/service", () => ({
  getAllSettingsMasked: mocks.getAllSettingsMasked,
  setManySettings: mocks.setManySettings,
  isValidSettingKey: mocks.isValidSettingKey,
}));
vi.mock("@/lib/settings/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings/schema")>();
  return {
    ...actual,
    MASKED_VALUE: "***",
  };
});
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../route");

describe("/api/settings audit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", username: "alice", user: { id: "u1" } } });
    mocks.getAllSettingsMasked.mockResolvedValue({});
    mocks.isValidSettingKey.mockImplementation((key: string) => ["platform.name", "smtp.pass", "runtime.commandExecutionTimeoutMs", "runtime.sshKeepaliveCountMax", "runtime.operationTaskListLimit", "runtime.aiProviderListLimit", "runtime.aiConversationListLimit"].includes(key));
    mocks.setManySettings.mockResolvedValue(undefined);
  });

  it("audits changed setting keys without leaking secret values", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        "platform.name": "控制台",
        "smtp.pass": "super-secret-session-value-that-must-not-leak",
      }),
    }));
    const payload = await response.clone().json().catch(() => null);

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(mocks.setManySettings).toHaveBeenCalledWith([
      { key: "platform.name", value: "控制台" },
      { key: "smtp.pass", value: "super-secret-session-value-that-must-not-leak" },
    ]);
    expect(mocks.auditUserAction).toHaveBeenCalledWith("u1", "settings.update", {
      keys: ["platform.name", "smtp.pass"],
      count: 2,
    });
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("super-secret-session-value-that-must-not-leak");
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("控制台");
  });

  it("does not write an audit entry when only masked sentinel values are submitted", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "smtp.pass": "***" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setManySettings).not.toHaveBeenCalled();
    expect(mocks.auditUserAction).not.toHaveBeenCalled();
  });

  it("normalizes valid runtime settings before persisting", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "runtime.commandExecutionTimeoutMs": "120000.9" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenCalledWith([
      { key: "runtime.commandExecutionTimeoutMs", value: "120000" },
    ]);
  });

  it("accepts bounded SSH terminal runtime settings", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "runtime.sshKeepaliveCountMax": "12.8" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenCalledWith([
      { key: "runtime.sshKeepaliveCountMax", value: "12" },
    ]);
  });

  it("accepts bounded Operation Tasks list limit runtime settings", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "runtime.operationTaskListLimit": "250.9" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenCalledWith([
      { key: "runtime.operationTaskListLimit", value: "250" },
    ]);
  });

  it("accepts bounded AI list limit runtime settings", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        "runtime.aiProviderListLimit": "80.9",
        "runtime.aiConversationListLimit": "350.2",
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenCalledWith([
      { key: "runtime.aiProviderListLimit", value: "80" },
      { key: "runtime.aiConversationListLimit", value: "350" },
    ]);
  });

  it("rejects out-of-range runtime settings", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "runtime.commandExecutionTimeoutMs": "1" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.setManySettings).not.toHaveBeenCalled();
  });
});
