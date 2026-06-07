import { unlink } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { logError } from "@/lib/logging";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";

export const dynamic = "force-dynamic";

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function unlinkIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

function imageVariantPaths(root: string, storageKey: string) {
  const ext = path.extname(storageKey);
  const base = path.basename(storageKey, ext);
  const subDir = path.dirname(storageKey);
  return [
    path.join(root, storageKey),
    path.join(root, subDir, `${base}_thumb.webp`),
    path.join(root, subDir, `${base}.webp`),
    path.join(root, subDir, `${base}.avif`),
  ];
}

function canDeleteImage(input: { ownerId: string; session: SessionPayload }) {
  return (
    input.ownerId === input.session.userId ||
    sessionHasPermission(input.session, "storage:delete") ||
    sessionHasPermission(input.session, "role:manage")
  );
}

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

      // Only owner or explicit destructive/admin permissions can delete.
      // `user:read` is intentionally not enough because viewer accounts have it.
      if (!canDeleteImage({ ownerId: image.userId, session })) {
        return NextResponse.json({ error: "无权删除" }, { status: 403 });
      }

      // If linked to a LOCAL storage node, delete the published copy before the
      // index row. Do not report success if the real storage-side delete fails.
      if (image.storageNodeId && image.relativePath) {
        const storageNode = await prisma.storageNode.findUnique({
          where: { id: image.storageNodeId },
          select: { basePath: true, driver: true },
        });
        if (storageNode?.driver === "LOCAL") {
          const resolvedDir = resolveStoragePathWithinBase(
            storageNode.basePath,
            image.relativePath,
          );
          if (!resolvedDir.ok) {
            return NextResponse.json(
              { error: resolvedDir.reason },
              { status: 400 },
            );
          }
          try {
            await unlinkIfPresent(path.join(resolvedDir.path, image.storageKey));
          } catch (error) {
            logError("image-bed:delete-storage-copy", error);
            return NextResponse.json(
              { error: "存储节点图片副本删除失败，记录未删除" },
              { status: 502 },
            );
          }
        }
      }

      // Delete local image-bed files before removing the DB record. Missing files
      // are already absent, but permission/I/O failures keep the row intact so
      // the UI does not claim deletion while files remain served from disk.
      try {
        for (const filePath of imageVariantPaths(UPLOAD_DIR, image.storageKey)) {
          await unlinkIfPresent(filePath);
        }
      } catch (error) {
        logError("image-bed:delete-local-files", error);
        return NextResponse.json(
          { error: "图片文件删除失败，记录未删除" },
          { status: 502 },
        );
      }

      await prisma.imageUpload.delete({ where: { id } });

      return NextResponse.json({ success: true });
    },
  );
}
