import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  openOrRefreshMock,
  resolveMock,
  getCapacityForecastMock,
  runPlaybookMock,
  alertRuleUpdateMock,
} = vi.hoisted(() => ({
  openOrRefreshMock: vi.fn(),
  resolveMock: vi.fn(),
  getCapacityForecastMock: vi.fn(),
  runPlaybookMock: vi.fn(),
  alertRuleUpdateMock: vi.fn(),
}));

vi.mock("@/lib/alert/incidents", () => ({
  openOrRefreshAlertIncident: openOrRefreshMock,
  resolveAlertIncident: resolveMock,
}));

vi.mock("@/lib/health/capacity-service", () => ({
  getCapacityForecast: getCapacityForecastMock,
}));

vi.mock("@/lib/playbook/service", () => ({
  runPlaybook: runPlaybookMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    alertRule: { update: alertRuleUpdateMock },
  },
}));

vi.mock("@/lib/health/service-types", () => ({
  isNowInAlertSilenceWindow: () => false,
}));

import {
  capacityMetricKeyFromAlertMetric,
  daysValueFromServerForecast,
  evaluateCapacityLinkedAlerts,
  isCapacityAlertMetric,
} from "../capacity-alert-link";
import type { ServerCapacityForecast } from "../capacity-predict";

function serverForecast(partial: Partial<ServerCapacityForecast> & { serverId: string }): ServerCapacityForecast {
  return {
    serverId: partial.serverId,
    serverName: partial.serverName ?? partial.serverId,
    host: null,
    overallRisk: partial.overallRisk ?? "warning",
    sampleCount: 20,
    latestSampleAt: new Date().toISOString(),
    metrics: partial.metrics ?? [
      {
        metric: "disk",
        sampleCount: 20,
        windowHours: 168,
        dataSpanHours: 100,
        latest: 70,
        slopePerDay: 1.5,
        r2: 0.9,
        projected: 91,
        horizonDays: 14,
        daysUntil85: 10,
        daysUntil95: 16,
        risk: "warning",
        reason: "ok",
      },
    ],
  };
}

describe("capacity alert metric helpers", () => {
  it("recognizes capacity_* metrics", () => {
    expect(isCapacityAlertMetric("capacity_disk_days")).toBe(true);
    expect(isCapacityAlertMetric("cpu_usage")).toBe(false);
    expect(capacityMetricKeyFromAlertMetric("capacity_cpu_days")).toBe("cpu");
  });

  it("reads daysUntil85 from forecast rows", () => {
    const s = serverForecast({ serverId: "s1" });
    expect(daysValueFromServerForecast(s, "disk")).toEqual({
      value: 10,
      reason: "ok",
    });
  });
});

describe("evaluateCapacityLinkedAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openOrRefreshMock.mockResolvedValue({
      incidentId: "inc1",
      created: true,
      notified: true,
      level: 1,
    });
    resolveMock.mockResolvedValue({ resolved: true, incidentId: "inc1" });
    alertRuleUpdateMock.mockResolvedValue({});
  });

  it("fires when days-to-85 is within threshold (lte)", async () => {
    getCapacityForecastMock.mockResolvedValue({
      summary: {
        serverCount: 1,
        forecastable: 1,
        insufficientData: 0,
        byRisk: { ok: 0, watch: 0, warning: 1, critical: 0, insufficient_data: 0 },
        worstRisk: "warning",
        horizonDays: 90,
        windowHours: 168,
        generatedAt: new Date().toISOString(),
      },
      servers: [serverForecast({ serverId: "s1", serverName: "node-a" })],
    });

    const result = await evaluateCapacityLinkedAlerts(
      [
        {
          id: "rule_cap",
          name: "Disk capacity 14d",
          metric: "capacity_disk_days",
          threshold: 14,
          operator: "lte",
          enabled: true,
          lastMatchedAt: null,
          lastTriggeredAt: null,
          cooldownMinutes: 30,
          silenceWindows: [],
          serverIds: [],
          notifyChannels: ["in_app"],
          playbookIds: [],
          webhookUrl: null,
          onCallUserIds: [],
        },
      ],
      { isSilent: () => false },
    );

    expect(result.fired).toBe(1);
    expect(openOrRefreshMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: "rule_cap",
        serverId: "s1",
        metric: "capacity_disk_days",
        value: 10,
        operator: "lte",
        threshold: 14,
      }),
    );
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("resolves when forecast has insufficient data", async () => {
    getCapacityForecastMock.mockResolvedValue({
      summary: {
        serverCount: 1,
        forecastable: 0,
        insufficientData: 1,
        byRisk: { ok: 0, watch: 0, warning: 0, critical: 0, insufficient_data: 1 },
        worstRisk: "insufficient_data",
        horizonDays: 90,
        windowHours: 168,
        generatedAt: new Date().toISOString(),
      },
      servers: [
        serverForecast({
          serverId: "s1",
          overallRisk: "insufficient_data",
          metrics: [
            {
              metric: "disk",
              sampleCount: 1,
              windowHours: 168,
              dataSpanHours: 1,
              latest: 50,
              slopePerDay: null,
              r2: null,
              projected: null,
              horizonDays: 14,
              daysUntil85: null,
              daysUntil95: null,
              risk: "insufficient_data",
              reason: "insufficient_data",
            },
          ],
        }),
      ],
    });

    const result = await evaluateCapacityLinkedAlerts(
      [
        {
          id: "rule_cap",
          name: "Disk capacity 14d",
          metric: "capacity_disk_days",
          threshold: 14,
          operator: "lte",
          enabled: true,
          lastMatchedAt: null,
          lastTriggeredAt: null,
          cooldownMinutes: 30,
          silenceWindows: [],
          serverIds: ["s1"],
          notifyChannels: ["in_app"],
          playbookIds: [],
          webhookUrl: null,
          onCallUserIds: [],
        },
      ],
      { isSilent: () => false },
    );

    expect(result.resolved).toBe(1);
    expect(openOrRefreshMock).not.toHaveBeenCalled();
    expect(resolveMock).toHaveBeenCalled();
  });

  it("does not inflate resolved when resolveAlertIncident finds no open incident", async () => {
    resolveMock.mockResolvedValue({ resolved: false });
    getCapacityForecastMock.mockResolvedValue({
      summary: {
        serverCount: 1,
        forecastable: 0,
        insufficientData: 1,
        byRisk: { ok: 0, watch: 0, warning: 0, critical: 0, insufficient_data: 1 },
        worstRisk: "insufficient_data",
        horizonDays: 90,
        windowHours: 168,
        generatedAt: new Date().toISOString(),
      },
      servers: [
        serverForecast({
          serverId: "s1",
          overallRisk: "insufficient_data",
          metrics: [
            {
              metric: "disk",
              sampleCount: 1,
              windowHours: 168,
              dataSpanHours: 1,
              latest: 50,
              slopePerDay: null,
              r2: null,
              projected: null,
              horizonDays: 14,
              daysUntil85: null,
              daysUntil95: null,
              risk: "insufficient_data",
              reason: "insufficient_data",
            },
          ],
        }),
      ],
    });

    const result = await evaluateCapacityLinkedAlerts(
      [
        {
          id: "rule_cap",
          name: "Disk capacity 14d",
          metric: "capacity_disk_days",
          threshold: 14,
          operator: "lte",
          enabled: true,
          lastMatchedAt: null,
          lastTriggeredAt: null,
          cooldownMinutes: 30,
          silenceWindows: [],
          serverIds: ["s1"],
          notifyChannels: ["in_app"],
          playbookIds: [],
          webhookUrl: null,
          onCallUserIds: [],
        },
      ],
      { isSilent: () => false },
    );

    expect(result.resolved).toBe(0);
    expect(resolveMock).toHaveBeenCalled();
  });

  it("still opens incidents for other hosts while rule lastTriggeredAt is recent", async () => {
    openOrRefreshMock
      .mockResolvedValueOnce({
        incidentId: "inc_s1",
        created: true,
        notified: true,
        level: 1,
      })
      .mockResolvedValueOnce({
        incidentId: "inc_s2",
        created: true,
        notified: true,
        level: 1,
      });
    getCapacityForecastMock.mockResolvedValue({
      summary: {
        serverCount: 2,
        forecastable: 2,
        insufficientData: 0,
        byRisk: { ok: 0, watch: 0, warning: 2, critical: 0, insufficient_data: 0 },
        worstRisk: "warning",
        horizonDays: 90,
        windowHours: 168,
        generatedAt: new Date().toISOString(),
      },
      servers: [
        serverForecast({ serverId: "s1", serverName: "node-a" }),
        serverForecast({ serverId: "s2", serverName: "node-b" }),
      ],
    });

    const result = await evaluateCapacityLinkedAlerts(
      [
        {
          id: "rule_multi",
          name: "Disk capacity multi",
          metric: "capacity_disk_days",
          threshold: 14,
          operator: "lte",
          enabled: true,
          lastMatchedAt: new Date(Date.now() - 60_000),
          // Recent rule-level stamp must NOT block second host.
          lastTriggeredAt: new Date(Date.now() - 60_000),
          cooldownMinutes: 30,
          silenceWindows: [],
          serverIds: [],
          notifyChannels: ["in_app"],
          playbookIds: [],
          webhookUrl: null,
          onCallUserIds: [],
        },
      ],
      { isSilent: () => false },
    );

    expect(result.fired).toBe(2);
    expect(openOrRefreshMock).toHaveBeenCalledTimes(2);
    expect(alertRuleUpdateMock).toHaveBeenCalledTimes(1);
    expect(alertRuleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rule_multi" },
        data: expect.objectContaining({
          lastTriggeredAt: expect.any(Date),
          lastMatchedAt: expect.any(Date),
        }),
      }),
    );
  });
});
