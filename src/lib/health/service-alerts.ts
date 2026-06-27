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
					const resolvedTitle = `告警恢复: ${server.serverName} ${rule.metric === "server_offline" ? "已上线" : rule.metric.replace("_", " ")}`;
					const resolvedMessage = `${rule.name}: ${rule.metric} 已恢复至正常范围（阈值 ${rule.operator} ${rule.threshold}）`;

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
			const title = `告警: ${server.serverName} ${rule.metric === "server_offline" ? "离线" : rule.metric.replace("_", " ")}`;
			const message = `${rule.name}: ${rule.metric} ${rule.operator} ${rule.threshold} (当前: ${value})`;

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
					await fetchWebhookSafely(rule.webhookUrl, {
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
							`服务器: ${server.serverName}`,
							`指标: ${rule.metric}`,
							`当前值: ${value}`,
							`阈值: ${rule.operator} ${rule.threshold}`,
							`时间: ${new Date().toISOString()}`,
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
							`服务器: ${server.serverName}`,
							`指标: ${rule.metric}`,
							`当前值: ${value}`,
							`阈值: ${rule.operator} ${rule.threshold}`,
							`时间: ${new Date().toISOString()}`,
						],
					});
				} catch {
					/* telegram best-effort */
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
