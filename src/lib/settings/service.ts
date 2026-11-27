import { lockSettingBindings, relatedSettingKeys, validateSettingBindings, publicOffsiteEndpoint } from "./bindings";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { getAppName } from "@/lib/branding";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { prisma } from "@/lib/db";
import {
	VALID_SETTING_KEYS, SETTING_VALUE_SCHEMAS, type SettingKey,
	isSensitiveKey,
	MASKED_VALUE,
} from "@/lib/settings/schema";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";
import { RUNTIME_SETTING_DEFINITIONS, isRuntimeSettingKey, normalizeRuntimeSettingValue } from "@/lib/runtime-settings/service";
import { rememberRuntimeSettingNumber } from "@/lib/runtime-settings/cached";
import { invalidatePlatformDefaults } from "@/lib/settings/platform-defaults";
import { invalidateCachedFlags } from "@/lib/settings/cached-flags";

/* ── Safe decrypt helper ──────────────────────────────────── */
/**
 * What `encrypt("")` used to store for a secret left empty: salt:iv:tag with nothing after the last colon.
 * It reads back as an unset secret; otherwise it was handed out as a 75-character "password", shown on the
 * settings page as a configured "***", and sent to SMTP/Telegram/S3/Turnstile as if it were one.
 */
const LEGACY_EMPTY_SECRET = /^[^:]+:[^:]+:[^:]+:$/;

export function decodeStoredSecret(value: string): string {
	if (LEGACY_EMPTY_SECRET.test(value)) return "";
	return isEncrypted(value) ? decrypt(value) : value;
}

export function readStoredSecret(value: string): string {
	try {
		return decodeStoredSecret(value);
	} catch {
		return value;
	}
}

/* ── Default settings ─────────────────────────────────────── */
const DEFAULTS: Record<string, string> = {
	"platform.name": getAppName(),
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
	"smtp.requireTls": "false",
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
	// RDP frames that change often as WebP (env RDP_WEBP_IMAGES is the fallback); see rdp/features.
	"rdp.webpImages": "",
	// Cloudflare Turnstile on the login form: on when both are set (see auth/turnstile).
	"security.turnstileSiteKey": "",
	"security.turnstileSecretKey": "",
	// Sync login to target servers that follow the platform setting: the way it always worked unless changed.
	"sync.targetAuthDefault": "credential",
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
	return isSensitiveKey(key) ? readStoredSecret(raw) : raw;
}

export async function getAllSettings(): Promise<Record<string, string>> {
	const rows = await prisma.setting.findMany({ where: { key: { in: VALID_SETTING_KEYS } }, select: { key: true, value: true } });
	const result: Record<string, string> = { ...DEFAULTS };
	for (const row of rows) {
		result[row.key] = isSensitiveKey(row.key) ? readStoredSecret(row.value) : row.value;
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
	const writerIds = [...new Set(settings.map((setting) => setting.updatedBy).filter((id): id is string => Boolean(id)))];
	const writers = writerIds.length > 0
		? await prisma.user.findMany({
			where: { id: { in: writerIds } },
			select: { id: true, username: true, displayName: true },
		})
		: [];
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
	if (masked["offsite.endpoint"]) masked["offsite.endpoint"] = publicOffsiteEndpoint(masked["offsite.endpoint"]);
	return masked;
}

/** `actorId`: the user making the change (null for system writes). */
/** A secret is stored encrypted; an empty one is stored empty (it means "not set"). */
export function toStoredValue(key: string, value: string): string {
	return isSensitiveKey(key) && value !== "" ? encrypt(value) : value;
}

export function normalizeStoredSetting(key: string, value: string): string {
	if (isRuntimeSettingKey(key)) return normalizeRuntimeSettingValue(key, value);
	const schema = Object.hasOwn(SETTING_VALUE_SCHEMAS, key) ? SETTING_VALUE_SCHEMAS[key as SettingKey] : undefined;
	if (!schema) return value;
	const result = schema.safeParse(value);
	if (!result.success) throw new ValidationError(t("backend.settings.invalidValue", { key }), { field: key, reason: "backend.settings.invalidValue" });
	return result.data;
}

const AI_OPS_BINDING_SETTING_KEYS = new Set(["ai.ops.mode", "ai.ops.provider", "ai.ops.providerBinding"]);

export async function setSetting(key: string, value: string, actorId: string | null = null): Promise<void> {
	if (relatedSettingKeys([key]).size || AI_OPS_BINDING_SETTING_KEYS.has(key)) return setManySettings([{ key, value }], actorId);
	const normalizedValue = normalizeStoredSetting(key, value);
	const storedValue = toStoredValue(key, normalizedValue);
	await prisma.setting.upsert({
		where: { key },
		update: { value: storedValue, updatedBy: actorId },
		create: { key, value: storedValue, updatedBy: actorId },
	});
	rememberSaved([{ key, value: normalizedValue }]);
}

/** Keep this process's sync caches in step with what was just written. */
export function rememberSaved(entries: Array<{ key: string; value: string }>) {
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
	const normalized = entries.map(({ key, value }) => ({ key, value: normalizeStoredSetting(key, value) }));
	const related = relatedSettingKeys(normalized.map((row) => row.key));
	const touchesAiOps = normalized.some((row) => AI_OPS_BINDING_SETTING_KEYS.has(row.key));
	await prisma.$transaction(async (tx) => {
		if (touchesAiOps) {
			await lockForTransaction(tx, "ai-ops-settings", "global");
		}
		if (related.size) {
			await lockSettingBindings(tx);
			const rows = await tx.setting.findMany({ where: { key: { in: [...related] } }, select: { key: true, value: true } });
			validateSettingBindings(new Map(rows.map((r) => [r.key, r.value])), new Map(normalized.map((r) => [r.key, r.value])), readStoredSecret);
		}
		for (const { key, value } of normalized) {
			const stored = { value: toStoredValue(key, value), updatedBy: actorId };
			await tx.setting.upsert({ where: { key }, create: { key, ...stored }, update: stored });
		}
	});
	rememberSaved(normalized);
}

/**
 * Check whether a key is in the whitelist of allowed setting keys.
 */
export function isValidSettingKey(key: string): boolean {
	return VALID_SETTING_KEYS.includes(key);
}
