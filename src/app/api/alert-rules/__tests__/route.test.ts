import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    listAlertRules: vi.fn(),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    deleteAlertRule: vi.fn(),
    testAlertRule: vi.fn(),
    toggleAlertRule: vi.fn(),
    evaluateAlerts: vi.fn(),
    auditUserAction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/alert/service", () => ({
  listAlertRules: mocks.listAlertRules,
  createAlertRule: mocks.createAlertRule,
  updateAlertRule: mocks.updateAlertRule,
  deleteAlertRule: mocks.deleteAlertRule,
  testAlertRule: mocks.testAlertRule,
  toggleAlertRule: mocks.toggleAlertRule,
}));
vi.mock("@/lib/health/service", () => ({
  evaluateAlerts: mocks.evaluateAlerts,
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));

const route = await import("../route");

const session = { userId: "u1", username: "alice", roles: ["admin"] };
const request = (method = "GET") =>
  new Request("http://local/api/alert-rules", { method });

describe("/api/alert-rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.listAlertRules.mockResolvedValue([
      {
        id: "rule1",
        name: "CPU",
        webhookUrl: "https://hooks.example.com/secret",
      },
    ]);
    mocks.createAlertRule.mockResolvedValue({
      id: "rule1",
      name: "CPU",
      webhookUrl: "https://hooks.example.com/secret",
    });
    mocks.updateAlertRule.mockResolvedValue({ id: "rule1" });
    mocks.toggleAlertRule.mockResolvedValue({ id: "rule1", enabled: false });
    mocks.testAlertRule.mockResolvedValue({
      rule: { id: "rule1", name: "CPU", webhookUrl: "https://hooks.example.com/secret" },
      deliveries: [{ channel: "webhook", status: "sent", message: "Webhook 测试请求已发送" }],
    });
    mocks.deleteAlertRule.mockResolvedValue({ id: "rule1" });
    mocks.evaluateAlerts.mockResolvedValue(undefined);
  });

  it("uses notification:manage rather than user:manage for alert rule access", async () => {
    await route.GET(request());
    expect(mocks.requireApiPermission).toHaveBeenCalledWith(
      "notification:manage",
    );
    expect(mocks.requireApiPermission).not.toHaveBeenCalledWith("user:manage");
  });

  it("rejects invalid alert rule payloads before persistence", async () => {
    const req = new Request("http://local/api/alert-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "",
        metric: "load_avg",
        operator: "gte",
        threshold: 1000,
        notifyChannels: ["webhook"],
        webhookUrl: "ftp://internal",
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    expect(mocks.createAlertRule).not.toHaveBeenCalled();
  });

  it("creates alert rules with validated fields and audits without webhook secrets", async () => {
    const req = new Request("http://local/api/alert-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: " CPU hot ",
        metric: "cpu_usage",
        operator: "gte",
        threshold: 90,
        notifyChannels: ["in_app", "webhook"],
        webhookUrl: "https://hooks.example.com/secret",
        cooldownMinutes: 10,
        serverIds: ["srv1"],
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    expect(mocks.createAlertRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "CPU hot",
        metric: "cpu_usage",
        operator: "gte",
        threshold: 90,
        notifyChannels: ["in_app", "webhook"],
        webhookUrl: "https://hooks.example.com/secret",
        cooldownMinutes: 10,
        serverIds: ["srv1"],
      }),
    );
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "alert_rule.create",
      expect.objectContaining({ ruleId: "rule1", webhookConfigured: true }),
    );
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain(
      "secret",
    );
  });

  it("accepts form submissions and redirects back to alert rules page", async () => {
    const req = new Request("http://local/api/alert-rules", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams([
        ["name", "CPU"],
        ["metric", "cpu_usage"],
        ["operator", "gte"],
        ["threshold", "90"],
        ["notifyChannels", "in_app"],
      ]),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://local/alert-rules");
  });

  it("rejects updates that enable webhook notifications without a webhook URL", async () => {
    const res = await route.PATCH(
      new Request("http://local/api/alert-rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "rule1", notifyChannels: ["webhook"] }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mocks.updateAlertRule).not.toHaveBeenCalled();
  });

  it("rejects webhook URLs pointing at local or private network targets", async () => {
    for (const webhookUrl of [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.2/hook",
      "https://[::1]/hook",
    ]) {
      const res = await route.POST(
        new Request("http://local/api/alert-rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Private hook",
            metric: "cpu_usage",
            operator: "gte",
            threshold: 90,
            notifyChannels: ["webhook"],
            webhookUrl,
          }),
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(mocks.createAlertRule).not.toHaveBeenCalled();
  });

  it("audits toggle, delete, test-send, and manual evaluation actions", async () => {
    await route.PATCH(
      new Request("http://local/api/alert-rules", {
        method: "PATCH",
        body: JSON.stringify({ toggleId: "rule1" }),
      }),
    );
    await route.PATCH(
      new Request("http://local/api/alert-rules", {
        method: "PATCH",
        body: JSON.stringify({ testId: "rule1" }),
      }),
    );
    await route.DELETE(
      new Request("http://local/api/alert-rules?id=rule1", {
        method: "DELETE",
      }),
    );
    await route.PUT(
      new Request("http://local/api/alert-rules", { method: "PUT" }),
    );
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "alert_rule.toggle",
      expect.objectContaining({ ruleId: "rule1" }),
    );
    expect(mocks.testAlertRule).toHaveBeenCalledWith("rule1");
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "alert_rule.test",
      expect.objectContaining({
        ruleId: "rule1",
        channels: ["webhook"],
        statuses: ["sent"],
      }),
    );
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("secret");
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "alert_rule.delete",
      expect.objectContaining({ ruleId: "rule1" }),
    );
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "alert_rule.evaluate",
      expect.objectContaining({ manual: true }),
    );
  });
});
