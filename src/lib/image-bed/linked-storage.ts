import path from "node:path";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export async function indexLinkedStorageImage(input: {
  imageId: string;
  createdAt: Date;
  storageNodeId: string;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  checksum: string;
}, db: Pick<Prisma.TransactionClient, "fileEntry"> = prisma) {
  const data = {
    name: input.originalName || path.posix.basename(input.relativePath),
    entryType: "FILE" as const,
    mimeType: input.mimeType,
    size: BigInt(input.size),
    checksumSha256: input.checksum,
    updatedAt: input.createdAt,
    isDeleted: false,
  };

  // Atomic on @@unique([storageNodeId, relativePath]) — avoids concurrent create P2002 races.
  return db.fileEntry.upsert({
    where: {
      storageNodeId_relativePath: {
        storageNodeId: input.storageNodeId,
        relativePath: input.relativePath,
      },
    },
    create: {
      id: input.imageId,
      storageNodeId: input.storageNodeId,
      relativePath: input.relativePath,
      ...data,
    },
    update: data,
  });
}
