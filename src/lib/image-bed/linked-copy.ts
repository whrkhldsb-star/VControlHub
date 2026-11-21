import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { storageFileNodeSelect, streamStorageFile, type StorageFileNode } from "@/lib/storage/file-content";
import { deleteBackingObject, moveBackingObject, renameBackingObject, statBackingObject } from "@/lib/storage/fs-backend";

type LinkedImage = { id: string; createdAt: Date; sizeBytes: number; checksum: string | null; storageKey: string; storageNodeId: string | null; relativePath: string | null };

/**
 * True when the image's storage path is the copy an upload wrote there itself: that copy is named by the storage
 * key. An image published from storage points at the user's own file, under its own name, which is not the image
 * bed's to delete.
 */
export function isOwnedLinkedCopy<T extends Pick<LinkedImage, "storageKey" | "storageNodeId" | "relativePath">>(
  image: T,
): image is T & { storageNodeId: string; relativePath: string } {
  return Boolean(
    image.storageNodeId &&
    image.relativePath &&
    path.posix.basename(image.relativePath) === image.storageKey,
  );
}

async function isImageCopy(storageNode: StorageFileNode, relativePath: string, image: LinkedImage) {
  const staged = await statBackingObject({ storageNode, relativePath });
  if (!staged || staged.isDirectory || staged.size !== image.sizeBytes) return false;
  const source = await streamStorageFile(storageNode, relativePath);
  try {
    if (source.size !== image.sizeBytes) return false;
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of source.stream) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > image.sizeBytes) return false;
      hash.update(chunk);
    }
    return bytes === image.sizeBytes && hash.digest("hex") === image.checksum;
  } finally {
    source.close();
  }
}

/** Remove the proven generation while holding the public path's overwrite lock. */
async function removeLockedCopy(
  storageNode: StorageFileNode,
  image: LinkedImage & { storageNodeId: string; relativePath: string },
  session: SessionPayload,
) {
  const target = { storageNodeId: image.storageNodeId, relativePath: image.relativePath };
  const access = await assertStorageAccess({ ...target, session, operation: "delete" });
  if (!access.allowed || !image.checksum) return false;

  // Legacy images do not carry this association. Editing an associated row also invalidates it.
  const identity = {
    ...target, id: image.id, updatedAt: image.createdAt, isDeleted: false,
    entryType: "FILE" as const, size: BigInt(image.sizeBytes), checksumSha256: image.checksum,
  };
  if (!await prisma.fileEntry.findFirst({ where: identity, select: { id: true } })) return false;

  const original = await statBackingObject({ storageNode, relativePath: image.relativePath });
  if (original && (original.isDirectory || original.size !== image.sizeBytes)) return false;
  let stagedPath: string | undefined;
  if (original) {
    const candidate = path.posix.join(path.posix.dirname(image.relativePath), `.vch-backup-${randomUUID()}`);
    await renameBackingObject({ storageNode, oldRelativePath: image.relativePath, newRelativePath: candidate });
    stagedPath = candidate;
  }

  let discardStage = false;
  try {
    // An external writer can replace the public name even under our advisory lock.
    // Verify the object we actually moved and only ever unlink that private name.
    if (stagedPath && !await isImageCopy(storageNode, stagedPath, image)) return false;
    if (await statBackingObject({ storageNode, relativePath: image.relativePath })) {
      discardStage = true;
      return false;
    }
    const claimed = await prisma.$transaction(async tx => {
      const deleted = await tx.fileEntry.deleteMany({ where: identity });
      if (!deleted.count) return false;
      await tx.mediaItem.deleteMany({ where: { ...target, fileEntryId: image.id } });
      return true;
    });
    discardStage = claimed;
    return claimed;
  } finally {
    if (stagedPath) {
      try {
        if (discardStage) {
          await deleteBackingObject({ storageNode, relativePath: stagedPath, isDirectory: false, tolerateMissing: true });
        } else {
          // A concurrent creator at the public name wins. Keep the staged object for recovery.
          await moveBackingObject({ storageNode, oldRelativePath: stagedPath, newRelativePath: image.relativePath });
        }
      } catch (error) {
        logError("image-bed:linked-copy-staging", error, { ...target, stagedPath });
        throw error;
      }
    }
  }
}

/** A copy that cannot be cleaned up is reported after the image has already been deleted. */
export async function removeOwnedLinkedCopies(
  images: LinkedImage[],
  session: SessionPayload,
): Promise<{ removed: string[]; failed: string[] }> {
  const owned = images.filter(isOwnedLinkedCopy);
  const removed: string[] = [];
  const failed: string[] = [];
  if (owned.length === 0) return { removed, failed };

  let nodes: Map<string, Awaited<ReturnType<typeof loadNodes>>[number]>;
  try {
    nodes = new Map((await loadNodes([...new Set(owned.map((image) => image.storageNodeId))], session)).map((node) => [node.id, node]));
  } catch (error) {
    logError("image-bed:linked-copy-nodes", error);
    return { removed, failed: owned.map((image) => image.id) };
  }

  for (const image of owned) {
    const storageNode = nodes.get(image.storageNodeId);
    if (!storageNode || (storageNode.driver !== "LOCAL" && storageNode.driver !== "SFTP")) continue;
    let unlock: (() => Promise<void>) | undefined;
    try {
      unlock = await lockStorageFileOverwrite(image.storageNodeId, image.relativePath);
      if (await removeLockedCopy(storageNode, image, session)) removed.push(image.id);
    } catch (error) {
      logError("image-bed:linked-copy-delete", error);
      failed.push(image.id);
    } finally {
      await unlock?.();
    }
  }
  return { removed, failed };
}

function loadNodes(ids: string[], session: SessionPayload) {
  return prisma.storageNode.findMany({ where: { id: { in: ids }, ...teamWhere(session) }, select: storageFileNodeSelect });
}
