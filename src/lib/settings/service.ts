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
	...Object.fromEntries(
		Object.entries(RUNTIME_SETTING_DEFINITIONS).map(([key, definition]) => [key, String(definition.defaultValue)])
	),
};

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
