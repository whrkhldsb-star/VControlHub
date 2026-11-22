import { Prisma } from "@prisma/client";
import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Batch operations for image-bed: bulk delete, bulk move album, bulk toggle public.
 * POST /api/images/batch  { action: "delete"|"moveAlbum"|"togglePublic", ids: string[], album?: string }
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { imageTeamWhere, lockLiveCustomer, rawActiveCustomerScope } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { deleteImageVariants } from "@/lib/image/service";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { isOwnedLinkedCopy, removeOwnedLinkedCopies } from "@/lib/image-bed/linked-copy";

const batchSchema = z.object({
  action: z.enum(["delete", "moveAlbum", "togglePublic"]),
  ids: z.array(z.string()).min(1).max(100),
  album: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "image:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorMessage: apiCopy("apiCopy.batch.operation.failed.07434a82"),
      bodySchema: batchSchema,
    },
    async ({ session, body }) => {
      const { action, ids, album } = body;

      const canManageImages =
        sessionHasPermission(session, "media:manage") ||
        sessionHasPermission(session, "team:manage") ||
        sessionHasPermission(session, "role:manage");
      const whereClause = canManageImages
        ? { id: { in: ids }, ...imageTeamWhere(session) }
        : { id: { in: ids }, userId: session.userId, ...imageTeamWhere(session) };

      switch (action) {
        case "delete": {
          // Owners may bulk-delete their own images (whereClause already scopes
          // non-managers to userId). Managers keep cross-owner delete via canManageImages.
          // Matches single-image DELETE canDeleteImage (owner OR media/team/role manage).
          const { deletedImages, result } = await prisma.$transaction(async tx => {
            const locked = await tx.$queryRaw<{ id: string; teamId: string | null }[]>`SELECT i.id, i."teamId" FROM image_uploads i
              WHERE i.id IN (${Prisma.join(ids)}) AND ${rawActiveCustomerScope(session, Prisma.sql`i."teamId"`)}
                ${canManageImages ? Prisma.empty : Prisma.sql`AND i."userId" = ${session.userId}`}
              ORDER BY i.id FOR UPDATE`;
            for (const teamId of [...new Set(locked.map(row => row.teamId))].sort()) {
              if (teamId) await lockLiveCustomer(tx, teamId);
            }
            const lockedIds = locked.map(row => row.id);
            if (lockedIds.length === 0) {
              return { deletedImages: [], result: { count: 0 } };
            }
            const images = await tx.imageUpload.findMany({
              where: { AND: [whereClause, { id: { in: lockedIds } }] },
              select: {
                id: true,
                storageKey: true,
                teamId: true,
                createdAt: true,
                checksum: true,
                sizeBytes: true,
                storageNodeId: true,
                relativePath: true,
              },
              take: 100,
            });
            const targetIds = images.map((image) => image.id);
            const result =
              targetIds.length > 0
                ? await tx.imageUpload.deleteMany({
                    where: { AND: [whereClause, { id: { in: targetIds } }] },
                  })
                : { count: 0 };
            return { deletedImages: images, result };
          });
          // Run local variant unlinks and linked-storage cleanup only after the DB delete commits.
          const [fileResults, linked] = await Promise.all([
            Promise.allSettled(
              deletedImages.map((img) =>
                deleteImageVariants(img.storageKey, UPLOAD_DIR),
              ),
            ),
            removeOwnedLinkedCopies(deletedImages, session),
          ]);
          const failedFileIds = deletedImages
            .filter((_, index) => fileResults[index]?.status === "rejected")
            .map((image) => image.id);
          const okIds = deletedImages
            .filter((_, index) => fileResults[index]?.status !== "rejected")
            .map((image) => image.id);
          await auditUserAction(
            session.userId,
            "image.batch.delete",
            {
              requestedCount: ids.length,
              deleted: result.count,
              ids: okIds,
              failedFileIds,
              removedLinkedStorage: linked.removed,
              linkedCleanupFailures: linked.failed,
              retainedLinkedStorage: deletedImages
                .filter(
                  (img) =>
                    img.storageNodeId &&
                    img.relativePath &&
                    !isOwnedLinkedCopy(img),
                )
                .map((img) => ({
                  id: img.id,
                  storageNodeId: img.storageNodeId,
                  relativePath: img.relativePath,
                })),
            },
            "WARNING",
            session.currentTeamId,
          );
          const payload = {
            deleted: result.count,
            filesDeleted: okIds.length,
            failedFileIds,
          };
          if (failedFileIds.length > 0) {
            return NextResponse.json(
              {
                ...payload,
                success: false,
                partial: true,
                cleanupPending: true,
                ...(linked.failed.length > 0 ? { linkedCleanupFailures: linked.failed } : {}),
              },
              { status: 207 },
            );
          }
          if (linked.failed.length > 0) {
            // Deleted, with a storage copy still to clean up: the shape the single delete answers with.
            return NextResponse.json(
              { ...payload, linkedCleanupFailures: linked.failed, cleanupPending: true },
              { status: 207 },
            );
          }
          return NextResponse.json(payload);
        }

        case "moveAlbum": {
          if (!album || typeof album !== "string")
            return NextResponse.json(
              { error: apiCopy("apiCopy.album.parameter.is.required.29fbd1dd") },
              { status: 400 },
            );
          const result = await prisma.imageUpload.updateMany({
            where: whereClause,
            data: { album: album.trim() || null },
          });
          await auditUserAction(
            session.userId,
            "image.batch.moveAlbum",
            {
              requestedCount: ids.length,
              updated: result.count,
              album: album.trim() || null,
            },
            undefined,
            session.currentTeamId,
          );
          return NextResponse.json({ updated: result.count });
        }

        case "togglePublic": {
          const scope = rawActiveCustomerScope(session, Prisma.sql`image_uploads."teamId"`);
          const images = await prisma.$queryRaw<Array<{ isPublic: boolean }>>(Prisma.sql`
            UPDATE image_uploads SET "isPublic" = NOT "isPublic"
            WHERE id IN (${Prisma.join(ids)}) AND ${scope}
              ${canManageImages ? Prisma.empty : Prisma.sql`AND "userId" = ${session.userId}`}
            RETURNING "isPublic"
          `);
          const toPublic = images.filter(image => image.isPublic).length;
          await auditUserAction(
            session.userId,
            "image.batch.togglePublic",
            {
              requestedCount: ids.length,
              updated: images.length,
              toPublicCount: toPublic,
              toPrivateCount: images.length - toPublic,
            },
            undefined,
            session.currentTeamId,
          );
          return NextResponse.json({ updated: images.length });
        }

        default:
          return NextResponse.json(
            {
              error:
                apiCopy("apiCopy.unsupported.operation.options.delete.movealbum.togglepublic.dc637510"),
            },
            { status: 400 },
          );
      }
    },
  );
}
