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
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", username: "alice", user: { id: "u1" }, currentTeamId: null } });
    mocks.getAllSettingsMasked.mockResolvedValue({});
    mocks.isValidSettingKey.mockImplementation((key: string) => [
      "platform.name",
      "platform.logo",
      "session.timeout",
      "password.minLength",
      "password.requireUppercase",
      "smtp.port",
      "smtp.from",
      "smtp.pass",
      "runtime.commandExecutionTimeoutMs",
      "runtime.sshIdleTimeoutSec",
      "runtime.operationTaskListLimit",
      "runtime.aiProviderListLimit",
      "runtime.aiConversationListLimit",
    ].includes(key));
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
    }, undefined, null);
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("super-secret-session-value-that-must-not-leak");
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("控制台");
  });

  it("rejects malformed JSON with the shared bodySchema error envelope", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Request body is not valid JSON" });
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

  it("normalizes and persists bounded system setting values", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        "platform.name": "  控制台  ",
        "platform.logo": " /logo.png ",
        "session.timeout": "900.9",
        "password.minLength": "12.9",
        "password.requireUppercase": "false",
        "smtp.port": "587.9",
        "smtp.from": " ops@example.com ",
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenCalledWith([
      { key: "platform.name", value: "控制台" },
      { key: "platform.logo", value: "/logo.png" },
      { key: "session.timeout", value: "900" },
      { key: "password.minLength", value: "12" },
      { key: "password.requireUppercase", value: "false" },
      { key: "smtp.port", value: "587" },
      { key: "smtp.from", value: "ops@example.com" },
    ]);
  });

  it("rejects invalid system setting values before persisting", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        "platform.logo": "ftp://example.com/logo.png",
        "session.timeout": "10",
        "password.minLength": "4",
        "smtp.from": "not-an-email",
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Logo URL only supports http(s) or internal path; Session timeout must be between 300 and 2592000 ; Password minimum length must be between 8 and 128 ; Invalid sender address format");
    expect(payload.error).toContain("Session timeout must be between 300 and 2592000");
    expect(payload.error).toContain("Password minimum length must be between 8 and 128");
    expect(payload.error).toContain("Invalid sender address format");
    expect(mocks.setManySettings).not.toHaveBeenCalled();
  });

  it("accepts bounded SSH idle timeout runtime settings", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "runtime.sshIdleTimeoutSec": "600.8" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenCalledWith([
      { key: "runtime.sshIdleTimeoutSec", value: "600" },
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
