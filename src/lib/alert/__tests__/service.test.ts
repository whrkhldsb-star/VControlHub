import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createNotificationMock, fetchWebhookSafelyMock, sendAlertEmailMock, sendAlertTelegramMock } = vi.hoisted(() => ({
	prismaMock: {
		alertRule: {
			create: vi.fn(),
			count: vi.fn(),
			findMany: vi.fn(),
			findUnique: vi.fn(),
			findFirst: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
		user: {
			findMany: vi.fn(),
		},
		playbook: {
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
vi.mock("@/lib/settings/service", () => ({
	getSetting: vi.fn(async () => "false"),
	setSetting: vi.fn(async () => undefined),
}));

const { createAlertRule, updateAlertRule, testAlertRule, ensureDefaultAlertRules } = await import("../service");
const settings = await import("@/lib/settings/service");

describe("alert service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createNotificationMock.mockResolvedValue({ id: "n1" });
		fetchWebhookSafelyMock.mockResolvedValue({ ok: true, response: { ok: true, status: 204 } });
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
			title: expect.stringMatching(/CPU hot/),
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
			title: expect.stringMatching(/Test alert|测试告警|backend\.alert\.testTitle|rule/i),
			message: expect.any(String),
			contextLines: expect.arrayContaining(["Rule: Email rule", "Metric: cpu_usage"]),
		}));
		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "email", status: "sent", message: "Email test sent to 1 recipients" }),
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
			title: expect.stringMatching(/Test alert|测试告警|backend\.alert\.testTitle|rule/i),
			contextLines: expect.arrayContaining(["Rule: Telegram rule", "Metric: cpu_usage"]),
		}));
		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "telegram", status: "sent", message: "Telegram test sent to 2 targets" }),
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

	it.each([
		[{ ok: false, error: "Webhook request failed" }, "Webhook request failed"],
		[{ ok: true, response: { ok: false, status: 500 } }, "HTTP 500"],
	])("reports structured webhook delivery failures: %s", async (delivery, expectedMessage) => {
		prismaMock.alertRule.findUnique.mockResolvedValue({
			id: "rule_structured_failure",
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
		fetchWebhookSafelyMock.mockResolvedValueOnce(delivery);

		const result = await testAlertRule("rule_structured_failure");

		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "webhook", status: "failed", message: expectedMessage }),
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

	it("installs starter alert rules only when the team-scoped table is empty", async () => {
		prismaMock.alertRule.count.mockResolvedValueOnce(0);
		prismaMock.alertRule.create
			.mockResolvedValueOnce({ id: "d1" })
			.mockResolvedValueOnce({ id: "d2" })
			.mockResolvedValueOnce({ id: "d3" })
			.mockResolvedValueOnce({ id: "d4" });

		const created = await ensureDefaultAlertRules({
			userId: "u1",
			roles: ["admin"],
			currentTeamId: "team-a",
		});
		expect(created).toEqual(expect.objectContaining({ created: 4, skipped: false }));
		expect(prismaMock.alertRule.create).toHaveBeenCalledTimes(4);
		expect(prismaMock.alertRule.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					metric: "server_offline",
					teamId: "team-a",
					notifyChannels: ["in_app"],
				}),
			}),
		);

		prismaMock.alertRule.count.mockResolvedValueOnce(2);
		const skipped = await ensureDefaultAlertRules({
			userId: "u1",
			roles: ["admin"],
			currentTeamId: "team-a",
		});
		expect(skipped).toEqual({ created: 0, skipped: true });
		expect(prismaMock.alertRule.create).toHaveBeenCalledTimes(4);
		// Both outcomes record that the starter pack was offered to this customer.
		expect(settings.setSetting).toHaveBeenCalledWith("alerts.defaultRulesSeeded:team-a", "true");
	});

	it("does not bring the starter rules back after every rule was deleted", async () => {
		vi.mocked(settings.getSetting).mockResolvedValueOnce("true");
		const result = await ensureDefaultAlertRules();
		expect(result).toEqual({ created: 0, skipped: true });
		expect(settings.getSetting).toHaveBeenCalledWith("alerts.defaultRulesSeeded");
		expect(prismaMock.alertRule.count).not.toHaveBeenCalled();
		expect(prismaMock.alertRule.create).not.toHaveBeenCalled();
	});

	it("keeps customer rules off the platform's own email and Telegram recipients", async () => {
		const customer = { userId: "u_c", roles: ["operator" as const], currentTeamId: "team_c" };
		await expect(createAlertRule({ name: "URGENT: verify at https://evil.example", metric: "cpu_usage", operator: "gte", threshold: 90, notifyChannels: ["in_app", "email"] }, customer))
			.rejects.toThrow(/platformChannelsAdminOnly|平台管理员|platform administrator/);
		await expect(updateAlertRule("rule1", { notifyChannels: ["telegram"] }, customer)).rejects.toThrow(/platformChannelsAdminOnly|平台管理员|platform administrator/);
		expect(prismaMock.alertRule.create).not.toHaveBeenCalled();

		// A rule saved earlier with those channels: the customer's test skips them.
		prismaMock.alertRule.findFirst.mockResolvedValueOnce({
			id: "rule_c", name: "Old rule", metric: "cpu_usage", threshold: 90, notifyChannels: ["email", "telegram"], webhookUrl: null, teamId: "team_c",
		});
		const result = await testAlertRule("rule_c", customer);
		expect(sendAlertEmailMock).not.toHaveBeenCalled();
		expect(sendAlertTelegramMock).not.toHaveBeenCalled();
		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "email", status: "skipped" }),
			expect.objectContaining({ channel: "telegram", status: "skipped" }),
		]);
	});

	it("scopes test in-app recipients to the rule team when teamId is set", async () => {
		prismaMock.alertRule.findUnique.mockResolvedValue({
			id: "rule_team",
			name: "Team rule",
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 0,
			serverIds: [],
			notifyChannels: ["in_app"],
			webhookUrl: null,
			cooldownMinutes: 30,
			enabled: true,
			teamId: "team_a",
			lastMatchedAt: null,
			lastTriggeredAt: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }]);
		await testAlertRule("rule_team");
		// Platform administrators plus team_a accounts whose identity template
		// may manage notifications.
		expect(prismaMock.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					OR: expect.arrayContaining([
						{ teamMembership: { is: { teamId: "team_a", team: { deletedAt: null }, identityTemplate: { permissions: { has: "notification:manage" } } } } },
					]),
				}),
			}),
		);
	});

});

