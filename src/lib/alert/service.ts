import { prisma } from "@/lib/db";

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
	enabled?: boolean;
};

/* ── CRUD ─────────────────────────────────────────────────── */

export async function listAlertRules() {
	return prisma.alertRule.findMany({ orderBy: { createdAt: "desc" } });
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
