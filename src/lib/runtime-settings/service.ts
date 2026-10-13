import { apiCopy } from "@/lib/i18n/api-copy";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";

export const RUNTIME_SETTING_DEFINITIONS = {
  "runtime.commandExecutionTimeoutMs": {
    env: "COMMAND_EXECUTION_TIMEOUT_MS",
    defaultValue: 5 * 60 * 1000,
    min: 5_000,
    max: 60 * 60 * 1000,
    label: "Command execution timeout",
    unit: "ms",
    applies: "Takes effect immediately for newly started command targets",
  },
  "runtime.commandOutputLimitBytes": {
    env: "COMMAND_OUTPUT_LIMIT_BYTES",
    defaultValue: 256 * 1024,
    min: 4 * 1024,
    max: 10 * 1024 * 1024,
    label: "Command output retention limit",
    unit: "bytes",
    applies: "Takes effect immediately for newly started command targets",
  },
  "runtime.commandStaleRunningAfterMs": {
    env: "COMMAND_STALE_RUNNING_AFTER_MS",
    defaultValue: 10 * 60 * 1000,
    min: 30_000,
    max: 24 * 60 * 60 * 1000,
    label: "Command stuck detection time",
    unit: "ms",
    applies: "Takes effect immediately for the next command maintenance scan",
  },
  "runtime.commandExecutionHeartbeatMs": {
    env: "COMMAND_EXECUTION_HEARTBEAT_MS",
    defaultValue: 60_000,
    min: 5_000,
    max: 10 * 60 * 1000,
    label: "Command execution heartbeat interval",
    unit: "ms",
    applies: "Takes effect immediately for newly started background command executions",
  },
  "runtime.commandReconcileIntervalMs": {
    env: "COMMAND_RECONCILE_INTERVAL_MS",
    defaultValue: 60_000,
    min: 5_000,
    max: 60 * 60 * 1000,
    label: "Command maintenance scan interval",
    unit: "ms",
    applies: "Requires service restart to reschedule the background scan timer",
  },
  "runtime.sftpSyncDirectoryTimeoutMs": {
    env: "SFTP_SYNC_DIRECTORY_TIMEOUT_MS",
    defaultValue: 60_000,
    min: 5_000,
    max: 30 * 60 * 1000,
    label: "SFTP single directory sync timeout",
    unit: "ms",
    applies: "Takes effect immediately for newly started SFTP syncs",
  },
  "runtime.sshWsHeartbeatIntervalMs": {
    env: "SSH_WS_HEARTBEAT_INTERVAL_MS",
    defaultValue: 25_000,
    min: 5_000,
    max: 10 * 60 * 1000,
    label: "SSH terminal WebSocket heartbeat interval",
    unit: "ms",
    applies: "Requires SSH WebSocket service restart to take effect",
  },
  "runtime.sshKeepaliveIntervalMs": {
    env: "SSH_KEEPALIVE_INTERVAL_MS",
    defaultValue: 30_000,
    min: 5_000,
    max: 10 * 60 * 1000,
    label: "SSH keepalive interval",
    unit: "ms",
    applies: "Requires SSH WebSocket service restart to take effect",
  },
  "runtime.sshKeepaliveCountMax": {
    env: "SSH_KEEPALIVE_COUNT_MAX",
    defaultValue: 60,
    min: 1,
    max: 60,
    label: "SSH keepalive tolerance count",
    unit: "times",
    applies: "Requires SSH WebSocket service restart to take effect",
  },
  "runtime.sshIdleTimeoutSec": {
    env: "SSH_IDLE_TIMEOUT_SEC",
    defaultValue: 0,
    min: 0,
    max: 7200,
    label: "SSH idle timeout",
    unit: "seconds",
    applies: "Takes effect for newly opened terminals; 0 means never idle-disconnect (forced keepalive)",
  },
  "runtime.rdpIdleTimeoutSec": {
    env: "RDP_IDLE_TIMEOUT_SEC",
    defaultValue: 0,
    min: 0,
    max: 86400,
    label: "RDP idle timeout",
    unit: "seconds",
    applies: "Takes effect for newly opened RDP sessions; 0 means never (dead browsers are still detected by the transport timeout)",
  },
  "runtime.rdpMaxSessionSec": {
    env: "RDP_MAX_SESSION_SEC",
    defaultValue: 0,
    min: 0,
    max: 86400,
    label: "RDP maximum session duration",
    unit: "seconds",
    applies: "Takes effect for newly opened RDP sessions; 0 means no absolute cap",
  },
  "runtime.operationTaskListLimit": {
    env: "OPERATION_TASK_LIST_LIMIT",
    defaultValue: 100,
    min: 20,
    max: 500,
    label: "Task center list limit",
    unit: "items",
    applies: "Takes effect immediately for new task center page/API queries",
  },
  "runtime.aiProviderListLimit": {
    env: "AI_PROVIDER_LIST_LIMIT",
    defaultValue: 100,
    min: 10,
    max: 500,
    label: "AI provider list limit",
    unit: "items",
    applies: "Takes effect immediately for new AI provider page/API queries",
  },
  "runtime.aiConversationListLimit": {
    env: "AI_CONVERSATION_LIST_LIMIT",
    defaultValue: 200,
    min: 20,
    max: 1000,
    label: "AI conversation list limit",
    unit: "items",
    applies: "Takes effect immediately for new AI conversation page/API queries",
  },
  // ── Security ──────────────────────────────────────────────
  "security.loginLockoutClientFailures": {
    env: "LOGIN_LOCKOUT_CLIENT_FAILURES",
    defaultValue: 5,
    min: 3,
    max: 50,
    label: "Failed logins before a client address is locked",
    unit: "attempts",
    applies: "Takes effect immediately for the next failed login",
  },
  "security.loginLockoutAccountFailures": {
    env: "LOGIN_LOCKOUT_ACCOUNT_FAILURES",
    defaultValue: 25,
    min: 5,
    max: 500,
    label: "Failed logins before an account is locked for every address",
    unit: "attempts",
    applies: "Takes effect immediately for the next failed login",
  },
  "security.loginLockoutMinutes": {
    env: "LOGIN_LOCKOUT_MINUTES",
    defaultValue: 15,
    min: 1,
    max: 1440,
    label: "Login lockout duration",
    unit: "minutes",
    applies: "Takes effect immediately for the next lockout",
  },
  "security.rememberSessionTtlSeconds": {
    env: "AUTH_REMEMBER_SESSION_TTL_SECONDS",
    defaultValue: 30 * 24 * 60 * 60,
    min: 3600,
    max: 365 * 24 * 60 * 60,
    label: "\"Remember me\" session lifetime",
    unit: "seconds",
    applies: "Takes effect for new logins",
  },
  // ── Storage ───────────────────────────────────────────────
  "storage.uploadMaxBytes": {
    env: "STORAGE_UPLOAD_MAX_BYTES",
    defaultValue: 2 * 1024 * 1024 * 1024,
    min: 1024 * 1024,
    max: 1024 * 1024 * 1024 * 1024,
    label: "Largest storage upload",
    unit: "bytes",
    applies: "Takes effect for new uploads within a minute",
  },
  "storage.fileVersionKeep": {
    env: "FILE_VERSION_KEEP",
    defaultValue: 20,
    min: 1,
    max: 200,
    label: "File versions kept per file",
    unit: "versions",
    applies: "Takes effect at the next version snapshot",
  },
  "storage.fileVersionMaxBytes": {
    env: "FILE_VERSION_MAX_BYTES",
    defaultValue: 50 * 1024 * 1024,
    min: 1024 * 1024,
    max: 1024 * 1024 * 1024,
    label: "Largest file body kept as a version",
    unit: "bytes",
    applies: "Takes effect at the next version snapshot",
  },
  "storage.contentSearchMaxFileBytes": {
    env: "CONTENT_SEARCH_MAX_FILE_BYTES",
    defaultValue: 1024 * 1024,
    min: 64 * 1024,
    max: 64 * 1024 * 1024,
    label: "Largest file scanned by content search",
    unit: "bytes",
    applies: "Takes effect for new searches within a minute",
  },
  // ── Jobs and operations ───────────────────────────────────
  "jobs.defaultMaxAttempts": {
    env: "JOB_DEFAULT_MAX_ATTEMPTS",
    defaultValue: 3,
    min: 1,
    max: 10,
    label: "Default attempts per background job",
    unit: "attempts",
    applies: "Takes effect for newly enqueued jobs within a minute",
  },
  "quickService.healthGateTimeoutMs": {
    env: "QUICK_SERVICE_HEALTH_TIMEOUT_MS",
    defaultValue: 90_000,
    min: 10_000,
    max: 600_000,
    label: "Quick-service start acceptance timeout",
    unit: "ms",
    applies: "Takes effect for the next install or update within a minute",
  },
  // ── Alerts ────────────────────────────────────────────────
  "alerts.defaultEscalationMinutes": {
    env: "ALERT_DEFAULT_ESCALATION_MINUTES",
    defaultValue: 30,
    min: 1,
    max: 1440,
    label: "Escalation delay for rules without their own",
    unit: "minutes",
    applies: "Takes effect at the next alert evaluation",
  },
  "alerts.notifyMaxAttempts": {
    env: "ALERT_NOTIFY_MAX_ATTEMPTS",
    defaultValue: 8,
    min: 1,
    max: 20,
    label: "Delivery attempts per alert notice",
    unit: "attempts",
    applies: "Takes effect at the next alert evaluation",
  },
  // ── Monitoring ────────────────────────────────────────────
  "monitoring.healthSampleIntervalMinutes": {
    env: "HEALTH_SAMPLE_INTERVAL_MINUTES",
    defaultValue: 5,
    min: 1,
    max: 60,
    label: "Metric sampling interval",
    unit: "minutes",
    applies: "Requires service restart to reschedule the sampling timer",
  },
  "monitoring.capacityWindowHours": {
    env: "CAPACITY_WINDOW_HOURS",
    defaultValue: 168,
    min: 24,
    max: 720,
    label: "Capacity forecast history window",
    unit: "hours",
    applies: "Takes effect for the next forecast",
  },
  "monitoring.capacityHorizonDays": {
    env: "CAPACITY_HORIZON_DAYS",
    defaultValue: 14,
    min: 1,
    max: 90,
    label: "Capacity forecast horizon",
    unit: "days",
    applies: "Takes effect for the next forecast",
  },
  // ── Data retention ────────────────────────────────────────
  "retention.auditLogDays": {
    env: "AUDIT_RETENTION_DAYS",
    defaultValue: 365,
    min: 0,
    max: 3650,
    label: "Audit log retention",
    unit: "days",
    applies: "Takes effect at the next maintenance sweep; 0 keeps every row",
  },
  "retention.healthSamplesDays": {
    env: "HEALTH_SAMPLE_RETENTION_DAYS",
    defaultValue: 30,
    min: 1,
    max: 365,
    label: "Metric sample retention",
    unit: "days",
    applies: "Takes effect at the next sampling run",
  },
  "retention.trafficSnapshotsDays": {
    env: "TRAFFIC_SNAPSHOT_RETENTION_DAYS",
    defaultValue: 14,
    min: 1,
    max: 365,
    label: "Traffic snapshot retention",
    unit: "days",
    applies: "Takes effect at the next traffic sampling run",
  },
  "retention.terminalJobsDays": {
    env: "JOB_TERMINAL_RETENTION_DAYS",
    defaultValue: 30,
    min: 1,
    max: 365,
    label: "Failed and cancelled job retention",
    unit: "days",
    applies: "Takes effect at the next maintenance sweep",
  },
  // ── AI ────────────────────────────────────────────────────
  "ai.knowledgeMaxResults": {
    env: "AI_KNOWLEDGE_MAX_RESULTS",
    defaultValue: 8,
    min: 1,
    max: 20,
    label: "Knowledge excerpts per answer",
    unit: "items",
    applies: "Takes effect for the next question",
  },
} as const;

