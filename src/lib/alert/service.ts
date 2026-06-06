import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notification/service";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";

/* ── Types ────────────────────────────────────────────────── */

export type CreateAlertRuleInput = {
	name: string;
	metric: string;
	operator: string;
	threshold: number;
	durationSeconds?: number;
	serverIds?: string[];
	notifyChannels?: string[];
	webhookUrl?: string;
	cooldownMinutes?: number;
	silenceWindows?: string[];
	enabled?: boolean;
};

/* ── CRUD ─────────────────────────────────────────────────── */

export async function listAlertRules() {
	return prisma.alertRule.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
}

export async function createAlertRule(input: CreateAlertRuleInput) {
	return prisma.alertRule.create({
		data: {
			name: input.name,
			metric: input.metric,
			operator: input.operator,
			threshold: input.threshold,
			durationSeconds: input.durationSeconds ?? 0,
			serverIds: input.serverIds ?? [],
			notifyChannels: input.notifyChannels ?? ["in_app"],
			webhookUrl: input.webhookUrl ?? null,
			cooldownMinutes: input.cooldownMinutes ?? 30,
			silenceWindows: input.silenceWindows ?? [],
			enabled: input.enabled ?? true,
		},
	});
}

export async function updateAlertRule(id: string, input: Partial<CreateAlertRuleInput> & { enabled?: boolean }) {
	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name;
	if (input.metric !== undefined) data.metric = input.metric;
	if (input.operator !== undefined) data.operator = input.operator;
	if (input.threshold !== undefined) data.threshold = input.threshold;
	if (input.durationSeconds !== undefined) data.durationSeconds = input.durationSeconds;
	if (input.serverIds !== undefined) data.serverIds = input.serverIds;
	if (input.notifyChannels !== undefined) data.notifyChannels = input.notifyChannels;
	if (input.webhookUrl !== undefined) data.webhookUrl = input.webhookUrl;
	if (input.cooldownMinutes !== undefined) data.cooldownMinutes = input.cooldownMinutes;
	if (input.silenceWindows !== undefined) data.silenceWindows = input.silenceWindows;
	if (input.enabled !== undefined) data.enabled = input.enabled;
	return prisma.alertRule.update({ where: { id }, data });
}

export async function deleteAlertRule(id: string) {
	return prisma.alertRule.delete({ where: { id } });
}

export async function toggleAlertRule(id: string) {
	const current = await prisma.alertRule.findUnique({ where: { id }, select: { enabled: true } });
	if (!current) throw new Error("规则不存在");
	return prisma.alertRule.update({ where: { id }, data: { enabled: !current.enabled } });
}

export type AlertRuleTestDelivery = {
	channel: string;
	status: "sent" | "skipped" | "failed";
	message: string;
};

export async function testAlertRule(id: string): Promise<{ rule: { id: string; name: string; metric: string; notifyChannels: string[]; webhookConfigured: boolean }; deliveries: AlertRuleTestDelivery[] }> {
	const rule = await prisma.alertRule.findUnique({ where: { id } });
	if (!rule) throw new Error("规则不存在");

	const deliveries: AlertRuleTestDelivery[] = [];
	const title = `测试告警: ${rule.name}`;
	const message = `这是一条测试告警，用于验证「${rule.name}」的通知渠道是否可达。`;

	if (rule.notifyChannels.includes("in_app")) {
		const admins = await prisma.user.findMany({
			where: {
				roles: {
					some: {
						role: {
							permissions: {
								some: { permission: { key: "notification:manage" } },
							},
						},
					},
				},
			},
			select: { id: true },
			take: 100,
		});
		const results = await Promise.allSettled(admins.map((admin) => createNotification({
			userId: admin.id,
			type: "server_alert",
			title,
			message,
			actionUrl: "/alert-rules",
		})));
		const failed = results.filter((result) => result.status === "rejected").length;
		deliveries.push({
			channel: "in_app",
			status: failed === 0 ? "sent" : "failed",
			message: failed === 0 ? `已发送给 ${admins.length} 位管理员` : `${failed}/${admins.length} 条站内通知发送失败`,
		});
	}

	if (rule.notifyChannels.includes("webhook")) {
		if (!rule.webhookUrl) {
			deliveries.push({ channel: "webhook", status: "skipped", message: "Webhook URL 未配置" });
		} else {
			try {
				await fetchWebhookSafely(rule.webhookUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						test: true,
						alert: rule.name,
						metric: rule.metric,
						threshold: rule.threshold,
						timestamp: new Date().toISOString(),
					}),
				});
				deliveries.push({ channel: "webhook", status: "sent", message: "Webhook 测试请求已发送" });
			} catch (error) {
				deliveries.push({ channel: "webhook", status: "failed", message: error instanceof Error ? error.message : "Webhook 测试请求失败" });
			}
		}
	}

	if (rule.notifyChannels.includes("email")) {
		deliveries.push({ channel: "email", status: "skipped", message: "邮件测试发送待 SMTP 通道接入" });
	}

	if (deliveries.length === 0) {
		deliveries.push({ channel: "none", status: "skipped", message: "未选择通知渠道" });
	}

	return {
		rule: {
			id: rule.id,
			name: rule.name,
			metric: rule.metric,
			notifyChannels: rule.notifyChannels,
			webhookConfigured: Boolean(rule.webhookUrl),
		},
		deliveries,
	};
}
