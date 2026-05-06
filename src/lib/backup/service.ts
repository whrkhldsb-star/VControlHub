import { join, normalize, sep } from "node:path";

import { prisma } from "@/lib/db";

type BackupStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\''`)}'`;
}

export function buildBackupFilePath(type: string, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `backups/${type.toLowerCase()}-${stamp}.dump`;
}

export async function createBackupRecord(input: { type: "DATABASE" | "FILES" | "FULL"; createdBy?: string; note?: string }) {
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

export async function listBackupRecords() {
  return prisma.backupRecord.findMany({ orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } });
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

export function buildPortableBackupCommand(input: { projectRoot: string; outputPath: string }) {
  const outputPath = assertPortableBackupPath(input.outputPath);
  return `cd ${shellQuote(input.projectRoot)} && bash deploy/backup.sh ${shellQuote(outputPath)}`;
}

export function buildRestoreCommand(input: { projectRoot: string; backupPath: string }) {
  const backupPath = assertPortableBackupPath(input.backupPath);
  return `cd ${shellQuote(input.projectRoot)} && bash scripts/restore-db.sh ${shellQuote(backupPath)}`;
}

export function resolveBackupPath(projectRoot: string, filePath: string) {
  const portablePath = assertPortableBackupPath(filePath);
  return join(projectRoot, portablePath);
}

export async function updateBackupRecordStatus(
  id: string,
  input: { status: BackupStatus; fileSize?: number; completedAt?: Date; errorMessage?: string },
) {
  const data: { status: BackupStatus; fileSize?: string; completedAt?: Date; errorMessage?: string } = { status: input.status };
  if (input.fileSize !== undefined) data.fileSize = String(input.fileSize);
  if (input.completedAt) data.completedAt = input.completedAt;
  if (input.errorMessage !== undefined) data.errorMessage = input.errorMessage;
  return prisma.backupRecord.update({ where: { id }, data });
}