describe("binding playbooks to a rule", () => {
	// The rule starts the playbook with nobody approving it: the caller must be allowed to run playbooks by hand.
	const rule = { name: "Disk full", metric: "disk_usage", operator: "gte" as const, threshold: 95, playbookIds: ["pb_1"] };

	it("refuses a caller who may manage notifications but not run playbooks", async () => {
		prismaMock.alertRule.create.mockResolvedValue({ id: "rule_pb" });
		const notifier = { userId: "u_9", roles: ["operator" as const], currentTeamId: "team_1", permissions: ["notification:manage" as const] };
		await expect(createAlertRule(rule, notifier)).rejects.toThrow(/playbook:run/);
		expect(prismaMock.alertRule.create).not.toHaveBeenCalled();
	});

	it("lets a caller with playbook:run bind playbooks of their own team", async () => {
		prismaMock.alertRule.create.mockResolvedValue({ id: "rule_pb" });
		prismaMock.playbook.findMany.mockResolvedValue([{ id: "pb_1" }]);
		const runner = { userId: "u_9", roles: ["operator" as const], currentTeamId: "team_1", permissions: ["notification:manage" as const, "playbook:run" as const] };
		await createAlertRule(rule, runner);
		expect(prismaMock.playbook.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["pb_1"] } }) }));
		expect(prismaMock.alertRule.create).toHaveBeenCalled();
	});
});