import type { RuntimeSettingSummaryDto } from "./dto";

export type RuntimeSettingKey = keyof typeof RUNTIME_SETTING_DEFINITIONS;

export type RuntimeSettingSource = "database" | "environment" | "default" | "invalid-database";

/**
 * TR-039: the wire shape of a runtime setting now lives in ./dto so the
 * settings client can read it without pulling the service module's
 * server-only deps. The exported `RuntimeSettingSummary` here is just an
 * alias of that DTO — same type, kept under its original name for
 * call-site compatibility.
 */
export type RuntimeSettingSummary = RuntimeSettingSummaryDto;

export function isRuntimeSettingKey(key: string): key is RuntimeSettingKey {
  return Object.prototype.hasOwnProperty.call(RUNTIME_SETTING_DEFINITIONS, key);
}

export function normalizeRuntimeSettingValue(key: RuntimeSettingKey, value: string | number | undefined | null): string {
  const definition = RUNTIME_SETTING_DEFINITIONS[key];
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(apiCopy("apiCopy.must.be.a.number.ab7c6a3d", { v0: String(definition.label) }));
  }
  const integer = Math.trunc(parsed);
  if (integer < definition.min || integer > definition.max) {
    throw new ValidationError(apiCopy("apiCopy.must.be.between.and.a3120c5a", { v0: String(definition.label), v1: String(definition.min), v2: String(definition.max), v3: String(definition.unit) }));
  }
  return String(integer);
}

