import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, collectServerMetricsMock, createNotificationMock, fetchWebhookSafelyMock } = vi.hoisted(() => ({
	prismaMock: {
		server: {
			findMany: vi.fn(),
		},
		alertRule: {
			findMany: vi.fn(),
			update: vi.fn(),
		},
		user: {
			findMany: vi.fn(),
		},
		metricSnapshot: {
			findMany: vi.fn(),
			create: vi.fn(),
		},
	},
	collectServerMetricsMock: vi.fn(),
	createNotificationMock: vi.fn(),
	fetchWebhookSafelyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/server/monitor", () => ({ collectServerMetrics: collectServerMetricsMock }));
vi.mock("@/lib/notification/service", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/security/webhook-url", () => ({ fetchWebhookSafely: fetchWebhookSafelyMock }));

import { evaluateAlerts, isNowInAlertSilenceWindow } from "../service";

function cpuMetrics(cpu: number) {
	return {
		cpu: { usagePercent: cpu },
		memory: { usagePercent: 30 },
		disk: [{ usagePercent: 40 }],
		uptime: "1h",
		timestamp: new Date().toISOString(),
	};
}

describe("evaluateAlerts", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		prismaMock.server.findMany.mockResolvedValue([{ id: "srv1", name: "Prod", host: "10.0.0.1", enabled: true }]);
		prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }]);
		prismaMock.alertRule.update.mockResolvedValue({});
		createNotificationMock.mockResolvedValue({});
		fetchWebhookSafelyMock.mockResolvedValue({ ok: true });
	});

	it("does not trigger rules with durationSeconds until the condition is sustained", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T00:00:00.000Z"));
		prismaMock.alertRule.findMany.mockResolvedValue([
			{
				id: "rule1",
				name: "CPU high for a while",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 60,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: null,
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["in_app"],
				webhookUrl: null,
			},
		]);
		collectServerMetricsMock.mockResolvedValue(cpuMetrics(95));

		await evaluateAlerts();

		expect(createNotificationMock).not.toHaveBeenCalled();
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule1" },
			data: { lastMatchedAt: new Date("2026-05-25T00:00:00.000Z") },
		});

		vi.setSystemTime(new Date("2026-05-25T00:01:01.000Z"));
		prismaMock.alertRule.update.mockClear();
		prismaMock.alertRule.findMany.mockResolvedValueOnce([
			{
				id: "rule1",
				name: "CPU high for a while",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 60,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: new Date("2026-05-25T00:00:00.000Z"),
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["in_app"],
				webhookUrl: null,
			},
		]);

		await evaluateAlerts();

		expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1", type: "server_alert" }));
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule1" },
			data: expect.objectContaining({ lastTriggeredAt: new Date("2026-05-25T00:01:01.000Z") }),
		});
	});

	it("clears pending sustained alert state once the condition recovers", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T00:02:00.000Z"));
		prismaMock.alertRule.findMany.mockResolvedValue([
			{
				id: "rule1",
				name: "CPU high for a while",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 60,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: new Date("2026-05-25T00:00:00.000Z"),
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["in_app"],
				webhookUrl: null,
			},
		]);
		collectServerMetricsMock.mockResolvedValue(cpuMetrics(20));

		await evaluateAlerts();

		expect(createNotificationMock).not.toHaveBeenCalled();
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule1" },
			data: { lastMatchedAt: null },
		});
	});

	it("detects same-day and overnight alert silence windows", () => {
		expect(isNowInAlertSilenceWindow(["09:00-17:00"], new Date("2026-05-25T10:30:00"))).toBe(true);
		expect(isNowInAlertSilenceWindow(["09:00-17:00"], new Date("2026-05-25T17:00:00"))).toBe(false);
		expect(isNowInAlertSilenceWindow(["22:00-08:00"], new Date("2026-05-25T23:15:00"))).toBe(true);
		expect(isNowInAlertSilenceWindow(["22:00-08:00"], new Date("2026-05-25T07:59:00"))).toBe(true);
		expect(isNowInAlertSilenceWindow(["22:00-08:00"], new Date("2026-05-25T08:01:00"))).toBe(false);
	});

	it("skips notification delivery while an alert rule is inside a silence window", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T23:30:00"));
		prismaMock.alertRule.findMany.mockResolvedValue([
			{
				id: "rule1",
				name: "CPU quiet hours",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 0,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: null,
				cooldownMinutes: 0,
				silenceWindows: ["22:00-08:00"],
				serverIds: [],
				notifyChannels: ["in_app", "webhook"],
				webhookUrl: "https://hooks.example.com/alert",
			},
		]);
		collectServerMetricsMock.mockResolvedValue(cpuMetrics(95));

		await evaluateAlerts();

		expect(createNotificationMock).not.toHaveBeenCalled();
		expect(fetchWebhookSafelyMock).not.toHaveBeenCalled();
		expect(prismaMock.alertRule.update).not.toHaveBeenCalled();
	});
});
