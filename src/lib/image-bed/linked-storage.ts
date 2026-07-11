import path from "node:path";

import { prisma } from "@/lib/db";

export async function indexLinkedStorageImage(input: {
  storageNodeId: string;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  checksum: string;
}) {
  const existing = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId: input.storageNodeId,
      relativePath: input.relativePath,
    },
    select: { id: true },
  });
  const data = {
    name: input.originalName || path.posix.basename(input.relativePath),
    entryType: "FILE" as const,
    mimeType: input.mimeType,
    size: BigInt(input.size),
    checksumSha256: input.checksum,
    isDeleted: false,
  };

  if (existing) {
    return prisma.fileEntry.update({ where: { id: existing.id }, data });
  }
  return prisma.fileEntry.create({
    data: {
      storageNodeId: input.storageNodeId,
      relativePath: input.relativePath,
      ...data,
    },
  });
}