/**
 * An env override counts when it is a positive number (it is clamped to the
 * key's range afterwards, like a persisted value); 0 counts only for keys
 * whose minimum is 0, such as "0 keeps every row".
 */
function envNumberOverride(envName: string, min: number): number | null {
  const envValue = process.env[envName];
  if (envValue === undefined || envValue.trim() === "") return null;
  const raw = Number(envValue);
  if (!Number.isFinite(raw)) return null;
  return raw > 0 || (raw === 0 && min === 0) ? raw : null;
}

function readEnvNumber(envName: string, fallback: number, min: number): number {
  return envNumberOverride(envName, min) ?? fallback;
}

function hasEnvOverride(envName: string, min: number): boolean {
  return envNumberOverride(envName, min) !== null;
}

/**
 * The persisted number for a key, or null when no row exists or it is not a
 * number. Callers that cannot await (see ./cached) use it to tell "database
 * value" from "fall back to env/default at call time".
 */
export async function readPersistedRuntimeSettingNumber(key: RuntimeSettingKey): Promise<number | null> {
  try {
    const settingDelegate = (prisma as unknown as { setting?: RuntimeSettingDelegate }).setting;
    if (!settingDelegate?.findUnique) return null;
    const row = await settingDelegate.findUnique({ where: { key }, select: { value: true } });
    if (!row?.value) return null;
    return Number(normalizeRuntimeSettingValue(key, row.value));
  } catch {
    return null;
  }
}

