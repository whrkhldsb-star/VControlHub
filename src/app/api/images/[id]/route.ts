import { unlink } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { logError } from "@/lib/logging";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
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
    sessionHasPermission(input.session, "media:manage") ||
    sessionHasPermission(input.session, "team:manage") ||
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
      permission: "image:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorMessage: "Delete failed",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
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
        throw new NotFoundError("Image not found");

      // Only owner or explicit destructive/admin permissions can delete.
      // `user:read` is intentionally not enough because viewer accounts have it.
      if (!canDeleteImage({ ownerId: image.userId, session })) {
        throw new ForbiddenError("No permission to delete");
      }

      // If linked to a LOCAL storage node visible under the caller's team,
      // delete the published copy before the index row. Do not report success
      // if the real storage-side delete fails. Cross-team node ids are ignored
      // for physical delete + index cascade (image-bed files still removed).
      let linkedStorageInTeam = false;
      if (image.storageNodeId && image.relativePath) {
        const storageNode = await prisma.storageNode.findFirst({
          where: { id: image.storageNodeId, ...teamWhere(session) },
          select: { basePath: true, driver: true },
        });
        if (storageNode) {
          linkedStorageInTeam = true;
          if (storageNode.driver === "LOCAL") {
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
              // New records store the full relative file path; legacy records
              // stored only the directory. Support both shapes during deletion.
              const linkedFilePath =
                path.basename(image.relativePath) === image.storageKey
                  ? resolvedDir.path
                  : path.join(resolvedDir.path, image.storageKey);
              await unlinkIfPresent(linkedFilePath);
            } catch (error) {
              logError("image-bed:delete-storage-copy", error);
              return NextResponse.json(
                { error: "Failed to delete image copy from storage node, record not deleted" },
                { status: 502 },
              );
            }
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
          { error: "Failed to delete image file, record not deleted" },
          { status: 502 },
        );
      }

      const ownsLinkedStorageCopy = Boolean(
        linkedStorageInTeam &&
        image.storageNodeId &&
        image.relativePath &&
        path.basename(image.relativePath) === image.storageKey,
      );
      if (ownsLinkedStorageCopy) {
        await prisma.$transaction([
          prisma.mediaItem.deleteMany({
            where: {
              storageNodeId: image.storageNodeId!,
              relativePath: image.relativePath!,
            },
          }),
          prisma.fileEntry.deleteMany({
            where: {
              storageNodeId: image.storageNodeId!,
              relativePath: image.relativePath!,
            },
          }),
          prisma.imageUpload.delete({ where: { id } }),
        ]);
      } else {
        await prisma.imageUpload.delete({ where: { id } });
      }

      await auditUserAction(session?.userId ?? "", "image.delete", { imageId: id }, undefined, session?.currentTeamId);
      return NextResponse.json({ success: true });
    },
  );
}
