import { access, readFile, stat, writeFile } from "node:fs/promises";

import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { BusinessError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { serverT } from "@/lib/i18n/server-locale";
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
  const t = await serverT();
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
    throw new NotFoundError(t("backend.storage.editableEntryNotFound"));
  }

  if (entry.storageNode.driver !== "LOCAL") {
    throw new BusinessError(t("backend.storage.editableLocalOnly"));
  }

  const storageAccess = await assertStorageAccess({
    session: input.session,
    storageNodeId: entry.storageNode.id,
    relativePath: entry.relativePath,
    operation: input.operation,
    writeBytes: input.writeBytes,
  });
  if (!storageAccess.allowed) {
    throw new ForbiddenError(storageAccess.reason ?? t("backend.storage.editableNoAccess"));
  }

  if (
    !isEditableTextFile({
      entryType: entry.entryType,
      name: entry.name,
      mimeType: entry.mimeType,
    })
  ) {
    throw new ValidationError(t("backend.storage.editableTextOnly"));
  }

  const absolutePath = resolveLocalAbsolutePath(
    entry.storageNode.basePath,
    entry.relativePath,
  );
  await access(absolutePath);
  const fileStat = await stat(absolutePath);

  if (!fileStat.isFile()) {
    throw new BusinessError(t("backend.storage.editableTargetNotFile"));
  }

  if (fileStat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
    throw new ValidationError(t("backend.storage.editableFileTooLarge"));
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

  const t = await serverT();

  if (byteSize > MAX_EDITABLE_FILE_SIZE_BYTES) {
    throw new ValidationError(t("backend.storage.editableFileTooLarge"));
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
    throw new ConflictError(t("backend.storage.editableFileUpdatedByOther"));
  }

  if (
    typeof input.expectedLastModifiedMs === "number" &&
    Number.isFinite(input.expectedLastModifiedMs) &&
    Math.abs(fileStat.mtimeMs - input.expectedLastModifiedMs) > 1
  ) {
    throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
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
