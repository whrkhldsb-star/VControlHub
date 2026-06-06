import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createNotificationMock, fetchWebhookSafelyMock } = vi.hoisted(() => ({
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
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/notification/service", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/security/webhook-url", () => ({ fetchWebhookSafely: fetchWebhookSafelyMock }));

const { createAlertRule, updateAlertRule, testAlertRule } = await import("../service");

describe("alert service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createNotificationMock.mockResolvedValue({ id: "n1" });
		fetchWebhookSafelyMock.mockResolvedValue({ ok: true });
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