function runtimeSettingSourceLabel(source: RuntimeSettingSource) {
  switch (source) {
    case "database":
      return "Database setting";
    case "environment":
      return "Environment variable";
    case "invalid-database":
      return "Database value invalid, fell back";
    default:
      return "System default";
  }
}

function runtimeSettingRequiresRestart(applies: string) {
  return applies.includes("Requires");
}

export function getRuntimeSettingFallback(key: RuntimeSettingKey): number {
  const definition = RUNTIME_SETTING_DEFINITIONS[key];
  const raw = readEnvNumber(definition.env, definition.defaultValue, definition.min);
  // Apply the same truncation and range check the database path gets from
  // `normalizeRuntimeSettingValue`. An env override was previously accepted
  // verbatim as long as it was positive, so `AI_PROVIDER_LIST_LIMIT=50.5`
  // reached a Prisma `take` (which rejects a fractional row count) and a value
  // above `definition.max` bypassed the limit the settings UI enforces.
  // Every definition's `defaultValue` is inside its own range, so this is a
  // no-op when no env override is set.
  return Math.min(Math.max(Math.trunc(raw), definition.min), definition.max);
}

function resolveRuntimeSettingSummary(key: RuntimeSettingKey, persistedValue?: string | null): RuntimeSettingSummary {
  const definition = RUNTIME_SETTING_DEFINITIONS[key];
  const fallback = getRuntimeSettingFallback(key);
  let source: RuntimeSettingSource = hasEnvOverride(definition.env, definition.min) ? "environment" : "default";
  let value = fallback;

  if (persistedValue) {
    try {
      value = Number(normalizeRuntimeSettingValue(key, persistedValue));
      source = "database";
    } catch {
      // Persisted value is not parseable as a number — fall back to the default.
      value = fallback;
      source = "invalid-database";
    }
  }

  return {
    key,
    label: definition.label,
    unit: definition.unit,
    env: definition.env,
    value,
    defaultValue: definition.defaultValue,
    min: definition.min,
    max: definition.max,
    source,
    sourceLabel: runtimeSettingSourceLabel(source),
    applies: definition.applies,
    requiresRestart: runtimeSettingRequiresRestart(definition.applies),
  };
}

