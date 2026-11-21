import { isUniqueViolation, prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import type { validateStorageFileIndex } from "./schema";

export const previousFileIndexFields = {
  id: true, updatedAt: true, entryType: true, isDeleted: true,
  name: true, size: true, mimeType: true, checksumSha256: true,
} as const;
type PreviousFileIndex = Prisma.FileEntryGetPayload<{ select: typeof previousFileIndexFields }>;

/** Called with the path locked. A publish failure may only compensate the row written by this caller. */
export async function writeFileIndex(
  index: ReturnType<typeof validateStorageFileIndex>,
  previous: PreviousFileIndex | null,
) {
  const target = { storageNodeId: index.storageNodeId, relativePath: index.relativePath };
  const data = {
    name: index.name, entryType: index.entryType, mimeType: index.mimeType || null,
    size: BigInt(index.size), checksumSha256: null,
  };
  const select = { id: true, updatedAt: true } as const;
  if (!previous) {
    try {
      const written = await prisma.fileEntry.create({ data: { ...target, ...data }, select });
      return () => prisma.fileEntry.deleteMany({ where: { ...written, ...target, isDeleted: false } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      previous = await prisma.fileEntry.findFirst({ where: target, select: previousFileIndexFields });
      if (!previous) throw error;
    }
  }
  const { id, updatedAt, isDeleted, entryType, name, size, mimeType, checksumSha256 } = previous;
  if (isDeleted || entryType === "DIRECTORY") {
    throw new ConflictError(t("backend.storage.editableFileUpdatedByOther"));
  }
  const identity = { id, ...target, isDeleted: false, entryType: "FILE" as const };
  const written = await prisma.fileEntry.update({ where: { ...identity, updatedAt }, data, select });
  return () => prisma.fileEntry.updateMany({
    where: { ...identity, updatedAt: written.updatedAt },
    data: { entryType, name, size, mimeType, checksumSha256, updatedAt },
  });
}
