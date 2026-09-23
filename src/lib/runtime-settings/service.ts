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
    applies: "Requires SSH WebSocket service restart to take effect; 0 means never (forced keepalive)",
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

function readPositiveEnvNumber(envName: string, fallback: number): number {
  const raw = Number(process.env[envName]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
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
  const raw = readPositiveEnvNumber(definition.env, definition.defaultValue);
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
  const envValue = process.env[definition.env];
  const fallback = getRuntimeSettingFallback(key);
  let source: RuntimeSettingSource = envValue && Number.isFinite(Number(envValue)) && Number(envValue) > 0 ? "environment" : "default";
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
  };
}

export async function getOperationTaskListLimit(): Promise<number> {
  return getRuntimeSettingNumber("runtime.operationTaskListLimit");
}

export async function getAiProviderListLimit(): Promise<number> {
  return getRuntimeSettingNumber("runtime.aiProviderListLimit");
}

export async function getAiConversationListLimit(): Promise<number> {
  return getRuntimeSettingNumber("runtime.aiConversationListLimit");
}
