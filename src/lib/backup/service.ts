import { stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";

import { prisma } from "@/lib/db";

import { backupCommandErrorMessage, runBackupCommand } from "./command-runner";

function getBackupStorageRoot(projectRoot: string) {
  const configured = process.env.BACKUP_DIR?.trim();
  if (configured) return configured;
  const slug = process.env.APP_SLUG?.trim();
  if (slug) return `/var/backups/${slug}`;
  return join(projectRoot, "backups");
}

export const RESTORE_CONFIRM_TEXT = "RESTORE";

type BackupStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type BackupType = "DATABASE" | "FILES" | "FULL";

type BackupRecordForSummary = {
  type: string;
  status: string;
  filePath?: string | null;
  fileSize?: string | number | bigint | null;
  errorMessage?: string | null;
  note?: string | null;
  createdAt: Date;
  completedAt?: Date | null;
};

type BackupFailureCategory = "path" | "permission" | "timeout" | "script" | "missing" | "storage" | "unknown";

export type BackupFailureSummaryItem = {
  category: BackupFailureCategory;
  label: string;
  remediation: string;
  count: number;
  latestMessage: string | null;
  latestRecordPath: string | null;
};

export type BackupPolicySummary = {
  totalRecords: number;
  completedRecords: number;
  failedRecords: number;
  runningRecords: number;
  totalCompletedSizeBytes: number;
  latestCompletedAt: Date | null;
  oldestCompletedAt: Date | null;
  recordsOlderThan30Days: number;
  byType: Record<BackupType, { count: number; sizeBytes: number }>;
  failureSummary: BackupFailureSummaryItem[];
  largestCompleted: { type: string; filePath?: string | null; sizeBytes: number } | null;
};

export function isBackupType(value: string): value is BackupType {
  return value === "DATABASE" || value === "FILES" || value === "FULL";
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\''`)}'`;
}

export function buildBackupFilePath(type: BackupType, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const extension = type === "DATABASE" ? "sql.gz" : "tar.gz";
  return `backups/${type.toLowerCase()}-${stamp}.${extension}`;
}

export async function createBackupRecord(input: { type: BackupType; createdBy?: string; note?: string }) {
  return prisma.backupRecord.create({
    data: {
      type: input.type,
      status: "PENDING",
      filePath: buildBackupFilePath(input.type),
      createdBy: input.createdBy,
      note: input.note?.trim() || undefined,
    },
  });
}

export async function runBackupRecord(input: { type: BackupType; createdBy?: string; note?: string; projectRoot?: string }) {
  const record = await createBackupRecord(input);
  return runExistingBackupRecord({ id: record.id, projectRoot: input.projectRoot });
}

export async function runExistingBackupRecord(input: { id: string; projectRoot?: string }) {
  const projectRoot = input.projectRoot || process.env.APP_DIR || process.cwd();
  const record = await getBackupRecord(input.id);
  if (!record) throw new Error("备份记录不存在");
  if (!isBackupType(record.type)) throw new Error("备份类型无效");
  let outputPath: string;
  try {
    outputPath = resolveBackupPath(projectRoot, record.filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "备份路径无效";
    return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage: message.slice(0, 2000) });
  }
  const args = record.type === "FILES" ? ["--files", outputPath] : record.type === "FULL" ? ["--full", outputPath] : [outputPath];

  await updateBackupRecordStatus(record.id, { status: "RUNNING" });

  try {
    await runBackupCommand({
      file: "bash",
      args: ["deploy/backup.sh", ...args],
      options: { cwd: projectRoot, env: { ...process.env, APP_DIR: projectRoot } },
    });
    const fileInfo = await stat(outputPath);
    return updateBackupRecordStatus(record.id, { status: "COMPLETED", fileSize: fileInfo.size, completedAt: new Date(), errorMessage: null });
  } catch (error) {
    return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage: backupCommandErrorMessage(error).slice(0, 2000) });
  }
}

