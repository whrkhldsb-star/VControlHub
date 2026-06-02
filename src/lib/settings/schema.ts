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
	z.literal("smtp.enabled"),
	z.literal("runtime.commandExecutionTimeoutMs"),
	z.literal("runtime.commandOutputLimitBytes"),
	z.literal("runtime.commandStaleRunningAfterMs"),
	z.literal("runtime.commandExecutionHeartbeatMs"),
	z.literal("runtime.commandReconcileIntervalMs"),
	z.literal("runtime.sftpSyncDirectoryTimeoutMs"),
	z.literal("runtime.sshWsHeartbeatIntervalMs"),
	z.literal("runtime.sshKeepaliveIntervalMs"),
	z.literal("runtime.sshKeepaliveCountMax"),
	z.literal("runtime.operationTaskListLimit"),
	z.literal("runtime.aiProviderListLimit"),
	z.literal("runtime.aiConversationListLimit"),
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
	"smtp.enabled",
	"runtime.commandExecutionTimeoutMs",
	"runtime.commandOutputLimitBytes",
	"runtime.commandStaleRunningAfterMs",
	"runtime.commandExecutionHeartbeatMs",
	"runtime.commandReconcileIntervalMs",
	"runtime.sftpSyncDirectoryTimeoutMs",
	"runtime.sshWsHeartbeatIntervalMs",
	"runtime.sshKeepaliveIntervalMs",
	"runtime.sshKeepaliveCountMax",
	"runtime.operationTaskListLimit",
	"runtime.aiProviderListLimit",
	"runtime.aiConversationListLimit",
];

/* ── Sensitive key detection ──────────────────────────────── */

const SENSITIVE_PATTERNS = /password|secret|key|token|pass/i;

/**
 * Returns true if the key likely holds a sensitive value
 * that should be masked in API responses.
 */
export function isSensitiveKey(key: string): boolean {
	return SENSITIVE_PATTERNS.test(key);
}

/* ── Sentinel value ───────────────────────────────────────── */

/** Placeholder returned for sensitive values in GET responses */
export const MASKED_VALUE = "***";
