import type { RoleKey } from "@/lib/auth/rbac";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";

import { sendAlertEmail } from "@/lib/notification/email";
import { sendAlertTelegram } from "@/lib/notification/telegram";
import { createNotification } from "@/lib/notification/service";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";

/* ── Types ────────────────────────────────────────────────── */

type TeamSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };

async function assertServerIdsInTeam(serverIds: string[], session?: TeamSession | null) {
  if (!session || serverIds.length === 0) return;
  if (session.roles.includes("admin")) return;
  const allowed = await prisma.server.findMany({
    where: { id: { in: serverIds }, ...teamWhere(session) },
    select: { id: true },
  });
  if (allowed.length !== serverIds.length) {
    throw new ValidationError("One or more serverIds are outside the current team scope");
  }
}

async function assertPlaybookIdsInTeam(playbookIds: string[], session?: TeamSession | null) {
  if (!session || playbookIds.length === 0) return;
  if (session.roles.includes("admin")) return;
  const allowed = await prisma.playbook.findMany({
    where: { id: { in: playbookIds }, ...teamWhere(session) },
    select: { id: true },
  });
  if (allowed.length !== playbookIds.length) {
    throw new ValidationError("One or more playbookIds are outside the current team scope");
  }
}


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
	escalationMinutes?: number;
	onCallUserIds?: string[];
	enabled?: boolean;
};

/* ── CRUD ─────────────────────────────────────────────────── */

export async function listAlertRules(session?: TeamSession | null) {
	return prisma.alertRule.findMany({
		where: session ? teamWhere(session) : {},
		orderBy: { createdAt: "desc" },
		take: 200,
	});
}

export async function createAlertRule(input: CreateAlertRuleInput, session?: TeamSession | null) {
	const serverIds = input.serverIds ?? [];
	const playbookIds = input.playbookIds ?? [];
	await assertServerIdsInTeam(serverIds, session);
	await assertPlaybookIdsInTeam(playbookIds, session);
	const teamId = session ? teamCreateData(session).teamId : null;
	return prisma.alertRule.create({
		data: {
			name: input.name,
			metric: input.metric,
			operator: input.operator,
			threshold: input.threshold,
			durationSeconds: input.durationSeconds ?? 0,
			serverIds,
			notifyChannels: input.notifyChannels ?? ["in_app"],
			webhookUrl: input.webhookUrl ?? null,
			playbookIds,
			cooldownMinutes: input.cooldownMinutes ?? 30,
			silenceWindows: input.silenceWindows ?? [],
			escalationMinutes: input.escalationMinutes ?? 30,
			onCallUserIds: input.onCallUserIds ?? [],
			enabled: input.enabled ?? true,
			teamId: teamId ?? null,
		},
	});
}

export async function updateAlertRule(
	id: string,
	input: Partial<CreateAlertRuleInput> & { enabled?: boolean },
	session?: TeamSession | null,
) {
	if (session) {
		const existing = await prisma.alertRule.findFirst({ where: { id, ...teamWhere(session) }, select: { id: true } });
		if (!existing) throw new NotFoundError("Rule not found");
	}
	if (input.serverIds !== undefined) await assertServerIdsInTeam(input.serverIds, session);
	if (input.playbookIds !== undefined) await assertPlaybookIdsInTeam(input.playbookIds, session);
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
	if (input.escalationMinutes !== undefined) data.escalationMinutes = input.escalationMinutes;
	if (input.onCallUserIds !== undefined) data.onCallUserIds = input.onCallUserIds;
	if (input.enabled !== undefined) data.enabled = input.enabled;
	if (session) {
		const claimed = await prisma.alertRule.updateMany({ where: { id, ...teamWhere(session) }, data });
		if (claimed.count === 0) throw new NotFoundError("Rule not found");
		const row = await prisma.alertRule.findFirst({ where: { id, ...teamWhere(session) } });
		if (!row) throw new NotFoundError("Rule not found");
		return row;
	}
	return prisma.alertRule.update({ where: { id }, data });
}

export async function deleteAlertRule(id: string, session?: TeamSession | null) {
	if (session) {
		const claimed = await prisma.alertRule.deleteMany({ where: { id, ...teamWhere(session) } });
		if (claimed.count === 0) throw new NotFoundError("Rule not found");
		return { id };
	}
	return prisma.alertRule.delete({ where: { id } });
}

export async function toggleAlertRule(id: string, session?: TeamSession | null) {
	const current = session
		? await prisma.alertRule.findFirst({ where: { id, ...teamWhere(session) }, select: { enabled: true } })
		: await prisma.alertRule.findUnique({ where: { id }, select: { enabled: true } });
	if (!current) throw new NotFoundError("Rule not found");
	if (session) {
		const claimed = await prisma.alertRule.updateMany({
			where: { id, ...teamWhere(session) },
			data: { enabled: !current.enabled },
		});
		if (claimed.count === 0) throw new NotFoundError("Rule not found");
		const row = await prisma.alertRule.findFirst({ where: { id, ...teamWhere(session) } });
		if (!row) throw new NotFoundError("Rule not found");
		return row;
	}
	return prisma.alertRule.update({ where: { id }, data: { enabled: !current.enabled } });
}

export type AlertRuleTestDelivery = {
	channel: string;
	status: "sent" | "skipped" | "failed";
	message: string;
};

export async function testAlertRule(id: string, session?: TeamSession | null): Promise<{ rule: { id: string; name: string; metric: string; notifyChannels: string[]; webhookConfigured: boolean }; deliveries: AlertRuleTestDelivery[] }> {
	const rule = session
		? await prisma.alertRule.findFirst({ where: { id, ...teamWhere(session) } })
		: await prisma.alertRule.findUnique({ where: { id } });
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
			teamId: rule.teamId ?? null,
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

/**
 * Idempotent starter pack so alert evaluation is not a no-op on fresh installs.
 * Creates baseline fleet rules only when the (team-scoped) rule table is empty.
 */
export async function ensureDefaultAlertRules(session?: TeamSession | null) {
	const existing = await prisma.alertRule.count({
		where: session ? teamWhere(session) : {},
	});
	if (existing > 0) {
		return { created: 0, skipped: true as const };
	}

	const defaults: CreateAlertRuleInput[] = [
		{
			name: "Server offline",
			metric: "server_offline",
			operator: "eq",
			threshold: 1,
			durationSeconds: 60,
			notifyChannels: ["in_app"],
			cooldownMinutes: 15,
			escalationMinutes: 30,
		},
		{
			name: "CPU high (≥ 90%)",
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 120,
			notifyChannels: ["in_app"],
			cooldownMinutes: 30,
			escalationMinutes: 45,
		},
		{
			name: "Memory high (≥ 90%)",
			metric: "mem_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 120,
			notifyChannels: ["in_app"],
			cooldownMinutes: 30,
			escalationMinutes: 45,
		},
		{
			name: "Disk high (≥ 90%)",
			metric: "disk_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 300,
			notifyChannels: ["in_app"],
			cooldownMinutes: 60,
			escalationMinutes: 60,
		},
	];

	const created = [];
	for (const rule of defaults) {
		created.push(await createAlertRule(rule, session));
	}
	return { created: created.length, skipped: false as const, rules: created };
}
