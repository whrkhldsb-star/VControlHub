import { join } from "node:path";

import { prisma } from "@/lib/db";

export function buildBackupFilePath(type: string, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `backups/${type.toLowerCase()}-${stamp}.dump`;
}

export async function createBackupRecord(input: { type: "DATABASE" | "FILES" | "FULL"; createdBy?: string; note?: string }) {
  return prisma.backupRecord.create({ data: { type: input.type, status: "PENDING", filePath: buildBackupFilePath(input.type), createdBy: input.createdBy, note: input.note } });
}

export async function listBackupRecords() {
  return prisma.backupRecord.findMany({ orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } });
}

export function buildPortableBackupCommand(input: { projectRoot: string; outputPath: string }) {
  const safeRoot = input.projectRoot.replace(/'/g, "'\\''");
  const safeOutput = input.outputPath.replace(/'/g, "'\\''");
  return `cd '${safeRoot}' && bash deploy/backup.sh '${safeOutput}'`;
}

export function resolveBackupPath(projectRoot: string, filePath: string) {
  if (filePath.startsWith("/") || filePath.includes("..")) throw new Error("备份路径必须是可移植的相对路径");
  return join(projectRoot, filePath);
}
