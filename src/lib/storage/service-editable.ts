import { access, readFile, stat, writeFile } from "node:fs/promises";

import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { MAX_EDITABLE_FILE_SIZE_BYTES } from "./mime-constants";
import {
  isEditableTextFile,
  resolveLocalAbsolutePath,
} from "./service-entries";

async function resolveLocalEditableFileEntry(input: {
  fileEntryId: string;
  session: SessionPayload;
  operation: "read" | "write";
  writeBytes?: number | bigint | null;
}) {
  const entry = await prisma.fileEntry.findUnique({
    where: { id: input.fileEntryId },
    include: {
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          basePath: true,
        },
      },
    },
  });

  if (!entry || entry.isDeleted) {
    throw new Error("文件条目不存在或已删除");
  }

  if (entry.storageNode.driver !== "LOCAL") {
    throw new Error("仅支持编辑已上传到当前服务器本机存储节点的文件");
  }

  const storageAccess = await assertStorageAccess({
    session: input.session,
    storageNodeId: entry.storageNode.id,
    relativePath: entry.relativePath,
    operation: input.operation,
    writeBytes: input.writeBytes,
  });
  if (!storageAccess.allowed) {
    throw new Error(storageAccess.reason ?? "没有该存储节点或路径的访问授权");
  }

  if (
    !isEditableTextFile({
      entryType: entry.entryType,
      name: entry.name,
      mimeType: entry.mimeType,
    })
  ) {
    throw new Error("当前仅支持编辑文本类文件");
  }

  const absolutePath = resolveLocalAbsolutePath(
    entry.storageNode.basePath,
    entry.relativePath,
  );
  await access(absolutePath);
  const fileStat = await stat(absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("目标不是可编辑文件");
  }

  if (fileStat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
    throw new Error("文件超过 512 KB，暂不支持在线编辑");
  }

  return { entry, absolutePath, fileStat };
}

export async function getLocalEditableFileDraft(input: {
  fileEntryId: string;
  session: SessionPayload;
}) {
  const { entry, fileStat, absolutePath } =
    await resolveLocalEditableFileEntry({
      fileEntryId: input.fileEntryId,
      session: input.session,
      operation: "read",
    });
  const content = await readFile(absolutePath, "utf8");

  return {
    fileEntryId: entry.id,
    name: entry.name,
    relativePath: entry.relativePath,
    content,
    byteSize: fileStat.size,
    lastModifiedMs: fileStat.mtimeMs,
    updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
  };
}

export async function saveLocalEditableFileDraft(input: {
  fileEntryId: string;
  content: string;
  session: SessionPayload;
  expectedUpdatedAt?: string | null;
  expectedLastModifiedMs?: number | null;
}) {
  const content = String(input.content ?? "");
  const byteSize = Buffer.byteLength(content, "utf8");

  if (byteSize > MAX_EDITABLE_FILE_SIZE_BYTES) {
    throw new Error("文件超过 512 KB，暂不支持在线编辑");
  }

  const { entry, fileStat, absolutePath } = await resolveLocalEditableFileEntry(
    {
      fileEntryId: input.fileEntryId,
      session: input.session,
      operation: "write",
      writeBytes: byteSize,
    },
  );

  const currentUpdatedAt = entry.updatedAt?.toISOString?.() ?? entry.updatedAt;
  if (input.expectedUpdatedAt && currentUpdatedAt && input.expectedUpdatedAt !== currentUpdatedAt) {
    throw new Error("文件已被其他操作更新，请重新加载后再保存");
  }

  if (
    typeof input.expectedLastModifiedMs === "number" &&
    Number.isFinite(input.expectedLastModifiedMs) &&
    Math.abs(fileStat.mtimeMs - input.expectedLastModifiedMs) > 1
  ) {
    throw new Error("文件内容已在磁盘上发生变化，请重新加载后再保存");
  }

  await writeFile(absolutePath, content, "utf8");
  const nextStat = await stat(absolutePath);
  const updated = await prisma.fileEntry.update({
    where: { id: entry.id },
    data: {
      size: BigInt(nextStat.size),
      updatedAt: new Date(),
      checksumSha256: null,
    },
  });

  return {
    fileEntryId: entry.id,
    name: entry.name,
    relativePath: entry.relativePath,
    byteSize: nextStat.size,
    previousByteSize: fileStat.size,
    lastModifiedMs: nextStat.mtimeMs,
    updatedAt: updated.updatedAt?.toISOString?.() ?? updated.updatedAt,
  };
}
