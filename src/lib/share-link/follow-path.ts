import type { Prisma } from "@prisma/client";

import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { BusinessError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";

type ShareLinkClient = Pick<Prisma.TransactionClient, "shareLink">;

const MAX_FOLLOWED_SHARES = 10_000;

/**
 * Shares name a path. When a file or directory gets a new path (moved,
 * renamed, or moved over WebDAV), its live shares follow it: left at the old
 * path they broke, and served whatever was later created there (a link given
 * out for one document handed out its replacement).
 */
export async function moveSharePaths(db: ShareLinkClient, input: {
  storageNodeId: string;
  oldPath: string;
  newPath: string;
  isDirectory: boolean;
  caseInsensitive?: boolean;
}): Promise<number> {
  const oldPrefix = `${input.oldPath}/`;
  const newPrefix = `${input.newPath}/`;
  const mode = input.caseInsensitive ? { mode: "insensitive" as const } : {};
  const shares = await db.shareLink.findMany({
    where: {
      storageNodeId: input.storageNodeId,
      revokedAt: null,
      OR: [
        { path: input.caseInsensitive ? { equals: input.oldPath, mode: "insensitive" as const } : input.oldPath },
        ...(input.isDirectory ? [{ path: { startsWith: escapeLikeLiteral(oldPrefix), ...mode } }] : []),
      ],
    },
    select: { id: true, path: true },
    take: MAX_FOLLOWED_SHARES + 1,
  });
  if (shares.length > MAX_FOLLOWED_SHARES) {
    const t = await serviceT();
    throw new BusinessError(t("backend.storageHardening.files.tooManyShares"));
  }
  const matchesExact = (p: string) =>
    input.caseInsensitive ? p.toLowerCase() === input.oldPath.toLowerCase() : p === input.oldPath;
  for (const share of shares) {
    await db.shareLink.update({
      where: { id: share.id },
      data: { path: matchesExact(share.path) ? input.newPath : newPrefix + share.path.slice(oldPrefix.length) },
    });
  }
  return shares.length;
}
