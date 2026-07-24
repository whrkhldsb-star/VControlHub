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
	z.literal("runtime.commandExecutionTimeoutMs"),
	z.literal("runtime.commandOutputLimitBytes"),
	z.literal("runtime.commandStaleRunningAfterMs"),
	z.literal("runtime.commandExecutionHeartbeatMs"),
	z.literal("runtime.commandReconcileIntervalMs"),
	z.literal("runtime.sftpSyncDirectoryTimeoutMs"),
	z.literal("runtime.sshWsHeartbeatIntervalMs"),
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
	"runtime.commandExecutionTimeoutMs",
	"runtime.commandOutputLimitBytes",
	"runtime.commandStaleRunningAfterMs",
	"runtime.commandExecutionHeartbeatMs",
	"runtime.commandReconcileIntervalMs",
	"runtime.sftpSyncDirectoryTimeoutMs",
	"runtime.sshWsHeartbeatIntervalMs",
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
];

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
	// Nested secret fields like *.secretAccessKey / *.botToken already covered by leaf.
	return false;
}

/* ── Sentinel value ───────────────────────────────────────── */

/** Placeholder returned for sensitive values in GET responses */
export const MASKED_VALUE = "***";
