import { prisma } from "@/lib/db";
import {
	VALID_SETTING_KEYS,
	isSensitiveKey,
	MASKED_VALUE,
} from "@/lib/settings/schema";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";
import { RUNTIME_SETTING_DEFINITIONS, isRuntimeSettingKey, normalizeRuntimeSettingValue } from "@/lib/runtime-settings/service";

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
	"platform.name": "VPS 统一管控平台",
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
	const rows = await prisma.setting.findMany({ select: { key: true, value: true } });
	const result: Record<string, string> = { ...DEFAULTS };
	for (const row of rows) {
		result[row.key] = isSensitiveKey(row.key) ? safeDecrypt(row.value) : row.value;
	}
	return result;
}

export async function getSettingUpdateMetadata(keys: string[]): Promise<Record<string, SettingUpdateMetadata>> {
	const uniqueKeys = [...new Set(keys)];
	const result = Object.fromEntries(
		uniqueKeys.map((key) => [key, { updatedAt: null, actorId: null, actorName: null }])
	) as Record<string, SettingUpdateMetadata>;

	if (uniqueKeys.length === 0) return result;

	const [settings, auditLogs] = await Promise.all([
		prisma.setting.findMany({
			where: { key: { in: uniqueKeys } },
			select: { key: true, updatedAt: true },
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

	for (const log of auditLogs) {
		for (const key of auditKeys(log.detail)) {
			if (!result[key] || result[key].actorName) continue;
			result[key] = {
				updatedAt: log.createdAt,
				actorId: log.actorId,
				actorName: log.actor?.displayName || log.actor?.username || log.actorId || "未知用户",
			};
		}
	}

	return result;
}

/**
 * Return all settings with sensitive values masked.
 * Keys containing password/secret/key/token/pass will have
 * their values replaced with '***'.
 */
export async function getAllSettingsMasked(): Promise<Record<string, string>> {
	const settings = await getAllSettings();
	const masked: Record<string, string> = {};
	for (const [key, value] of Object.entries(settings)) {
		masked[key] = isSensitiveKey(key) ? MASKED_VALUE : value;
	}
	return masked;
}

export async function setSetting(key: string, value: string): Promise<void> {
	const normalizedValue = isRuntimeSettingKey(key) ? normalizeRuntimeSettingValue(key, value) : value;
	const storedValue = isSensitiveKey(key) ? encrypt(normalizedValue) : normalizedValue;
	await prisma.setting.upsert({
		where: { key },
		update: { value: storedValue },
		create: { key, value: storedValue },
	});
}

export async function setManySettings(
	entries: Array<{ key: string; value: string }>
): Promise<void> {
	await prisma.$transaction(
		entries.map(({ key, value }) => {
			const normalizedValue = isRuntimeSettingKey(key) ? normalizeRuntimeSettingValue(key, value) : value;
			const storedValue = isSensitiveKey(key) ? encrypt(normalizedValue) : normalizedValue;
			return prisma.setting.upsert({
				where: { key },
				update: { value: storedValue },
				create: { key, value: storedValue },
			});
		})
	);
}

/**
 * Check whether a key is in the whitelist of allowed setting keys.
 */
export function isValidSettingKey(key: string): boolean {
	return VALID_SETTING_KEYS.includes(key);
}
