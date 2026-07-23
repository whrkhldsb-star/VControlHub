/**
 * Batch operations for image-bed: bulk delete, bulk move album, bulk toggle public.
 * POST /api/images/batch  { action: "delete"|"moveAlbum"|"togglePublic", ids: string[], album?: string }
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { deleteImageVariants } from "@/lib/image/service";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";

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
      errorMessage: "Batch operation failed",
      bodySchema: batchSchema,
    },
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );
      const { action, ids, album } = body;

      const canManageImages =
        sessionHasPermission(session, "media:manage") ||
    sessionHasPermission(session, "team:manage") ||
        sessionHasPermission(session, "role:manage");
      const whereClause = canManageImages
        ? { id: { in: ids } }
        : { id: { in: ids }, userId: session.userId };

      switch (action) {
        case "delete": {
          if (!canManageImages) {
            return NextResponse.json(
              { error: "No permission to batch delete images" },
              { status: 403 },
            );
          }
          const images = await prisma.imageUpload.findMany({
            where: whereClause,
            select: {
              id: true,
              storageKey: true,
              storageNodeId: true,
              relativePath: true,
            },
            take: 100,
          });
          // Delete on-disk variants FIRST so a disk failure leaves DB rows for retry.
          const fileResults = await Promise.allSettled(
            images.map((img) => deleteImageVariants(img.storageKey, UPLOAD_DIR)),
          );
          const failedFileIds = images
            .filter((_, index) => fileResults[index]?.status === "rejected")
            .map((image) => image.id);
          const okIds = images
            .filter((_, index) => fileResults[index]?.status !== "rejected")
            .map((image) => image.id);
          // Only remove DB rows for successfully unlinked image-bed files.
          const result =
            okIds.length > 0
              ? await prisma.imageUpload.deleteMany({
                  where: { id: { in: okIds } },
                })
              : { count: 0 };
          // Linked LOCAL/SFTP copies are intentionally retained (publish-from-storage
          // is a share of storage content); operators can delete via Files if needed.
          await auditUserAction(session.userId, "image.batch.delete", {
            requestedCount: ids.length,
            deleted: result.count,
            ids: okIds,
            failedFileIds,
            retainedLinkedStorage: images
              .filter((img) => okIds.includes(img.id) && img.storageNodeId && img.relativePath)
              .map((img) => ({ id: img.id, storageNodeId: img.storageNodeId, relativePath: img.relativePath })),
          }, "WARNING", session?.currentTeamId);
          const payload = {
            deleted: result.count,
            filesDeleted: okIds.length,
            failedFileIds,
          };
          if (failedFileIds.length > 0) {
            return NextResponse.json({ ...payload, success: false, partial: true }, { status: 207 });
          }
          return NextResponse.json(payload);
        }

        case "moveAlbum": {
          if (!album || typeof album !== "string")
            return NextResponse.json(
              { error: "album parameter is required" },
              { status: 400 },
            );
          const result = await prisma.imageUpload.updateMany({
            where: whereClause,
            data: { album: album.trim() || null },
          });
          await auditUserAction(session.userId, "image.batch.moveAlbum", {
            requestedCount: ids.length,
            updated: result.count,
            album: album.trim() || null,
          }, undefined, session?.currentTeamId);
          return NextResponse.json({ updated: result.count });
        }

        case "togglePublic": {
          // Get current isPublic states and flip them
          const images = await prisma.imageUpload.findMany({
            where: whereClause,
            select: { id: true, isPublic: true },
            take: 100,
          });
          // Batch into two updateMany calls instead of N individual updates
          const toPublic = images.filter((img) => !img.isPublic).map((img) => img.id);
          const toPrivate = images.filter((img) => img.isPublic).map((img) => img.id);
          if (toPublic.length > 0) {
            await prisma.imageUpload.updateMany({
              where: { id: { in: toPublic } },
              data: { isPublic: true },
            });
          }
          if (toPrivate.length > 0) {
            await prisma.imageUpload.updateMany({
              where: { id: { in: toPrivate } },
              data: { isPublic: false },
            });
          }
          await auditUserAction(session.userId, "image.batch.togglePublic", {
            requestedCount: ids.length,
            updated: images.length,
            toPublicCount: toPublic.length,
            toPrivateCount: toPrivate.length,
          }, undefined, session?.currentTeamId);
          return NextResponse.json({ updated: images.length });
        }

        default:
          return NextResponse.json(
            { error: "Unsupported operation, options: delete / moveAlbum / togglePublic" },
            { status: 400 },
          );
      }
    },
  );
}