export async function listBackupRecords() {
  return prisma.backupRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { creator: { select: { username: true, displayName: true } } },
  });
}

function parseBackupSizeBytes(value: string | number | bigint | null | undefined) {
  if (value == null) return 0;
  const numeric = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return numeric;
}

const backupFailureCategoryLabels: Record<BackupFailureCategory, string> = {
  path: "路径无效或越界",
  permission: "权限或只读路径",
  timeout: "执行超时",
  script: "备份脚本执行失败",
  missing: "文件或目录不存在",
  storage: "存储空间或写入失败",
  unknown: "未归类失败",
};

const backupFailureRemediation: Record<BackupFailureCategory, string> = {
  path: "检查备份记录的 portable path，避免绝对路径、..、反斜杠或跨目录片段；必要时作废旧记录后重新创建备份。",
  permission: "优先确认 BACKUP_DIR 或 /var/backups/<slug> 是可写目录，并把旧的仓库内只读路径失败记录标记作废或重试到新的系统备份根。",
  timeout: "检查备份体积、网络/磁盘 IO 与 30 分钟执行窗口；必要时拆分文件备份或改为后台低峰执行。",
  script: "查看对应 Durable Job 日志和 deploy/backup.sh 输出，先修复脚本依赖、环境变量或数据库连接后再重试。",
  missing: "确认备份脚本引用的源目录、restore 目标或历史 artifact 仍存在；对已不存在的旧 artifact 保留审计并标记作废。",
  storage: "检查磁盘空间、inode、挂载只读状态和备份目录写入权限；释放空间或切换 BACKUP_DIR 后再重试。",
  unknown: "保留错误片段并到任务中心查看完整日志；若能稳定复现，再按路径/权限/脚本/存储方向细分处理。",
};

function classifyBackupFailure(message: string | null | undefined): BackupFailureCategory {
  const value = (message || "").toLowerCase();
  if (/permission|denied|readonly|read-only|只读|权限|eacces|eperm/.test(value)) return "permission";
  if (/路径|path|portable|traversal|invalid/.test(value)) return "path";
  if (/timeout|timed out|超时/.test(value)) return "timeout";
  if (/no such file|enoent|not found|不存在|missing/.test(value)) return "missing";
  if (/no space|enospc|disk|write|写入|空间/.test(value)) return "storage";
  if (/exit code|command failed|backup\.sh|restore-db\.sh|脚本|执行失败/.test(value)) return "script";
  return "unknown";
}

