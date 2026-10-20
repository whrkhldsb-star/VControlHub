import { prisma } from "@/lib/db";
import {
	VALID_SETTING_KEYS,
	isSensitiveKey,
	MASKED_VALUE,
} from "@/lib/settings/schema";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";
import { RUNTIME_SETTING_DEFINITIONS, isRuntimeSettingKey, normalizeRuntimeSettingValue } from "@/lib/runtime-settings/service";
import { rememberRuntimeSettingNumber } from "@/lib/runtime-settings/cached";
import { invalidatePlatformDefaults } from "@/lib/settings/platform-defaults";
import { invalidateCachedFlags } from "@/lib/settings/cached-flags";

/* ── Safe decrypt helper ──────────────────────────────────── */
function safeDecrypt(value: string): string {
	try {
		return isEncrypted(value) ? decrypt(value) : value;
	} catch {
		return value;
	}
}

/* ── Default settings ─────────────────────────────────────── */
const DEFAULTS: Record<string, string> = {
	"platform.name": "VPS Unified Control Platform",
	"platform.logo": "",
	"session.timeout": "86400",
	"password.minLength": "8",
	"password.requireUppercase": "true",
	"password.requireNumber": "true",
	"password.requireSpecial": "false",
	"smtp.host": "",
	"smtp.port": "587",
	"smtp.user": "",
	"smtp.pass": "",
	"smtp.from": "",
	"smtp.alertRecipients": "",
	"smtp.enabled": "false",
	// TR-020 M02: 仪表盘拖拽重排默认开启 (admin 可关)
	"dashboard.layout.dragReorderEnabled": "true",
	// TR-007 M03: 异地备份 (S3-compatible, 默认全部关闭)
	"offsite.enabled": "false",
	"offsite.provider": "s3",
	"offsite.endpoint": "",
	"offsite.region": "auto",
	"offsite.bucket": "",
	"offsite.accessKeyId": "",
	"offsite.secretAccessKey": "",
	"offsite.pathPrefix": "vcontrolhub-backups/",
	"offsite.dailyWindowHour": "3",
	"offsite.retentionDays": "30",
	"offsite.failureAlertRecipient": "",
	// TR-009 55a: offsite upload pipeline — 默认开 gzip 压缩 (用户可关)
	"offsite.compress": "true",
	// TR-032 E02: 智能 AI 运维 (默认 recommendation 模式, provider 留空 = 走内置信号 surface)
	"ai.ops.mode": "recommendation",
	"ai.ops.provider": "",
	// TR-009 55d: Telegram Bot 告警 (默认关闭; botToken 为密码型敏感字段, GET 时返回 ***)
	"telegram.enabled": "false",
	"telegram.botToken": "",
	"telegram.chatId": "",
	// Platform defaults for visitors without a preference cookie; SSH host key pin policy (env SSH_ENFORCE_HOST_KEY_PIN is the fallback).
	"platform.defaultLocale": "zh",
	"platform.defaultTheme": "dark",
	"security.sshEnforceHostKeyPin": "",
	...Object.fromEntries(
		Object.entries(RUNTIME_SETTING_DEFINITIONS).map(([key, definition]) => [key, String(definition.defaultValue)])
	),
};

