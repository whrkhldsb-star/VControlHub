import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createNotificationMock, fetchWebhookSafelyMock, sendAlertEmailMock, sendAlertTelegramMock } = vi.hoisted(() => ({
	prismaMock: {
		alertRule: {
			create: vi.fn(),
			findMany: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
		user: {
			findMany: vi.fn(),
		},
	},
	createNotificationMock: vi.fn(),
	fetchWebhookSafelyMock: vi.fn(),
	sendAlertEmailMock: vi.fn(),
	sendAlertTelegramMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/notification/email", () => ({ sendAlertEmail: sendAlertEmailMock }));
vi.mock("@/lib/notification/telegram", () => ({ sendAlertTelegram: sendAlertTelegramMock }));
vi.mock("@/lib/notification/service", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/security/webhook-url", () => ({ fetchWebhookSafely: fetchWebhookSafelyMock }));

const { createAlertRule, updateAlertRule, testAlertRule } = await import("../service");

describe("alert service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createNotificationMock.mockResolvedValue({ id: "n1" });
		fetchWebhookSafelyMock.mockResolvedValue({ ok: true });
		sendAlertEmailMock.mockResolvedValue({ accepted: ["ops@example.com"], rejected: [] });
		sendAlertTelegramMock.mockResolvedValue({ accepted: [{ chatId: "100200300", messageId: 1 }], rejected: [] });
		prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }, { id: "admin2" }]);
	});

	it("sends test alert notifications through configured in-app and webhook channels", async () => {
		prismaMock.alertRule.findUnique.mockResolvedValue({
			id: "rule1",
			name: "CPU hot",
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 0,
			serverIds: [],
			notifyChannels: ["in_app", "webhook"],
			webhookUrl: "https://hooks.example.com/secret",
			cooldownMinutes: 30,
			enabled: true,
			lastMatchedAt: null,
			lastTriggeredAt: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});

		const result = await testAlertRule("rule1");

		expect(createNotificationMock).toHaveBeenCalledTimes(2);
		expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
			userId: "admin1",
			type: "server_alert",
			title: "测试告警: CPU hot",
			actionUrl: "/alert-rules",
		}));
		expect(fetchWebhookSafelyMock).toHaveBeenCalledWith(
			"https://hooks.example.com/secret",
			expect.objectContaining({ method: "POST" }),
		);
		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "in_app", status: "sent" }),
			expect.objectContaining({ channel: "webhook", status: "sent" }),
		]);
	});

	it("sends alert test emails through configured SMTP recipients", async () => {
		prismaMock.alertRule.findUnique.mockResolvedValue({
			id: "rule_email",
			name: "Email rule",
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 0,
			serverIds: [],
			notifyChannels: ["email"],
			webhookUrl: null,
			cooldownMinutes: 30,
			enabled: true,
			lastMatchedAt: null,
			lastTriggeredAt: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});

		const result = await testAlertRule("rule_email");

		expect(sendAlertEmailMock).toHaveBeenCalledWith(expect.objectContaining({
			title: "测试告警: Email rule",
			message: "这是一条测试告警，用于验证「Email rule」的通知渠道是否可达。",
			contextLines: expect.arrayContaining(["规则: Email rule", "指标: cpu_usage"]),
		}));
		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "email", status: "sent", message: "邮件测试已发送给 1 个收件人" }),
		]);
	});

	it("sends alert test via Telegram channel and reports sent/failed delivery", async () => {
		prismaMock.alertRule.findUnique.mockResolvedValue({
			id: "rule_telegram_ok",
			name: "Telegram rule",
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 0,
			serverIds: [],
			notifyChannels: ["telegram"],
			webhookUrl: null,
			cooldownMinutes: 30,
			enabled: true,
			lastMatchedAt: null,
			lastTriggeredAt: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		sendAlertTelegramMock.mockResolvedValueOnce({
			accepted: [{ chatId: "100200300", messageId: 1 }, { chatId: "-100400500", messageId: 2 }],
			rejected: [],
		});

		const result = await testAlertRule("rule_telegram_ok");

		expect(sendAlertTelegramMock).toHaveBeenCalledWith(expect.objectContaining({
			title: "测试告警: Telegram rule",
			contextLines: expect.arrayContaining(["规则: Telegram rule", "指标: cpu_usage"]),
		}));
		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "telegram", status: "sent", message: "Telegram 测试已发送给 2 个目标" }),
		]);
	});

	it("reports telegram test failures when all chat ids are rejected", async () => {
		prismaMock.alertRule.findUnique.mockResolvedValue({
			id: "rule_tg_fail",
			name: "Telegram fail",
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 0,
			serverIds: [],
			notifyChannels: ["telegram"],
			webhookUrl: null,
			cooldownMinutes: 30,
			enabled: true,
			lastMatchedAt: null,
			lastTriggeredAt: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		sendAlertTelegramMock.mockResolvedValueOnce({
			accepted: [],
			rejected: [{ chatId: "100200300", reason: "chat not found" }],
		});

		const result = await testAlertRule("rule_tg_fail");

		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "telegram", status: "failed", message: "chat not found" }),
		]);
	});

	it("reports webhook test failures without throwing or leaking the URL", async () => {
		prismaMock.alertRule.findUnique.mockResolvedValue({
			id: "rule1",
			name: "Webhook rule",
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 0,
			serverIds: [],
			notifyChannels: ["webhook"],
			webhookUrl: "https://hooks.example.com/secret-token",
			cooldownMinutes: 30,
			enabled: true,
			lastMatchedAt: null,
			lastTriggeredAt: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		fetchWebhookSafelyMock.mockRejectedValueOnce(new Error("HTTP 500"));

		const result = await testAlertRule("rule1");

		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "webhook", status: "failed", message: "HTTP 500" }),
		]);
		expect(JSON.stringify(result)).not.toContain("secret-token");
	});

	it("persists silence windows on create and update", async () => {
		prismaMock.alertRule.create.mockResolvedValue({ id: "rule1" });
		prismaMock.alertRule.update.mockResolvedValue({ id: "rule1" });

		await createAlertRule({
			name: "Night mute",
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			silenceWindows: ["22:00-08:00"],
		});
		await updateAlertRule("rule1", { silenceWindows: ["12:00-13:00", "22:00-08:00"] });

		expect(prismaMock.alertRule.create).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({ silenceWindows: ["22:00-08:00"] }),
		}));
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule1" },
			data: { silenceWindows: ["12:00-13:00", "22:00-08:00"] },
		});
	});
});
