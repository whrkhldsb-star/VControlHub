import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createNotificationMock, sendEmailMock, sendTelegramMock, webhookMock } = vi.hoisted(() => ({
  prismaMock: {
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
    expect(result.notified).toBe(true);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "oncall1",
        type: "server_alert",
      }),
    );
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

  it("acknowledges open incidents", async () => {
    prismaMock.alertIncident.findUnique.mockResolvedValue({
      id: "inc1",
      status: "OPEN",
    });
    prismaMock.alertIncident.update.mockResolvedValue({
      id: "inc1",
      status: "ACKNOWLEDGED",
    });

    const result = await acknowledgeAlertIncident({ incidentId: "inc1", userId: "u1" });
    expect(result.status).toBe("ACKNOWLEDGED");
    expect(prismaMock.alertIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ACKNOWLEDGED",
          acknowledgedById: "u1",
        }),
      }),
    );
  });

  it("resolves open incidents and notifies", async () => {
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

  it("listAlertIncidents scopes null-server fleet rows by team rule ids", async () => {
    prismaMock.server.findMany.mockResolvedValue([{ id: "s-team" }]);
    prismaMock.alertRule.findMany.mockResolvedValue([{ id: "rule-team" }]);
    prismaMock.alertIncident.findMany.mockResolvedValue([]);

    await listAlertIncidents({
      session: { userId: "u1", roles: ["operator"], currentTeamId: "team-a" },
    });

    expect(prismaMock.server.findMany).toHaveBeenCalled();
    expect(prismaMock.alertRule.findMany).toHaveBeenCalled();
    expect(prismaMock.alertIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { serverId: { in: ["s-team"] } },
                { serverId: null, ruleId: { in: ["rule-team"] } },
              ],
            },
          ],
        }),
      }),
    );
  });
});
