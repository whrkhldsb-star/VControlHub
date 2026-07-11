/**
 * Health service — alert evaluation + notification dispatch
 * (R28 god-file split).
 *
 * `evaluateAlerts` reads enabled alert rules, fetches the current
 * `HealthOverview` (via the collector in `./service-collect`), filters
 * by silence-window / cooldown / duration, and fires notifications
 * (in-app / webhook / email) on rule match. Updates the rule's
 * `lastMatchedAt` / `lastTriggeredAt` as state progresses.
 */
import { prisma } from "@/lib/db";
import { sendAlertEmail } from "@/lib/notification/email";
import { sendAlertTelegram } from "@/lib/notification/telegram";
import { createNotification } from "@/lib/notification/service";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";
import { runPlaybook } from "@/lib/playbook/service";

import { collectAllHealth } from "./service-collect";
import { isNowInAlertSilenceWindow } from "./service-types";

export async function evaluateAlerts() {
	const rules = await prisma.alertRule.findMany({
		where: { enabled: true },
		select: {
			id: true,
			name: true,
			metric: true,
			threshold: true,
			operator: true,
			durationSeconds: true,
			enabled: true,
			lastMatchedAt: true,
			lastTriggeredAt: true,
			cooldownMinutes: true,
			silenceWindows: true,
			serverIds: true,
			notifyChannels: true,
			playbookIds: true,
			webhookUrl: true,
		},
		take: 200,
	});
	if (rules.length === 0) return;

	const health = await collectAllHealth();

	for (const rule of rules) {
		if (isNowInAlertSilenceWindow(rule.silenceWindows)) continue;

		// Check cooldown
		if (rule.lastTriggeredAt) {
			const cooldownMs = rule.cooldownMinutes * 60_000;
			if (Date.now() - rule.lastTriggeredAt.getTime() < cooldownMs) continue;
		}

		const targetServers =
			rule.serverIds.length > 0
				? health.servers.filter((s) => rule.serverIds.includes(s.serverId))
				: health.servers.filter((s) => s.enabled);

		for (const server of targetServers) {
			let value: number | undefined;
			switch (rule.metric) {
				case "cpu_usage":
					value = server.cpu;
					break;
				case "mem_usage":
					value = server.mem;
					break;
				case "disk_usage":
					value = server.diskMax;
					break;
				case "server_offline":
					value = server.status === "offline" ? 1 : 0;
					break;
				case "network_in":
					value = server.networkInKbps;
					break;
				case "network_out":
					value = server.networkOutKbps;
					break;
				case "load_avg":
					value = server.loadAvg1m;
					break;
				case "swap_usage":
					value = server.swapUsagePercent;
					break;
			}

			if (value === undefined) continue;

			let triggered = false;
			switch (rule.operator) {
				case "gt":
					triggered = value > rule.threshold;
					break;
				case "gte":
					triggered = value >= rule.threshold;
					break;
				case "lt":
					triggered = value < rule.threshold;
					break;
				case "lte":
					triggered = value <= rule.threshold;
					break;
				case "eq":
					triggered = value === rule.threshold;
					break;
			}

			if (!triggered) {
				if (rule.lastMatchedAt) {
					// Alert condition resolved — notify via the same channels
					const resolvedTitle = `Alert resolved: ${server.serverName} ${rule.metric === "server_offline" ? "back online" : rule.metric.replace("_", " ")}`;
					const resolvedMessage = `${rule.name}: ${rule.metric} has returned to normal range (threshold ${rule.operator} ${rule.threshold})`;

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
							await Promise.allSettled(
								admins.map((admin) =>
									createNotification({
										userId: admin.id,
										type: "alert_resolved",
										title: resolvedTitle,
										message: resolvedMessage,
										actionUrl: "/health",
									}),
								),
							);
						}

						await prisma.alertRule.update({
						where: { id: rule.id },
						data: { lastMatchedAt: null },
					});
				}
				continue;
			}

			const now = new Date();
			if (rule.durationSeconds > 0) {
				if (!rule.lastMatchedAt) {
					await prisma.alertRule.update({
						where: { id: rule.id },
						data: { lastMatchedAt: now },
					});
					continue;
				}
				const matchedForMs = now.getTime() - rule.lastMatchedAt.getTime();
				if (matchedForMs < rule.durationSeconds * 1000) continue;
			}

			// Fire alert
			const title = `Alert: ${server.serverName} ${rule.metric === "server_offline" ? "offline" : rule.metric.replace("_", " ")}`;
			const message = `${rule.name}: ${rule.metric} ${rule.operator} ${rule.threshold} (current: ${value})`;

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
				await Promise.allSettled(
					admins.map((admin) =>
						createNotification({
							userId: admin.id,
							type: "server_alert",
							title,
							message,
							actionUrl: `/health`,
						}),
					),
				);
			}

			if (rule.notifyChannels.includes("webhook") && rule.webhookUrl) {
				try {
					const delivery = await fetchWebhookSafely(rule.webhookUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							alert: rule.name,
							server: server.serverName,
							metric: rule.metric,
							value,
							threshold: rule.threshold,
							timestamp: new Date().toISOString(),
						}),
					});
					if (!delivery.ok) throw new Error(delivery.error);
					if (!delivery.response.ok) throw new Error(`HTTP ${delivery.response.status}`);
				} catch {
					/* webhook best-effort */
				}
			}

			if (rule.notifyChannels.includes("email")) {
				try {
					await sendAlertEmail({
						title,
						message,
						contextLines: [
							`Server: ${server.serverName}`,
							`Metric: ${rule.metric}`,
							`Current value: ${value}`,
							`Threshold: ${rule.operator} ${rule.threshold}`,
							`Time: ${new Date().toISOString()}`,
						],
					});
				} catch {
					/* email best-effort */
				}
			}

			if (rule.notifyChannels.includes("telegram")) {
				try {
					await sendAlertTelegram({
						title,
						message,
						contextLines: [
							`Server: ${server.serverName}`,
							`Metric: ${rule.metric}`,
							`Current value: ${value}`,
							`Threshold: ${rule.operator} ${rule.threshold}`,
							`Time: ${new Date().toISOString()}`,
						],
					});
				} catch {
					/* telegram best-effort */
				}
			}

			for (const playbookId of rule.playbookIds ?? []) {
				try {
					await runPlaybook({
						playbookId,
						dryRun: false,
						triggerContext: {
							type: "alert_rule",
							alertRuleId: rule.id,
							alertRuleName: rule.name,
							serverId: server.serverId,
							serverName: server.serverName,
							metric: rule.metric,
							operator: rule.operator,
							threshold: rule.threshold,
							value,
							triggeredAt: now.toISOString(),
						},
					});
				} catch {
					/* playbook automation is best-effort; notification already fired */
				}
			}

			// Update last triggered
			await prisma.alertRule.update({
				where: { id: rule.id },
				data: { lastTriggeredAt: now, lastMatchedAt: now },
			});
		}
	}
}
