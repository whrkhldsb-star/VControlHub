import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createNotificationMock, sendEmailMock, sendTelegramMock, webhookMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    setting: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    alertIncident: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    alertRule: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    server: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
  createNotificationMock: vi.fn(),
  sendEmailMock: vi.fn(),
  sendTelegramMock: vi.fn(),
  webhookMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock, isUniqueViolation: (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002" }));
vi.mock("@/lib/alert/delivery-intent", async (original) => ({
  ...await original<typeof import("@/lib/alert/delivery-intent")>(),
  currentDeliveryChannels: async () => ["in_app", "webhook", "email", "telegram"],
}));
vi.mock("@/lib/notification/service", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/notification/email", () => ({ sendAlertEmail: sendEmailMock }));
vi.mock("@/lib/notification/telegram", () => ({ sendAlertTelegram: sendTelegramMock }));
vi.mock("@/lib/security/webhook-url", () => ({ fetchWebhookSafely: webhookMock }));

import {
  acknowledgeAlertIncident,
  buildAlertFingerprint,
  escalateOverdueAlertIncidents,
  listAlertIncidents,
  openOrRefreshAlertIncident,
  resolveAlertIncident,
} from "../incidents";

describe("alert incidents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$executeRaw.mockResolvedValue(0);
    prismaMock.alertIncident.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation((fn) => fn(prismaMock));
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }]);
    createNotificationMock.mockResolvedValue({});
    sendEmailMock.mockResolvedValue(undefined);
    sendTelegramMock.mockResolvedValue(undefined);
    webhookMock.mockResolvedValue({ ok: true, response: { ok: true } });
  });

  it("builds stable fingerprints", () => {
    expect(buildAlertFingerprint("r1", "s1", "cpu_usage")).toBe("r1::s1::cpu_usage");
    expect(buildAlertFingerprint("r1", null, "cpu_usage")).toBe("r1::fleet::cpu_usage");
  });

  it("creates a new OPEN incident and notifies on-call", async () => {
    prismaMock.alertIncident.findUnique.mockResolvedValue(null);
    prismaMock.alertIncident.create.mockResolvedValue({
      id: "inc1",
      level: 1,
      status: "OPEN",
    });
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: "oncall1" }]);

    const result = await openOrRefreshAlertIncident({
      ruleId: "r1",
      ruleName: "High CPU",
      serverId: "s1",
      serverName: "vps-1",
      metric: "cpu_usage",
      operator: "gte",
      threshold: 90,
      value: 95,
      notifyChannels: ["in_app"],
      onCallUserIds: ["oncall1"],
      title: "Alert: vps-1 cpu usage",
      message: "High CPU: cpu_usage gte 90 (current: 95)",
    });

    expect(result.created).toBe(true);
    expect(result.fired).toBe(true);
    expect(result.notified).toBe(true);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "oncall1",
        type: "server_alert",
      }),
    );
  });

  it("reports fired=true but notified=false when every channel fails (best-effort delivery)", async () => {
    prismaMock.alertIncident.findUnique.mockResolvedValue(null);
    prismaMock.alertIncident.create.mockResolvedValue({
      id: "inc_fail",
      level: 1,
      status: "OPEN",
    });
    // Telegram-only rule, delivery throws — the incident still opened this pass.
    sendTelegramMock.mockRejectedValueOnce(new Error("network down"));

    const result = await openOrRefreshAlertIncident({
      ruleId: "r1",
      ruleName: "High CPU",
      serverId: "s1",
      serverName: "vps-1",
      metric: "cpu_usage",
      operator: "gte",
      threshold: 90,
      value: 95,
      notifyChannels: ["telegram"],
      onCallUserIds: [],
      title: "Alert: vps-1 cpu usage",
      message: "High CPU: cpu_usage gte 90 (current: 95)",
    });

    // fired reflects that an incident opened; notified reflects delivery reality.
    // Callers stamp lastTriggeredAt / run playbooks on fired, not notified.
    expect(result.fired).toBe(true);
    expect(result.notified).toBe(false);
    expect(result.failedChannels).toEqual([
      { channel: "telegram", error: "network down" },
    ]);
    expect(prismaMock.alertIncident.create).toHaveBeenCalled();
  });

  it("telegram that resolves with zero accepted (all chats rejected) is NOT a phantom notify", async () => {
    prismaMock.alertIncident.findUnique.mockResolvedValue(null);
    prismaMock.alertIncident.create.mockResolvedValue({ id: "inc_tg0", level: 1, status: "OPEN" });
    // sendAlertTelegram resolves (does not throw) even when every chat_id failed.
    sendTelegramMock.mockResolvedValueOnce({
      accepted: [],
      rejected: [{ chatId: "123", reason: "chat not found" }],
    });

    const result = await openOrRefreshAlertIncident({
      ruleId: "r1",
      ruleName: "High CPU",
      serverId: "s1",
      serverName: "vps-1",
      metric: "cpu_usage",
      operator: "gte",
      threshold: 90,
      value: 95,
      notifyChannels: ["telegram"],
      onCallUserIds: [],
      title: "Alert: vps-1 cpu usage",
      message: "High CPU",
    });

    expect(result.fired).toBe(true);
    expect(result.notified).toBe(false);
    expect(result.deliveredChannels).toEqual([]);
    expect(result.failedChannels).toEqual([
      { channel: "telegram", error: "chat not found" },
    ]);
  });

  it("telegram/email with at least one accepted counts as delivered", async () => {
    prismaMock.alertIncident.findUnique.mockResolvedValue(null);
    prismaMock.alertIncident.create.mockResolvedValue({ id: "inc_ok", level: 1, status: "OPEN" });
    sendTelegramMock.mockResolvedValueOnce({
      accepted: [{ chatId: "123", messageId: 1 }],
      rejected: [{ chatId: "456", reason: "blocked" }], // partial → still delivered
    });
    sendEmailMock.mockResolvedValueOnce({ accepted: ["a@b.com"], rejected: [] });

    const result = await openOrRefreshAlertIncident({
      ruleId: "r1",
      ruleName: "High CPU",
      serverId: "s1",
      serverName: "vps-1",
      metric: "cpu_usage",
      operator: "gte",
      threshold: 90,
      value: 95,
      notifyChannels: ["telegram", "email"],
      onCallUserIds: [],
      title: "Alert: vps-1 cpu usage",
      message: "High CPU",
    });

    expect(result.notified).toBe(true);
    expect(result.deliveredChannels).toEqual(expect.arrayContaining(["telegram", "email"]));
  });

  it("email that resolves with all recipients rejected is NOT a phantom notify", async () => {
    prismaMock.alertIncident.findUnique.mockResolvedValue(null);
    prismaMock.alertIncident.create.mockResolvedValue({ id: "inc_em0", level: 1, status: "OPEN" });
    sendEmailMock.mockResolvedValueOnce({ accepted: [], rejected: ["a@b.com", "c@d.com"] });

    const result = await openOrRefreshAlertIncident({
      ruleId: "r1",
      ruleName: "High CPU",
      serverId: "s1",
      serverName: "vps-1",
      metric: "cpu_usage",
      operator: "gte",
      threshold: 90,
      value: 95,
      notifyChannels: ["email"],
      onCallUserIds: [],
      title: "Alert: vps-1 cpu usage",
      message: "High CPU",
    });

    expect(result.notified).toBe(false);
    expect(result.failedChannels).toEqual([
      { channel: "email", error: "all 2 recipient(s) rejected" },
    ]);
  });

  it("does not re-notify when incident already OPEN", async () => {
    prismaMock.alertIncident.findUnique.mockResolvedValue({
      id: "inc1",
      status: "OPEN",
      level: 1,
    });
    prismaMock.alertIncident.update.mockResolvedValue({ id: "inc1" });

    const result = await openOrRefreshAlertIncident({
      ruleId: "r1",
      ruleName: "High CPU",
      serverId: "s1",
      serverName: "vps-1",
      metric: "cpu_usage",
      operator: "gte",
      threshold: 90,
      value: 97,
      notifyChannels: ["in_app"],
      title: "Alert",
      message: "msg",
    });

    expect(result.created).toBe(false);
    expect(result.notified).toBe(false);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("escalation retry quotes the minutes snapshot taken at escalation time", async () => {
    // Escalated incident: rule said 15 minutes when it escalated (snapshot),
    // but the rule has since been edited to 60 — the retry copy must still
    // quote the 15 that actually triggered the escalation.
    const old = new Date(Date.now() - 60 * 60_000);
    prismaMock.alertIncident.findUnique.mockResolvedValue({
      id: "inc1",
      status: "OPEN",
      level: 2,
      escalationMinutes: 15,
      title: "Alert",
      message: "cpu high",
      serverName: "vps-1",
      metric: "cpu_usage",
      createdAt: old,
      pendingNotifyChannels: ["in_app"],
      notifyAttempts: 0,
      nextNotifyAt: new Date(Date.now() - 1000),
    });
    prismaMock.alertIncident.update.mockResolvedValue({ id: "inc1" });
    prismaMock.alertIncident.updateMany.mockResolvedValue({ count: 1 });
    // Escalation dispatch resolves on-call + notification:manage recipients.
    prismaMock.user.findMany.mockResolvedValue([{ id: "oncall1" }, { id: "admin1" }]);

    const result = await openOrRefreshAlertIncident({
      ruleId: "r1",
      ruleName: "High CPU",
      serverId: "s1",
      serverName: "vps-1",
      metric: "cpu_usage",
      operator: "gte",
      threshold: 90,
      value: 95,
      notifyChannels: ["in_app"],
      onCallUserIds: [],
      // The rule's CURRENT value — must NOT win over the snapshot.
      escalationMinutes: 60,
      title: "Alert",
      message: "High CPU",
    });

    expect(result.notified).toBe(true);
    expect(createNotificationMock).toHaveBeenCalled();
    const messageArg = createNotificationMock.mock.calls[0]?.[0]?.message ?? "";
    expect(messageArg).toContain("15");
    expect(messageArg).not.toContain("60");
  });

  it("acknowledges open incidents", async () => {
    const row = { id: "inc1", status: "OPEN", createdAt: new Date(), teamId: "customer" };
    prismaMock.$queryRaw.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ ...row, status: "ACKNOWLEDGED" }]);
    const result = await acknowledgeAlertIncident({ incidentId: row.id, userId: "u1", openedAt: row.createdAt });
    expect(result).toMatchObject({ status: "ACKNOWLEDGED", teamId: "customer" });
    expect(prismaMock.$queryRaw.mock.calls[1]![0].join("?")).toContain("i.status = 'OPEN'");
  });

  it("refuses to acknowledge an incident resolved after it was read", async () => {
    const row = { id: "inc1", status: "OPEN", createdAt: new Date() };
    prismaMock.$queryRaw.mockResolvedValueOnce([row]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...row, status: "RESOLVED" }]);
    await expect(acknowledgeAlertIncident({ incidentId: "inc1", userId: "u1" })).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("lets only one of two concurrent resolutions notify", async () => {
    prismaMock.alertIncident.findUnique.mockResolvedValue({ id: "inc1", status: "OPEN", level: 1, serverName: "s", metric: "cpu_usage" });
    prismaMock.alertIncident.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const input = { ruleId: "r1", serverId: "s1", metric: "cpu_usage", title: "ok", message: "ok", notifyChannels: [] as string[] };

    const results = await Promise.all([resolveAlertIncident(input), resolveAlertIncident(input)]);

    expect(results.map((result) => result.resolved).sort()).toEqual([false, true]);
  });

  it("resolves open incidents and notifies", async () => {
    prismaMock.alertIncident.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.alertIncident.findUnique.mockResolvedValue({
      id: "inc1",
      status: "OPEN",
      level: 1,
      serverName: "vps-1",
      metric: "cpu_usage",
    });
    prismaMock.alertIncident.update.mockResolvedValue({ id: "inc1" });

    const result = await resolveAlertIncident({
      ruleId: "r1",
      serverId: "s1",
      metric: "cpu_usage",
      title: "resolved",
      message: "back to normal",
      notifyChannels: ["in_app"],
    });
    expect(result.resolved).toBe(true);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "alert_resolved" }),
    );
  });

  it("suppresses re-open notify during cooldown after RESOLVED", async () => {
    const recent = new Date(Date.now() - 60_000);
    prismaMock.alertIncident.findUnique.mockResolvedValue({
      id: "inc-cool",
      status: "RESOLVED",
      level: 1,
      lastNotifiedAt: recent,
    });

    const result = await openOrRefreshAlertIncident({
      ruleId: "r1",
      ruleName: "High CPU",
      serverId: "s1",
      serverName: "vps-1",
      metric: "cpu_usage",
      operator: "gte",
      threshold: 90,
      value: 95,
      notifyChannels: ["in_app"],
      onCallUserIds: ["oncall1"],
      title: "Alert: vps-1 cpu usage",
      message: "still high",
      cooldownMinutes: 15,
    });

    expect(result).toEqual({
      incidentId: "inc-cool",
      created: false,
      fired: false,
      notified: false,
      level: 1,
    });
    expect(prismaMock.alertIncident.create).not.toHaveBeenCalled();
    expect(prismaMock.alertIncident.update).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("escalates overdue OPEN incidents", async () => {
    const old = new Date(Date.now() - 60 * 60_000);
    prismaMock.alertIncident.findMany.mockResolvedValue([
      {
        id: "inc1",
        ruleId: "r1",
        status: "OPEN",
        level: 1,
        title: "Alert",
        message: "cpu high",
        serverName: "vps-1",
        metric: "cpu_usage",
        createdAt: old,
        lastNotifiedAt: old,
        rule: {
          id: "r1",
          name: "High CPU",
          escalationMinutes: 15,
          onCallUserIds: ["oncall1"],
          notifyChannels: ["in_app"],
          webhookUrl: null,
          enabled: true,
        },
      },
    ]);
    prismaMock.alertIncident.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findMany
      .mockResolvedValueOnce([{ id: "oncall1" }])
      .mockResolvedValueOnce([{ id: "admin1" }]);

    const result = await escalateOverdueAlertIncidents();
    expect(result.escalated).toBe(1);
    expect(createNotificationMock).toHaveBeenCalled();
    expect(prismaMock.alertIncident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "inc1", status: "OPEN", level: 1 }),
        data: expect.objectContaining({ level: 2 }),
      }),
    );
  });

  it("persists the escalation's delivery intent with the claim and keeps a failed channel pending", async () => {
    const old = new Date(Date.now() - 60 * 60_000);
    prismaMock.alertIncident.findMany.mockResolvedValue([
      {
        id: "inc1",
        ruleId: "r1",
        status: "OPEN",
        level: 1,
        title: "Alert",
        message: "cpu high",
        serverName: "vps-1",
        metric: "cpu_usage",
        createdAt: old,
        lastNotifiedAt: old,
        rule: {
          id: "r1",
          name: "High CPU",
          escalationMinutes: 15,
          onCallUserIds: ["oncall1"],
          notifyChannels: ["in_app", "webhook"],
          webhookUrl: "https://hooks.example.test/alert",
          enabled: true,
        },
      },
    ]);
    prismaMock.alertIncident.updateMany.mockResolvedValue({ count: 1 });
    webhookMock.mockResolvedValue({ ok: true, response: { ok: false, status: 503, statusText: "Service Unavailable" } });

    const result = await escalateOverdueAlertIncidents();
    expect(result.escalated).toBe(1);
    const writes = prismaMock.alertIncident.updateMany.mock.calls.map((call) => call[0]);
    // Claim: level 2 + every channel pending before anything is sent.
    expect(writes[0]).toMatchObject({
      where: { id: "inc1", status: "OPEN", level: 1 },
      data: { level: 2, pendingNotifyChannels: ["in_app", "webhook"], notifyAttempts: 1 },
    });
    expect(writes[0].data.nextNotifyAt).toBeInstanceOf(Date);
    // Bookkeeping after the send: only the failed channel stays pending, with a retry time.
    expect(writes[1]).toMatchObject({
      where: { id: "inc1", status: "OPEN", level: 2 },
      data: { pendingNotifyChannels: ["webhook"], notifyAttempts: 1 },
    });
    expect(writes[1].data.nextNotifyAt).toBeInstanceOf(Date);
    expect(writes[1].data.lastNotifyError).toContain("webhook");
  });

  it("paginates escalation with a stable keyset cursor instead of a mutating offset", async () => {
    const older = new Date("2026-05-01T00:00:00.000Z");
    const newer = new Date("2026-05-02T00:00:00.000Z");
    const base = {
      ruleId: "r1",
      status: "OPEN",
      level: 1,
      title: "Alert",
      message: "cpu high",
      serverName: "vps-1",
      metric: "cpu_usage",
      createdAt: older,
      lastNotifiedAt: older,
      rule: {
        id: "r1",
        name: "High CPU",
        escalationMinutes: 15,
        onCallUserIds: ["oncall1"],
        notifyChannels: ["in_app"],
        webhookUrl: null,
        enabled: true,
      },
    };
    // Page 1 is a full 200-row page (so the scan continues), page 2 is empty.
    // Escalating a row stamps updatedAt=now, which under the old skip/limit
    // pagination shifted rows behind the offset — the keyset cursor must
    // advance past the last row of the previous page instead.
    const fullPage = Array.from({ length: 200 }, (_, index) => ({
      ...base,
      id: `inc${index}`,
      updatedAt: index === 199 ? newer : older,
    }));
    // The orphan-resolution scan runs first and shares the mock; route by args
    // (only the escalation query includes the rule relation).
    let escalationPage = 0;
    prismaMock.alertIncident.findMany.mockImplementation(
      async (args: { include?: { rule?: unknown } }) => {
        if (!args?.include?.rule) return [];
        escalationPage += 1;
        return escalationPage === 1 ? fullPage : [];
      },
    );
    prismaMock.alertIncident.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findMany.mockResolvedValue([{ id: "oncall1" }]);

    const result = await escalateOverdueAlertIncidents();
    expect(result.escalated).toBe(200);

    const escalationCalls = prismaMock.alertIncident.findMany.mock.calls.filter(
      ([args]) => (args as { include?: { rule?: unknown } })?.include?.rule,
    );
    expect(escalationCalls).toHaveLength(2);
    const firstArgs = escalationCalls[0]?.[0] as {
      orderBy?: Array<Record<string, string>>;
      skip?: number;
      where?: { id?: { gt: string } };
    };
    const secondArgs = escalationCalls[1]?.[0] as {
      where?: { id?: { gt: string } };
    };
    expect(firstArgs?.orderBy).toEqual({ id: "asc" });
    expect(firstArgs?.skip).toBeUndefined();
    // The cursor is derived from the last row of the previous page.
    expect(secondArgs?.where?.id).toEqual({ gt: "inc199" });
  });

  it("skips escalate notify when conditional claim loses the race", async () => {
    const old = new Date(Date.now() - 60 * 60_000);
    prismaMock.alertIncident.findMany.mockResolvedValue([
      {
        id: "inc1",
        ruleId: "r1",
        status: "OPEN",
        level: 1,
        title: "Alert",
        message: "cpu high",
        serverName: "vps-1",
        metric: "cpu_usage",
        createdAt: old,
        lastNotifiedAt: old,
        rule: {
          id: "r1",
          name: "High CPU",
          escalationMinutes: 15,
          onCallUserIds: ["oncall1"],
          notifyChannels: ["in_app"],
          webhookUrl: null,
          enabled: true,
        },
      },
    ]);
    prismaMock.alertIncident.updateMany.mockResolvedValue({ count: 0 });

    const result = await escalateOverdueAlertIncidents();
    expect(result.escalated).toBe(0);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("auto-resolves incidents whose target server was deleted or disabled", async () => {
    // resolveOrphanedAlertIncidents scan returns one OPEN incident bound to a
    // server that no longer exists / is disabled; the escalation scan then sees
    // nothing left to page.
    prismaMock.alertIncident.findMany
      .mockResolvedValueOnce([{ id: "inc-orphan", serverId: "gone", createdAt: new Date(), rule: { teamId: null } }])
      .mockResolvedValue([]);
    // Server row is gone (or disabled) → not returned by the enabled-only lookup.
    prismaMock.server.findMany.mockResolvedValueOnce([]);
    prismaMock.$executeRaw.mockResolvedValueOnce(1);
    const result = await escalateOverdueAlertIncidents();
    expect(result.orphansResolved).toBe(1);
    expect(result.escalated).toBe(0);
    expect(prismaMock.$executeRaw.mock.calls[0]![0].join("?")).toContain('i."createdAt" = v.opened');
    // A deleted/disabled host must never be escalated or re-paged.
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("keeps incidents whose target server still exists and is enabled", async () => {
    prismaMock.alertIncident.findMany
      .mockResolvedValueOnce([{ id: "inc-live", serverId: "live-srv", metric: "cpu_usage", createdAt: new Date(), rule: { teamId: null, enabled: true, metric: "cpu_usage", serverIds: [] } }])
      .mockResolvedValue([]);
    prismaMock.server.findMany.mockResolvedValue([{ id: "live-srv" }]);
    prismaMock.alertIncident.updateMany.mockResolvedValue({ count: 0 });

    const result = await escalateOverdueAlertIncidents();

    expect(result.orphansResolved).toBe(0);
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
    // The only updateMany permitted here is the (skipped) escalation claim, never
    // an orphan resolve — the live server keeps its incident open.
    for (const call of prismaMock.alertIncident.updateMany.mock.calls) {
      expect((call[0] as { data?: { status?: string } }).data?.status).not.toBe("RESOLVED");
    }
  });

  it("openOrRefresh recovers from concurrent P2002 create races", async () => {
    prismaMock.alertIncident.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "inc-race",
        status: "OPEN",
        level: 1,
      });
    prismaMock.alertIncident.create.mockRejectedValue({ code: "P2002" });
    prismaMock.alertIncident.update.mockResolvedValue({ id: "inc-race" });

    const result = await openOrRefreshAlertIncident({
      ruleId: "r1",
      ruleName: "High CPU",
      serverId: "s1",
      serverName: "vps-1",
      metric: "cpu_usage",
      operator: "gte",
      threshold: 90,
      value: 95,
      notifyChannels: ["in_app"],
      onCallUserIds: ["oncall1"],
      title: "Alert: vps-1 cpu usage",
      message: "High CPU",
    });

    expect(result.created).toBe(false);
    expect(result.notified).toBe(false);
    expect(result.incidentId).toBe("inc-race");
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("limits incidents of a transferred host to its new customer's and platform rules", async () => {
    prismaMock.server.findMany.mockResolvedValue([{ id: "transferred" }]);
    prismaMock.alertIncident.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (action) => action(prismaMock));
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "eligible" }]);
    await listAlertIncidents({ session: { userId: "u1", roles: ["operator"], currentTeamId: "team-b" } });

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
    expect(prismaMock.server.findMany).not.toHaveBeenCalled();
    const [parts, ...values] = prismaMock.$queryRaw.mock.lastCall!;
    expect(parts.join("?")).toContain("EXISTS");
    expect(values).toContain("team-b");
    expect(prismaMock.alertIncident.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["eligible"] } } }));
  });

  it("refuses to acknowledge an event owned by the transferred host's old customer", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(acknowledgeAlertIncident({
      incidentId: "moved", userId: "u", session: { userId: "u", roles: [], currentTeamId: "team-b" },
    })).rejects.toMatchObject({ status: 404 });
    expect(prismaMock.$queryRaw.mock.calls[0]?.at(-1).text).toContain('s."teamId"');
  });

  it("preserves the platform administrator's all-customers incident history", async () => {
    prismaMock.alertIncident.findMany.mockResolvedValue([]);
    await listAlertIncidents({ status: "OPEN", session: { userId: "admin", roles: ["admin"], currentTeamId: null } });
    expect(prismaMock.server.findMany).not.toHaveBeenCalled();
    expect(prismaMock.alertIncident.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "OPEN" } }));
  });
});
