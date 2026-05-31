import { prisma } from "@/lib/db";

export const RUNTIME_SETTING_DEFINITIONS = {
  "runtime.commandExecutionTimeoutMs": {
    env: "COMMAND_EXECUTION_TIMEOUT_MS",
    defaultValue: 5 * 60 * 1000,
    min: 5_000,
    max: 60 * 60 * 1000,
    label: "命令执行超时",
    unit: "毫秒",
    applies: "立即生效到新启动的命令目标",
  },
  "runtime.commandOutputLimitBytes": {
    env: "COMMAND_OUTPUT_LIMIT_BYTES",
    defaultValue: 256 * 1024,
    min: 4 * 1024,
    max: 10 * 1024 * 1024,
    label: "命令输出保留上限",
    unit: "字节",
    applies: "立即生效到新启动的命令目标",
  },
  "runtime.commandStaleRunningAfterMs": {
    env: "COMMAND_STALE_RUNNING_AFTER_MS",
    defaultValue: 10 * 60 * 1000,
    min: 30_000,
    max: 24 * 60 * 60 * 1000,
    label: "命令卡死判定时间",
    unit: "毫秒",
    applies: "立即生效到下一次命令维护扫描",
  },
  "runtime.commandExecutionHeartbeatMs": {
    env: "COMMAND_EXECUTION_HEARTBEAT_MS",
    defaultValue: 60_000,
    min: 5_000,
    max: 10 * 60 * 1000,
    label: "命令执行心跳间隔",
    unit: "毫秒",
    applies: "立即生效到新启动的后台命令执行",
  },
  "runtime.commandReconcileIntervalMs": {
    env: "COMMAND_RECONCILE_INTERVAL_MS",
    defaultValue: 60_000,
    min: 5_000,
    max: 60 * 60 * 1000,
    label: "命令维护扫描间隔",
    unit: "毫秒",
    applies: "需要重启服务后重新安排后台扫描定时器",
  },
  "runtime.sftpSyncDirectoryTimeoutMs": {
    env: "SFTP_SYNC_DIRECTORY_TIMEOUT_MS",
    defaultValue: 60_000,
    min: 5_000,
    max: 30 * 60 * 1000,
    label: "SFTP 单目录同步超时",
    unit: "毫秒",
    applies: "立即生效到新启动的 SFTP 同步",
  },
  "runtime.sshWsHeartbeatIntervalMs": {
    env: "SSH_WS_HEARTBEAT_INTERVAL_MS",
    defaultValue: 25_000,
    min: 5_000,
    max: 10 * 60 * 1000,
    label: "SSH 终端 WebSocket 心跳间隔",
    unit: "毫秒",
    applies: "需要重启 SSH WebSocket 服务后生效",
  },
  "runtime.sshKeepaliveIntervalMs": {
    env: "SSH_KEEPALIVE_INTERVAL_MS",
    defaultValue: 30_000,
    min: 5_000,
    max: 10 * 60 * 1000,
    label: "SSH keepalive 间隔",
    unit: "毫秒",
    applies: "需要重启 SSH WebSocket 服务后生效",
  },
  "runtime.sshKeepaliveCountMax": {
    env: "SSH_KEEPALIVE_COUNT_MAX",
    defaultValue: 8,
    min: 1,
    max: 60,
    label: "SSH keepalive 容忍次数",
    unit: "次",
    applies: "需要重启 SSH WebSocket 服务后生效",
  },
} as const;

export type RuntimeSettingKey = keyof typeof RUNTIME_SETTING_DEFINITIONS;

export function isRuntimeSettingKey(key: string): key is RuntimeSettingKey {
  return Object.prototype.hasOwnProperty.call(RUNTIME_SETTING_DEFINITIONS, key);
}

export function normalizeRuntimeSettingValue(key: RuntimeSettingKey, value: string | number | undefined | null): string {
  const definition = RUNTIME_SETTING_DEFINITIONS[key];
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${definition.label} 必须是数字`);
  }
  const integer = Math.trunc(parsed);
  if (integer < definition.min || integer > definition.max) {
    throw new Error(`${definition.label} 必须在 ${definition.min} 到 ${definition.max} ${definition.unit}之间`);
  }
  return String(integer);
}

function readPositiveEnvNumber(envName: string, fallback: number): number {
  const raw = Number(process.env[envName]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function getRuntimeSettingFallback(key: RuntimeSettingKey): number {
  const definition = RUNTIME_SETTING_DEFINITIONS[key];
  return readPositiveEnvNumber(definition.env, definition.defaultValue);
}

type RuntimeSettingDelegate = {
  findUnique?: (args: { where: { key: string }; select: { value: true } }) => Promise<{ value: string | null } | null>;
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

export async function getCommandRuntimeConfig() {
  const executionTimeoutMs = await getRuntimeSettingNumber("runtime.commandExecutionTimeoutMs");
  const outputLimitBytes = await getRuntimeSettingNumber("runtime.commandOutputLimitBytes");
  const staleRunningAfterMs = await getRuntimeSettingNumber("runtime.commandStaleRunningAfterMs");
  const executionHeartbeatMs = await getRuntimeSettingNumber("runtime.commandExecutionHeartbeatMs");
  return {
    executionTimeoutMs,
    outputLimitBytes,
    staleRunningAfterMs,
    executionHeartbeatMs,
  };
}

export async function getSftpSyncDirectoryTimeoutMs(): Promise<number> {
  return getRuntimeSettingNumber("runtime.sftpSyncDirectoryTimeoutMs");
}

export async function getSshTerminalRuntimeConfig() {
  const wsHeartbeatIntervalMs = await getRuntimeSettingNumber("runtime.sshWsHeartbeatIntervalMs");
  const sshKeepaliveIntervalMs = await getRuntimeSettingNumber("runtime.sshKeepaliveIntervalMs");
  const sshKeepaliveCountMax = await getRuntimeSettingNumber("runtime.sshKeepaliveCountMax");
  return {
    wsHeartbeatIntervalMs,
    sshKeepaliveIntervalMs,
    sshKeepaliveCountMax,
  };
}