export async function getRuntimeSettingSummaries(): Promise<RuntimeSettingSummary[]> {
  const keys = Object.keys(RUNTIME_SETTING_DEFINITIONS) as RuntimeSettingKey[];
  const rows = await prisma.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
    take: 500, // P2: keys 已外部限,500 作 hard 上界
  });
  const rowMap = new Map(rows.map((row) => [row.key, row.value]));
  return keys.map((key) => resolveRuntimeSettingSummary(key, rowMap.get(key)));
}

type RuntimeSettingDelegate = {
  findUnique?: (args: { where: { key: string }; select: { value: true } }) => Promise<{ value: string | null } | null>;
  findMany?: (args: {
    where: { key: { in: string[] } };
    select: { key: true; value: true };
  }) => Promise<Array<{ key: string; value: string | null }> | null | undefined>;
};

export async function getRuntimeSettingNumber(key: RuntimeSettingKey): Promise<number> {
  const fallback = getRuntimeSettingFallback(key);
  try {
    const settingDelegate = (prisma as unknown as { setting?: RuntimeSettingDelegate }).setting;
    if (!settingDelegate?.findUnique) return fallback;
    const row = await settingDelegate.findUnique({ where: { key }, select: { value: true } });
    if (!row?.value) return fallback;
    return Number(normalizeRuntimeSettingValue(key, row.value));
  } catch {
    return fallback;
  }
}

/**
 * Read several settings in ONE query.
 *
 * `getCommandRuntimeConfig` used to be four sequential round-trips, and it runs
 * on every command execution and once per row of the operation-task list —
 * the cheapest win in the whole runtime-settings layer. Returns null when the
 * batch read is unavailable so callers keep the per-key behaviour.
 */
async function readRuntimeSettingValues(
  keys: readonly RuntimeSettingKey[],
): Promise<Map<string, string> | null> {
  try {
    const settingDelegate = (prisma as unknown as { setting?: RuntimeSettingDelegate }).setting;
    if (!settingDelegate?.findMany) return null;
    const rows = await settingDelegate.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, value: true },
    });
    if (!Array.isArray(rows)) return null;
    const values = new Map<string, string>();
    for (const row of rows) {
      if (row?.key && row.value) values.set(row.key, row.value);
    }
    return values;
  } catch {
    return null;
  }
}

function runtimeSettingNumberFrom(key: RuntimeSettingKey, raw: string | undefined): number {
  if (!raw) return getRuntimeSettingFallback(key);
  try {
    const parsed = Number(normalizeRuntimeSettingValue(key, raw));
    return Number.isFinite(parsed) ? parsed : getRuntimeSettingFallback(key);
  } catch {
    return getRuntimeSettingFallback(key);
  }
}

