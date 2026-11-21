import { z } from "zod";

/* ── Allowed setting keys (whitelist) ─────────────────────── */

export const SettingKey = z.union([
	z.literal("platform.name"),
	z.literal("platform.logo"),
	z.literal("session.timeout"),
	z.literal("password.minLength"),
	z.literal("password.requireUppercase"),
	z.literal("password.requireNumber"),
	z.literal("password.requireSpecial"),
	z.literal("smtp.host"),
	z.literal("smtp.port"),
	z.literal("smtp.user"),
	z.literal("smtp.pass"),
	z.literal("smtp.from"),
	z.literal("smtp.alertRecipients"),
	z.literal("smtp.enabled"),
	z.literal("smtp.requireTls"),
	z.literal("runtime.commandExecutionTimeoutMs"),
	z.literal("runtime.commandOutputLimitBytes"),
	z.literal("runtime.commandStaleRunningAfterMs"),
	z.literal("runtime.commandExecutionHeartbeatMs"),
	z.literal("runtime.commandReconcileIntervalMs"),
	z.literal("runtime.sftpSyncDirectoryTimeoutMs"),
	z.literal("runtime.sshWsHeartbeatIntervalMs"),
	z.literal("runtime.sshKeepaliveIntervalMs"),
	z.literal("runtime.sshKeepaliveCountMax"),
	z.literal("runtime.rdpIdleTimeoutSec"),
	z.literal("runtime.rdpMaxSessionSec"),
	z.literal("runtime.sshIdleTimeoutSec"),
	z.literal("runtime.operationTaskListLimit"),
	z.literal("runtime.aiProviderListLimit"),
	z.literal("runtime.aiConversationListLimit"),
	// TR-020 M02: 仪表盘拖拽重排总开关 (默认 true, admin 可关)
	z.literal("dashboard.layout.dragReorderEnabled"),
	// TR-007 M03: 异地备份 (S3-compatible, 默认关闭)
	z.literal("offsite.enabled"),
	z.literal("offsite.provider"),
	z.literal("offsite.endpoint"),
	z.literal("offsite.region"),
	z.literal("offsite.bucket"),
	z.literal("offsite.accessKeyId"),
	z.literal("offsite.secretAccessKey"),
	z.literal("offsite.pathPrefix"),
	z.literal("offsite.dailyWindowHour"),
	z.literal("offsite.retentionDays"),
	z.literal("offsite.failureAlertRecipient"),
	// TR-009 55a: 上传前是否先 gzip 压缩 (默认 true, offsite upload pipeline)
	z.literal("offsite.compress"),
	// TR-032 E02: 智能 AI 运维 (ai.ops.mode 默认 recommendation, admin 可切 autonomous; ai.ops.provider 留口对接真实 AI 提供方)
	z.literal("ai.ops.mode"),
	z.literal("ai.ops.provider"),
	// TR-009 55d: Telegram Bot 告警渠道 (Bot Token 由 user 自建, Chat ID 可逗号/分号/换行分隔多目标)
	z.literal("telegram.enabled"),
	z.literal("telegram.botToken"),
	z.literal("telegram.chatId"),
	// 2026-10: platform defaults, security policy, storage, jobs, alerts, monitoring, retention and AI knobs
	z.literal("platform.defaultLocale"),
	z.literal("platform.defaultTheme"),
	z.literal("security.sshEnforceHostKeyPin"),
	z.literal("rdp.webpImages"),
	z.literal("security.turnstileSiteKey"),
	z.literal("security.turnstileSecretKey"),
	z.literal("security.loginLockoutClientFailures"),
	z.literal("security.loginLockoutAccountFailures"),
	z.literal("security.loginLockoutMinutes"),
	z.literal("security.rememberSessionTtlSeconds"),
	z.literal("storage.uploadMaxBytes"),
	z.literal("storage.fileVersionKeep"),
	z.literal("storage.fileVersionMaxBytes"),
	z.literal("storage.contentSearchMaxFileBytes"),
	z.literal("jobs.defaultMaxAttempts"),
	z.literal("quickService.healthGateTimeoutMs"),
	z.literal("alerts.defaultEscalationMinutes"),
	z.literal("alerts.notifyMaxAttempts"),
	z.literal("monitoring.healthSampleIntervalMinutes"),
	z.literal("monitoring.capacityWindowHours"),
	z.literal("monitoring.capacityHorizonDays"),
	z.literal("retention.auditLogDays"),
	z.literal("retention.healthSamplesDays"),
	z.literal("retention.trafficSnapshotsDays"),
	z.literal("retention.terminalJobsDays"),
	z.literal("ai.knowledgeMaxResults"),
	// How sync logs in to target servers that follow the platform setting (see sync/target-auth).
	z.literal("sync.targetAuthDefault"),
]);

