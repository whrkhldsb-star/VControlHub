import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createNotificationMock, fetchWebhookSafelyMock, sendAlertEmailMock, sendAlertTelegramMock } = vi.hoisted(() => ({
	prismaMock: {
		$transaction<T>(callback: (tx: unknown) => Promise<T>) { return callback(this); },
		$executeRaw: vi.fn(),
		setting: { upsert: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
		userServerAccess: { findFirst: vi.fn() },
		server: { findMany: vi.fn() },
		alertRule: {
			create: vi.fn(),
			count: vi.fn(),
			findMany: vi.fn(),
			findUnique: vi.fn(),
			findFirst: vi.fn(),
			update: vi.fn(),
			updateManyAndReturn: vi.fn(),
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

const { createAlertRule, updateAlertRule, toggleAlertRule, testAlertRule, ensureDefaultAlertRules } = await import("../service");
const { withApiCopyLocale } = await import("@/lib/i18n/api-copy");


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
			contextLines: expect.arrayContaining(["规则：Email rule", "指标：cpu_usage"]),
		}));
		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "email", status: "sent", message: "测试邮件已发送给 1 位收件人" }),
		]);

		// The result is shown on the rule's page: it is worded in the language of the request, as the in-app and
		// webhook lines already were (these were fixed English).
		const english = await withApiCopyLocale("en", () => testAlertRule("rule_email"));
		expect(english.deliveries).toEqual([
			expect.objectContaining({ channel: "email", status: "sent", message: "Test email sent to 1 recipient" }),
		]);
		expect(sendAlertEmailMock).toHaveBeenLastCalledWith(expect.objectContaining({
			contextLines: expect.arrayContaining(["Rule: Email rule", "Metric: cpu_usage"]),
		}));
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
			contextLines: expect.arrayContaining(["规则：Telegram rule", "指标：cpu_usage"]),
		}));
		expect(result.deliveries).toEqual([
			expect.objectContaining({ channel: "telegram", status: "sent", message: "Telegram 测试消息已发送到 2 个会话" }),
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
		// Named in the language of the request that seeds them (they were fixed English).
		expect(prismaMock.alertRule.create.mock.calls.map(([args]) => args.data.name)).toEqual([
			"服务器离线", "CPU 使用率过高（≥ 90%）", "内存使用率过高（≥ 90%）", "磁盘使用率过高（≥ 90%）",
		]);

		prismaMock.alertRule.count.mockResolvedValueOnce(2);
		const skipped = await ensureDefaultAlertRules({
			userId: "u1",
			roles: ["admin"],
			currentTeamId: "team-a",
		});
		expect(skipped).toEqual({ created: 0, skipped: true });
		expect(prismaMock.alertRule.create).toHaveBeenCalledTimes(4);
		// Both outcomes record that the starter pack was offered to this customer.
		expect(prismaMock.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { key: "alerts.defaultRulesSeeded:team-a", value: "true" } }));
	});

	it("does not bring the starter rules back after every rule was deleted", async () => {
		prismaMock.setting.findUnique.mockResolvedValueOnce({ value: "true" });
		const result = await ensureDefaultAlertRules();
		expect(result).toEqual({ created: 0, skipped: true });
		expect(prismaMock.setting.findUnique).toHaveBeenCalledWith({ where: { key: "alerts.defaultRulesSeeded" } });
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

describe("editing what a rule watches", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.alertRule.update.mockResolvedValue({ id: "rule1" });
	});

	it("keeps the stored webhook address when an edit names the channel without one", async () => {
		// The edit form cannot send the address back (the page never gets it): it sends the channels only.
		prismaMock.alertRule.findUnique.mockResolvedValue({ id: "rule1", metric: "cpu_usage", notifyChannels: ["webhook"], webhookUrl: "https://hooks.example.com/secret" });

		await updateAlertRule("rule1", { notifyChannels: ["in_app", "webhook"], threshold: 95 });

		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule1" },
			data: { notifyChannels: ["in_app", "webhook"], threshold: 95 },
		});
	});

	it("refuses to turn the webhook channel on for a rule that has no address", async () => {
		prismaMock.alertRule.findUnique.mockResolvedValue({ id: "rule1", metric: "cpu_usage", notifyChannels: ["in_app"], webhookUrl: null });

		await expect(updateAlertRule("rule1", { notifyChannels: ["in_app", "webhook"] })).rejects.toThrow(/Webhook/);
		expect(prismaMock.alertRule.update).not.toHaveBeenCalled();

		// With an address in the same request it is accepted.
		await updateAlertRule("rule1", { notifyChannels: ["in_app", "webhook"], webhookUrl: "https://hooks.example.com/new" });
		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule1" },
			data: { notifyChannels: ["in_app", "webhook"], webhookUrl: "https://hooks.example.com/new" },
		});
	});

	it("forgets how long each server has matched when the metric changes", async () => {
		// The stamps say since when a server breached the old metric: a server that then breached the new one fired
		// at once, without the rule's duration.
		prismaMock.alertRule.findUnique.mockResolvedValue({ id: "rule1", metric: "cpu_usage" });

		await updateAlertRule("rule1", { metric: "mem_usage" });

		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
			where: { id: "rule1" },
			data: { metric: "mem_usage", matchState: {}, lastMatchedAt: null },
		});
	});

	it("keeps them for an edit that leaves the metric as it is", async () => {
		prismaMock.alertRule.findUnique.mockResolvedValue({ id: "rule1", metric: "cpu_usage" });

		await updateAlertRule("rule1", { metric: "cpu_usage", threshold: 95 });

		expect(prismaMock.alertRule.update).toHaveBeenCalledWith({ where: { id: "rule1" }, data: { metric: "cpu_usage", threshold: 95 } });
	});
});