/** Batch read of N runtime settings, falling back per key when unavailable. */
export async function getRuntimeSettingNumbers(
  keys: readonly RuntimeSettingKey[],
): Promise<Record<RuntimeSettingKey, number>> {
  const resolved = {} as Record<RuntimeSettingKey, number>;
  const values = await readRuntimeSettingValues(keys);
  if (!values) {
    await Promise.all(
      keys.map(async (key) => {
        resolved[key] = await getRuntimeSettingNumber(key);
      }),
    );
    return resolved;
  }
  for (const key of keys) {
    resolved[key] = runtimeSettingNumberFrom(key, values.get(key));
  }
  return resolved;
}

export async function getCommandRuntimeConfig() {
  const values = await getRuntimeSettingNumbers([
    "runtime.commandExecutionTimeoutMs",
    "runtime.commandOutputLimitBytes",
    "runtime.commandStaleRunningAfterMs",
    "runtime.commandExecutionHeartbeatMs",
  ]);
  return {
    executionTimeoutMs: values["runtime.commandExecutionTimeoutMs"],
    outputLimitBytes: values["runtime.commandOutputLimitBytes"],
    staleRunningAfterMs: values["runtime.commandStaleRunningAfterMs"],
    executionHeartbeatMs: values["runtime.commandExecutionHeartbeatMs"],
  };
}

export async function getSftpSyncDirectoryTimeoutMs(): Promise<number> {
  return getRuntimeSettingNumber("runtime.sftpSyncDirectoryTimeoutMs");
}

export async function getSshTerminalRuntimeConfig() {
  const values = await getRuntimeSettingNumbers([
    "runtime.sshWsHeartbeatIntervalMs",
    "runtime.sshIdleTimeoutSec",
  ]);
  const wsHeartbeatIntervalMs = values["runtime.sshWsHeartbeatIntervalMs"];
  const sshIdleTimeoutSec = values["runtime.sshIdleTimeoutSec"];
  // SSH 空闲超时 0 = 永不(强保活, 60 次容忍 ≈ 30 分钟); 其它值按 30s 间隔计算容忍次数, 最多 60 次。
  // interval 固定 30s, 避免误改既有行为。
  const SSH_KEEPALIVE_INTERVAL_MS = 30_000;
  const SSH_KEEPALIVE_COUNT_MAX_CAP = 60;
  const sshKeepaliveCountMax = sshIdleTimeoutSec === 0
    ? SSH_KEEPALIVE_COUNT_MAX_CAP
    : Math.min(
        SSH_KEEPALIVE_COUNT_MAX_CAP,
        Math.max(1, Math.ceil(sshIdleTimeoutSec * 1000 / SSH_KEEPALIVE_INTERVAL_MS)),
      );
  return {
    wsHeartbeatIntervalMs,
    sshKeepaliveIntervalMs: SSH_KEEPALIVE_INTERVAL_MS,
    sshKeepaliveCountMax,
    // Drives the live-but-idle terminal reaper in ssh-ws-proxy: 0 = never reap
    // (the settings-page contract), > 0 = reap after this long without traffic
    // in either direction.
    sshIdleTimeoutMs: sshIdleTimeoutSec > 0 ? sshIdleTimeoutSec * 1000 : 0,
  };
}

export async function getOperationTaskListLimit(): Promise<number> {
  return getRuntimeSettingNumber("runtime.operationTaskListLimit");
}

/**
 * RDP session limits, managed by the same runtime settings as SSH timeouts
 * so both remote channels share one policy surface. Zero disables a limit —
 * the default keeps a healthy RDP session alive as long as its browser,
 * matching the SSH idle semantics.
 */
export async function getRdpSessionRuntimeConfig() {
  const values = await getRuntimeSettingNumbers([
    "runtime.rdpIdleTimeoutSec",
    "runtime.rdpMaxSessionSec",
  ]);
  return {
    idleTimeoutMs: values["runtime.rdpIdleTimeoutSec"] * 1000,
    maxSessionMs: values["runtime.rdpMaxSessionSec"] * 1000,
  };
}

export async function getAiProviderListLimit(): Promise<number> {
  return getRuntimeSettingNumber("runtime.aiProviderListLimit");
}

export async function getAiConversationListLimit(): Promise<number> {
  return getRuntimeSettingNumber("runtime.aiConversationListLimit");
}