function summarizeBackupFailures(records: BackupRecordForSummary[]): BackupFailureSummaryItem[] {
  const grouped = new Map<BackupFailureCategory, BackupFailureSummaryItem & { latestAt: Date }>();
  for (const record of records) {
    if (record.status !== "FAILED") continue;
    const category = classifyBackupFailure(record.errorMessage);
    const latestAt = record.completedAt ?? record.createdAt;
    const existing = grouped.get(category);
    if (!existing) {
      grouped.set(category, {
        category,
        label: backupFailureCategoryLabels[category],
        remediation: backupFailureRemediation[category],
        count: 1,
        latestMessage: record.errorMessage || record.note || null,
        latestRecordPath: record.filePath ?? null,
        latestAt,
      });
      continue;
    }
    existing.count += 1;
    if (latestAt >= existing.latestAt) {
      existing.latestAt = latestAt;
      existing.latestMessage = record.errorMessage || record.note || null;
      existing.latestRecordPath = record.filePath ?? null;
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count || b.latestAt.getTime() - a.latestAt.getTime())
    .map(({ latestAt: _latestAt, ...item }) => item);
}

export function formatBackupSize(value: string | number | bigint | null | undefined) {
  const size = parseBackupSizeBytes(value);
  if (size <= 0) return "待生成";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function summarizeBackupPolicy(records: BackupRecordForSummary[], now = new Date()): BackupPolicySummary {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const byType: BackupPolicySummary["byType"] = {
    DATABASE: { count: 0, sizeBytes: 0 },
    FILES: { count: 0, sizeBytes: 0 },
    FULL: { count: 0, sizeBytes: 0 },
  };
  let completedRecords = 0;
  let failedRecords = 0;
  let runningRecords = 0;
  let totalCompletedSizeBytes = 0;
  let latestCompletedAt: Date | null = null;
  let oldestCompletedAt: Date | null = null;
  let recordsOlderThan30Days = 0;
  let largestCompleted: BackupPolicySummary["largestCompleted"] = null;

  for (const record of records) {
    if (record.status === "FAILED") failedRecords += 1;
    if (record.status === "RUNNING" || record.status === "PENDING") runningRecords += 1;
    if (record.status !== "COMPLETED") continue;

    completedRecords += 1;
    const sizeBytes = parseBackupSizeBytes(record.fileSize);
    totalCompletedSizeBytes += sizeBytes;
    if (isBackupType(record.type)) {
      byType[record.type].count += 1;
      byType[record.type].sizeBytes += sizeBytes;
    }
    if (!largestCompleted || sizeBytes > largestCompleted.sizeBytes) {
      largestCompleted = { type: record.type, filePath: record.filePath ?? null, sizeBytes };
    }

    const completedAt = record.completedAt ?? record.createdAt;
    if (!latestCompletedAt || completedAt > latestCompletedAt) latestCompletedAt = completedAt;
    if (!oldestCompletedAt || completedAt < oldestCompletedAt) oldestCompletedAt = completedAt;
    if (completedAt < cutoff) recordsOlderThan30Days += 1;
  }

  return {
    totalRecords: records.length,
    completedRecords,
    failedRecords,
    runningRecords,
    totalCompletedSizeBytes,
    latestCompletedAt,
    oldestCompletedAt,
    recordsOlderThan30Days,
    byType,
    failureSummary: summarizeBackupFailures(records),
    largestCompleted,
  };
}

export async function getBackupPolicySummary() {
  const records = await listBackupRecords();
  return summarizeBackupPolicy(records);
}

export async function getBackupRecord(id: string) {
  return prisma.backupRecord.findUnique({ where: { id } });
}

export function assertPortableBackupPath(filePath: string) {
  const value = filePath.trim();
  const parts = value.split(/[\\/]+/);
  if (
    !value ||
    value === "." ||
    value.startsWith("/") ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.includes("//") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("备份路径必须是可移植的相对路径");
  }
  const normalized = normalize(value);
  if (normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`) || normalized === "..") {
    throw new Error("备份路径必须是可移植的相对路径");
  }
  return value;
}

export function buildPortableBackupCommand(input: { projectRoot: string; outputPath: string; type?: BackupType }) {
  const outputPath = assertPortableBackupPath(input.outputPath);
  const modeFlag = input.type === "FILES" ? " --files" : input.type === "FULL" ? " --full" : "";
  return `cd ${shellQuote(input.projectRoot)} && bash deploy/backup.sh${modeFlag} ${shellQuote(outputPath)}`;
}

export function buildScheduledBackupCommand(input: { projectRoot: string; type: BackupType }) {
  const modeFlag = input.type === "FILES" ? " --files" : input.type === "FULL" ? " --full" : "";
  return `cd ${shellQuote(input.projectRoot)} && bash deploy/backup.sh${modeFlag}`;
}

export function buildRestoreCommand(input: { projectRoot: string; backupPath: string }) {
  const backupPath = assertPortableBackupPath(input.backupPath);
  return `cd ${shellQuote(input.projectRoot)} && bash scripts/restore-db.sh ${shellQuote(backupPath)}`;
}

export function buildBackupRestoreCommand(input: { projectRoot: string; backupPath: string; type?: BackupType }) {
  const backupPath = assertPortableBackupPath(input.backupPath);
  if (input.type === "FILES" || input.type === "FULL") {
    return `cd ${shellQuote(input.projectRoot)} && tar -xzf ${shellQuote(backupPath)} -C ${shellQuote(input.projectRoot)}`;
  }
  return `cd ${shellQuote(input.projectRoot)} && bash scripts/restore-db.sh ${shellQuote(backupPath)}`;
}

export function resolveBackupPath(projectRoot: string, filePath: string) {
  const portablePath = assertPortableBackupPath(filePath);
  return join(getBackupStorageRoot(projectRoot), portablePath);
}

function buildRestoreExecution(record: { type: string; filePath: string }, projectRoot: string) {
  const backupPath = resolveBackupPath(projectRoot, record.filePath);
  const type = isBackupType(record.type) ? record.type : "DATABASE";
  if (type === "FILES" || type === "FULL") {
    return { file: "tar", args: ["-xzf", backupPath, "-C", projectRoot], backupPath };
  }
  return { file: "bash", args: ["scripts/restore-db.sh", backupPath], backupPath };
}

export async function restoreBackupRecord(input: { id: string; confirm: string; projectRoot?: string }) {
  if (input.confirm !== RESTORE_CONFIRM_TEXT) {
    throw new Error("恢复操作需要明确确认");
  }
  const record = await getBackupRecord(input.id);
  if (!record) {
    throw new Error("备份记录不存在");
  }
  if (record.status !== "COMPLETED") {
    throw new Error("只能恢复已完成的备份");
  }
  const projectRoot = input.projectRoot || process.env.APP_DIR || process.cwd();
  const execution = buildRestoreExecution(record, projectRoot);
  await stat(execution.backupPath);
  await runBackupCommand({
    file: execution.file,
    args: execution.args,
    options: { cwd: projectRoot, env: { ...process.env, APP_DIR: projectRoot, CONFIRM_RESTORE: "1" } },
  });
  return { id: record.id, type: record.type, filePath: record.filePath, restoredAt: new Date().toISOString() };
}

export async function updateBackupRecordStatus(
  id: string,
  input: { status: BackupStatus; fileSize?: number; completedAt?: Date; errorMessage?: string | null },
) {
  const data: { status: BackupStatus; fileSize?: string; completedAt?: Date; errorMessage?: string | null } = { status: input.status };
  if (input.fileSize !== undefined) data.fileSize = String(input.fileSize);
  if (input.completedAt) data.completedAt = input.completedAt;
  if (input.errorMessage !== undefined) data.errorMessage = input.errorMessage;
  return prisma.backupRecord.update({ where: { id }, data });
}

export async function voidBackupRecord(input: { id: string; reason: string }) {
  const record = await getBackupRecord(input.id);
  if (!record) throw new Error("备份记录不存在");
  if (record.status === "COMPLETED") throw new Error("已完成备份不能作废");
  if (record.status === "RUNNING") throw new Error("运行中的备份不能作废");
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) throw new Error("作废原因不能为空");
  const prefix = "已作废";
  const errorMessage = record.errorMessage?.includes(prefix)
    ? record.errorMessage
    : `${prefix}：${reason}`;
  return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage });
}

export async function prepareBackupRecordRetry(input: { id: string }) {
  const record = await getBackupRecord(input.id);
  if (!record) throw new Error("备份记录不存在");
  if (record.status === "COMPLETED") throw new Error("已完成备份不能重试");
  if (record.status === "RUNNING") throw new Error("运行中的备份不能重试");
  if (record.status === "PENDING") throw new Error("排队中的备份不能重复排队");
  if (record.status !== "FAILED") throw new Error("只能重试失败的备份记录");
  if (!isBackupType(record.type)) throw new Error("备份类型无效");
  assertPortableBackupPath(record.filePath);
  return updateBackupRecordStatus(record.id, { status: "PENDING", errorMessage: null });
}
