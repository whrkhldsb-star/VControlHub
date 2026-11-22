import { createHash } from "node:crypto";
import type { AlertRule, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const PLATFORM_ONLY_CHANNELS = ["email", "telegram"];
type DeliveryRule = Omit<AlertRule, "createdAt" | "updatedAt" | "matchState" | "lastMatchedAt" | "lastTriggeredAt">;

function grantKey(id: string) {
	return `alerts.platformChannels.${id}`;
}

/** Runtime match/notification timestamps change on every evaluation. Only configuration is approved. */
export function configurationDigest(rule: DeliveryRule) {
	return createHash("sha256").update(JSON.stringify([
		rule.id, rule.teamId, rule.name, rule.metric, rule.operator, rule.threshold, rule.enabled,
		rule.durationSeconds, rule.cooldownMinutes, rule.escalationMinutes, rule.silenceWindows,
		rule.serverIds, rule.playbookIds, rule.onCallUserIds, rule.webhookUrl, rule.notifyChannels,
	])).digest("hex");
}

export async function recordChannelGrant(tx: Prisma.TransactionClient, rule: AlertRule, actorId: string) {
	if (!rule.teamId) return;
	const key = grantKey(rule.id);
	if (!rule.notifyChannels.some((channel) => PLATFORM_ONLY_CHANNELS.includes(channel))) {
		await tx.setting.deleteMany({ where: { key } });
		return;
	}
	const data = { value: configurationDigest(rule), updatedBy: actorId };
	await tx.setting.upsert({ where: { key }, create: { key, ...data }, update: data });
}

export async function verifiedRuleChannels(rule: DeliveryRule, db: Prisma.TransactionClient = prisma): Promise<string[]> {
	if (!rule.teamId || !rule.notifyChannels.some((channel) => PLATFORM_ONLY_CHANNELS.includes(channel))) return rule.notifyChannels;
	const grant = await db.setting.findUnique({ where: { key: grantKey(rule.id) } });
	if (grant?.updatedBy && grant.value === configurationDigest(rule)) return rule.notifyChannels;
	return rule.notifyChannels.filter((channel) => !PLATFORM_ONLY_CHANNELS.includes(channel));
}
