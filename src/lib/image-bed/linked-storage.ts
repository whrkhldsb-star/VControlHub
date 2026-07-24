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
  const data = {
    name: input.originalName || path.posix.basename(input.relativePath),
    entryType: "FILE" as const,
    mimeType: input.mimeType,
    size: BigInt(input.size),
    checksumSha256: input.checksum,
    isDeleted: false,
  };

  // Atomic on @@unique([storageNodeId, relativePath]) — avoids concurrent create P2002 races.
  return prisma.fileEntry.upsert({
    where: {
      storageNodeId_relativePath: {
        storageNodeId: input.storageNodeId,
        relativePath: input.relativePath,
      },
    },
    create: {
      storageNodeId: input.storageNodeId,
      relativePath: input.relativePath,
      ...data,
    },
    update: data,
  });
}