export type SettingKey = z.infer<typeof SettingKey>;

/** All valid keys as a plain array for runtime checks */
export const VALID_SETTING_KEYS: string[] = [
	"platform.name",
	"platform.logo",
	"session.timeout",
	"password.minLength",
	"password.requireUppercase",
	"password.requireNumber",
	"password.requireSpecial",
	"smtp.host",
	"smtp.port",
	"smtp.user",
	"smtp.pass",
	"smtp.from",
	"smtp.alertRecipients",
	"smtp.enabled",
	"smtp.requireTls",
	"runtime.commandExecutionTimeoutMs",
	"runtime.commandOutputLimitBytes",
	"runtime.commandStaleRunningAfterMs",
	"runtime.commandExecutionHeartbeatMs",
	"runtime.commandReconcileIntervalMs",
	"runtime.sftpSyncDirectoryTimeoutMs",
	"runtime.sshWsHeartbeatIntervalMs",
	"runtime.sshKeepaliveIntervalMs",
	"runtime.sshKeepaliveCountMax",
	"runtime.rdpIdleTimeoutSec",
	"runtime.rdpMaxSessionSec",
	"runtime.sshIdleTimeoutSec",
	"runtime.operationTaskListLimit",
	"runtime.aiProviderListLimit",
	"runtime.aiConversationListLimit",
	// TR-020 M02: 仪表盘拖拽重排总开关
	"dashboard.layout.dragReorderEnabled",
	// TR-007 M03: 异地备份 (S3-compatible)
	"offsite.enabled",
	"offsite.provider",
	"offsite.endpoint",
	"offsite.region",
	"offsite.bucket",
	"offsite.accessKeyId",
	"offsite.secretAccessKey",
	"offsite.pathPrefix",
	"offsite.dailyWindowHour",
	"offsite.retentionDays",
	"offsite.failureAlertRecipient",
	// TR-009 55a: offsite upload pipeline 开关
	"offsite.compress",
	// TR-032 E02: 智能 AI 运维
	"ai.ops.mode",
	"ai.ops.provider",
	// TR-009 55d: Telegram Bot 告警
	"telegram.enabled",
	"telegram.botToken",
	"telegram.chatId",
	// 2026-10: platform defaults, security policy, storage, jobs, alerts, monitoring, retention and AI knobs
	"platform.defaultLocale",
	"platform.defaultTheme",
	"security.sshEnforceHostKeyPin",
	"rdp.webpImages",
	"security.turnstileSiteKey",
	"security.turnstileSecretKey",
	"security.loginLockoutClientFailures",
	"security.loginLockoutAccountFailures",
	"security.loginLockoutMinutes",
	"security.rememberSessionTtlSeconds",
	"storage.uploadMaxBytes",
	"storage.fileVersionKeep",
	"storage.fileVersionMaxBytes",
	"storage.contentSearchMaxFileBytes",
	"jobs.defaultMaxAttempts",
	"quickService.healthGateTimeoutMs",
	"alerts.defaultEscalationMinutes",
	"alerts.notifyMaxAttempts",
	"monitoring.healthSampleIntervalMinutes",
	"monitoring.capacityWindowHours",
	"monitoring.capacityHorizonDays",
	"retention.auditLogDays",
	"retention.healthSamplesDays",
	"retention.trafficSnapshotsDays",
	"retention.terminalJobsDays",
	"ai.knowledgeMaxResults",
	"sync.targetAuthDefault",
];

// Shared persistence rules for settings writes from the API and configuration
// packages. Runtime numeric settings use RUNTIME_SETTING_DEFINITIONS instead.
const bool = z.enum(["true", "false"]);
const optionalBool = z.union([z.literal(""), bool]);
function integer(min: number, max: number, empty?: string) {
	return z.string().transform((value) => Math.trunc(Number(value || empty)))
		.pipe(z.number().int().min(min).max(max)).transform(String);
}
const address = /^.+@.+\..+$/;
const separated = z.string().transform((value) => value.split(/[\n,;，；]+/).map((s) => s.trim()).filter(Boolean));
const turnstile = z.string().trim().max(200).regex(/^\S*$/);

