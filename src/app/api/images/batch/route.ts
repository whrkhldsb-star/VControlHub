/**
 * Batch operations for image-bed: bulk delete, bulk move album, bulk toggle public.
 * POST /api/images/batch  { action: "delete"|"moveAlbum"|"togglePublic", ids: string[], album?: string }
 */
import { NextResponse } from "next/server";
import { z } from "zod";

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
      requireAuth: true,
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorMessage: "批量操作失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const parsed = batchSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success)
        return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
      const { action, ids, album } = parsed.data;

      const canManageImages =
        sessionHasPermission(session, "storage:delete") ||
        sessionHasPermission(session, "role:manage");
      const whereClause = canManageImages
        ? { id: { in: ids } }
        : { id: { in: ids }, userId: session.userId };

      switch (action) {
        case "delete": {
          if (!canManageImages) {
            return NextResponse.json(
              { error: "无权批量删除图片" },
              { status: 403 },
            );
          }
          const images = await prisma.imageUpload.findMany({
            where: whereClause,
            select: { id: true, storageKey: true },
            take: 100,
          });
          // Delete DB records
          const result = await prisma.imageUpload.deleteMany({
            where: whereClause,
          });
          // Delete files (best-effort)
          for (const img of images) {
            await deleteImageVariants(img.storageKey, UPLOAD_DIR);
          }
          return NextResponse.json({ deleted: result.count });
        }

        case "moveAlbum": {
          if (!album || typeof album !== "string")
            return NextResponse.json(
              { error: "album 参数必填" },
              { status: 400 },
            );
          const result = await prisma.imageUpload.updateMany({
            where: whereClause,
            data: { album: album.trim() || null },
          });
          return NextResponse.json({ updated: result.count });
        }

        case "togglePublic": {
          // Get current isPublic states and flip them
          const images = await prisma.imageUpload.findMany({
            where: whereClause,
            select: { id: true, isPublic: true },
            take: 100,
          });
          const updates = images.map((img) =>
            prisma.imageUpload.update({
              where: { id: img.id },
              data: { isPublic: !img.isPublic },
            }),
          );
          await Promise.all(updates);
          return NextResponse.json({ updated: images.length });
        }

        default:
          return NextResponse.json(
            { error: "不支持的操作，可选: delete / moveAlbum / togglePublic" },
            { status: 400 },
          );
      }
    },
  );
}
