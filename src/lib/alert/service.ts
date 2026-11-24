import { checkSamplingClaim, type SamplingClaim } from "@/lib/monitoring/sampling-claim";
import { intentPrefix } from "./delivery-intent";
import { createHash } from "node:crypto";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";

function hashPlaybookLockKey(resourceId: string): number {
	let h = 0;
	for (let i = 0; i < resourceId.length; i++) {
		h = (Math.imul(31, h) + resourceId.charCodeAt(i)) | 0;
	}
	return h;
}
import { PLATFORM_ONLY_CHANNELS, recordChannelGrant } from "./channel-grants";
import type { AlertRule, Prisma } from "@prisma/client";
import { apiCopy } from "@/lib/i18n/api-copy";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { assertPlaybookCommandStepsInScope } from "@/lib/playbook/service";
import type { PlaybookStep } from "@/lib/playbook/types";
import { PLAYBOOK_RUN_PERMISSION } from "@/lib/playbook/permissions";
import { isGlobalTeamManager, activeCustomerTeamWhere, serverTeamWhere, teamCreateData, teamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

import { sendAlertEmail } from "@/lib/notification/email";
import { sendAlertTelegram } from "@/lib/notification/telegram";
import { createNotification } from "@/lib/notification/service";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";
import { t } from "@/lib/i18n/service-translations";
import { permissionHoldersWhere } from "@/lib/auth/permission-holders";

/* ── Types ────────────────────────────────────────────────── */

async function hasDeniedServerReads(session?: TeamSession | null, db: Prisma.TransactionClient = prisma) {
	if (!session?.currentTeamId || isGlobalTeamManager(session)) return false;
	return Boolean(await db.userServerAccess.findFirst({
		where: { userId: session.userId, canRead: false, server: { teamId: session.currentTeamId } },
		select: { serverId: true },
	}));
}

async function assertServerIdsInTeam(serverIds: string[], session?: TeamSession | null, db: Prisma.TransactionClient = prisma) {
	if (!session) return;
	if (serverIds.length === 0) {
		if (await hasDeniedServerReads(session, db)) {
			throw new ForbiddenError(t("backend.alert.selectReadableServers"));
		}
		return;
	}
	const allowed = await db.server.findMany({
		where: { id: { in: serverIds }, ...serverTeamWhere(session) },
		select: { id: true },
	});
	if (allowed.length !== serverIds.length) {
		throw new ValidationError(t("backend.alert.oneOrMoreServeridsAreOutsideTheCurrent"));
	}
}

async function assertPlaybookIdsInTeam(db: Prisma.TransactionClient, playbookIds: string[], session: TeamSession | null | undefined, teamId: string | null, requiresRun = true) {
	if (playbookIds.length === 0) return;
	const canRun = !session || sessionHasPermission(session, PLAYBOOK_RUN_PERMISSION);
	if (requiresRun && !canRun) throw new ForbiddenError(t("backend.alert.bindingPlaybooksRequiresRun"));
	const allowed = await db.playbook.findMany({
		where: { id: { in: playbookIds }, ...(session ? activeCustomerTeamWhere(session) : {}), ...(teamId ? { teamId } : {}) },
		select: { id: true, steps: true },
	});
	if (allowed.length !== playbookIds.length) {
		throw new ValidationError(t("backend.alert.oneOrMorePlaybookidsAreOutsideTheCurrent"));
	}
	const steps = allowed.flatMap((playbook) => playbook.steps as unknown as PlaybookStep[]);
	if (!canRun && steps.some((step) => step.type === "run_command")) {
		throw new ForbiddenError(t("backend.alert.bindingPlaybooksRequiresRun"));
	}
	await assertPlaybookCommandStepsInScope(steps, session, db);
}

/**
 * Email and Telegram deliver to the platform's own recipients (smtp.alertRecipients, telegram.chatId), never to a
 * customer's. A customer rule on them sent the owner whatever its name said, on demand through the test button,
 * so only a platform administrator may route a rule there.
 */
function mayUsePlatformChannels(session?: TeamSession | null): boolean {
	return !session || isGlobalTeamManager(session);
}

function assertChannelsAllowed(channels: string[] | undefined, session?: TeamSession | null) {
	if (!channels || mayUsePlatformChannels(session)) return;
	if (channels.some((channel) => PLATFORM_ONLY_CHANNELS.includes(channel))) {
		throw new ValidationError(t("backend.alert.platformChannelsAdminOnly"));
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

export function formatAlertRuleCursor(rule: { createdAt: Date | string; id: string }): string {
	const ms = rule.createdAt instanceof Date ? rule.createdAt.getTime() : new Date(rule.createdAt).getTime();
	return `${ms}.${rule.id}`;
}

function parseAlertRuleCursor(after?: string): Prisma.AlertRuleWhereInput | null {
	if (!after) return null;
	const dot = after.indexOf(".");
	if (dot > 0) {
		const ms = Number(after.slice(0, dot));
		const id = after.slice(dot + 1);
		if (Number.isFinite(ms) && id) {
			const createdAt = new Date(ms);
			return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] };
		}
	}
	return { id: { lt: after } };
}

export async function listAlertRules(session?: TeamSession | null, page?: { after?: string; take: number }) {
	const cursorWhere = parseAlertRuleCursor(page?.after);
	return prisma.alertRule.findMany({
		where: { ...(session ? teamWhere(session) : {}), ...(cursorWhere ?? {}) },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: page?.take,
	});
}

const MAX_ALERT_RULES_PER_SCOPE = 200;

export async function createAlertRule(input: CreateAlertRuleInput, session?: TeamSession | null) {
	const serverIds = input.serverIds ?? [];
	const playbookIds = [...new Set(input.playbookIds ?? [])];
	if (serverIds.length > 500 || playbookIds.length > 32) {
		throw new ValidationError(apiCopy("apiCopy.request.body.too.large.c49c1143"));
	}
	if (playbookIds.length > 0 && session && !sessionHasPermission(session, PLAYBOOK_RUN_PERMISSION)) {
		throw new ForbiddenError(t("backend.alert.bindingPlaybooksRequiresRun"));
	}
	assertChannelsAllowed(input.notifyChannels, session);
	await assertServerIdsInTeam(serverIds, session);
	await assertOnCallUserIdsInTeam(input.onCallUserIds ?? [], session);
	const teamId = session ? teamCreateData(session).teamId : null;
	const data = ruleData(input, teamId ?? null);
	const grant = teamId && session && input.notifyChannels?.some((channel) => PLATFORM_ONLY_CHANNELS.includes(channel));
	const assertRuleLimit = async (db: Pick<Prisma.TransactionClient, "alertRule">) => {
		const existingCount = await db.alertRule.count({ where: { teamId: teamId ?? null } });
		if (existingCount >= MAX_ALERT_RULES_PER_SCOPE) {
			throw new ValidationError(t("backend.alert.ruleLimitReached", { max: MAX_ALERT_RULES_PER_SCOPE }));
		}
	};
	if (playbookIds.length || grant) {
		return prisma.$transaction(async (tx) => {
			await lockAlertPlaybookBindings(tx, playbookIds);
			await assertPlaybookIdsInTeam(tx, playbookIds, session, teamId ?? null);
			await assertRuleLimit(tx);
			const rule = await tx.alertRule.create({ data });
			if (grant) await recordChannelGrant(tx, rule, session.userId);
			return rule;
		});
	}
	await assertRuleLimit(prisma);
	return prisma.alertRule.create({ data });
}

function ruleData(input: CreateAlertRuleInput, teamId: string | null): Prisma.AlertRuleUncheckedCreateInput {
	return {
		name: input.name,
		metric: input.metric,
		operator: input.operator,
		threshold: input.threshold,
		durationSeconds: input.durationSeconds ?? 0,
		serverIds: input.serverIds ?? [],
		notifyChannels: input.notifyChannels ?? ["in_app"],
		webhookUrl: input.webhookUrl ?? null,
		playbookIds: [...new Set(input.playbookIds ?? [])],
		cooldownMinutes: input.cooldownMinutes ?? 30,
		silenceWindows: input.silenceWindows ?? [],
		escalationMinutes: input.escalationMinutes ?? 30,
		onCallUserIds: input.onCallUserIds ?? [],
		enabled: input.enabled ?? true,
		teamId,
	};
}

export async function lockAlertPlaybookBindings(tx: Prisma.TransactionClient, ids: string[]) {
	const sorted = [...new Set(ids)].sort((a, b) => {
		const diff = hashPlaybookLockKey(a) - hashPlaybookLockKey(b);
		return diff !== 0 ? diff : a.localeCompare(b);
	});
	const seenLockKeys = new Set<number>();
	for (const id of sorted) {
		const k2 = hashPlaybookLockKey(id);
		if (seenLockKeys.has(k2)) continue;
		seenLockKeys.add(k2);
		await lockForTransaction(tx, "playbook-lifecycle", id);
	}
}

type RuleTargets = Pick<AlertRule, "teamId" | "updatedAt" | "enabled" | "playbookIds" | "serverIds" | "notifyChannels">;

async function assertRuleChangeInScope(db: Prisma.TransactionClient, current: RuleTargets, input: Partial<CreateAlertRuleInput>, session?: TeamSession | null) {
	const disablingOnly = input.enabled === false && Object.keys(input).length === 1;
	if (!disablingOnly) {
		assertChannelsAllowed(input.notifyChannels ?? current.notifyChannels, session);
		const requiresRun = input.playbookIds !== undefined || (input.enabled ?? current.enabled);
		await assertPlaybookIdsInTeam(db, input.playbookIds ?? current.playbookIds, session, current.teamId, requiresRun);
	}
	await assertServerIdsInTeam(input.serverIds ?? current.serverIds, session, db);
}

async function updateScopedAlertRule(
	id: string,
	session: TeamSession | null | undefined,
	current: RuleTargets,
	input: Partial<CreateAlertRuleInput>,
	data: Prisma.AlertRuleUpdateManyMutationInput,
) {
	if ((input.serverIds && input.serverIds.length > 500) || (input.playbookIds && input.playbookIds.length > 32)) {
		throw new ValidationError(apiCopy("apiCopy.request.body.too.large.c49c1143"));
	}
	const disablingOnly = input.enabled === false && Object.keys(input).length === 1;
	if (!disablingOnly && session) {
		const effectivePlaybooks = input.playbookIds ?? current.playbookIds;
		const requiresRun = input.playbookIds !== undefined || (input.enabled ?? current.enabled);
		if (effectivePlaybooks.length > 0 && requiresRun && !sessionHasPermission(session, PLAYBOOK_RUN_PERMISSION)) {
			throw new ForbiddenError(t("backend.alert.bindingPlaybooksRequiresRun"));
		}
	}
	const where = { id, ...(session ? teamWhere(session) : {}) };
	const touchesPlatform = [...current.notifyChannels, ...(input.notifyChannels ?? [])]
		.some((channel) => PLATFORM_ONLY_CHANNELS.includes(channel));
	const [row] = await prisma.$transaction(async (tx) => {
		await lockAlertPlaybookBindings(tx, [...current.playbookIds, ...(input.playbookIds ?? [])]);
		// Prisma exposes historical NULL arrays as []. Check their effective
		// contents under the rule row lock before validating the bound definitions.
		const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM alert_rules WHERE id = ${id}
			AND "teamId" IS NOT DISTINCT FROM ${current.teamId} AND "updatedAt" = ${current.updatedAt} AND enabled = ${current.enabled}
			AND COALESCE("serverIds", '{}') = ${current.serverIds}::text[] AND COALESCE("playbookIds", '{}') = ${current.playbookIds}::text[]
			AND COALESCE("notifyChannels", '{}') = ${current.notifyChannels}::text[] FOR UPDATE`;
		if (!locked.length) return [];
		await assertRuleChangeInScope(tx, current, input, session);
		const rows = await tx.alertRule.updateManyAndReturn({ where: { ...where, teamId: current.teamId, updatedAt: current.updatedAt }, data });
		if (touchesPlatform && session && rows[0] && (isGlobalTeamManager(session) || !rows[0].notifyChannels.some((channel) => PLATFORM_ONLY_CHANNELS.includes(channel)))) {
			await recordChannelGrant(tx, rows[0], session.userId);
		}
		return rows;
	});
	if (row) return row;
	if (await prisma.alertRule.findFirst({ where, select: { id: true } })) {
		throw new ConflictError(t("backend.alert.ruleChanged"));
	}
	throw new NotFoundError(t("backend.alert.ruleNotFound"));
}

type AlertCondition = Pick<AlertRule, "metric" | "operator" | "threshold">;

export function alertConditionChanged(previous: AlertCondition, change: Partial<AlertCondition>) {
	return (change.metric ?? previous.metric) !== previous.metric
		|| (change.operator ?? previous.operator) !== previous.operator
		|| (change.threshold ?? previous.threshold) !== previous.threshold;
}

export async function updateAlertRule(
	id: string,
	input: Partial<CreateAlertRuleInput> & { enabled?: boolean },
	session?: TeamSession | null,
) {
	if (input.playbookIds) input = { ...input, playbookIds: [...new Set(input.playbookIds)] };
	assertChannelsAllowed(input.notifyChannels, session);
	const select = { teamId: true, updatedAt: true, metric: true, operator: true, threshold: true, webhookUrl: true, enabled: true, playbookIds: true, serverIds: true, notifyChannels: true } as const;
	let existing: Pick<AlertRule, keyof typeof select> | null = null;
	if (session) {
		existing = await prisma.alertRule.findFirst({ where: { id, ...teamWhere(session) }, select });
		if (!existing) throw new NotFoundError(t("backend.alert.ruleNotFound"));
	} else if (input.playbookIds !== undefined || input.enabled === true || input.threshold !== undefined || input.operator !== undefined || input.metric !== undefined || input.notifyChannels !== undefined || input.webhookUrl !== undefined) {
		existing = await prisma.alertRule.findUnique({ where: { id }, select });
	}
	// The webhook channel needs an address: the one in this change, or the one the rule already holds (which
	// the edit form cannot send back — the page is never given it).
	if (input.notifyChannels?.includes("webhook") && !(input.webhookUrl ?? existing?.webhookUrl)) {
		throw new ValidationError(t("backend.alert.webhookUrlRequired"));
	}
	if (input.onCallUserIds !== undefined) await assertOnCallUserIdsInTeam(input.onCallUserIds, session);
	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name;
	if (input.metric !== undefined) data.metric = input.metric;
	if (existing && alertConditionChanged(existing, input)) {
		data.matchState = {};
		data.lastMatchedAt = null;
	}
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
	if (existing && (session || input.playbookIds !== undefined || (input.enabled && existing.playbookIds.length))) return updateScopedAlertRule(id, session, existing, input, data);
	return prisma.alertRule.update({ where: { id }, data });
}

export async function deleteAlertRule(id: string, session?: TeamSession | null) {
	const scope = session ? teamWhere(session) : {};
	return prisma.$transaction(async (tx) => {
		const row = await tx.alertRule.findFirst({ where: { id, ...scope }, select: { id: true, teamId: true } });
		if (!row) throw new NotFoundError(t("backend.alert.ruleNotFound"));
		const deleted = await tx.alertRule.deleteMany({ where: { id, ...scope, teamId: row.teamId } });
		if (!deleted.count) throw new NotFoundError(t("backend.alert.ruleNotFound"));
		await tx.setting.deleteMany({ where: { key: { startsWith: intentPrefix(id) } } });
		return row;
	});
}

export async function toggleAlertRule(id: string, session?: TeamSession | null) {
	const select = { teamId: true, updatedAt: true, enabled: true, playbookIds: true, serverIds: true, notifyChannels: true } as const;
	const current = session
		? await prisma.alertRule.findFirst({ where: { id, ...teamWhere(session) }, select })
		: await prisma.alertRule.findUnique({ where: { id }, select });
	if (!current) throw new NotFoundError(t("backend.alert.ruleNotFound"));
	const change = { enabled: !current.enabled };
	if (session || (change.enabled && current.playbookIds.length)) {
		return updateScopedAlertRule(id, session, current, change, change);
	}
	return prisma.alertRule.update({ where: { id }, data: change });
}

export type AlertRuleTestDelivery = {
	channel: string;
	status: "sent" | "skipped" | "failed";
	message: string;
};

export async function testAlertRule(id: string, session?: TeamSession | null): Promise<{ rule: { id: string; teamId: string | null; name: string; metric: string; notifyChannels: string[]; webhookConfigured: boolean }; deliveries: AlertRuleTestDelivery[] }> {
	const rule = session
		? await prisma.alertRule.findFirst({ where: { id, ...teamWhere(session) } })
		: await prisma.alertRule.findUnique({ where: { id } });
	if (!rule) throw new NotFoundError(t("backend.alert.ruleNotFound"));

	const deliveries: AlertRuleTestDelivery[] = [];
	const title = t("backend.alert.testTitle", { name: rule.name });
	const message = t("backend.alert.testMessage", { name: rule.name });

	if (rule.notifyChannels.includes("in_app")) {
		const admins = await prisma.user.findMany({
			where: { status: { not: "DISABLED" }, ...permissionHoldersWhere("notification:manage", rule.teamId) },
			select: { id: true },
			take: 100,
		});
		const results = await Promise.allSettled(admins.map((admin) => createNotification({
			userId: admin.id,
			type: "server_alert",
			notice: { code: "alertTest", params: { rule: rule.name } },
			title,
			message,
			actionUrl: "/alert-rules",
			teamId: rule.teamId ?? null,
		})));
		const failed = results.filter((result) => result.status === "rejected").length;
		deliveries.push({
			channel: "in_app",
			status: failed === 0 ? "sent" : "failed",
			message:
				failed === 0
					? t("backend.alert.testInAppSent", { count: admins.length })
					: t("backend.alert.testInAppPartialFail", { failed, total: admins.length }),
		});
	}

	if (rule.notifyChannels.includes("webhook")) {
		if (!rule.webhookUrl) {
			deliveries.push({ channel: "webhook", status: "skipped", message: t("backend.alert.testWebhookSkipped") });
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
				deliveries.push({ channel: "webhook", status: "sent", message: t("backend.alert.testWebhookSent") });
			} catch (error) {
				deliveries.push({ channel: "webhook", status: "failed", message: error instanceof Error ? error.message : t("backend.alert.testWebhookFailed") });
			}
		}
	}

	const contextLines = [
		t("backend.alert.testContext.rule", { value: rule.name }),
		t("backend.alert.testContext.metric", { value: rule.metric }),
		t("backend.alert.testContext.threshold", { value: rule.threshold }),
	];

	// A customer's test never reaches the platform's own mailbox or bot (see PLATFORM_ONLY_CHANNELS); rules saved
	// before that rule may still list them.
	const platformChannelsAllowed = mayUsePlatformChannels(session);
	for (const channel of PLATFORM_ONLY_CHANNELS) {
		if (!platformChannelsAllowed && rule.notifyChannels.includes(channel)) {
			deliveries.push({ channel, status: "skipped", message: t("backend.alert.platformChannelsAdminOnly") });
		}
	}

	if (platformChannelsAllowed && rule.notifyChannels.includes("email")) {
		try {
			const result = await sendAlertEmail({
				title,
				message,
				contextLines,
			});
			deliveries.push({
				channel: "email",
				status: result.accepted.length > 0 && result.rejected.length === 0 ? "sent" : "failed",
				message: result.rejected.length === 0
					? t("backend.alert.testEmailSent", { count: result.accepted.length })
					: t("backend.alert.testEmailPartialFail", { rejected: result.rejected.length }),
			});
		} catch (error) {
			deliveries.push({
				channel: "email",
				status: "failed",
				message: error instanceof Error ? error.message : t("backend.alert.testEmailFailed"),
			});
		}
	}

	if (platformChannelsAllowed && rule.notifyChannels.includes("telegram")) {
		try {
			const result = await sendAlertTelegram({
				title,
				message,
				contextLines,
			});
			if (result.accepted.length === 0) {
				deliveries.push({
					channel: "telegram",
					status: "failed",
					message: result.rejected[0]?.reason ?? t("backend.alert.testTelegramFailed"),
				});
			} else if (result.rejected.length > 0) {
				deliveries.push({
					channel: "telegram",
					status: "failed",
					message: t("backend.alert.testTelegramPartialFail", { failed: result.rejected.length, total: result.accepted.length + result.rejected.length }),
				});
			} else {
				deliveries.push({
					channel: "telegram",
					status: "sent",
					message: t("backend.alert.testTelegramSent", { count: result.accepted.length }),
				});
			}
		} catch (error) {
			deliveries.push({
				channel: "telegram",
				status: "failed",
				message: error instanceof Error ? error.message : t("backend.alert.testTelegramFailed"),
			});
		}
	}

	if (deliveries.length === 0) {
		deliveries.push({ channel: "none", status: "skipped", message: t("backend.alert.testNoChannel") });
	}

	return {
		rule: {
			id: rule.id,
			teamId: rule.teamId,
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
 *
 * Channel selection: always include in_app. When SMTP / Telegram are already
 * enabled in settings, also opt default rules into those channels so a fresh
 * install does not silently stay in-app-only after ops configured delivery.
 */
export async function ensureDefaultAlertRules(session?: TeamSession | null, claim?: SamplingClaim) {
	const teamId = session?.currentTeamId ?? null;
	const markerKey = teamId ? `${DEFAULT_RULES_MARKER}:${teamId}` : DEFAULT_RULES_MARKER;
	if (session && !teamId && !isGlobalTeamManager(session)) return { created: 0, skipped: true as const };
	if ((await prisma.setting.findUnique({ where: { key: markerKey } }))?.value === "true") return { created: 0, skipped: true as const };
	if (await hasDeniedServerReads(session)) return { created: 0, skipped: true as const };
	const notifyChannels = await resolveDefaultNotifyChannels(session);

	const defaults: CreateAlertRuleInput[] = [
		{
			name: t("backend.alert.starter.offline"),
			metric: "server_offline",
			operator: "eq",
			threshold: 1,
			durationSeconds: 60,
			notifyChannels,
			cooldownMinutes: 15,
			escalationMinutes: 30,
		},
		{
			name: t("backend.alert.starter.cpu"),
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 120,
			notifyChannels,
			cooldownMinutes: 30,
			escalationMinutes: 45,
		},
		{
			name: t("backend.alert.starter.memory"),
			metric: "mem_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 120,
			notifyChannels,
			cooldownMinutes: 30,
			escalationMinutes: 45,
		},
		{
			name: t("backend.alert.starter.disk"),
			metric: "disk_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 300,
			notifyChannels,
			cooldownMinutes: 60,
			escalationMinutes: 60,
		},
	];

	return prisma.$transaction(async (tx) => {
		await lockForTransaction(tx, "default-alert-rules", markerKey);
		await checkSamplingClaim(tx, claim);
		if ((await tx.setting.findUnique({ where: { key: markerKey } }))?.value === "true") return { created: 0, skipped: true as const };
		const created = [];
		if (!await tx.alertRule.count({ where: session ? teamWhere(session) : {} })) {
			for (const input of defaults) {
				const id = "starter-" + createHash("sha256").update(JSON.stringify([teamId, input.metric])).digest("hex");
				const rule = await tx.alertRule.create({ data: { id, ...ruleData(input, teamId) } });
				if (teamId && session && notifyChannels.some((channel) => PLATFORM_ONLY_CHANNELS.includes(channel))) {
					await recordChannelGrant(tx, rule, session.userId);
				}
				created.push(rule);
			}
		}
		await tx.setting.upsert({ where: { key: markerKey }, create: { key: markerKey, value: "true" }, update: { value: "true" } });
		return created.length ? { created: created.length, skipped: false as const, rules: created } : { created: 0, skipped: true as const };
	});
}

const DEFAULT_RULES_MARKER = "alerts.defaultRulesSeeded";

async function assertOnCallUserIdsInTeam(userIds: string[], session?: TeamSession | null) {
	if (!session || userIds.length === 0) return;
	if (sessionHasPermission(session, "team:manage")) return;
	const teamId = session.currentTeamId;
	if (!teamId) {
		throw new ValidationError(apiCopy("apiCopy.oncalluserids.require.a.team.context.895b2a56"));
	}
	const members = await prisma.teamMember.findMany({
		where: { teamId, userId: { in: userIds } },
		select: { userId: true },
	});
	if (members.length !== new Set(userIds).size) {
		throw new ValidationError(apiCopy("apiCopy.oncalluserids.must.be.members.of.the.current.team.28c63b6c"));
	}
}


async function resolveDefaultNotifyChannels(session?: TeamSession | null): Promise<string[]> {
	const channels = new Set<string>(["in_app"]);
	// A customer's starter rules stay off the platform's own mailbox and bot.
	if (!mayUsePlatformChannels(session)) return [...channels];
	try {
		const { getSetting } = await import("@/lib/settings/service");
		const isOn = (v: string) => ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());
		const [smtpEnabled, telegramEnabled] = await Promise.all([
			getSetting("smtp.enabled"),
			getSetting("telegram.enabled"),
		]);
		if (isOn(smtpEnabled)) channels.add("email");
		if (isOn(telegramEnabled)) channels.add("telegram");
	} catch {
		// Settings read is best-effort; fall back to in_app only.
	}
	return [...channels];
}
