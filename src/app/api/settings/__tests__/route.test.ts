import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    getAllSettingsMasked: vi.fn(),
    setManySettings: vi.fn(),
    isValidSettingKey: vi.fn(),
    getSetting: vi.fn(),
    auditUserAction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/settings/service", () => ({
  getAllSettingsMasked: mocks.getAllSettingsMasked,
  setManySettings: mocks.setManySettings,
  isValidSettingKey: mocks.isValidSettingKey,
  getSetting: mocks.getSetting,
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
      "security.loginLockoutMinutes",
      "security.sshEnforceHostKeyPin",
      "telegram.enabled",
      "telegram.chatId",
    ].includes(key));
    mocks.getSetting.mockResolvedValue("");
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
    ], "u1");
    expect(mocks.auditUserAction).toHaveBeenCalledWith("u1", "settings.update", {
      keys: ["platform.name", "smtp.pass"],
      count: 2,
    }, undefined, null);
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("super-secret-session-value-that-must-not-leak");
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("控制台");
  });

  it("keeps a secret sent back as the *** sentinel and clears one sent empty", async () => {
    const patch = (body: Record<string, string>) => route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));

    expect((await patch({ "platform.name": "控制台", "smtp.pass": "***" })).status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenLastCalledWith([{ key: "platform.name", value: "控制台" }], "u1");

    expect((await patch({ "smtp.pass": "" })).status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenLastCalledWith([{ key: "smtp.pass", value: "" }], "u1");

    expect((await patch({ "smtp.pass": "new-secret" })).status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenLastCalledWith([{ key: "smtp.pass", value: "new-secret" }], "u1");
  });

  it("saves *** as a real value for keys that are never masked", async () => {
    const patch = (body: Record<string, string>) => route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));

    expect((await patch({ "platform.name": "***" })).status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenLastCalledWith([{ key: "platform.name", value: "***" }], "u1");
    expect(mocks.auditUserAction).toHaveBeenLastCalledWith("u1", "settings.update", { keys: ["platform.name"], count: 1 }, undefined, null);

    // Mixed with a kept secret: only the secret's sentinel is dropped.
    expect((await patch({ "platform.name": "***", "smtp.pass": "***" })).status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenLastCalledWith([{ key: "platform.name", value: "***" }], "u1");
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
    ], "u1");
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
    ], "u1");
  });

  it("explains an invalid value in the language of the request (H-3)", async () => {
    const save = (language: string) => route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", "accept-language": language, cookie: `vps-locale=${language}` },
      body: JSON.stringify({ "platform.name": "" }),
    }));
    const english = await (await save("en")).json();
    expect(String(english.error)).toBe("Platform name is required");
    const chinese = await (await save("zh")).json();
    expect(String(chinese.error)).toBe("平台名称不能为空");
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
    expect(String(payload.error)).toMatch(/Logo URL|Session|Password|sender|发件人|必须/i);
    expect(mocks.setManySettings).not.toHaveBeenCalled();
  });

  it("accepts an empty host-key pin policy (env fallback) next to edited security settings", async () => {
    const response = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "security.loginLockoutMinutes": "20", "security.sshEnforceHostKeyPin": "" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenCalledWith(expect.arrayContaining([
      { key: "security.sshEnforceHostKeyPin", value: "" },
    ]), "u1");
    const invalid = await route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "security.sshEnforceHostKeyPin": "yes" }),
    }));
    expect(invalid.status).toBe(400);
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
    ], "u1");
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
    ], "u1");
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
    ], "u1");
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

  it("turns Telegram off while clearing its target in one save", async () => {
    // The target is required to send, not to stay off: requiring it here
    // made the user keep (or re-type) the value they meant to remove.
    const patch = (body: Record<string, string>) => route.PATCH(new Request("http://local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    mocks.getSetting.mockResolvedValue("true");
    const off = await patch({ "telegram.enabled": "false", "telegram.chatId": "" });
    expect(off.status).toBe(200);
    expect(mocks.setManySettings).toHaveBeenLastCalledWith([
      { key: "telegram.enabled", value: "false" },
      { key: "telegram.chatId", value: "" },
    ], "u1");

    // Enabled (in this save or already), the target is still required.
    expect((await patch({ "telegram.enabled": "true", "telegram.chatId": "" })).status).toBe(400);
    expect((await patch({ "telegram.chatId": "" })).status).toBe(400);
  });
});

