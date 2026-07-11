import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { sendAlertEmail } from "@/lib/notification/email";
import { sendAlertTelegram } from "@/lib/notification/telegram";
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
	playbookIds?: string[];
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
			playbookIds: input.playbookIds ?? [],
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
	if (input.playbookIds !== undefined) data.playbookIds = input.playbookIds;
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
	if (!current) throw new NotFoundError("Rule not found");
	return prisma.alertRule.update({ where: { id }, data: { enabled: !current.enabled } });
}

export type AlertRuleTestDelivery = {
	channel: string;
	status: "sent" | "skipped" | "failed";
	message: string;
};

export async function testAlertRule(id: string): Promise<{ rule: { id: string; name: string; metric: string; notifyChannels: string[]; webhookConfigured: boolean }; deliveries: AlertRuleTestDelivery[] }> {
	const rule = await prisma.alertRule.findUnique({ where: { id } });
	if (!rule) throw new NotFoundError("Rule not found");

	const deliveries: AlertRuleTestDelivery[] = [];
	const title = `Test alert: ${rule.name}`;
	const message = `This is a test alert to verify that the notification channel for "${rule.name}" is reachable.`;

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
			message: failed === 0 ? `Sent to ${admins.length} administrators` : `${failed}/${admins.length} in-app notifications failed to send`,
		});
	}

	if (rule.notifyChannels.includes("webhook")) {
		if (!rule.webhookUrl) {
			deliveries.push({ channel: "webhook", status: "skipped", message: "Webhook URL not configured" });
		} else {
			try {
				const delivery = await fetchWebhookSafely(rule.webhookUrl, {
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
				if (!delivery.ok) {
					throw new Error(delivery.error);
				}
				if (!delivery.response.ok) {
					throw new Error(`HTTP ${delivery.response.status}`);
				}
				deliveries.push({ channel: "webhook", status: "sent", message: "Webhook test request sent" });
			} catch (error) {
				deliveries.push({ channel: "webhook", status: "failed", message: error instanceof Error ? error.message : "Webhook test request failed" });
			}
		}
	}

	if (rule.notifyChannels.includes("email")) {
		try {
			const result = await sendAlertEmail({
				title,
				message,
				contextLines: [
					`Rule: ${rule.name}`,
					`Metric: ${rule.metric}`,
					`Threshold: ${rule.threshold}`,
				],
			});
			deliveries.push({
				channel: "email",
				status: result.accepted.length > 0 && result.rejected.length === 0 ? "sent" : "failed",
				message: result.rejected.length === 0
					? `Email test sent to ${result.accepted.length} recipients`
					: `Email test partially failed: ${result.rejected.length} recipients rejected`,
			});
		} catch (error) {
			deliveries.push({
				channel: "email",
				status: "failed",
				message: error instanceof Error ? error.message : "Email test send failed",
			});
		}
	}

	if (rule.notifyChannels.includes("telegram")) {
		try {
			const result = await sendAlertTelegram({
				title,
				message,
				contextLines: [
					`Rule: ${rule.name}`,
					`Metric: ${rule.metric}`,
					`Threshold: ${rule.threshold}`,
				],
			});
			if (result.accepted.length === 0) {
				deliveries.push({
					channel: "telegram",
					status: "failed",
					message: result.rejected[0]?.reason ?? "Telegram send failed",
				});
			} else if (result.rejected.length > 0) {
				deliveries.push({
					channel: "telegram",
					status: "failed",
					message: `Telegram partially failed: ${result.rejected.length}/${result.accepted.length + result.rejected.length} targets failed to send`,
				});
			} else {
				deliveries.push({
					channel: "telegram",
					status: "sent",
					message: `Telegram test sent to ${result.accepted.length} targets`,
				});
			}
		} catch (error) {
			deliveries.push({
				channel: "telegram",
				status: "failed",
				message: error instanceof Error ? error.message : "Telegram test send failed",
			});
		}
	}

	if (deliveries.length === 0) {
		deliveries.push({ channel: "none", status: "skipped", message: "No notification channel selected" });
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