describe("binding playbooks to a rule", () => {
	// The rule starts the playbook with nobody approving it: the caller must be allowed to run playbooks by hand.
	const rule = { notifyChannels: ["in_app"], name: "Disk full", metric: "disk_usage", operator: "gte" as const, threshold: 95, playbookIds: ["pb_1"], serverIds: [] };
	const notifier = { userId: "u_9", roles: ["operator" as const], currentTeamId: "team_1", permissions: ["notification:manage" as const] };

	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.userServerAccess.findFirst.mockResolvedValue(null);
	});

	it("refuses a caller who may manage notifications but not run playbooks", async () => {
		prismaMock.alertRule.create.mockResolvedValue({ id: "rule_pb" });
		await expect(createAlertRule(rule, notifier)).rejects.toThrow(/playbook:run/);
		expect(prismaMock.alertRule.create).not.toHaveBeenCalled();
	});

	it("lets a caller with playbook:run bind playbooks of their own team", async () => {
		prismaMock.alertRule.create.mockResolvedValue({ id: "rule_pb" });
		prismaMock.playbook.findMany.mockResolvedValue([{ id: "pb_1", steps: [] }]);
		const runner = { userId: "u_9", roles: ["operator" as const], currentTeamId: "team_1", permissions: ["notification:manage" as const, "playbook:run" as const] };
		await createAlertRule(rule, runner);
		expect(prismaMock.playbook.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["pb_1"] } }) }));
		expect(prismaMock.alertRule.create).toHaveBeenCalled();
	});

	it.each([
		{ metric: "cpu_usage" }, { operator: "gt" }, { threshold: 50 }, { durationSeconds: 0 },
		{ serverIds: [] }, { silenceWindows: [] }, { enabled: true }, { playbookIds: ["pb_2"] },
	])("requires playbook:run to edit an enabled bound rule with %j", async (change) => {
		prismaMock.alertRule.findFirst.mockResolvedValue({ ...rule, enabled: true });
		await expect(updateAlertRule("rule1", change, notifier)).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
		expect(prismaMock.alertRule.updateManyAndReturn).not.toHaveBeenCalled();
	});

	it("checks the stored binding before toggling a disabled rule on", async () => {
		prismaMock.alertRule.findFirst.mockResolvedValue({ ...rule, enabled: false });
		await expect(toggleAlertRule("rule1", notifier)).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
		expect(prismaMock.alertRule.updateManyAndReturn).not.toHaveBeenCalled();
	});

	it("allows disabling or unbinding a rule without run permission", async () => {
		prismaMock.alertRule.findFirst.mockResolvedValue({ ...rule, enabled: true });
		prismaMock.alertRule.updateManyAndReturn.mockResolvedValueOnce([{ enabled: false }]).mockResolvedValueOnce([{ playbookIds: [] }]);
		await expect(toggleAlertRule("rule1", notifier)).resolves.toMatchObject({ enabled: false });
		await expect(updateAlertRule("rule1", { playbookIds: [], threshold: 50 }, notifier)).resolves.toMatchObject({ playbookIds: [] });
	});

	it("keeps the permission check on the write when an unbound rule gains a binding after the read", async () => {
		prismaMock.alertRule.findFirst.mockResolvedValueOnce({ ...rule, playbookIds: [], enabled: true }).mockResolvedValueOnce({ id: "rule1" });
		prismaMock.alertRule.updateManyAndReturn.mockResolvedValueOnce([]);
		await expect(updateAlertRule("rule1", { threshold: 50 }, notifier)).rejects.toMatchObject({ name: "ConflictError", status: 409 });
		expect(prismaMock.alertRule.updateManyAndReturn).toHaveBeenCalledWith({
			where: { id: "rule1", teamId: "team_1", enabled: true, notifyChannels: { equals: ["in_app"] }, playbookIds: { equals: [] }, serverIds: { equals: [] } }, data: { threshold: 50 },
		});
	});

	const runner = { ...notifier, permissions: [...notifier.permissions, "playbook:run" as const] };
	const commandRunner = { ...runner, permissions: [...runner.permissions, "command:execute" as const] };
	const commandStep = { type: "run_command", config: { serverIds: ["command-target"] } };

	it.each(["create", "edit", "enable"] as const)("checks command and connect grants before %s with a borrowed command playbook", async (operation) => {
		prismaMock.playbook.findMany.mockResolvedValue([{ id: "pb_1", steps: [commandStep] }]);
		prismaMock.alertRule.findFirst.mockResolvedValue({ ...rule, enabled: operation !== "enable" });
		const perform = (session: typeof commandRunner | typeof runner) => {
			if (operation === "create") return createAlertRule(rule, session);
			if (operation === "enable") return toggleAlertRule("rule1", session);
			return updateAlertRule("rule1", { threshold: 55 }, session);
		};

		await expect(perform(runner)).rejects.toMatchObject({ status: 403 });
		prismaMock.server.findMany.mockResolvedValue([]);
		await expect(perform(commandRunner)).rejects.toMatchObject({ name: "ValidationError" });
		expect(prismaMock.server.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				id: { in: ["command-target"] },
				AND: [{ teamId: "team_1" }, { OR: [
					{ userAccess: { none: { userId: "u_9" } } },
					{ userAccess: { some: { userId: "u_9", canConnect: true } } },
				] }],
			},
		}));
		expect(prismaMock.alertRule.create).not.toHaveBeenCalled();
		expect(prismaMock.alertRule.updateManyAndReturn).not.toHaveBeenCalled();
		prismaMock.server.findMany.mockResolvedValue([{ id: "command-target" }]);
		prismaMock.alertRule.updateManyAndReturn.mockResolvedValue([{ ...rule, enabled: true }]);
		prismaMock.alertRule.create.mockResolvedValue(rule);
		await expect(perform(commandRunner)).resolves.toMatchObject({ name: rule.name });
	});

	it("requires restricted readers to select readable targets on creation, edit and enable", async () => {
		prismaMock.userServerAccess.findFirst.mockResolvedValue({ serverId: "hidden" });
		const unbound = { ...rule, serverIds: [], playbookIds: [], enabled: false };
		prismaMock.alertRule.findFirst.mockResolvedValue(unbound);
		await expect(createAlertRule(unbound, notifier)).rejects.toMatchObject({ status: 403 });
		await expect(updateAlertRule("rule1", { webhookUrl: "https://example.test/hook" }, notifier)).rejects.toMatchObject({ status: 403 });
		await expect(toggleAlertRule("rule1", notifier)).rejects.toMatchObject({ status: 403 });
		expect(prismaMock.userServerAccess.findFirst).toHaveBeenCalledWith({
			where: { userId: notifier.userId, server: { teamId: notifier.currentTeamId }, canRead: false },
			select: { serverId: true },
		});
		prismaMock.server.findMany.mockResolvedValue([]);
		await expect(updateAlertRule("rule1", { serverIds: ["hidden"] }, notifier)).rejects.toMatchObject({ name: "ValidationError" });
		expect(prismaMock.alertRule.create).not.toHaveBeenCalled();
		expect(prismaMock.alertRule.updateManyAndReturn).not.toHaveBeenCalled();

		prismaMock.server.findMany.mockResolvedValue([{ id: "readable" }]);
		prismaMock.alertRule.updateManyAndReturn.mockResolvedValue([{ id: "rule1" }]);
		await expect(updateAlertRule("rule1", { serverIds: ["readable"] }, notifier)).resolves.toMatchObject({ id: "rule1" });
	});

	it("leaves starter rules for an unrestricted account when a restricted reader opens an empty list", async () => {
		prismaMock.userServerAccess.findFirst.mockResolvedValue({ serverId: "hidden" });
		prismaMock.alertRule.count.mockResolvedValue(0);
		await expect(ensureDefaultAlertRules(notifier)).resolves.toEqual({ created: 0, skipped: true });
		expect(prismaMock.alertRule.create).not.toHaveBeenCalled();
		expect(prismaMock.setting.upsert).not.toHaveBeenCalled();
	});
});