/** Accepted by the settings form and safe to render as a site path or an HTTP image. */
export function isPlatformLogoUrl(value: string) {
	if (!value) return true;
	if (value.includes("\\") || /[\r\n\t]/.test(value)) return false;
	if (value.startsWith("/")) return !value.startsWith("//");
	try {
		const url = new URL(value);
		return /^https?:\/\//i.test(value) && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
	} catch {
		return false;
	}
}

export const SETTING_VALUE_SCHEMAS: Partial<Record<SettingKey, z.ZodType<string>>> = {
	"platform.name": z.string().trim().min(1).max(80),
	"platform.logo": z.string().trim().refine(isPlatformLogoUrl),
	"session.timeout": integer(300, 2_592_000),
	"password.minLength": integer(8, 128),
	"password.requireUppercase": bool,
	"password.requireNumber": bool,
	"password.requireSpecial": bool,
	"smtp.enabled": bool,
	"smtp.requireTls": bool,
	"smtp.port": integer(1, 65_535, "587"),
	"smtp.from": z.string().trim().refine((v) => !v || address.test(v)),
	"smtp.alertRecipients": separated.refine((v) => v.every((email) => address.test(email))).transform((v) => v.join(",")),
	"smtp.host": z.string().trim(),
	"smtp.user": z.string().trim(),
	"smtp.pass": z.string().trim(),
	"dashboard.layout.dragReorderEnabled": bool,
	"offsite.enabled": bool,
	"offsite.compress": bool,
	"offsite.provider": z.enum(["s3", "r2", "b2", "minio"]),
	"offsite.dailyWindowHour": z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(23)).transform(String),
	"offsite.retentionDays": z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(3650)).transform(String),
	"ai.ops.mode": z.enum(["recommendation", "autonomous"]),
	"ai.ops.provider": z.string().regex(/^[A-Za-z0-9._:-]{0,64}$/),
	"telegram.enabled": bool,
	"telegram.botToken": z.string().trim(),
	"telegram.chatId": separated.refine((v) => v.every((id) => /^-?\d+$|^@[A-Za-z0-9_]{4,}$/.test(id))).transform((v) => v.join(",")),
	"security.sshEnforceHostKeyPin": optionalBool,
	"rdp.webpImages": optionalBool,
	"platform.defaultLocale": z.string().trim().toLowerCase().pipe(z.enum(["", "zh", "en"])),
	"platform.defaultTheme": z.string().trim().toLowerCase().pipe(z.enum(["", "dark", "light"])),
	"security.turnstileSiteKey": turnstile,
	"security.turnstileSecretKey": turnstile,
	"sync.targetAuthDefault": z.enum(["credential", "one-time-key"]),
};

/* ── Sensitive key detection ──────────────────────────────── */

/**
 * Explicit sensitive keys (secrets / credentials). Avoid broad regex:
 * password.minLength / password.require* are policy knobs, not secrets.
 */
const SENSITIVE_KEYS = new Set([
	"smtp.pass",
	"telegram.botToken",
	"offsite.accessKeyId",
	"offsite.secretAccessKey",
	"security.turnstileSecretKey",
	"offsite.access-key-id",
]);

/**
 * Returns true if the key holds a sensitive value that should be masked
 * in API responses and encrypted at rest.
 */
export function isSensitiveKey(key: string): boolean {
	if (SENSITIVE_KEYS.has(key)) return true;
	// Community / future keys: match only dotted leaf secrets, not "password.*" policy.
	const leaf = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
	if (/^(pass|password|secret|token|apiKey|apikey|privateKey|accessKey|secretKey)$/i.test(leaf)) {
		return true;
	}
	// Older offsite versions wrote kebab-case leaves such as secret-access-key.
	return /-(?:secret|key|token|password)$/i.test(leaf);
}

/* ── Sentinel value ───────────────────────────────────────── */

/** Placeholder returned for sensitive values in GET responses */
export const MASKED_VALUE = "***";