export type SettingUpdateMetadata = {
	updatedAt: Date | null;
	actorId: string | null;
	actorName: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function auditKeys(detail: unknown): string[] {
	if (!isRecord(detail) || !Array.isArray(detail.keys)) return [];
	return detail.keys.filter((key): key is string => typeof key === "string");
}

/* ── Get / Set ────────────────────────────────────────────── */
export async function getSetting(key: string): Promise<string> {
	const row = await prisma.setting.findUnique({ where: { key }, select: { key: true, value: true } });
	const raw = row?.value ?? DEFAULTS[key] ?? "";
	return isSensitiveKey(key) ? safeDecrypt(raw) : raw;
}

export async function getAllSettings(): Promise<Record<string, string>> {
	const rows = await prisma.setting.findMany({ select: { key: true, value: true }, take: 500 }); // P2: setting 表总行数有限
	const result: Record<string, string> = { ...DEFAULTS };
	for (const row of rows) {
		result[row.key] = isSensitiveKey(row.key) ? safeDecrypt(row.value) : row.value;
	}
	return result;
}

/**
 * For rows written before the updatedBy column: an audit entry names who made
 * the stored change only if it was written right after it (never before it).
 */
const AUDIT_MATCH_WINDOW_MS = 60_000;

export async function getSettingUpdateMetadata(keys: string[]): Promise<Record<string, SettingUpdateMetadata>> {
	const uniqueKeys = [...new Set(keys)];
	const result = Object.fromEntries(
		uniqueKeys.map((key) => [key, { updatedAt: null, actorId: null, actorName: null }])
	) as Record<string, SettingUpdateMetadata>;

	if (uniqueKeys.length === 0) return result;

	const [settings, auditLogs] = await Promise.all([
		prisma.setting.findMany({
			where: { key: { in: uniqueKeys } },
			select: { key: true, updatedAt: true, updatedBy: true },
			take: 500, // P2: uniqueKeys 已外部限,500 作 hard 上界
		}),
		prisma.auditLog.findMany({
			where: { action: "settings.update" },
			select: {
				actorId: true,
				createdAt: true,
				detail: true,
				actor: { select: { username: true, displayName: true } },
			},
			orderBy: { createdAt: "desc" },
			take: 100,
		}),
	]);

	for (const setting of settings) {
		result[setting.key]!.updatedAt = setting.updatedAt;
	}

	// The row names its writer. Only rows written before that column existed
	// fall back to the audit log, and only to an entry written right after
	// the stored change: an older entry belongs to an earlier change.
	const writers = await prisma.user.findMany({
		where: { id: { in: [...new Set(settings.map((setting) => setting.updatedBy).filter((id): id is string => Boolean(id)))] } },
		select: { id: true, username: true, displayName: true },
	});
	const writerById = new Map(writers.map((user) => [user.id, user]));
	const needsAudit = new Map<string, number>();
	for (const setting of settings) {
		if (setting.updatedBy) {
			const writer = writerById.get(setting.updatedBy);
			result[setting.key] = {
				updatedAt: setting.updatedAt,
				actorId: setting.updatedBy,
				actorName: writer?.displayName || writer?.username || setting.updatedBy,
			};
		} else {
			needsAudit.set(setting.key, setting.updatedAt.getTime());
		}
	}
	const settled = new Set<string>();
	for (const log of auditLogs) {
		for (const key of auditKeys(log.detail)) {
			if (!result[key] || settled.has(key)) continue;
			const stored = needsAudit.get(key);
			if (stored === undefined) {
				// No row (never stored, or written elsewhere): the newest audit entry tells.
				if (!settings.some((setting) => setting.key === key)) {
					settled.add(key);
					result[key] = { updatedAt: log.createdAt, actorId: log.actorId, actorName: log.actor?.displayName || log.actor?.username || log.actorId || "Unknown user" };
				}
				continue;
			}
			const written = log.createdAt.getTime();
			// Entries newer than the window belong to no stored change; keep looking.
			if (written > stored + AUDIT_MATCH_WINDOW_MS) continue;
			settled.add(key);
			if (written < stored) continue; // older than the stored change: not its author
			result[key] = { updatedAt: new Date(stored), actorId: log.actorId, actorName: log.actor?.displayName || log.actor?.username || log.actorId || "Unknown user" };
		}
	}

	return result;
}

/**
 * Return all settings with sensitive values masked.
 * A stored secret (see isSensitiveKey) is replaced with '***'; an unset one
 * stays empty so the settings page does not show a secret that is not there.
 */
export async function getAllSettingsMasked(): Promise<Record<string, string>> {
	const settings = await getAllSettings();
	const masked: Record<string, string> = {};
	for (const [key, value] of Object.entries(settings)) {
		masked[key] = isSensitiveKey(key) && value !== "" ? MASKED_VALUE : value;
	}
	return masked;
}

/** `actorId`: the user making the change (null for system writes). */
export async function setSetting(key: string, value: string, actorId: string | null = null): Promise<void> {
	const normalizedValue = isRuntimeSettingKey(key) ? normalizeRuntimeSettingValue(key, value) : value;
	const storedValue = isSensitiveKey(key) ? encrypt(normalizedValue) : normalizedValue;
	await prisma.setting.upsert({
		where: { key },
		update: { value: storedValue, updatedBy: actorId },
		create: { key, value: storedValue, updatedBy: actorId },
	});
	rememberSaved([{ key, value: normalizedValue }]);
}

/** Keep this process's sync caches in step with what was just written. */
function rememberSaved(entries: Array<{ key: string; value: string }>) {
	for (const { key, value } of entries) {
		if (isRuntimeSettingKey(key)) rememberRuntimeSettingNumber(key, Number(value));
	}
	if (entries.some(({ key }) => key.startsWith("platform."))) invalidatePlatformDefaults();
	if (entries.some(({ key }) => key === "security.sshEnforceHostKeyPin")) invalidateCachedFlags();
}

export async function setManySettings(
	entries: Array<{ key: string; value: string }>,
	/** The user making the change (null for system writes). */
	actorId: string | null = null,
): Promise<void> {
	await prisma.$transaction(
		entries.map(({ key, value }) => {
			const normalizedValue = isRuntimeSettingKey(key) ? normalizeRuntimeSettingValue(key, value) : value;
			const storedValue = isSensitiveKey(key) ? encrypt(normalizedValue) : normalizedValue;
			return prisma.setting.upsert({
				where: { key },
				update: { value: storedValue, updatedBy: actorId },
				create: { key, value: storedValue, updatedBy: actorId },
			});
		})
	);
	rememberSaved(entries.map(({ key, value }) => ({ key, value: isRuntimeSettingKey(key) ? normalizeRuntimeSettingValue(key, value) : value })));
}

/**
 * Check whether a key is in the whitelist of allowed setting keys.
 */
export function isValidSettingKey(key: string): boolean {
	return VALID_SETTING_KEYS.includes(key);
}
