import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, collectServerMetricsMock, tcpProbeMock, createNotificationMock, fetchWebhookSafelyMock, sendAlertEmailMock, sendAlertTelegramMock, runPlaybookMock } = vi.hoisted(() => ({
	prismaMock: {
		server: {
			findMany: vi.fn(),
		},
		alertRule: {
			findMany: vi.fn(),
			update: vi.fn(),
		},
		alertIncident: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
			create: vi.fn(),
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
	tcpProbeMock: vi.fn(),
	createNotificationMock: vi.fn(),
	fetchWebhookSafelyMock: vi.fn(),
	sendAlertEmailMock: vi.fn(),
	sendAlertTelegramMock: vi.fn(),
	runPlaybookMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/server/monitor", () => ({ collectServerMetrics: collectServerMetricsMock }));
// Stub the network probe so alert tests don't open real sockets (TR-050
// integration lives in service-collect.test.ts).
vi.mock("@/lib/server/connectivity", () => ({ tcpProbe: tcpProbeMock }));
vi.mock("@/lib/notification/service", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/notification/email", () => ({ sendAlertEmail: sendAlertEmailMock }));
vi.mock("@/lib/notification/telegram", () => ({ sendAlertTelegram: sendAlertTelegramMock }));
vi.mock("@/lib/security/webhook-url", () => ({ fetchWebhookSafely: fetchWebhookSafelyMock }));
vi.mock("@/lib/playbook/service", () => ({ runPlaybook: runPlaybookMock }));

import { evaluateAlerts, isNowInAlertSilenceWindow } from "../service";

function cpuMetrics(cpu: number) {
	return {
		cpu: { usagePercent: cpu, cores: 4, loadAvg: [1.0, 0.8, 0.6] as [number, number, number] },
		memory: { usagePercent: 30 },
		disk: [{ usagePercent: 40 }],
		network: [{ iface: "eth0", rxBytes: 1024000, txBytes: 512000 }],
		uptime: "1h",
		timestamp: new Date().toISOString(),
	};
}

describe("evaluateAlerts", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		// TR-050: default to "host is up" so the existing alert tests continue
		// to drive collectServerMetrics. The service-collect.test.ts file
		// exercises the failure / warning paths explicitly.
		tcpProbeMock.mockResolvedValue({ ok: true, latencyMs: 5 });
		prismaMock.server.findMany.mockResolvedValue([{ id: "srv1", name: "Prod", host: "10.0.0.1", port: 22, enabled: true }]);
		prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }]);
		prismaMock.alertRule.update.mockResolvedValue({});
		prismaMock.alertIncident.findUnique.mockResolvedValue(null);
		prismaMock.alertIncident.findMany.mockResolvedValue([]);
		prismaMock.alertIncident.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
			id: "inc1",
			...data,
		}));
		prismaMock.alertIncident.update.mockResolvedValue({});
		createNotificationMock.mockResolvedValue({});
		fetchWebhookSafelyMock.mockResolvedValue({ ok: true });
		sendAlertEmailMock.mockResolvedValue({ accepted: ["ops@example.com"], rejected: [] });
		sendAlertTelegramMock.mockResolvedValue({ accepted: [{ chatId: "100200300", messageId: 1 }], rejected: [] });
	runPlaybookMock.mockResolvedValue({ id: "run1", status: "completed" });
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
			data: expect.objectContaining({
				matchState: { srv1: "2026-05-25T00:00:00.000Z" },
				lastMatchedAt: new Date("2026-05-25T00:00:00.000Z"),
			}),
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
				matchState: { srv1: "2026-05-25T00:00:00.000Z" },
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
			data: expect.objectContaining({
				lastTriggeredAt: new Date("2026-05-25T00:01:01.000Z"),
				matchState: { srv1: "2026-05-25T00:01:01.000Z" },
			}),
		});
	});

	it("runs linked playbooks with alert context when a rule triggers", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T00:01:30.000Z"));
		prismaMock.alertRule.findMany.mockResolvedValue([
			{
				id: "rule_auto",
				name: "CPU automation",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 0,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: null,
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["in_app"],
				playbookIds: ["pb_restart", "pb_notify"],
				webhookUrl: null,
			},
		]);
		collectServerMetricsMock.mockResolvedValue(cpuMetrics(95));

		await evaluateAlerts();

		expect(runPlaybookMock).toHaveBeenCalledTimes(2);
		expect(runPlaybookMock).toHaveBeenCalledWith(expect.objectContaining({
			playbookId: "pb_restart",
			dryRun: false,
			triggerContext: expect.objectContaining({
				type: "alert_rule",
				alertRuleId: "rule_auto",
				serverId: "srv1",
				metric: "cpu_usage",
				value: 95,
			}),
		}));
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule_auto" },
			data: expect.objectContaining({ lastTriggeredAt: new Date("2026-05-25T00:01:30.000Z") }),
		});
	});

	it("clears pending sustained alert state once the condition recovers", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T00:02:00.000Z"));
		// Open incident exists so resolve can notify; duration stamp is per-server.
		prismaMock.alertIncident.findUnique.mockResolvedValue({
			id: "inc1",
			status: "OPEN",
			level: 1,
			serverName: "Prod",
			metric: "cpu_usage",
		});
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
				// Per-server stamp (preferred); legacy lastMatchedAt alone still migrates via _legacy.
				matchState: { srv1: "2026-05-25T00:00:00.000Z" },
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["in_app"],
				webhookUrl: null,
			},
		]);
		collectServerMetricsMock.mockResolvedValue(cpuMetrics(20));

		await evaluateAlerts();

		// Alert resolved — in-app notification should be sent
		expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1", type: "alert_resolved" }));
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule1" },
			data: expect.objectContaining({
				matchState: {},
				lastMatchedAt: null,
			}),
		});
	});

	it("does not resolve unrelated hosts from a global lastMatchedAt alone", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T01:05:00.000Z"));
		prismaMock.server.findMany.mockResolvedValue([
			{ id: "srv1", name: "Hot", host: "10.0.0.1", port: 22, enabled: true },
			{ id: "srv2", name: "Cool", host: "10.0.0.2", port: 22, enabled: true },
		]);
		// Only Hot has an open incident; Cool is healthy with no match key.
		prismaMock.alertIncident.findUnique.mockImplementation(async ({ where }: { where: { fingerprint: string } }) => {
			if (where.fingerprint.includes("srv1")) {
				return {
					id: "inc_hot",
					status: "OPEN",
					level: 1,
					serverName: "Hot",
					metric: "cpu_usage",
				};
			}
			return null;
		});
		prismaMock.alertRule.findMany.mockResolvedValue([
			{
				id: "rule_scope",
				name: "CPU scoped",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 60,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: new Date("2026-05-25T01:00:00.000Z"),
				matchState: { srv1: "2026-05-25T01:00:00.000Z" },
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["in_app"],
				webhookUrl: null,
			},
		]);
		collectServerMetricsMock
			.mockResolvedValueOnce(cpuMetrics(20)) // srv1 recovers
			.mockResolvedValueOnce(cpuMetrics(10)); // srv2 always healthy

		await evaluateAlerts();

		expect(createNotificationMock).toHaveBeenCalledTimes(1);
		expect(createNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "alert_resolved",
				title: expect.stringContaining("Hot"),
			}),
		);
		expect(createNotificationMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ title: expect.stringContaining("Cool") }),
		);
		// matchState should drop only srv1
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule_scope" },
			data: expect.objectContaining({
				matchState: {},
				lastMatchedAt: null,
			}),
		});
	});

	it("tracks durationSeconds independently per server (matchState map)", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T01:00:00.000Z"));
		prismaMock.server.findMany.mockResolvedValue([
			{ id: "srv1", name: "Prod-A", host: "10.0.0.1", port: 22, enabled: true },
			{ id: "srv2", name: "Prod-B", host: "10.0.0.2", port: 22, enabled: true },
		]);
		// srv1 already sustained; srv2 first match this tick
		prismaMock.alertRule.findMany.mockResolvedValue([
			{
				id: "rule_multi",
				name: "CPU multi",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 60,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: new Date("2026-05-25T00:58:00.000Z"),
				matchState: { srv1: "2026-05-25T00:58:00.000Z" },
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["in_app"],
				webhookUrl: null,
			},
		]);
		collectServerMetricsMock
			.mockResolvedValueOnce(cpuMetrics(95))
			.mockResolvedValueOnce(cpuMetrics(90));

		await evaluateAlerts();

		// Only srv1 has met duration; srv2 should only stamp matchState
		expect(createNotificationMock).toHaveBeenCalledTimes(1);
		expect(createNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "admin1",
				type: "server_alert",
				title: expect.stringContaining("Prod-A"),
			}),
		);
		// Final persist should keep both server keys
		const updates = prismaMock.alertRule.update.mock.calls.map((c) => c[0]);
		const withMatch = updates.find(
			(u) => u?.data?.matchState && typeof u.data.matchState === "object" && "srv2" in u.data.matchState,
		);
		expect(withMatch?.data.matchState.srv2).toBe("2026-05-25T01:00:00.000Z");
		expect(withMatch?.data.matchState.srv1).toBeTruthy();
	});

	it("detects same-day and overnight alert silence windows", () => {
		expect(isNowInAlertSilenceWindow(["09:00-17:00"], new Date("2026-05-25T10:30:00"))).toBe(true);
		expect(isNowInAlertSilenceWindow(["09:00-17:00"], new Date("2026-05-25T17:00:00"))).toBe(false);
		expect(isNowInAlertSilenceWindow(["22:00-08:00"], new Date("2026-05-25T23:15:00"))).toBe(true);
		expect(isNowInAlertSilenceWindow(["22:00-08:00"], new Date("2026-05-25T07:59:00"))).toBe(true);
		expect(isNowInAlertSilenceWindow(["22:00-08:00"], new Date("2026-05-25T08:01:00"))).toBe(false);
	});

	it("sends email alerts through the SMTP alert channel when a rule triggers", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T00:03:00.000Z"));
		prismaMock.alertRule.findMany.mockResolvedValue([
			{
				id: "rule_email",
				name: "CPU email",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 0,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: null,
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["email"],
				webhookUrl: null,
			},
		]);
		collectServerMetricsMock.mockResolvedValue(cpuMetrics(95));

		await evaluateAlerts();

		expect(sendAlertEmailMock).toHaveBeenCalledWith(expect.objectContaining({
			title: "Alert: Prod cpu usage",
			message: "CPU email: cpu_usage gte 80 (current: 95)",
			contextLines: expect.arrayContaining([
				"Server: Prod",
				"Metric: cpu_usage",
				"Current: 95",
				"Threshold: gte 80",
				"Level: 1",
				"Incident: inc1",
			]),
		}));
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule_email" },
			data: expect.objectContaining({ lastTriggeredAt: new Date("2026-05-25T00:03:00.000Z") }),
		});
	});

	it("sends Telegram alerts when a rule with the telegram channel triggers", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T00:04:00.000Z"));
		prismaMock.alertRule.findMany.mockResolvedValue([
			{
				id: "rule_telegram",
				name: "CPU telegram",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 0,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: null,
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["telegram"],
				webhookUrl: null,
			},
		]);
		collectServerMetricsMock.mockResolvedValue(cpuMetrics(95));

		await evaluateAlerts();

		expect(sendAlertTelegramMock).toHaveBeenCalledWith(expect.objectContaining({
			title: "Alert: Prod cpu usage",
			message: "CPU telegram: cpu_usage gte 80 (current: 95)",
			contextLines: expect.arrayContaining(["Server: Prod", "Current: 95", "Metric: cpu_usage"]),
		}));
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule_telegram" },
			data: expect.objectContaining({ lastTriggeredAt: new Date("2026-05-25T00:04:00.000Z") }),
		});
	});

	it("does not let telegram delivery failures prevent rule state updates", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-25T00:05:00.000Z"));
		sendAlertTelegramMock.mockRejectedValueOnce(new Error("network down"));
		prismaMock.alertRule.findMany.mockResolvedValue([
			{
				id: "rule_tg_fail",
				name: "CPU telegram fail",
				metric: "cpu_usage",
				threshold: 80,
				operator: "gte",
				durationSeconds: 0,
				enabled: true,
				lastTriggeredAt: null,
				lastMatchedAt: null,
				cooldownMinutes: 0,
				silenceWindows: [],
				serverIds: [],
				notifyChannels: ["telegram"],
				webhookUrl: null,
			},
		]);
		collectServerMetricsMock.mockResolvedValue(cpuMetrics(95));

		await evaluateAlerts();

		expect(sendAlertTelegramMock).toHaveBeenCalled();
		// lastTriggeredAt 仍然要被更新 (best-effort 投递)
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule_tg_fail" },
			data: expect.objectContaining({ lastTriggeredAt: new Date("2026-05-25T00:05:00.000Z") }),
		});
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
