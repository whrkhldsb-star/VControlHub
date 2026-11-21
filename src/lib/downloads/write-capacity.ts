import { prisma } from "@/lib/db";
import { getStorageWriteCapacity } from "@/lib/storage/access-control";

/** A known destination can reuse its existing live bytes. Final admission is locked at publish. */
export async function downloadWriteCapacity(
  input: Parameters<typeof getStorageWriteCapacity>[0], fileName: string | null,
) {
  const relativePath = [input.relativePath, fileName].filter(Boolean).join("/");
  const capacity = await getStorageWriteCapacity({ ...input, relativePath });
  if (!fileName || capacity.remainingBytes === null || capacity.maxFileBytes === BigInt(0)) return capacity;
  const replaced = await prisma.fileEntry.findFirst({
    where: { storageNodeId: input.storageNodeId, relativePath, entryType: "FILE", isDeleted: false },
    select: { size: true },
  });
  return replaced ? { ...capacity, replacing: true, remainingBytes: capacity.remainingBytes + (replaced.size ?? BigInt(0)) } : capacity;
}
