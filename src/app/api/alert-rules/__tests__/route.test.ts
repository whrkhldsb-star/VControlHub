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
    ensureDefaultAlertRules: vi.fn(),
    auditUserAction: vi.fn(),
    getPlatformDefaults: vi.fn(),
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
  ensureDefaultAlertRules: mocks.ensureDefaultAlertRules,
}));
vi.mock("@/lib/health/service", () => ({
  evaluateAlerts: mocks.evaluateAlerts,
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));
vi.mock("@/lib/settings/platform-defaults", () => ({
  getPlatformDefaults: mocks.getPlatformDefaults,
}));

const route = await import("../route");
const { currentCopyLocale } = await import("@/lib/i18n/api-copy");

const session = { userId: "u1", username: "alice", roles: ["admin"], currentTeamId: null };
/** A rule as the database holds it, address included. */
const row = (over: Record<string, unknown> = {}) => ({
  id: "rule1", name: "CPU", metric: "cpu_usage", operator: "gte", threshold: 90, durationSeconds: 0, serverIds: [],
  notifyChannels: ["in_app", "webhook"], webhookUrl: "https://hooks.example.com/secret", playbookIds: [], cooldownMinutes: 30,
  escalationMinutes: 30, onCallUserIds: [], silenceWindows: [], enabled: true, lastTriggeredAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z"), matchState: null, lastMatchedAt: null, teamId: null,
  ...over,
});
const request = (method = "GET") =>
  new Request("http://local/api/alert-rules", { method });

describe("/api/alert-rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.listAlertRules.mockResolvedValue([row()]);
    mocks.createAlertRule.mockResolvedValue(row());
    mocks.updateAlertRule.mockResolvedValue(row());
    mocks.toggleAlertRule.mockResolvedValue(row({ enabled: false }));
    mocks.testAlertRule.mockResolvedValue({
      rule: { id: "rule1", name: "CPU", webhookUrl: "https://hooks.example.com/secret" },
      deliveries: [{ channel: "webhook", status: "sent", message: "Webhook test request sent" }],
    });
    mocks.deleteAlertRule.mockResolvedValue({ id: "rule1" });
    mocks.evaluateAlerts.mockResolvedValue(undefined);
    mocks.getPlatformDefaults.mockResolvedValue({ locale: "zh", theme: "dark" });
  });

  // An evaluation opens incidents and sends mail, Telegram and webhook notices to people who did
  // not start it: started by hand it has to word them as the worker's own evaluation does.
  it.each([
    ["en", "zh"],
    ["zh", "en"],
  ] as const)("evaluates in the platform's language (%s page, %s platform)", async (page, platform) => {
    mocks.getPlatformDefaults.mockResolvedValue({ locale: platform, theme: "dark" });
    let evaluatedIn: string | undefined;
    mocks.evaluateAlerts.mockImplementation(async () => {
      evaluatedIn = currentCopyLocale();
    });

    const response = await route.PUT(
      new Request("http://local/api/alert-rules", { method: "PUT", headers: { cookie: `vps-locale=${page}` } }),
    );

    expect(response.status).toBe(200);
    expect(evaluatedIn).toBe(platform);
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
        silenceWindows: ["22:00-08:00"],
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
        silenceWindows: ["22:00-08:00"],
        serverIds: ["srv1"],
      }),
      expect.anything(),
    );
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "alert_rule.create",
      expect.objectContaining({ ruleId: "rule1", webhookConfigured: true }),
      undefined, null);
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain(
      "secret",
    );
  });

  it("coerces server_offline rules to operator eq and threshold 1", async () => {
    mocks.createAlertRule.mockResolvedValueOnce(row({ id: "rule-off", name: "Host offline", metric: "server_offline", webhookUrl: null }));
    const req = new Request("http://local/api/alert-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Host offline",
        metric: "server_offline",
        operator: "gte",
        threshold: 85,
        notifyChannels: ["in_app"],
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    expect(mocks.createAlertRule).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: "server_offline",
        operator: "eq",
        threshold: 1,
      }),
      expect.anything(),
    );
  });

  it("accepts capacity_* forecast metrics offered by the create-rule UI", async () => {
    mocks.createAlertRule.mockResolvedValueOnce(row({ id: "rule-cap", name: "Disk capacity risk", metric: "capacity_disk_days", webhookUrl: null }));
    const req = new Request("http://local/api/alert-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Disk capacity risk",
        metric: "capacity_disk_days",
        operator: "lte",
        threshold: 14,
        notifyChannels: ["in_app"],
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    expect(mocks.createAlertRule).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: "capacity_disk_days",
        operator: "lte",
        threshold: 14,
      }),
      expect.anything(),
    );
  });

  it("accepts form submissions and redirects back to alert rules page", async () => {
    const req = new Request("http://local/api/alert-rules", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // Browser form posts always declare a length; without it the route
        // answers 411 before parsing (see requestContentLengthMissing).
        "content-length": "1024",
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

  it("updates only the fields a request names", async () => {
    // zod 4 applied the creation defaults to absent keys: changing a threshold
    // also reset the rule to every server, in-app only, no playbooks, no
    // silence windows and no on-call users.
    const res = await route.PATCH(
      new Request("http://local/api/alert-rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "rule1", threshold: 95 }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.updateAlertRule).toHaveBeenCalledWith("rule1", { id: "rule1", threshold: 95 }, expect.anything());
  });

  it("leaves an update that names the webhook channel without an address to the rule it changes", async () => {
    // The stored address is never sent to the page, so the edit form sends the channels without it. The
    // request was refused here, before anything knew whether the rule already had an address: a rule with a
    // webhook could not be edited at all without typing the address again. The service decides, against the rule.
    const res = await route.PATCH(
      new Request("http://local/api/alert-rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "rule1", notifyChannels: ["webhook"], threshold: 95 }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.updateAlertRule).toHaveBeenCalledWith("rule1", { id: "rule1", notifyChannels: ["webhook"], threshold: 95 }, expect.anything());
  });

  it("answers with the rule as the page shows it: whether a webhook is configured, never its address", async () => {
    // Every answer carried the database row. The list on the page, refreshed from here, lost its "webhook
    // configured" badge (the row has no such field) and held the address, token and all.
    const json = (body: unknown, method = "PATCH") =>
      new Request("http://local/api/alert-rules", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    mocks.ensureDefaultAlertRules.mockResolvedValue({ created: 0, skipped: 3 });
    const answers = [
      await route.GET(request()),
      await route.POST(json({ name: "CPU", metric: "cpu_usage", operator: "gte", threshold: 90, notifyChannels: ["in_app", "webhook"], webhookUrl: "https://hooks.example.com/secret" }, "POST")),
      await route.PATCH(json({ id: "rule1", threshold: 95 })),
      await route.PATCH(json({ toggleId: "rule1" })),
      await route.PATCH(json({ ensureDefaults: true })),
    ];
    for (const answer of answers) {
      const text = JSON.stringify(await answer.json());
      expect(answer.status).toBeLessThan(300);
      expect(text).not.toContain("hooks.example.com");
      expect(text).not.toContain("webhookUrl");
      expect(text).toContain('"webhookConfigured":true');
      expect(text).toContain('"createdAt":"2026-01-01T00:00:00.000Z"');
    }
  });

  it("rejects malformed silence windows before persistence", async () => {
    const res = await route.POST(
      new Request("http://local/api/alert-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Quiet hours",
          metric: "cpu_usage",
          operator: "gte",
          threshold: 90,
          notifyChannels: ["in_app"],
          silenceWindows: ["25:00-08:00"],
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mocks.createAlertRule).not.toHaveBeenCalled();
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
      undefined, null);
    expect(mocks.testAlertRule).toHaveBeenCalledWith("rule1", expect.anything());
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "alert_rule.test",
      expect.objectContaining({
        ruleId: "rule1",
        channels: ["webhook"],
        statuses: ["sent"],
      }),
      undefined, null);
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("secret");
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "alert_rule.delete",
      expect.objectContaining({ ruleId: "rule1" }),
      undefined, null);
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "alert_rule.evaluate",
      expect.objectContaining({ manual: true }),
      undefined, null);
  });
});
