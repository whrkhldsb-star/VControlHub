import { stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { prisma } from "@/lib/db";

const runFile = promisify(execFile);

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
  const projectRoot = input.projectRoot || process.env.APP_DIR || process.cwd();
  const record = await createBackupRecord(input);
  let outputPath: string;
  try {
    outputPath = resolveBackupPath(projectRoot, record.filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "备份路径无效";
    return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage: message.slice(0, 2000) });
  }
  const args = input.type === "FILES" ? ["--files", outputPath] : input.type === "FULL" ? ["--full", outputPath] : [outputPath];

  await updateBackupRecordStatus(record.id, { status: "RUNNING" });

  try {
    await runFile("bash", ["deploy/backup.sh", ...args], {
      cwd: projectRoot,
      timeout: 30 * 60 * 1000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, APP_DIR: projectRoot },
    });
    const fileInfo = await stat(outputPath);
    return updateBackupRecordStatus(record.id, { status: "COMPLETED", fileSize: fileInfo.size, completedAt: new Date(), errorMessage: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "备份执行失败";
    return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage: message.slice(0, 2000) });
  }
}

export async function listBackupRecords() {
  return prisma.backupRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { creator: { select: { username: true, displayName: true } } },
  });
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
  await runFile(execution.file, execution.args, {
    cwd: projectRoot,
    timeout: 30 * 60 * 1000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, APP_DIR: projectRoot, CONFIRM_RESTORE: "1" },
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
