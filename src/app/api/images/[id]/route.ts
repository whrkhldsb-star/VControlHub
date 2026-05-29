import { unlink } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { logError } from "@/lib/logging";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorMessage: "删除失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const { id } = await params;

      const image = await prisma.imageUpload.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          storageKey: true,
          storageNodeId: true,
          relativePath: true,
        },
      });

      if (!image)
        return NextResponse.json({ error: "图片不存在" }, { status: 404 });

      // Only owner or admin can delete
      if (
        image.userId !== session.userId &&
        !sessionHasPermission(session, "user:read")
      ) {
        return NextResponse.json({ error: "无权删除" }, { status: 403 });
      }

      // Delete local file
      try {
        await unlink(path.join(UPLOAD_DIR, image.storageKey));
      } catch {
        // File may already be gone
      }

      // If linked to storage node, also delete from storage path
      if (image.storageNodeId && image.relativePath) {
        try {
          const storageNode = await prisma.storageNode.findUnique({
            where: { id: image.storageNodeId },
            select: { basePath: true, driver: true },
          });
          if (storageNode?.driver === "LOCAL" && image.relativePath) {
            const resolvedDir = resolveStoragePathWithinBase(
              storageNode.basePath,
              image.relativePath,
            );
            if (resolvedDir.ok) {
              await unlink(path.join(resolvedDir.path, image.storageKey)).catch(
                () => {},
              );
            }
          }
        } catch (error) {
          logError("image-bed:delete-storage-copy", error);
        }
      }

      await prisma.imageUpload.delete({ where: { id } });

      return NextResponse.json({ success: true });
    },
  );
}
