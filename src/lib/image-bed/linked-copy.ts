import path from "node:path";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { storageFileNodeSelect } from "@/lib/storage/file-content";
import { deleteBackingObject } from "@/lib/storage/fs-backend";

type LinkedImage = { id: string; storageKey: string; storageNodeId: string | null; relativePath: string | null };

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

/**
 * Removes the storage copies the image bed wrote for images that were just deleted: their file-index and media
 * rows first, then the bytes. Copies on nodes outside the caller's team scope are left alone. Never throws: the
 * images are gone already, so a copy that could not be removed is reported, not raised.
 */
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
    if (!storageNode) continue;
    try {
      await prisma.$transaction([
        prisma.mediaItem.deleteMany({ where: { storageNodeId: image.storageNodeId, relativePath: image.relativePath } }),
        prisma.fileEntry.deleteMany({ where: { storageNodeId: image.storageNodeId, relativePath: image.relativePath } }),
      ]);
      await deleteBackingObject({ storageNode, relativePath: image.relativePath, isDirectory: false, tolerateMissing: true });
      removed.push(image.id);
    } catch (error) {
      logError("image-bed:linked-copy-delete", error);
      failed.push(image.id);
    }
  }
  return { removed, failed };
}

function loadNodes(ids: string[], session: SessionPayload) {
  return prisma.storageNode.findMany({ where: { id: { in: ids }, ...teamWhere(session) }, select: storageFileNodeSelect });
}
